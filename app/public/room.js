import {
  AudioPresets,
  DisconnectReason,
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  VideoPresets,
  VideoQuality,
  createLocalAudioTrack,
  createLocalVideoTrack,
  isE2EESupported,
} from '/vendor/livekit-client.esm.mjs';
import { CATEGORIES, RECENT_ID, RECENT_MAX, isOnlyEmoji } from '/static/emoji.js';
import { lang, mountLanguageSwitch, t, translatePage } from '/static/i18n.js';
import { PRESETS, HEAVY_HEIGHT, QUALITY_LABELS, bandwidthWarning, limitQualitySelect } from '/static/quality.js';
import { createNetworkWatch, summarizeSend } from '/static/send-stats.js';
import { Recorder, recordingFormat } from '/static/recorder.js';
import { finishPreview, setupPreview } from '/static/preview.js';
import { rememberRoom, renameRoom } from '/static/rooms-local.js';
import { mountRoomList } from '/static/room-list.js';
import { api, copyText } from '/static/ui.js';

translatePage();
mountLanguageSwitch();

const $ = (id) => document.getElementById(id);

// Camadas menores do simulcast: o SFU entrega a cada pessoa a que a conexão dela aguenta
const SIMULCAST_LAYERS = [
  new VideoPreset(1280, 720, 1_500_000, 30),
  new VideoPreset(640, 360, 500_000, 15),
];

// Fontes de mídia como o servidor as libera (TrackSource do protocolo do LiveKit)
const SOURCE = { camera: 1, microphone: 2, screen: 3 };

const storage = {
  get: (s, k) => { try { return s.getItem(k); } catch { return null; } },
  set: (s, k, v) => { try { s.setItem(k, v); return true; } catch { return false; } },
};

// --- link: /r/<sala>#k=<chave E2EE>&h=<chave de anfitrião> -----------------

// O código da sala muda quando o anfitrião troca o link (ou remove alguém)
let roomId = location.pathname.split('/').pop();
const hash = new URLSearchParams(location.hash.slice(1));
// Na volta do login corporativo o fragmento (#k=...) se perde: a chave fica guardada na aba durante a ida
let e2eeKey = hash.get('k');
const ssoKeyName = `e2ee:${roomId}`;
if (!e2eeKey && storage.get(sessionStorage, ssoKeyName)) {
  e2eeKey = storage.get(sessionStorage, ssoKeyName);
  history.replaceState(null, '', `${location.pathname}#k=${e2eeKey}`);
}
try {
  sessionStorage.removeItem(ssoKeyName);
} catch {}
let hostKey = hash.get('h') ?? storage.get(sessionStorage, `host:${roomId}`);

// Tira a chave de anfitrião da barra de endereço para ela não vazar num copiar/colar
if (hash.get('h') && storage.set(sessionStorage, `host:${roomId}`, hostKey)) {
  history.replaceState(null, '', `${location.pathname}#k=${e2eeKey}`);
}

const inviteLink = () => `${location.origin}/r/${roomId}#k=${e2eeKey}`;

// --- UI helpers ------------------------------------------------------------

const video = $('video');
const pipVideo = $('pip');
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

const button = (className, text, onClick) => {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
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

// Botão redondo que liga e desliga: rótulo, ícone e estado acompanham
const setToggle = (id, on, labels, icons) => {
  const btn = $(id);
  const label = t(on ? labels[1] : labels[0]);
  btn.classList.toggle('on', on);
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(on));
  if (icons) btn.querySelector('use').setAttribute('href', on ? icons[1] : icons[0]);
};

// --- sala ------------------------------------------------------------------

let room;
let isHost = false;
let token = null;
// Estado da sala que o anfitrião controla, recebido pelos metadados da sala
let meta = { type: 'live', openScreens: false, chat: true, recording: false, requests: [] };
let recorder = null;
// De quem é a tela (ou câmera) que estou assistindo
let watching = null;
let mainTrack = null;
let pipTrack = null;
let pipHidden = false;
let pipSwapped = false;
let voiceTrack = null;
let extraAudio = null;
let cameraTrack = null;
let shareHintShown = false;
// Quem transmite pode esconder a própria transmissão (fica guardado no navegador)
let selfHidden = storage.get(localStorage, 'hide-self') === '1';
// Último retrato do envio, para calcular a taxa a cada segundo
let lastSend = null;
// Tela sendo publicada de novo (troca de qualidade): não é o fim do compartilhamento
let republishing = false;
// Quais fontes eu podia publicar, para avisar quando o anfitrião libera ou tira
let allowed = { microphone: false, screen: false };
const audioTracks = new Set();
// Elemento <audio> de cada faixa recebida, para sair da página quando a faixa sai
const audioElements = new Map();

// Nomes das faixas: voz de quem fala e áudio extra do jogo
const VOICE_TRACK = 'voice';
const GAME_AUDIO_TRACK = 'game-audio';

// Todos os áudios da sala (vozes, jogo, de quem apresenta), para a gravação misturar
const roomAudio = new Set();
const addRoomAudio = (track) => {
  roomAudio.add(track);
  recorder?.addAudio(track);
};
const removeRoomAudio = (track) => {
  roomAudio.delete(track);
  recorder?.removeAudio(track);
};

const everyone = () => [room.localParticipant, ...room.remoteParticipants.values()];
const isMe = (p) => p === room.localParticipant;

const nameOf = (identity) =>
  identity === room.localParticipant.identity
    ? room.localParticipant.name
    : (room.remoteParticipants.get(identity)?.name ?? t('alguém'));

// O servidor decide o que cada um publica; a interface só acompanha
const can = (source) => {
  const perm = room?.localParticipant.permissions;
  if (!perm?.canPublish) return false;
  const sources = perm.canPublishSources ?? [];
  return sources.length === 0 || sources.includes(SOURCE[source]);
};

const updateCount = () => {
  const n = room.remoteParticipants.size + 1;
  $('count').textContent = t(n === 1 ? '{n} pessoa na sala' : '{n} pessoas na sala', { n });
};

// --- palco: quem está transmitindo, qual tela assistir, câmera sobre a tela -------

// Quem transmite vídeo agora (tela e/ou câmera)
const broadcasters = () =>
  everyone()
    .map((p) => ({
      p,
      screen: p.getTrackPublication(Track.Source.ScreenShare),
      camera: p.getTrackPublication(Track.Source.Camera),
    }))
    .filter((b) => b.screen || b.camera);

// Só recebe a tela, o áudio da tela e a câmera de quem estou assistindo; as vozes, de todos
const applySubscriptions = () => {
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      const want =
        pub.source === Track.Source.Microphone ||
        (p.identity === watching &&
          [Track.Source.ScreenShare, Track.Source.ScreenShareAudio, Track.Source.Camera].includes(pub.source));
      if (pub.isSubscribed !== want) pub.setSubscribed(want);
    }
  }
};

const attach = (track, element, current) => {
  if (current === track) return track;
  current?.detach(element);
  if (track) track.attach(element);
  else element.srcObject = null;
  return track;
};

const PIP_DEFAULT = { corner: 'br', size: 'm', shape: 'rounded' };
const parsePip = (value) => {
  const [corner, size, shape] = String(value ?? '').split(':');
  return corner && size && shape ? { corner, size, shape } : PIP_DEFAULT;
};
let myPip = (() => {
  try {
    return { ...PIP_DEFAULT, ...JSON.parse(storage.get(localStorage, 'pip') ?? '{}') };
  } catch {
    return PIP_DEFAULT;
  }
})();

