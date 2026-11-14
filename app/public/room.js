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

const roomId = location.pathname.split('/').pop();
const hash = new URLSearchParams(location.hash.slice(1));
const e2eeKey = hash.get('k');
let hostKey = hash.get('h') ?? storage.get(sessionStorage, `host:${roomId}`);

// Tira a chave de anfitrião da barra de endereço para ela não vazar num copiar/colar
if (hash.get('h') && storage.set(sessionStorage, `host:${roomId}`, hostKey)) {
  history.replaceState(null, '', `${location.pathname}#k=${e2eeKey}`);
}

const inviteLink = `${location.origin}/r/${roomId}#k=${e2eeKey}`;

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
    li.append(avatar, meta, el('p', 'text', text));
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
    showOverlay(isHost ? 'Clique no botão de tela, embaixo, para começar a transmitir.' : 'Aguardando a transmissão começar…');
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
    }, 3000);
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
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      addMessage(`${p.name} saiu.`);
      updateCount();
    })
    .on(RoomEvent.EncryptionError, () => {
      showOverlay('Não foi possível descriptografar a transmissão. O link está completo?');
    })
    .on(RoomEvent.Disconnected, (reason) => {
      setVideoTrack(null);
      showOverlay(
        reason === DisconnectReason.ROOM_DELETED ? 'A sala foi encerrada.' : 'Você foi desconectado. Recarregue a página para voltar.',
      );
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

const setupHost = () => {
  $('host-controls').hidden = false;
  $('invite').hidden = false;
  $('invite-link').value = inviteLink;
  setupSettings();
  showOverlay('Clique no botão de tela, embaixo, para começar a transmitir.');

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

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      $('copy').textContent = 'Copiado!';
    } catch {
      $('invite-link').select();
    }
    setTimeout(() => ($('copy').textContent = 'Copiar convite'), 1500);
  });

  $('end').addEventListener('click', async () => {
    if (!confirm('Encerrar a sala para todos?')) return;
    const res = await fetch('/api/rooms/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, hostKey }),
    });
    if (!res.ok) addMessage('Não foi possível encerrar a sala.');
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

$('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || !room) return;
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
  setVideoTrack(videoTrack);
  updateCount();
  addMessage(isHost ? 'Você é o anfitrião desta sala.' : 'Você entrou na sala.');
});
