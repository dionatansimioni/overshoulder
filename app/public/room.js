import {
  AudioPresets,
  DisconnectReason,
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  createLocalAudioTrack,
  isE2EESupported,
} from '/vendor/livekit-client.esm.mjs';
import { CATEGORIES, RECENT_ID, RECENT_MAX, isOnlyEmoji } from '/static/emoji.js';

const $ = (id) => document.getElementById(id);

const PRESETS = {
  '720p30': { width: 1280, height: 720, fps: 30, bitrate: 3_000_000 },
  '720p60': { width: 1280, height: 720, fps: 60, bitrate: 4_500_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 7_000_000 },
  '1440p60': { width: 2560, height: 1440, fps: 60, bitrate: 12_000_000 },
};

// Camadas menores do simulcast: o SFU entrega a cada amigo a que a conexão dele aguenta
const SIMULCAST_LAYERS = [
  new VideoPreset(1280, 720, 1_500_000, 30),
  new VideoPreset(640, 360, 500_000, 15),
];

const storage = {
  get: (s, k) => { try { return s.getItem(k); } catch { return null; } },
  set: (s, k, v) => { try { s.setItem(k, v); return true; } catch { return false; } },
};

// --- link: /r/<sala>#k=<chave E2EE>&h=<chave de anfitrião> -----------------

// O código da sala muda quando o anfitrião troca o link (ou remove alguém)
let roomId = location.pathname.split('/').pop();
const hash = new URLSearchParams(location.hash.slice(1));
const e2eeKey = hash.get('k');
let hostKey = hash.get('h') ?? storage.get(sessionStorage, `host:${roomId}`);

// Tira a chave de anfitrião da barra de endereço para ela não vazar num copiar/colar
if (hash.get('h') && storage.set(sessionStorage, `host:${roomId}`, hostKey)) {
  history.replaceState(null, '', `${location.pathname}#k=${e2eeKey}`);
}

const inviteLink = () => `${location.origin}/r/${roomId}#k=${e2eeKey}`;

// --- UI helpers ------------------------------------------------------------

const video = $('video');
const overlay = $('overlay');

const showOverlay = (text) => {
  overlay.textContent = text;
  overlay.hidden = false;
};

// Cor do avatar derivada do nome, para cada pessoa manter a mesma cor
const AVATAR_COLORS = ['#5b8cff', '#2fb37a', '#e0a33a', '#d9568f', '#8f6cf0', '#3fb3c8', '#e5733f'];
const avatarColor = (name) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const addMessage = (text, author) => {
  const li = el('li');
  if (author) {
    li.className = 'msg';
    const avatar = el('span', 'avatar', [...author][0]?.toUpperCase() ?? '?');
    avatar.style.background = avatarColor(author);
    const meta = el('div', 'meta');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.append(el('span', 'author', author), el('span', 'time', time));
    li.append(avatar, meta, el('p', isOnlyEmoji(text) ? 'text jumbo' : 'text', text));
  } else {
    li.className = 'system';
    li.textContent = text;
  }
  const list = $('messages');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(li);
  if (atBottom) list.scrollTop = list.scrollHeight;
};

const joinError = (msg) => {
  $('join-error').textContent = msg;
  $('join-error').hidden = false;
};

// --- sala ------------------------------------------------------------------

let room;
let isHost = false;
let isPresenter = false;
// Estado da sala que o anfitrião controla, recebido pelos metadados da sala
let meta = { chat: true, presenter: null };
let videoTrack = null;
let extraAudio = null;
let voiceTrack = null;
const audioTracks = new Set();

// Nome da faixa de voz do anfitrião; os espectadores mostram o aviso de microfone por ela
const VOICE_TRACK = 'voice';

const updateCount = () => {
  const n = room.remoteParticipants.size + 1;
  $('count').textContent = `${n} ${n === 1 ? 'pessoa' : 'pessoas'} na sala`;
};

const setVideoTrack = (track) => {
  if (videoTrack) videoTrack.detach(video);
  videoTrack = track;
  if (track) {
    track.attach(video);
    overlay.hidden = true;
  } else {
    showOverlay(
      isHost || isPresenter ? 'Clique no botão de tela, embaixo, para começar a transmitir.' : 'Aguardando a transmissão começar…',
    );
  }
};