const renderStage = () => {
  if (!room) return;
  const list = broadcasters();
  // Continua assistindo a mesma pessoa enquanto ela transmite; senão, a primeira das outras pessoas
  if (!list.some((b) => b.p.identity === watching)) {
    watching = (list.find((b) => !isMe(b.p)) ?? list[0])?.p.identity ?? null;
  }
  applySubscriptions();
  refreshWatchQuality();

  $('screens').hidden = list.length < 2;
  $('screens').replaceChildren(
    ...list.map((b) => {
      const label = isMe(b.p)
        ? t('Sua transmissão')
        : t(b.screen ? 'Tela de {name}' : 'Câmera de {name}', { name: b.p.name });
      const chip = button('screen-chip', label, () => {
        watching = b.p.identity;
        renderStage();
      });
      chip.dataset.identity = b.p.identity;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(b.p.identity === watching));
      return chip;
    }),
  );

  const current = list.find((b) => b.p.identity === watching);
  const screen = current?.screen?.track ?? null;
  const camera = current?.camera?.track ?? null;
  let main = screen ?? camera;
  let pip = screen && camera ? camera : null;
  if (pip && pipSwapped) [main, pip] = [pip, main];
  // A própria transmissão escondida: nada é reproduzido aqui, quem assiste continua vendo
  const mine = !!current && isMe(current.p) && !!main;
  const hideMine = mine && selfHidden;
  if (hideMine) main = pip = null;
  $('self-hidden').hidden = !hideMine;
  $('hide-self').hidden = !mine;
  setToggle('hide-self', selfHidden, ['Ocultar sua tela para você', 'Mostrar sua tela'], ['#i-eye', '#i-eye-off']);
  mainTrack = attach(main, video, mainTrack);
  pipTrack = attach(pipHidden ? null : pip, pipVideo, pipTrack);
  pipVideo.hidden = !pipTrack;
  const layout = current ? (isMe(current.p) ? myPip : parsePip(current.p.attributes?.pip)) : PIP_DEFAULT;
  pipVideo.className = `pip pip-${layout.corner} pip-${layout.size} pip-${layout.shape}`;
  $('pip-hide').hidden = $('pip-swap').hidden = !(screen && camera);

  overlay.hidden = true;
  $('voice-stage').hidden = !!main || hideMine;
  if (!main && !hideMine) {
    const presenting = can('screen');
    $('voice-hint').textContent = t(
      presenting ? 'Ninguém está transmitindo. Use o botão de tela, embaixo, para mostrar a sua.' : 'Ninguém está transmitindo agora.',
    );
    renderVoiceStage();
  }

  const presenter = current && !isMe(current.p) ? current.p : null;
  $('presenter-badge').hidden = !presenter;
  if (presenter) $('presenter-badge').textContent = t('{name} está apresentando', { name: presenter.name });
  // Microfone ligado de quem estou assistindo (ou do anfitrião, quando ninguém transmite)
  const speaker = current?.p ?? everyone().find((p) => p.identity.startsWith('h-'));
  const mic = speaker?.getTrackPublication(Track.Source.Microphone);
  $('mic-badge').hidden = !mic || mic.isMuted || isMe(speaker);

  // Na troca de qualidade a tela some por um instante: a gravação segue na mesma parte
  if (!republishing) {
    recorder?.switchVideo(screen?.mediaStreamTrack ?? (camera && !screen ? camera.mediaStreamTrack : null));
    recorder?.switchCamera(screen && camera ? camera.mediaStreamTrack : null);
  }
  renderPeople();
};

// Qualidade que quem assiste recebe: "Automática" ou uma das camadas que quem transmite envia,
// nunca acima. Vale na hora (o servidor passa a mandar a camada escolhida).
let watchQualityPub = null;
const watchedPublication = () => {
  if (!room || !watching || watching === room.localParticipant.identity) return null;
  const p = room.remoteParticipants.get(watching);
  const pub = p?.getTrackPublication(Track.Source.ScreenShare) ?? p?.getTrackPublication(Track.Source.Camera);
  return pub?.isSubscribed ? pub : null;
};
const refreshWatchQuality = () => {
  const pub = watchedPublication();
  const layers = (pub?.trackInfo?.layers ?? []).filter((l) => l.height > 0).sort((a, b) => b.height - a.height);
  // Sem camadas para escolher (transmissão sem simulcast), não há o que trocar
  $('watch-quality-row').hidden = layers.length < 2;
  if (layers.length < 2) return;
  const select = $('watch-quality');
  const keep = pub === watchQualityPub ? select.value : 'auto';
  select.length = 1;
  for (const l of layers) select.add(new Option(`${l.height}p`, String(l.quality)));
  select.value = [...select.options].some((o) => o.value === keep) ? keep : 'auto';
  if (pub !== watchQualityPub) {
    watchQualityPub = pub;
    pub.setVideoQuality(VideoQuality.HIGH);
  }
};

// Avisos de rede para quem transmite: um por episódio, com atalho para a qualidade de baixo
const netWatch = createNetworkWatch();
const showNetWarning = (text, action) => {
  $('net-warning-text').textContent = text;
  $('net-warning-action').hidden = !action;
  if (action) {
    $('net-warning-action').textContent = action.label;
    $('net-warning-action').onclick = () => {
      $('net-warning').hidden = true;
      action.run();
    };
  }
  $('net-warning').hidden = false;
};
const checkNetwork = (summary) => {
  const alerts = netWatch(summary);
  if (alerts.bandwidth) {
    const options = [...$('quality').options];
    const lower = options[options.findIndex((o) => o.value === $('quality').value) - 1];
    showNetWarning(
      t('Sua internet não está dando conta de transmitir em {quality}.', { quality: QUALITY_LABELS[$('quality').value] }),
      lower && {
        label: t('Usar {quality}', { quality: QUALITY_LABELS[lower.value] }),
        run: () => {
          $('quality').value = lower.value;
          updateQualityWarning();
          applyScreenSettings();
        },
      },
    );
  } else if (alerts.loss) {
    showNetWarning(t('Sua conexão está perdendo muitos pacotes ({pct}%). Quem assiste pode ver travamentos.', { pct: Math.round(summary.lossPct) }));
  }
};

// Sala só de voz: um cartão por pessoa, com destaque em quem está falando
const renderVoiceStage = () => {
  if (!room || $('voice-stage').hidden) return;
  $('voice-people').replaceChildren(
    ...everyone().map((p) => {
      const name = p.name || '?';
      const li = el('li', `voice-person${p.isSpeaking ? ' speaking' : ''}`);
      const avatar = el('span', 'avatar big-avatar', [...name][0].toUpperCase());
      avatar.style.background = avatarColor(name);
      const muted = !p.getTrackPublication(Track.Source.Microphone) || p.getTrackPublication(Track.Source.Microphone).isMuted;
      li.append(avatar, el('span', 'voice-name', isMe(p) ? t('{name} (você)', { name }) : name));
      if (muted) li.classList.add('muted-mic');
      li.dataset.identity = p.identity;
      return li;
    }),
  );
};

