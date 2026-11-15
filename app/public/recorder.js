// Gravação no navegador do anfitrião, em dois canais com arquivos separados:
// "tela" (o vídeo que está na tela + todo o áudio da sala, misturado) e "camera" (só a câmera).
// O servidor nunca vê o conteúdo (a transmissão continua cifrada de ponta a ponta).
// Cada canal grava em partes: quando a fonte do vídeo muda, a parte atual fecha e outra começa.
import { t } from '/static/i18n.js';

const MP4 = [['video/mp4;codecs=avc1,opus', 'mp4']];
const WEBM = [
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
];

// Gravando numa pasta, o arquivo precisa crescer a cada segundo para não se perder se o navegador
// fechar: o WebM entrega um pedaço por segundo, o MP4 do Chrome só a cada quadro-chave (com a tela
// parada, pode passar muito tempo sem nada salvo). Baixando no fim, o MP4 abre em mais programas.
export const recordingFormat = (toFolder = false) =>
  (toFolder ? [...WEBM, ...MP4] : [...MP4, ...WEBM]).find(([type]) => window.MediaRecorder?.isTypeSupported(type));

const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

const download = (blob, name) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};

const CHANNELS = { screen: 'tela', camera: 'camera' };

export class Recorder {
  constructor() {
    this.audio = new AudioContext();
    this.mix = this.audio.createMediaStreamDestination();
    this.sources = new Map();
    this.active = false;
    this.parts = [];
    // Por canal: a parte em andamento e uma fila, para as trocas de fonte acontecerem em ordem
    this.channels = Object.fromEntries(
      Object.keys(CHANNELS).map((c) => [c, { current: null, count: 0, queue: Promise.resolve() }]),
    );
  }

  // Áudios entram e saem da mistura a qualquer momento (vozes, áudio do jogo, áudio de quem apresenta)
  addAudio(track) {
    if (!track || this.sources.has(track)) return;
    const source = this.audio.createMediaStreamSource(new MediaStream([track]));
    source.connect(this.mix);
    this.sources.set(track, source);
  }

  removeAudio(track) {
    this.sources.get(track)?.disconnect();
    this.sources.delete(track);
  }

  // Precisa ser chamada a partir de um clique: é quando o navegador permite escolher a pasta
  async start({ screen = null, camera = null } = {}) {
    if (!recordingFormat()) throw new Error(t('Este navegador não consegue gravar vídeo.'));
    this.folder = null;
    if (window.showDirectoryPicker) {
      // Chrome e Edge: grava direto numa pasta, enquanto acontece (cancelar o seletor cancela a gravação)
      this.folder = await window.showDirectoryPicker({ id: 'overshoulder-gravacoes', mode: 'readwrite', startIn: 'videos' });
    }
    this.format = recordingFormat(!!this.folder);
    this.baseName = `overshoulder-${stamp()}`;
    this.parts = [];
    for (const ch of Object.values(this.channels)) ch.count = 0;
    this.active = true;
    await this.audio.resume();
    await Promise.all([this.switchVideo(screen), this.switchCamera(camera)]);
  }

  switchVideo(track) {
    return this.#switch('screen', track);
  }

  switchCamera(track) {
    return this.#switch('camera', track);
  }

  async stop() {
    this.active = false;
    await Promise.all(Object.keys(this.channels).map((c) => this.#switch(c, null, true)));
    return { parts: [...this.parts], toFolder: !!this.folder };
  }

  #switch(channel, track, stopping = false) {
    const ch = this.channels[channel];
    ch.queue = ch.queue.then(async () => {
      if (!stopping && (!this.active || ch.current?.track === track)) return;
      await this.#endPart(ch);
      if (track && this.active) await this.#beginPart(channel, ch, track);
    });
    return ch.queue;
  }

  async #beginPart(channel, ch, track) {
    const [mimeType, ext] = this.format;
    ch.count++;
    const name = `${this.baseName}-${t(CHANNELS[channel])}-${t('parte')}${ch.count}.${ext}`;
    // A tela leva o áudio da sala; a câmera vai só com imagem, para quem edita montar depois
    const withAudio = channel === 'screen';
    const recorder = new MediaRecorder(new MediaStream(withAudio ? [track, ...this.mix.stream.getAudioTracks()] : [track]), {
      mimeType: withAudio ? mimeType : mimeType.replace(',opus', ''),
      videoBitsPerSecond: withAudio ? 6_000_000 : 1_500_000,
      audioBitsPerSecond: 128_000,
    });
    const file = this.folder && (await (await this.folder.getFileHandle(name, { create: true })).createWritable());
    const chunks = [];
    let writing = Promise.resolve();
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      if (file) writing = writing.then(() => file.write(e.data));
      else chunks.push(e.data);
    };
    const done = new Promise((resolve) => {
      recorder.onstop = async () => {
        await writing;
        if (file) await file.close();
        else download(new Blob(chunks, { type: mimeType }), name);
        resolve();
      };
    });
    // Um pedaço por segundo: na pasta, o arquivo cresce durante a gravação
    recorder.start(1000);
    ch.current = { recorder, done, track };
    this.parts.push(name);
  }

  async #endPart(ch) {
    const current = ch.current;
    if (!current) return;
    ch.current = null;
    if (current.recorder.state !== 'inactive') current.recorder.stop();
    await current.done;
  }
}