// A mensagem de quem acabou de entrar pode chegar antes do aviso de entrada:
// espera esse aviso por um tempo antes de desistir do nome
const participantName = (identity) => {
  const known = room.remoteParticipants.get(identity);
  if (known) return Promise.resolve(known.name);
  return new Promise((resolve) => {
    const onJoin = (p) => {
      if (p.identity !== identity) return;
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve(p.name);
    };
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve('?');
    }, 10_000);
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });
};

const wireRoomEvents = () => {
  room
    .on(RoomEvent.TrackSubscribed, (track, pub) => {
      if (pub.trackName === VOICE_TRACK) $('mic-badge').hidden = false;
      if (track.kind === Track.Kind.Video) {
        setVideoTrack(track);
      } else if (track.kind === Track.Kind.Audio) {
        audioTracks.add(track);
        $('audio-sink').append(track.attach());
        track.setVolume(Number($('volume').value));
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
      if (pub.trackName === VOICE_TRACK) $('mic-badge').hidden = true;
      track.detach().forEach((el) => el !== video && el.remove());
      audioTracks.delete(track);
      if (track === videoTrack) setVideoTrack(null);
    })
    .on(RoomEvent.LocalTrackPublished, (pub) => {
      if (pub.source === Track.Source.ScreenShare) {
        setVideoTrack(pub.track);
        setShareButton(true);
      }
    })
    .on(RoomEvent.LocalTrackUnpublished, (pub) => {
      if (pub.source === Track.Source.ScreenShare) {
        // Também dispara quando se clica em "Parar de compartilhar" na barra do navegador
        setVideoTrack(null);
        setShareButton(false);
        stopExtraAudio();
      }
    })
    .on(RoomEvent.ParticipantConnected, (p) => {
      addMessage(`${p.name} entrou.`);
      updateCount();
      renderPeople();
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      addMessage(`${p.name} saiu.`);
      updateCount();
      renderPeople();
    })
    .on(RoomEvent.RoomMetadataChanged, applyMetadata)
    .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
      // Só importa a própria permissão: o anfitrião passou ou pegou de volta a vez de apresentar
      if (!isHost && (!participant || participant === room.localParticipant)) {
        setPresenterMode(!!room.localParticipant.permissions?.canPublish);
      }
    })
    .on(RoomEvent.EncryptionError, () => {
      showOverlay('Não foi possível descriptografar a transmissão. O link está completo?');
    })
    .on(RoomEvent.Disconnected, (reason) => {
      setVideoTrack(null);
      showOverlay(
        reason === DisconnectReason.ROOM_DELETED
          ? 'A sala foi encerrada.'
          : reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'Você foi removido da sala pelo anfitrião.'
            : 'Você foi desconectado. Recarregue a página para voltar.',
      );
      $('chat-input').disabled = true;
      $('host-controls').hidden = true;
      $('mic-badge').hidden = true;
      voiceTrack?.stop();
      $('invite').hidden = true;
    });

  room.registerTextStreamHandler('chat', async (reader, info) => {
    const text = await reader.readAll();
    addMessage(text, await participantName(info.identity));
  });
};

const connect = async (name) => {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, hostKey, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Não foi possível entrar na sala.');
  isHost = data.role === 'host';

  const keyProvider = new ExternalE2EEKeyProvider();
  room = new Room({
    adaptiveStream: true,
    dynacast: true,
    e2ee: {
      keyProvider,
      worker: new Worker('/vendor/livekit-client.e2ee.worker.mjs', { type: 'module' }),
    },
  });
  wireRoomEvents();

  await keyProvider.setKey(e2eeKey);
  await room.setE2EEEnabled(true);
  await room.connect(data.url, data.token);
};

// --- estado da sala: chat, apresentador e lista de pessoas -------------------

const nameOf = (identity) =>
  identity === room.localParticipant.identity
    ? room.localParticipant.name
    : (room.remoteParticipants.get(identity)?.name ?? 'alguém');