// --- controles: o que eu posso fazer agora --------------------------------------

const updateControls = () => {
  const mic = can('microphone');
  const screen = can('screen');
  $('mic').hidden = !mic;
  $('share').hidden = !screen;
  $('camera').hidden = !screen;
  $('record').hidden = !isHost || !recordingFormat();
  $('end').hidden = !isHost;
  // Ajustes valem para todos (o que se recebe); os da transmissão, só para quem pode transmitir
  $('broadcast-settings').hidden = !(mic || screen);
  $('host-controls').hidden = !(mic || screen);
  if (screen && !navigator.mediaDevices?.getDisplayMedia) {
    $('share').disabled = true;
    // Celulares não compartilham a tela: avisa uma vez e aponta o guia
    if (!shareHintShown) {
      shareHintShown = true;
      addMessage(t('Este navegador não compartilha a tela. Dá para transmitir com a câmera; para jogos de celular, veja o guia em {url}', { url: `${location.origin}/celular` }));
    }
  }

  // Pedidos: na Live, quem não pode falar pede a palavra; quem não pode mostrar a tela pede
  const mine = (kind) => meta.requests.some((r) => r.identity === room.localParticipant.identity && r.kind === kind);
  $('raise-hand').hidden = isHost || mic || meta.type !== 'live';
  $('ask-screen').hidden = isHost || screen || (meta.type === 'together' && meta.openScreens);
  $('request-controls').hidden = $('raise-hand').hidden && $('ask-screen').hidden;
  setToggle('raise-hand', mine('speak'), ['Pedir a palavra', 'Desistir de falar']);
  setToggle('ask-screen', mine('screen'), ['Pedir para mostrar a tela', 'Desistir de mostrar a tela']);

  // O anfitrião liberou ou tirou permissões: avisa e para o que não pode mais
  if (!isHost) {
    if (mic !== allowed.microphone && meta.type === 'live') {
      addMessage(t(mic ? 'O anfitrião liberou sua fala.' : 'O anfitrião encerrou sua fala.'));
    }
    if (screen !== allowed.screen && !(meta.type === 'together' && meta.openScreens)) {
      addMessage(t(screen ? 'O anfitrião liberou você para mostrar a tela.' : 'O anfitrião encerrou sua permissão de mostrar a tela.'));
    }
  }
  allowed = { microphone: mic, screen };
  if (!mic && voiceTrack) toggleMic().catch(() => {});
  if (!screen) stopVideo().catch(() => {});
};

// Para a tela, o áudio do jogo e a câmera que eu estiver transmitindo
const stopVideo = async () => {
  if (room.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
  await stopExtraAudio();
  if (cameraTrack) await toggleCamera().catch(() => {});
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
    .on(RoomEvent.TrackPublished, renderStage)
    .on(RoomEvent.TrackUnpublished, renderStage)
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        audioTracks.add(track);
        addRoomAudio(track.mediaStreamTrack);
        const element = track.attach();
        audioElements.set(track, element);
        $('audio-sink').append(element);
        track.setVolume(Number($('volume').value));
      }
      renderStage();
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        // O LiveKit já desanexa a faixa antes deste evento (detach() volta vazio): o elemento guardado sai
        track.detach();
        audioElements.get(track)?.remove();
        audioElements.delete(track);
        audioTracks.delete(track);
        removeRoomAudio(track.mediaStreamTrack);
      }
      renderStage();
    })
    .on(RoomEvent.TrackMuted, renderStage)
    .on(RoomEvent.TrackUnmuted, renderStage)
    .on(RoomEvent.LocalTrackPublished, (pub) => {
      if (pub.kind === Track.Kind.Audio) addRoomAudio(pub.track.mediaStreamTrack);
      if (pub.source === Track.Source.ScreenShare) setShareButton(true);
      // Quem começa a transmitir passa a ver a própria transmissão
      if (pub.kind === Track.Kind.Video) watching = room.localParticipant.identity;
      renderStage();
    })
    .on(RoomEvent.LocalTrackUnpublished, (pub) => {
      if (pub.kind === Track.Kind.Audio && pub.track) removeRoomAudio(pub.track.mediaStreamTrack);
      // Troca de qualidade: a tela sai e volta na hora, não é o fim do compartilhamento
      if (pub.source === Track.Source.ScreenShare && !republishing) {
        // Também dispara quando se clica em "Parar de compartilhar" na barra do navegador
        setShareButton(false);
        stopExtraAudio();
      }
      renderStage();
    })
    .on(RoomEvent.ParticipantConnected, (p) => {
      addMessage(t('{name} entrou.', { name: p.name }));
      updateCount();
      renderPeople();
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      addMessage(t('{name} saiu.', { name: p.name }));
      updateCount();
      renderStage();
    })
    .on(RoomEvent.ParticipantAttributesChanged, renderStage)
    .on(RoomEvent.ActiveSpeakersChanged, renderPeople)
    .on(RoomEvent.RoomMetadataChanged, applyMetadata)
    .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
      if (!participant || isMe(participant)) updateControls();
      renderPeople();
    })
    .on(RoomEvent.EncryptionError, () => {
      showOverlay(t('Não foi possível descriptografar a transmissão. O link está completo?'));
    })
    .on(RoomEvent.Disconnected, (reason) => {
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        $('room').hidden = true;
        $('ended').hidden = false;
      }
      mainTrack = attach(null, video, mainTrack);
      pipTrack = attach(null, pipVideo, pipTrack);
      pipVideo.hidden = true;
      $('voice-stage').hidden = true;
      showOverlay(
        t(
          reason === DisconnectReason.ROOM_DELETED
            ? 'A sala foi encerrada.'
            : 'Você foi desconectado. Recarregue a página para voltar.',
        ),
      );
      $('chat-input').disabled = true;
      if (recorder?.active) stopRecording();
      for (const id of ['host-controls', 'request-controls', 'mic-badge', 'presenter-badge', 'invite', 'screens', 'raise-hand', 'ask-screen'])
        $(id).hidden = true;
      voiceTrack?.stop();
      cameraTrack?.stop();
    });

  room.registerTextStreamHandler('chat', async (reader, info) => {
    const text = await reader.readAll();
    addMessage(text, await participantName(info.identity));
  });
};

