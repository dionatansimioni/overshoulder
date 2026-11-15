// Antessala: testar câmera e microfone antes de entrar. Nada é pedido ao navegador até a pessoa
// clicar; ao entrar, as escolhas (ligado e dispositivo) passam para a sala e a prévia é desligada.
import { t } from '/static/i18n.js';

const $ = (id) => document.getElementById(id);

const streams = { mic: null, camera: null };
let audioContext = null;
let meterFrame = 0;

const setButton = (kind, on) => {
  const btn = $(`preview-${kind}`);
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('on', on);
  const labels = kind === 'mic' ? ['Ligar microfone', 'Desligar microfone'] : ['Ligar câmera', 'Desligar câmera'];
  btn.setAttribute('aria-label', t(labels[on ? 1 : 0]));
  btn.title = t(labels[on ? 1 : 0]);
  btn.querySelector('use').setAttribute('href', kind === 'mic' ? (on ? '#i-mic' : '#i-mic-off') : on ? '#i-camera' : '#i-camera-off');
};

const stopStream = (kind) => {
  streams[kind]?.getTracks().forEach((track) => track.stop());
  streams[kind] = null;
  if (kind === 'camera') {
    $('preview-video').srcObject = null;
    $('preview-off').hidden = false;
  } else {
    cancelAnimationFrame(meterFrame);
    audioContext?.close().catch(() => {});
    audioContext = null;
    $('mic-level').style.width = '0%';
  }
  setButton(kind, false);
};

// Barra que sobe com o volume do microfone
const startMeter = (stream) => {
  audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    $('mic-level').style.width = `${Math.min(100, (peak / 128) * 160)}%`;
    meterFrame = requestAnimationFrame(tick);
  };
  tick();
};

// Depois da primeira permissão o navegador revela os nomes dos dispositivos
const listDevices = async () => {
  const selects = { audioinput: $('preview-mic-device'), videoinput: $('preview-camera-device') };
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const [kind, select] of Object.entries(selects)) {
    const current = select.value;
    select.length = 1;
    for (const d of devices) {
      if (d.kind !== kind || !d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
      select.add(new Option(d.label || d.deviceId, d.deviceId));
    }
    select.value = [...select.options].some((o) => o.value === current) ? current : '';
  }
  $('preview-devices').hidden = false;
};

const start = async (kind) => {
  const deviceId = $(`preview-${kind}-device`).value;
  const constraints =
    kind === 'mic'
      ? { audio: { ...(deviceId && { deviceId: { exact: deviceId } }), echoCancellation: true, noiseSuppression: true } }
      : { video: { ...(deviceId && { deviceId: { exact: deviceId } }), width: 960, height: 540 } };
  try {
    streams[kind] = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    $('preview-error').textContent = t(
      err?.name === 'NotAllowedError'
        ? kind === 'mic' ? 'Permissão de microfone negada.' : 'Permissão de câmera negada.'
        : kind === 'mic' ? 'Não foi possível abrir o microfone.' : 'Não foi possível abrir a câmera.',
    );
    $('preview-error').hidden = false;
    return;
  }
  $('preview-error').hidden = true;
  if (kind === 'camera') {
    $('preview-video').srcObject = streams.camera;
    $('preview-off').hidden = true;
  } else {
    startMeter(streams.mic);
  }
  setButton(kind, true);
  await listDevices().catch(() => {});
};

const toggle = (kind) => (streams[kind] ? stopStream(kind) : start(kind));

export const setupPreview = () => {
  setButton('mic', false);
  setButton('camera', false);
  $('preview-mic').addEventListener('click', () => toggle('mic'));
  $('preview-camera').addEventListener('click', () => toggle('camera'));
  for (const kind of ['mic', 'camera']) {
    $(`preview-${kind}-device`).addEventListener('change', async () => {
      if (!streams[kind]) return;
      stopStream(kind);
      await start(kind);
    });
  }
};

// Desliga a prévia e devolve o que a pessoa escolheu, com a lista de dispositivos já carregada
export const finishPreview = () => {
  const choice = {
    mic: !!streams.mic,
    camera: !!streams.camera,
    micDevice: $('preview-mic-device').value,
    cameraDevice: $('preview-camera-device').value,
    micOptions: [...$('preview-mic-device').options].slice(1).map((o) => [o.text, o.value]),
    cameraOptions: [...$('preview-camera-device').options].slice(1).map((o) => [o.text, o.value]),
  };
  stopStream('mic');
  stopStream('camera');
  return choice;
};