function applyMetadata() {
  try {
    meta = { chat: true, presenter: null, ...JSON.parse(room.metadata || '{}') };
  } catch {}
  const input = $('chat-input');
  const blocked = !meta.chat && !isHost;
  input.disabled = blocked;
  input.placeholder = blocked ? 'O anfitrião desligou o chat' : 'Conversar na sala';
  $('emoji-btn').disabled = blocked;
  $('chat-toggle').textContent = meta.chat ? 'Desligar chat' : 'Ligar chat';
  const badge = $('presenter-badge');
  badge.hidden = !meta.presenter;
  if (meta.presenter) badge.textContent = `${nameOf(meta.presenter)} está apresentando`;
  renderPeople();
}

// Ação do anfitrião sobre a sala; devolve a resposta ou mostra o erro no chat
const hostAction = async (path, extra = {}) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, hostKey, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    addMessage(data.error ?? 'Não foi possível concluir a ação.');
    return null;
  }
  return data;
};

// O link mudou: atualiza a barra de endereço, o convite e onde a chave de anfitrião fica guardada
const switchRoomCode = (code, why) => {
  roomId = code;
  storage.set(sessionStorage, `host:${roomId}`, hostKey);
  history.replaceState(null, '', `/r/${roomId}#k=${e2eeKey}`);
  $('invite-link').value = inviteLink();
  addMessage(`${why} O link antigo não serve mais: envie o novo a quem ainda vai entrar.`);
};

const renderPeople = () => {
  if (!room) return;
  const everyone = [room.localParticipant, ...room.remoteParticipants.values()];
  $('people').replaceChildren(
    ...everyone.map((p) => {
      const li = el('li', 'person');
      li.dataset.identity = p.identity;
      const avatar = el('span', 'avatar', [...(p.name || '?')][0].toUpperCase());
      avatar.style.background = avatarColor(p.name || '?');
      const tags = [
        p.identity.startsWith('h-') ? 'anfitrião' : null,
        meta.presenter === p.identity ? 'apresentando' : null,
        p === room.localParticipant ? 'você' : null,
      ].filter(Boolean);
      const info = el('div', 'person-info');
      info.append(el('span', 'author', p.name || '?'), el('span', 'muted small', tags.join(' · ')));
      li.append(avatar, info);
      if (isHost && p.identity.startsWith('v-')) {
        const actions = el('div', 'person-actions');
        const presenting = meta.presenter === p.identity;
        const pass = el('button', 'secondary', presenting ? 'Retomar a vez' : 'Passar a vez');
        pass.type = 'button';
        pass.dataset.action = 'presenter';
        pass.addEventListener('click', () => passPresenter(presenting ? null : p.identity));
        const kick = el('button', 'danger', 'Remover');
        kick.type = 'button';
        kick.dataset.action = 'kick';
        kick.addEventListener('click', async () => {
          if (!confirm(`Remover ${p.name} da sala? O link da sala será trocado para que essa pessoa não volte.`)) return;
          const data = await hostAction('/api/rooms/kick', { identity: p.identity });
          if (data) switchRoomCode(data.roomId, `${p.name} foi removido.`);
        });
        actions.append(pass, kick);
        li.append(actions);
      }
      return li;
    }),
  );
};

const passPresenter = async (identity) => {
  // Um apresentador por vez: o anfitrião para a própria tela e o microfone antes de passar a vez
  if (identity) await stopPublishing();
  const data = await hostAction('/api/rooms/presenter', { identity });
  if (data) addMessage(identity ? `${nameOf(identity)} agora pode apresentar.` : 'Você retomou a vez de apresentar.');
};

const showTab = (tab) => {
  const people = tab === 'people';
  $('tab-chat').setAttribute('aria-selected', String(!people));
  $('tab-people').setAttribute('aria-selected', String(people));
  $('people').hidden = !people;
  $('messages').hidden = people;
  $('chat-form').hidden = people;
  $('chat-tools').hidden = people || !isHost;
  if (people) renderPeople();
};
$('tab-chat').addEventListener('click', () => showTab('chat'));
$('tab-people').addEventListener('click', () => showTab('people'));

// --- anfitrião -------------------------------------------------------------