// Ingresso guardado no navegador: voltar à sala (recarregar, cair a rede) não gasta o convite de
// novo nem pede senha ou sala de espera. Guardado por um resumo da chave da sala, nunca pela chave.
const ticketKey = async () => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e2eeKey));
  return `ticket:${[...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

let lobbyId = null;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Pede o token; na sala de espera, pergunta de novo a cada 2 s até o anfitrião decidir
const requestToken = async (name) => {
  const key = await ticketKey();
  for (;;) {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': lang },
      body: JSON.stringify({
        roomId,
        hostKey,
        name,
        ticket: hostKey ? undefined : storage.get(localStorage, key) ?? undefined,
        password: $('invite-password').value || undefined,
        lobbyId: lobbyId ?? undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 202) {
      lobbyId = data.lobbyId;
      $('waiting-msg').hidden = false;
      await pause(2000);
      continue;
    }
    $('waiting-msg').hidden = true;
    lobbyId = null;
    if (!res.ok) throw Object.assign(new Error(data.error ?? t('Não foi possível entrar na sala.')), { code: data.code });
    if (data.ticket) storage.set(localStorage, key, data.ticket);
    return data;
  }
};

const connect = async (name) => {
  const data = await requestToken(name);
  isHost = data.role === 'host';
  token = data.token;
  if (data.quality) limitQualitySelect($('quality'), data.quality);
  // Sala privada não fica guardada no navegador: a chave de anfitrião fica só nesta aba
  if (!data.room?.private) rememberRoom({ code: roomId, k: e2eeKey, h: isHost ? hostKey : undefined, type: data.room?.type, title: data.room?.title });

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
  // Assinatura manual: cada um recebe só a tela que escolheu assistir
  await room.connect(data.url, data.token, { autoSubscribe: false });
};

// --- estado da sala: tipo, chat, pedidos e lista de pessoas --------------------

let knownRequests = new Set();
let knownLobby = new Set();

function applyMetadata() {
  try {
    meta = { type: 'live', openScreens: false, chat: true, recording: false, requests: [], lobby: [], ...JSON.parse(room.metadata || '{}') };
  } catch {}
  const input = $('chat-input');
  const blocked = !meta.chat && !isHost;
  input.disabled = blocked;
  input.placeholder = t(blocked ? 'O anfitrião desligou o chat' : 'Conversar na sala');
  $('emoji-btn').disabled = blocked;
  $('chat-toggle').textContent = t(meta.chat ? 'Desligar chat' : 'Ligar chat');
  $('rec-badge').hidden = !meta.recording;
  // Avisa o anfitrião de cada pedido novo
  if (isHost) {
    for (const r of meta.requests) {
      const key = `${r.identity}:${r.kind}`;
      if (!knownRequests.has(key))
        addMessage(t(r.kind === 'speak' ? '{name} pediu a palavra.' : '{name} pediu para mostrar a tela.', { name: r.name }));
    }
    knownRequests = new Set(meta.requests.map((r) => `${r.identity}:${r.kind}`));
    for (const w of meta.lobby ?? []) if (!knownLobby.has(w.id)) addMessage(t('{name} está na sala de espera.', { name: w.name }));
    knownLobby = new Set((meta.lobby ?? []).map((w) => w.id));
    const pending = meta.requests.length + (meta.lobby ?? []).length;
    $('requests-count').textContent = pending ? String(pending) : '';
    $('requests-count').hidden = !pending;
    renderLobby();
  }
  updateControls();
  renderStage();
}

// Ação do anfitrião sobre a sala; devolve a resposta ou mostra o erro no chat
const hostAction = async (path, extra = {}) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': lang },
    body: JSON.stringify({ roomId, hostKey, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    addMessage(data.error ?? t('Não foi possível concluir a ação.'));
    return null;
  }
  return data;
};

// Pedido de quem está na sala: o próprio token da sala prova quem pede
const participantAction = async (path, extra = {}) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': lang },
    body: JSON.stringify({ token, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) addMessage(data.error ?? t('Não foi possível concluir a ação.'));
  return res.ok ? data : null;
};

// O link mudou: atualiza a barra de endereço, o convite e onde a chave de anfitrião fica guardada
const switchRoomCode = (code, why) => {
  renameRoom(roomId, code);
  roomId = code;
  storage.set(sessionStorage, `host:${roomId}`, hostKey);
  history.replaceState(null, '', `/r/${roomId}#k=${e2eeKey}`);
  $('invite-link').value = inviteLink();
  addMessage(t('{why} O link antigo não serve mais: envie o novo a quem ainda vai entrar.', { why }));
};

const permitted = (p, source) => {
  if (p.identity.startsWith('h-')) return true;
  const sources = p.permissions?.canPublishSources ?? [];
  return !!p.permissions?.canPublish && (sources.length === 0 || sources.includes(SOURCE[source]));
};

// --- convites da sala e sala de espera (anfitrião) ------------------------------

const linkFor = (code) => `${location.origin}/r/${code}#k=${e2eeKey}`;

const describeInvite = (inv) => {
  const parts = [inv.maxUses ? t('{used} de {max} pessoas', { used: inv.used, max: inv.maxUses }) : t('{used} pessoas', { used: inv.used })];
  if (inv.expiresAt) parts.push(t('vale até {when}', { when: new Date(inv.expiresAt).toLocaleString(lang) }));
  if (inv.hasPassword) parts.push(t('com senha'));
  if (inv.revoked) parts.push(t('revogado'));
  return parts.join(' · ');
};

async function refreshInvites() {
  if (!isHost) return;
  const data = await hostAction('/api/rooms/invites/list');
  if (!data) return;
  $('waiting-toggle').checked = data.waiting;
  $('invites').replaceChildren(
    ...data.invites.map((inv) => {
      const li = el('li', 'invite-item');
      li.dataset.invite = inv.id;
      const info = el('div');
      info.append(el('strong', null, inv.isDefault ? t('Convite padrão') : inv.label), el('span', 'muted small', describeInvite(inv)));
      li.append(info);
      if (!inv.revoked) {
        const copy = button('secondary', t('Copiar'), async () => {
          try {
            await navigator.clipboard.writeText(linkFor(inv.code));
            copy.textContent = t('Copiado!');
          } catch {
            prompt(t('Link do convite'), linkFor(inv.code));
          }
        });
        copy.dataset.action = 'copy';
        li.append(copy);
      }
      if (!inv.isDefault && !inv.revoked) {
        const revoke = button('danger', t('Revogar'), async () => {
          if (!confirm(t('Revogar este convite? O link deixa de funcionar e quem entrou por ele sai da sala.'))) return;
          const r = await hostAction('/api/rooms/invites/revoke', { inviteId: inv.id });
          if (r) addMessage(t('Convite revogado. {n} pessoa(s) saíram da sala.', { n: r.removed }));
          refreshInvites();
        });
        revoke.dataset.action = 'revoke';
        li.append(revoke);
      }
      return li;
    }),
  );
}

const setupInvites = () => {
  $('invites-panel').hidden = false;
  $('invites-panel').addEventListener('toggle', () => $('invites-panel').open && refreshInvites());
  $('waiting-toggle').addEventListener('change', async (e) => {
    const data = await hostAction('/api/rooms/waiting', { enabled: e.target.checked });
    if (data) addMessage(t(data.waiting ? 'Sala de espera ligada: você libera cada pessoa que chegar.' : 'Sala de espera desligada.'));
    else e.target.checked = !e.target.checked;
  });
  $('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const max = $('invite-max').value;
    const expiry = $('invite-expiry').value;
    const data = await hostAction('/api/rooms/invites', {
      label: $('invite-label').value,
      maxUses: max ? Number(max) : null,
      expiresInMinutes: expiry ? Number(expiry) : null,
      password: $('invite-pass').value,
    });
    if (!data) return;
    e.target.reset();
    addMessage(t('Convite “{label}” criado.', { label: data.label }));
    try {
      await navigator.clipboard.writeText(linkFor(data.code));
      addMessage(t('Link do convite copiado.'));
    } catch {}
    refreshInvites();
  });
};

const renderLobby = () => {
  const waiting = meta.lobby ?? [];
  $('lobby').hidden = !isHost || !waiting.length;
  if (!isHost) return;
  $('lobby').replaceChildren(
    ...waiting.map((w) => {
      const li = el('li', 'request');
      li.dataset.lobby = w.id;
      li.append(
        el('span', null, t('{name} está na sala de espera.', { name: w.name })),
        button('', t('Deixar entrar'), () => hostAction('/api/rooms/lobby', { lobbyId: w.id, admit: true })),
        button('secondary', t('Recusar'), () => hostAction('/api/rooms/lobby', { lobbyId: w.id, admit: false })),
      );
      return li;
    }),
  );
};

const renderRequests = () => {
  $('requests').hidden = !isHost || !meta.requests.length;
  if (!isHost) return;
  $('requests').replaceChildren(
    ...meta.requests.map((r) => {
      const li = el('li', 'request');
      li.dataset.identity = r.identity;
      li.dataset.kind = r.kind;
      const field = r.kind === 'speak' ? 'speak' : 'screen';
      li.append(
        el('span', null, t(r.kind === 'speak' ? '{name} pediu a palavra.' : '{name} pediu para mostrar a tela.', { name: r.name })),
        button('', t('Aprovar'), () => hostAction('/api/rooms/permissions', { identity: r.identity, [field]: true })),
        button('secondary', t('Recusar'), () => hostAction('/api/rooms/permissions', { identity: r.identity, [field]: false })),
      );
      return li;
    }),
  );
};

function renderPeople() {
  if (!room) return;
  // A tela de voz mostra as mesmas pessoas: entra, sai e quem fala atualizam as duas
  renderVoiceStage();
  renderRequests();
  const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
  $('people').replaceChildren(
    ...everyone().map((p) => {
      const li = el('li', 'person');
      li.dataset.identity = p.identity;
      const avatar = el('span', 'avatar', [...(p.name || '?')][0].toUpperCase());
      avatar.style.background = avatarColor(p.name || '?');
      avatar.classList.toggle('speaking', speaking.has(p.identity));
      const micOn = p.getTrackPublication(Track.Source.Microphone) && !p.getTrackPublication(Track.Source.Microphone).isMuted;
      const tags = [
        p.identity.startsWith('h-') ? t('anfitrião') : null,
        isMe(p) ? t('você') : null,
        p.getTrackPublication(Track.Source.ScreenShare) ? t('mostrando a tela') : null,
        p.getTrackPublication(Track.Source.Camera) ? t('câmera') : null,
        micOn ? t('microfone') : null,
      ].filter(Boolean);
      const info = el('div', 'person-info');
      info.append(el('span', 'author', p.name || '?'), el('span', 'muted small', tags.join(' · ')));
      li.append(avatar, info);
      if (isHost && p.identity.startsWith('v-')) {
        const actions = el('div', 'person-actions');
        // Na Live, o anfitrião libera a fala; a tela, sempre que ela não é livre na sala
        if (meta.type === 'live') {
          const speaks = permitted(p, 'microphone');
          const speak = button('secondary', t(speaks ? 'Tirar a fala' : 'Liberar a fala'), () =>
            hostAction('/api/rooms/permissions', { identity: p.identity, speak: !speaks }),
          );
          speak.dataset.action = 'speak';
          actions.append(speak);
        }
        if (!(meta.type === 'together' && meta.openScreens)) {
          const shares = permitted(p, 'screen');
          const screen = button('secondary', t(shares ? 'Tirar a tela' : 'Liberar a tela'), () =>
            hostAction('/api/rooms/permissions', { identity: p.identity, screen: !shares }),
          );
          screen.dataset.action = 'screen';
          actions.append(screen);
        }
        const kick = button('danger', t('Remover'), async () => {
          if (!confirm(t('Remover {name} da sala? O link da sala será trocado para que essa pessoa não volte.', { name: p.name }))) return;
          const data = await hostAction('/api/rooms/kick', { identity: p.identity });
          if (!data) return;
          if (data.roomId !== roomId) switchRoomCode(data.roomId, t('{name} foi removido.', { name: p.name }));
          else addMessage(t('{name} foi removido. O convite por onde a pessoa entrou ganhou um link novo.', { name: p.name }));
          refreshInvites();
        });
        kick.dataset.action = 'kick';
        actions.append(kick);
        li.append(actions);
      }
      return li;
    }),
  );
}

const showTab = (tab) => {
  const people = tab === 'people';
  $('tab-chat').setAttribute('aria-selected', String(!people));
  $('tab-people').setAttribute('aria-selected', String(people));
  $('people-panel').hidden = !people;
  $('messages').hidden = people;
  $('chat-form').hidden = people;
  $('chat-tools').hidden = people || !isHost;
  if (people) renderPeople();
};
$('tab-chat').addEventListener('click', () => showTab('chat'));
$('tab-people').addEventListener('click', () => showTab('people'));

// --- transmitir: microfone, tela, câmera ---------------------------------------

const setShareButton = (on) => setToggle('share', on, ['Compartilhar tela', 'Parar de compartilhar'], ['#i-screen', '#i-screen-off']);
const setMicButton = (on) => setToggle('mic', on, ['Ligar microfone', 'Desligar microfone'], ['#i-mic-off', '#i-mic']);
const setCameraButton = (on) => setToggle('camera', on, ['Ligar câmera', 'Desligar câmera'], ['#i-camera-off', '#i-camera']);

// Indicador de que o microfone está captando: um anel no botão que cresce com a voz
let stopMicMeter = null;
const startMicMeter = (track) => {
  stopMicMeter?.();
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    const level = Math.min(1, (peak / 128) * 2.5);
    $('mic').style.setProperty('--level', level.toFixed(2));
    $('mic').classList.toggle('speaking', level > 0.1);
    frame = requestAnimationFrame(tick);
  };
  tick();
  stopMicMeter = () => {
    cancelAnimationFrame(frame);
    context.close().catch(() => {});
    $('mic').style.removeProperty('--level');
    $('mic').classList.remove('speaking');
    stopMicMeter = null;
  };
};