const setShareButton = (on) => {
  const btn = $('share');
  const label = on ? 'Parar de compartilhar' : 'Compartilhar tela';
  btn.classList.toggle('on', on);
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.querySelector('use').setAttribute('href', on ? '#i-screen-off' : '#i-screen');
};

const setMicButton = (on) => {
  const btn = $('mic');
  const label = on ? 'Desligar microfone' : 'Ligar microfone';
  btn.classList.toggle('on', on);
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(on));
  btn.querySelector('use').setAttribute('href', on ? '#i-mic' : '#i-mic-off');
};

// Voz do anfitrião: independente da tela, com os filtros de voz do navegador ligados
const toggleMic = async () => {
  if (voiceTrack) {
    const track = voiceTrack;
    voiceTrack = null;
    setMicButton(false);
    await room.localParticipant.unpublishTrack(track).catch(() => {});
    track.stop();
    return;
  }
  const deviceId = $('mic-device').value;
  const track = await createLocalAudioTrack({
    ...(deviceId && { deviceId: { exact: deviceId } }),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  await room.localParticipant.publishTrack(track, {
    source: Track.Source.Microphone,
    name: VOICE_TRACK,
    audioPreset: AudioPresets.speech,
    dtx: true,
  });
  voiceTrack = track;
  setMicButton(true);
};

const setupSettings = () => {
  const btn = $('settings-btn');
  const panel = $('settings');
  const toggle = (open) => {
    panel.hidden = !open;
    btn.classList.toggle('on', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => toggle(panel.hidden));
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) toggle(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && toggle(false));
};

const stopExtraAudio = async () => {
  if (!extraAudio) return;
  const track = extraAudio;
  extraAudio = null;
  await room.localParticipant.unpublishTrack(track).catch(() => {});
  track.stop();
};

const startShare = async () => {
  const p = PRESETS[$('quality').value];
  const codec = $('codec').value;

  await room.localParticipant.setScreenShareEnabled(
    true,
    {
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      contentHint: 'motion',
      resolution: { width: p.width, height: p.height, frameRate: p.fps },
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    },
    {
      videoCodec: codec,
      // Quem não decodifica VP9/AV1 recebe H.264
      backupCodec: codec === 'h264' ? false : { codec: 'h264' },
      screenShareEncoding: { maxBitrate: p.bitrate, maxFramerate: p.fps },
      screenShareSimulcastLayers: SIMULCAST_LAYERS.filter((l) => l.height < p.height),
      degradationPreference: 'maintain-framerate',
      dtx: false,
    },
  );

  const deviceId = $('audio-device').value;
  if (deviceId) {
    extraAudio = await createLocalAudioTrack({
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    });
    await room.localParticipant.publishTrack(extraAudio, {
      source: Track.Source.ScreenShareAudio,
      name: 'game-audio',
      audioPreset: AudioPresets.musicHighQualityStereo,
      forceStereo: true,
      dtx: false,
      red: false,
    });
  }
};

// Para tela, voz e áudio do jogo que esta pessoa estiver transmitindo
const stopPublishing = async () => {
  if (room.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
  await stopExtraAudio();
  if (voiceTrack) await toggleMic().catch(() => {});
};

// Quem recebe a vez do anfitrião ganha os controles de tela e microfone (sem encerrar a sala)
const setPresenterMode = async (on) => {
  if (on === isPresenter) return;
  isPresenter = on;
  if (on) {
    setupPublishControls();
    $('host-controls').hidden = false;
    $('end').hidden = true;
    addMessage('O anfitrião passou a vez para você: compartilhe a tela ou ligue o microfone.');
  } else {
    $('host-controls').hidden = true;
    await stopPublishing();
    setShareButton(false);
    setMicButton(false);
    addMessage('A vez de apresentar voltou para o anfitrião.');
  }
  if (!videoTrack) setVideoTrack(null);
};

const setupHost = () => {
  setupPublishControls();
  $('host-controls').hidden = false;
  $('invite').hidden = false;
  $('invite-link').value = inviteLink();
  $('chat-tools').hidden = false;
  showOverlay('Clique no botão de tela, embaixo, para começar a transmitir.');

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      $('copy').textContent = 'Copiado!';
    } catch {
      $('invite-link').select();
    }
    setTimeout(() => ($('copy').textContent = 'Copiar convite'), 1500);
  });

  $('new-link').addEventListener('click', async () => {
    if (!confirm('Gerar um link novo? O link atual deixa de funcionar para quem ainda não entrou.')) return;
    const data = await hostAction('/api/rooms/link');
    if (data) switchRoomCode(data.roomId, 'Link da sala trocado.');
  });

  $('chat-toggle').addEventListener('click', async () => {
    const data = await hostAction('/api/rooms/chat', { enabled: !meta.chat });
    if (data) addMessage(data.chat ? 'Você ligou o chat.' : 'Você desligou o chat para quem assiste.');
  });

  $('end').addEventListener('click', async () => {
    if (!confirm('Encerrar a sala para todos?')) return;
    if (!(await hostAction('/api/rooms/end'))) addMessage('Não foi possível encerrar a sala.');
  });
};