// Voz: independente da tela, com os filtros de voz do navegador ligados
const toggleMic = async () => {
  if (voiceTrack) {
    const track = voiceTrack;
    voiceTrack = null;
    stopMicMeter?.();
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
  startMicMeter(track);
};

// Câmera de quem apresenta: pequena e leve, aparece sobre a tela no player de quem assiste
const toggleCamera = async () => {
  if (cameraTrack) {
    const track = cameraTrack;
    cameraTrack = null;
    setCameraButton(false);
    await room.localParticipant.unpublishTrack(track).catch(() => {});
    track.stop();
    return;
  }
  const deviceId = $('camera-device').value;
  const track = await createLocalVideoTrack({
    ...(deviceId && { deviceId: { exact: deviceId } }),
    resolution: VideoPresets.h540.resolution,
  });
  await room.localParticipant.publishTrack(track, {
    source: Track.Source.Camera,
    videoEncoding: { maxBitrate: 900_000, maxFramerate: 30 },
    simulcast: false,
  });
  cameraTrack = track;
  setCameraButton(true);
};

// Acima de 720p, avisa quanto cada pessoa recebe e quanto o servidor envia com quem está na sala
const updateQualityWarning = () => {
  const quality = $('quality').value;
  const heavy = PRESETS[quality].height > HEAVY_HEIGHT;
  $('quality-warning').hidden = !heavy;
  if (heavy) $('quality-warning').textContent = bandwidthWarning(quality, room?.remoteParticipants.size ?? 0);
};

const setupSettings = () => {
  const btn = $('settings-btn');
  const panel = $('settings');
  const toggle = (open) => {
    if (open) updateQualityWarning();
    panel.hidden = !open;
    btn.classList.toggle('on', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => toggle(panel.hidden));
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) toggle(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && toggle(false));
  $('quality').addEventListener('change', () => {
    updateQualityWarning();
    applyScreenSettings();
  });
  $('codec').addEventListener('change', applyScreenSettings);
  $('audio-device').addEventListener('change', () =>
    changeExtraAudio().catch((err) => addMessage(t('Não foi possível usar esse áudio: {error}', { error: err.message }))),
  );
};

const stopExtraAudio = async () => {
  if (!extraAudio) return;
  const track = extraAudio;
  extraAudio = null;
  updateExtraAudioStatus();
  await room.localParticipant.unpublishTrack(track).catch(() => {});
  track.stop();
};

// Como a tela é enviada, pela qualidade e pelo codec escolhidos nos ajustes
const screenPublishOptions = () => {
  const p = PRESETS[$('quality').value];
  const codec = $('codec').value;
  return {
    videoCodec: codec,
    // Quem não decodifica VP9/AV1 recebe H.264
    backupCodec: codec === 'h264' ? false : { codec: 'h264' },
    screenShareEncoding: { maxBitrate: p.bitrate, maxFramerate: p.fps },
    screenShareSimulcastLayers: SIMULCAST_LAYERS.filter((l) => l.height < p.height),
    degradationPreference: 'maintain-framerate',
    dtx: false,
  };
};

const startShare = async () => {
  const p = PRESETS[$('quality').value];
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
    screenPublishOptions(),
  );

  await startExtraAudio();
  // No Linux o navegador não captura o som do computador junto com a tela: explica onde escolher
  const captured = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
  if (!captured && IS_LINUX) {
    addMessage(t('No Linux, o navegador não envia o som do computador junto com a tela. Em Ajustes › Áudio do jogo, clique em “Listar” e escolha o “Monitor of …” da sua saída de som.'));
  }
};

const IS_LINUX = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

// Áudio do jogo por um dispositivo de entrada (no Linux, o "Monitor of …" da saída de som), enviado como
// áudio da tela: sem filtros de voz e em estéreo
const startExtraAudio = async () => {
  const select = $('audio-device');
  if (!select.value) return updateExtraAudioStatus();
  extraAudio = await createLocalAudioTrack({
    deviceId: { exact: select.value },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
  });
  await room.localParticipant.publishTrack(extraAudio, {
    source: Track.Source.ScreenShareAudio,
    name: GAME_AUDIO_TRACK,
    audioPreset: AudioPresets.musicHighQualityStereo,
    forceStereo: true,
    dtx: false,
    red: false,
  });
  updateExtraAudioStatus();
};

const updateExtraAudioStatus = () => {
  const option = $('audio-device').selectedOptions[0];
  $('audio-status').textContent = extraAudio ? t('Enviando o áudio de: {device}', { device: option?.text ?? '' }) : '';
};

// Trocar o áudio do jogo com a tela já compartilhada vale na hora
const changeExtraAudio = async () => {
  await stopExtraAudio();
  if (room?.localParticipant.isScreenShareEnabled) await startExtraAudio();
  else updateExtraAudioStatus();
};

// Trocar a qualidade ou o codec com a tela já sendo compartilhada: a mesma captura é publicada de
// novo com as opções novas, sem pedir a tela outra vez. Quem assiste vê uma piscada de ~1 s.
const applyScreenSettings = async () => {
  const pub = room?.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  if (!pub?.track || republishing) return;
  const track = pub.track;
  const p = PRESETS[$('quality').value];
  republishing = true;
  try {
    // Reduzir a captura alivia o computador; aumentar só vai até o tamanho real da tela
    await track.mediaStreamTrack
      .applyConstraints({ width: { ideal: p.width }, height: { ideal: p.height }, frameRate: { ideal: p.fps } })
      .catch(() => {});
    await room.localParticipant.unpublishTrack(track, false);
    await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare, ...screenPublishOptions() });
    lastSend = null;
    addMessage(t('Transmitindo agora em {quality}.', { quality: QUALITY_LABELS[$('quality').value] }));
  } catch (err) {
    addMessage(t('Não foi possível trocar a qualidade: {error}', { error: err.message }));
  } finally {
    republishing = false;
  }
};

// Posição, tamanho e formato da câmera sobre a tela: guardados no navegador e enviados à sala
const renderPipLayout = () => {
  for (const b of $('pip-layout').querySelectorAll('button')) {
    const [field, value] = Object.entries(b.dataset)[0];
    b.setAttribute('aria-pressed', String(myPip[field] === value));
  }
};

const setupPipLayout = () => {
  renderPipLayout();
  $('pip-layout').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const [field, value] = Object.entries(b.dataset)[0];
    myPip = { ...myPip, [field]: value };
    storage.set(localStorage, 'pip', JSON.stringify(myPip));
    renderPipLayout();
    renderStage();
    await participantAction('/api/rooms/layout', { pip: myPip });
  });
};

const withButton = async (id, fn, onError) => {
  const btn = $(id);
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false;
  }
};

const micError = (err) =>
  addMessage(err?.name === 'NotAllowedError' ? t('Permissão de microfone negada.') : t('Erro no microfone: {error}', { error: err.message }));
const cameraError = (err) =>
  addMessage(err?.name === 'NotAllowedError' ? t('Permissão de câmera negada.') : t('Erro na câmera: {error}', { error: err.message }));

// O que ficou ligado na antessala entra ligado, se a sala permitir; os dispositivos escolhidos vêm junto
const applyPreviewChoice = async (choice) => {
  for (const [select, options, value] of [
    [$('mic-device'), choice.micOptions, choice.micDevice],
    [$('camera-device'), choice.cameraOptions, choice.cameraDevice],
  ]) {
    if (select.length === 1) for (const [text, v] of options) select.add(new Option(text, v));
    select.value = value;
  }
  if (choice.mic) {
    if (can('microphone')) await withButton('mic', toggleMic, micError);
    else addMessage(t('Seu microfone fica desligado até o anfitrião liberar a palavra.'));
  }
  if (choice.camera) {
    if (can('camera')) await withButton('camera', toggleCamera, cameraError);
    else addMessage(t('Sua câmera fica desligada: nesta sala, só quem apresenta aparece.'));
  }
};

const setupPublishControls = () => {
  setupSettings();
  setupPipLayout();

  $('share').addEventListener('click', () =>
    withButton(
      'share',
      async () => {
        if (room.localParticipant.isScreenShareEnabled) {
          await room.localParticipant.setScreenShareEnabled(false);
          await stopExtraAudio();
        } else {
          await startShare();
        }
      },
      // Cancelar o seletor de tela do navegador cai aqui; não é erro
      (err) => err?.name !== 'NotAllowedError' && addMessage(t('Erro ao compartilhar: {error}', { error: err.message })),
    ),
  );

  $('mic').addEventListener('click', () => withButton('mic', toggleMic, micError));
  $('camera').addEventListener('click', () => withButton('camera', toggleCamera, cameraError));

  // Pedir a palavra ou a tela: clicar de novo desiste do pedido
  for (const [id, kind] of [['raise-hand', 'speak'], ['ask-screen', 'screen']]) {
    $(id).addEventListener('click', () =>
      withButton(id, () => participantAction('/api/rooms/request', { kind, cancel: $(id).getAttribute('aria-pressed') === 'true' }), () => {}),
    );
  }

  $('mic-device').addEventListener('change', (e) => {
    voiceTrack
      ?.setDeviceId(e.target.value || 'default')
      .then(() => voiceTrack && startMicMeter(voiceTrack))
      .catch(() => addMessage(t('Não foi possível trocar o microfone.')));
  });
  $('camera-device').addEventListener('change', (e) => {
    cameraTrack?.setDeviceId(e.target.value || 'default').catch(() => addMessage(t('Não foi possível trocar a câmera.')));
  });

  $('load-devices').addEventListener('click', async () => {
    try {
      // Pede permissão uma vez para o navegador revelar os nomes dos dispositivos
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: can('screen') });
      s.getTracks().forEach((track) => track.stop());
    } catch {
      addMessage(t('Permissão de áudio negada.'));
      return;
    }
    const audioSelects = [$('mic-device'), $('audio-device')];
    for (const select of [...audioSelects, $('camera-device')]) select.length = 1;
    for (const d of await navigator.mediaDevices.enumerateDevices()) {
      if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
      if (d.kind === 'audioinput') for (const select of audioSelects) select.add(new Option(d.label || d.deviceId, d.deviceId));
      if (d.kind === 'videoinput') $('camera-device').add(new Option(d.label || d.deviceId, d.deviceId));
    }
    addMessage(t('Dispositivos carregados. No Linux, escolha o “Monitor of …” da sua saída de som.'));
  });
};

// --- anfitrião: convite, chat, encerrar, gravar --------------------------------

const setupHost = () => {
  $('invite').hidden = false;
  $('invite-link').value = inviteLink();
  $('chat-tools').hidden = false;

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      $('copy').textContent = t('Copiado!');
    } catch {
      $('invite-link').select();
    }
    setTimeout(() => ($('copy').textContent = t('Copiar convite')), 1500);
  });

  $('new-link').addEventListener('click', async () => {
    if (!confirm(t('Gerar um link novo? O link atual deixa de funcionar para quem ainda não entrou.'))) return;
    const data = await hostAction('/api/rooms/link');
    if (data) switchRoomCode(data.roomId, t('Link da sala trocado.'));
  });

  setupInvites();

  $('chat-toggle').addEventListener('click', async () => {
    const data = await hostAction('/api/rooms/chat', { enabled: !meta.chat });
    if (data) addMessage(t(data.chat ? 'Você ligou o chat.' : 'Você desligou o chat para quem assiste.'));
  });

  $('end').addEventListener('click', async () => {
    if (!confirm(t('Encerrar a sala para todos?'))) return;
    if (!(await hostAction('/api/rooms/end'))) addMessage(t('Não foi possível encerrar a sala.'));
  });

  $('record').addEventListener('click', () =>
    withButton('record', () => (recorder?.active ? stopRecording() : startRecording()), () => {}),
  );

  // Fechar a aba no meio da gravação: avisa a sala que ela parou (o que já foi para a pasta fica salvo)
  addEventListener('pagehide', () => {
    if (!recorder?.active) return;
    const body = JSON.stringify({ roomId, hostKey, enabled: false });
    navigator.sendBeacon('/api/rooms/recording', new Blob([body], { type: 'application/json' }));
  });

  // Sala privada: avisa a saída na hora, para a tolerância começar sem esperar o LiveKit notar a queda
  addEventListener('pagehide', () => {
    if (!meta.private) return;
    const body = JSON.stringify({ roomId, hostKey, identity: room.localParticipant.identity });
    navigator.sendBeacon('/api/rooms/host-left', new Blob([body], { type: 'application/json' }));
  });
};

const setRecordButton = (on) => {
  setToggle('record', on, ['Gravar a transmissão', 'Parar a gravação']);
  $('record').classList.toggle('recording', on);
  $('record').classList.remove('on');
};

const startRecording = async () => {
  recorder ??= new Recorder();
  for (const track of roomAudio) recorder.addAudio(track);
  const current = broadcasters().find((b) => b.p.identity === watching);
  const screen = current?.screen?.track?.mediaStreamTrack ?? null;
  const camera = current?.camera?.track?.mediaStreamTrack ?? null;
  try {
    await recorder.start({ screen: screen ?? camera, camera: screen ? camera : null });
  } catch (err) {
    // Cancelar a escolha da pasta cancela a gravação; não é erro
    if (err?.name !== 'AbortError') addMessage(t('Não foi possível gravar: {error}', { error: err.message }));
    return;
  }
  setRecordButton(true);
  await hostAction('/api/rooms/recording', { enabled: true });
  addMessage(
    t(
      recorder.folder
        ? 'Gravando na pasta escolhida. Todos na sala veem o aviso de gravação.'
        : 'Gravando. O arquivo será baixado quando você parar. Todos na sala veem o aviso de gravação.',
    ),
  );
};

const stopRecording = async () => {
  const { parts, toFolder } = await recorder.stop();
  setRecordButton(false);
  await hostAction('/api/rooms/recording', { enabled: false });
  if (!parts.length) addMessage(t('Nada foi gravado: não havia vídeo na tela.'));
  else addMessage(t(toFolder ? 'Gravação salva na pasta escolhida: {parts}' : 'Gravação salva: {parts}', { parts: parts.join(', ') }));
};

// --- quem assiste: volume, tela cheia, câmera sobre a tela ------------------------

const setupViewing = () => {
  $('viewer-controls').hidden = false;

  $('volume').addEventListener('input', (e) => {
    for (const track of audioTracks) track.setVolume(Number(e.target.value));
  });

  // No iPhone só o <video> entra em tela cheia (webkitEnterFullscreen); no Android, deita a tela
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    if (!$('player').requestFullscreen) return video.webkitEnterFullscreen?.();
    await $('player').requestFullscreen();
    await window.screen.orientation?.lock?.('landscape').catch(() => {});
  };
  $('fullscreen').addEventListener('click', toggleFullscreen);
  video.addEventListener('dblclick', toggleFullscreen);

  $('pip-hide').addEventListener('click', () => {
    pipHidden = !pipHidden;
    setToggle('pip-hide', pipHidden, ['Esconder câmera', 'Mostrar câmera']);
    renderStage();
  });
  $('watch-quality').addEventListener('change', (e) => {
    const value = e.target.value;
    watchedPublication()?.setVideoQuality(value === 'auto' ? VideoQuality.HIGH : Number(value));
  });
  $('net-warning-close').addEventListener('click', () => ($('net-warning').hidden = true));

  $('hide-self').addEventListener('click', () => setSelfHidden(!selfHidden));
  $('show-self').addEventListener('click', () => setSelfHidden(false));

  $('pip-swap').addEventListener('click', () => {
    pipSwapped = !pipSwapped;
    setToggle('pip-swap', pipSwapped, ['Inverter câmera e tela', 'Voltar a tela para o centro']);
    renderStage();
  });

  setInterval(async () => {
    const sending = await sendSummary();
    if (sending) checkNetwork(sending);
    // Selo na prévia de quem transmite: a qualidade que está saindo de fato
    const watchingMe = watching === room?.localParticipant.identity;
    $('send-badge').hidden = !(sending && watchingMe);
    if (sending) {
      $('send-badge').textContent = t('Transmitindo {width}×{height} · {fps} fps · {mbps} Mbps', sending);
      if (watchingMe) return ($('stats').textContent = $('send-badge').textContent);
    }
    if (!mainTrack || !video.videoWidth) return ($('stats').textContent = '');
    const mbps = ((mainTrack.currentBitrate ?? 0) / 1e6).toFixed(1);
    $('stats').textContent = `${video.videoWidth}×${video.videoHeight} · ${mbps} Mbps`;
  }, 1000);
};