// Tela, microfone e ajustes: usados pelo anfitrião e por quem recebe a vez de apresentar
let publishControlsReady = false;
const setupPublishControls = () => {
  if (publishControlsReady) return;
  publishControlsReady = true;
  setupSettings();

  if (!navigator.mediaDevices?.getDisplayMedia) {
    $('share').disabled = true;
    showOverlay('Este navegador não permite compartilhar a tela. Use Chrome, Edge ou Firefox no computador.');
  }

  $('share').addEventListener('click', async () => {
    const btn = $('share');
    btn.disabled = true;
    try {
      if (room.localParticipant.isScreenShareEnabled) {
        await room.localParticipant.setScreenShareEnabled(false);
        await stopExtraAudio();
      } else {
        await startShare();
      }
    } catch (err) {
      // Cancelar o seletor de tela do navegador cai aqui; não é erro
      if (err?.name !== 'NotAllowedError') addMessage(`Erro ao compartilhar: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  $('mic').addEventListener('click', async () => {
    const btn = $('mic');
    btn.disabled = true;
    try {
      await toggleMic();
    } catch (err) {
      addMessage(err?.name === 'NotAllowedError' ? 'Permissão de microfone negada.' : `Erro no microfone: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  $('mic-device').addEventListener('change', (e) => {
    voiceTrack?.setDeviceId(e.target.value || 'default').catch(() => addMessage('Não foi possível trocar o microfone.'));
  });

  $('load-devices').addEventListener('click', async () => {
    try {
      // Pede permissão uma vez para o navegador revelar os nomes dos dispositivos
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      addMessage('Permissão de áudio negada.');
      return;
    }
    const selects = [$('mic-device'), $('audio-device')];
    for (const select of selects) select.length = 1;
    for (const d of await navigator.mediaDevices.enumerateDevices()) {
      if (d.kind !== 'audioinput' || d.deviceId === 'default' || d.deviceId === 'communications') continue;
      for (const select of selects) select.add(new Option(d.label || d.deviceId, d.deviceId));
    }
    addMessage('Dispositivos carregados. No Linux, escolha o “Monitor of …” da sua saída de som.');
  });
};

// --- espectador ------------------------------------------------------------

const setupViewer = () => {
  $('viewer-controls').hidden = false;

  $('volume').addEventListener('input', (e) => {
    for (const t of audioTracks) t.setVolume(Number(e.target.value));
  });

  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : $('player').requestFullscreen();
  $('fullscreen').addEventListener('click', toggleFullscreen);
  video.addEventListener('dblclick', toggleFullscreen);

  setInterval(() => {
    if (!videoTrack || !video.videoWidth) return ($('stats').textContent = '');
    const mbps = (videoTrack.currentBitrate / 1e6).toFixed(1);
    $('stats').textContent = `${video.videoWidth}×${video.videoHeight} · ${mbps} Mbps`;
  }, 1000);
};

// --- chat ------------------------------------------------------------------

// --- emojis ----------------------------------------------------------------

const picker = $('emoji-picker');
const emojiBtn = $('emoji-btn');

const recentEmojis = () => {
  try {
    const list = JSON.parse(storage.get(localStorage, 'emoji-recent') ?? '[]');
    return Array.isArray(list) ? list.filter((e) => typeof e === 'string') : [];
  } catch {
    return [];
  }
};

const rememberEmoji = (emoji) => {
  const list = [emoji, ...recentEmojis().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  storage.set(localStorage, 'emoji-recent', JSON.stringify(list));
};

const showCategory = (id) => {
  const recent = { id: RECENT_ID, label: 'Usados recentemente', emojis: recentEmojis() };
  const category = id === RECENT_ID ? recent : CATEGORIES.find((c) => c.id === id);
  for (const tab of picker.querySelectorAll('.emoji-tabs button')) {
    tab.setAttribute('aria-selected', String(tab.dataset.category === category.id));
  }
  picker.querySelector('.emoji-title').textContent = category.label;
  const grid = picker.querySelector('.emoji-grid');
  grid.replaceChildren(
    ...category.emojis.map((emoji) => {
      const b = el('button', null, emoji);
      b.type = 'button';
      b.dataset.emoji = emoji;
      return b;
    }),
  );
  if (!category.emojis.length) grid.append(el('p', 'empty', 'Os emojis que você usar aparecem aqui.'));
};

const toggleEmojiPicker = (open) => {
  picker.hidden = !open;
  emojiBtn.setAttribute('aria-expanded', String(open));
  if (open) showCategory(recentEmojis().length ? RECENT_ID : CATEGORIES[0].id);
};

const insertEmoji = (emoji) => {
  const input = $('chat-input');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  if (input.value.length - (end - start) + emoji.length > input.maxLength) return;
  input.setRangeText(emoji, start, end, 'end');
  input.focus();
  rememberEmoji(emoji);
};

picker.querySelector('.emoji-tabs').append(
  ...[{ id: RECENT_ID, label: 'Usados recentemente', icon: '🕘' }, ...CATEGORIES].map((c) => {
    const b = el('button', null, c.icon ?? c.emojis[0]);
    b.type = 'button';
    b.title = c.label;
    b.setAttribute('role', 'tab');
    b.dataset.category = c.id;
    return b;
  }),
);

// Clicar no seletor não tira o foco (nem a posição do cursor) do campo de mensagem
picker.addEventListener('mousedown', (e) => e.preventDefault());
picker.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.dataset.category) showCategory(button.dataset.category);
  else if (button.dataset.emoji) insertEmoji(button.dataset.emoji);
});
emojiBtn.addEventListener('click', () => toggleEmojiPicker(picker.hidden));
document.addEventListener('click', (e) => {
  if (!picker.hidden && !picker.contains(e.target) && !emojiBtn.contains(e.target)) toggleEmojiPicker(false);
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && !picker.hidden && toggleEmojiPicker(false));

// --- envio -----------------------------------------------------------------

$('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  toggleEmojiPicker(false);
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || !room || input.disabled) return;
  input.value = '';
  addMessage(text, room.localParticipant.name);
  try {
    await room.localParticipant.sendText(text, { topic: 'chat' });
  } catch {
    addMessage('Mensagem não enviada.');
  }
});

// --- entrada ---------------------------------------------------------------

$('name').value = storage.get(localStorage, 'name') ?? '';

if (!e2eeKey) {
  joinError('Link incompleto: falta a chave da sala. Peça o link de novo.');
  $('join-form').querySelector('button').disabled = true;
} else if (!isE2EESupported()) {
  joinError('Seu navegador não suporta criptografia de ponta a ponta. Use Chrome, Edge, Firefox ou Safari atualizados.');
  $('join-form').querySelector('button').disabled = true;
}

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  storage.set(localStorage, 'name', name);
  const btn = e.target.querySelector('button');
  btn.disabled = true;

  try {
    await connect(name);
  } catch (err) {
    joinError(err.message);
    btn.disabled = false;
    return;
  }

  $('join').hidden = true;
  $('room').hidden = false;
  if (isHost) setupHost();
  else setupViewer();
  applyMetadata();
  setVideoTrack(videoTrack);
  updateCount();
  addMessage(isHost ? 'Você é o anfitrião desta sala.' : 'Você entrou na sala.');
});