// Esconder ou mostrar a própria transmissão: ao esconder, guarda um quadro pequeno para o fundo desfocado
const setSelfHidden = (hide) => {
  if (hide && video.videoWidth) {
    const frame = $('self-frame');
    frame.width = 160;
    frame.height = Math.round((160 * video.videoHeight) / video.videoWidth);
    frame.getContext('2d').drawImage(video, 0, 0, frame.width, frame.height);
  }
  selfHidden = hide;
  storage.set(localStorage, 'hide-self', hide ? '1' : '0');
  renderStage();
};

// O que a tela compartilhada está enviando agora (null se não há tela)
const sendSummary = async () => {
  const track = room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!track || republishing) return null;
  const summary = summarizeSend(await track.getSenderStats().catch(() => []), lastSend);
  lastSend = summary?.snap ?? null;
  if (!summary?.width) return null;
  const fmt = (n) => n.toLocaleString(lang, { maximumFractionDigits: 1 });
  return { ...summary, mbps: fmt(summary.mbps ?? 0) };
};

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
  picker.querySelector('.emoji-title').textContent = t(category.label);
  const grid = picker.querySelector('.emoji-grid');
  grid.replaceChildren(
    ...category.emojis.map((emoji) => {
      const b = el('button', null, emoji);
      b.type = 'button';
      b.dataset.emoji = emoji;
      return b;
    }),
  );
  if (!category.emojis.length) grid.append(el('p', 'empty', t('Os emojis que você usar aparecem aqui.')));
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
    b.title = t(c.label);
    b.setAttribute('role', 'tab');
    b.dataset.category = c.id;
    return b;
  }),
);

// Clicar no seletor não tira o foco (nem a posição do cursor) do campo de mensagem
picker.addEventListener('mousedown', (e) => e.preventDefault());
picker.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.category) showCategory(b.dataset.category);
  else if (b.dataset.emoji) insertEmoji(b.dataset.emoji);
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
    addMessage(t('Mensagem não enviada.'));
  }
});

// --- entrada ---------------------------------------------------------------

// Sugere o último nome usado, sem apagar o que a pessoa já tenha digitado antes de o script carregar
if (!$('name').value) $('name').value = storage.get(localStorage, 'name') ?? '';

// Quem já fez o login corporativo entra com o nome real, que vem do provedor
const SSO_ERRORS = {
  dominio: 'O e-mail da sua conta não pertence a um domínio permitido nesta sala.',
  falhou: 'Não foi possível concluir o login da empresa. Tente de novo.',
  expirou: 'O login da empresa expirou. Tente de novo.',
  cancelado: 'O login da empresa foi cancelado.',
  provedor: 'O provedor de login da empresa não respondeu. Tente mais tarde.',
};
const ssoError = new URLSearchParams(location.search).get('erro_sso');
if (ssoError) {
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  joinError(t(SSO_ERRORS[ssoError] ?? SSO_ERRORS.falhou));
  $('sso-join').hidden = false;
}
fetch('/api/state')
  .then((r) => r.json())
  .then(({ viewer }) => {
    if (!viewer) return;
    $('name').value = viewer.name;
    $('name').readOnly = true;
    $('sso-hint').textContent = t('Você entrou como {name} ({email}) pelo login da empresa.', viewer);
    $('sso-hint').hidden = false;
  })
  .catch(() => {});

$('sso-join').addEventListener('click', () => {
  storage.set(sessionStorage, ssoKeyName, e2eeKey);
  location.href = `/api/sso/start?next=${encodeURIComponent(`/r/${roomId}`)}`;
});

if (!e2eeKey) {
  joinError(t('Link incompleto: falta a chave da sala. Peça o link de novo.'));
  $('join-form').querySelector('button').disabled = true;
} else if (!isE2EESupported()) {
  joinError(t('Seu navegador não suporta criptografia de ponta a ponta. Use Chrome, Edge, Firefox ou Safari atualizados.'));
  $('join-form').querySelector('button').disabled = true;
} else if (hostKey) {
  // O anfitrião já pode mandar o convite antes de entrar
  $('join-invite-link').value = inviteLink();
  $('join-invite').hidden = false;
  $('join-copy').addEventListener('click', () => copyText($('join-invite-link').value, $('join-copy'), $('join-invite-link')));
}

setupPreview();

// --- gaveta lateral: outras salas e a gestão do servidor, para quem tem conta ----------

const setupNav = async () => {
  const { user } = await api('/api/state').catch(() => ({}));
  if (!user || user.needs2fa) return;
  $('nav-toggle').hidden = false;
  $('nav-admin').hidden = user.role !== 'admin';
  let list = null;
  const toggle = (open) => {
    $('room-nav').hidden = $('nav-backdrop').hidden = !open;
    $('nav-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      list ??= mountRoomList({
        isAdmin: user.role === 'admin',
        current: roomId,
        ids: { mine: 'nav-rooms', empty: 'nav-no-rooms', fixedSection: 'nav-fixed-section', fixed: 'nav-fixed-rooms' },
      });
      $('room-nav').querySelector('a')?.focus();
    } else $('nav-toggle').focus();
  };
  $('nav-toggle').addEventListener('click', () => toggle($('room-nav').hidden));
  $('nav-close').addEventListener('click', () => toggle(false));
  $('nav-backdrop').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('room-nav').hidden && toggle(false));
  // Sair da sala por um link da gaveta: quem transmite ou é anfitrião confirma antes
  $('room-nav').addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link || !room || room.state !== 'connected') return;
    const broadcasting = room.localParticipant.isScreenShareEnabled || room.localParticipant.isCameraEnabled || !!voiceTrack;
    if ((isHost || broadcasting) && !confirm(t('Sair desta sala? Sua transmissão para aqui.'))) e.preventDefault();
  });
};
setupNav();

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
    if (err.code === 'sso_required') $('sso-join').hidden = false;
    if (err.code === 'password_required') {
      $('password-row').hidden = false;
      $('invite-password').focus();
    }
    btn.disabled = false;
    return;
  }

  const choice = finishPreview();
  $('join').hidden = true;
  $('room').hidden = false;
  setupViewing();
  setupPublishControls();
  if (isHost) setupHost();
  applyMetadata();
  updateCount();
  addMessage(t(isHost ? 'Você é o anfitrião desta sala.' : 'Você entrou na sala.'));
  if (meta.private)
    addMessage(t(isHost ? 'Sala privada: se você sair por mais de 30 segundos, ela acaba para todos.' : 'Sala privada: ela acaba quando o anfitrião sair.'));
  await applyPreviewChoice(choice);
});
