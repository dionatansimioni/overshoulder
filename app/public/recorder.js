// Gravação no navegador do anfitrião: o vídeo que está na tela e todo o áudio da sala, misturado.
// O servidor nunca vê o conteúdo (a transmissão continua cifrada de ponta a ponta).
import { t } from '/static/i18n.js';
// Grava em partes: quando a fonte do vídeo muda (outra pessoa passa a apresentar, ou a tela para),
// a parte atual é fechada e uma nova começa quando houver vídeo de novo.

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

export class Recorder {
  constructor() {
    this.audio = new AudioContext();
    this.mix = this.audio.createMediaStreamDestination();
    this.sources = new Map();
    this.active = false;
    this.current = null;
    this.parts = [];
    // Partes encerram em sequência, mesmo quando a fonte muda várias vezes seguidas
    this.queue = Promise.resolve();
  }

  // Áudios entram e saem da mistura a qualquer momento (voz, áudio do jogo, áudio de quem apresenta)
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
  async start(videoTrack) {
    if (!recordingFormat()) throw new Error(t('Este navegador não consegue gravar vídeo.'));
    this.folder = null;
    if (window.showDirectoryPicker) {
      // Chrome e Edge: grava direto numa pasta, enquanto acontece (cancelar o seletor cancela a gravação)
      this.folder = await window.showDirectoryPicker({ id: 'overshoulder-gravacoes', mode: 'readwrite', startIn: 'videos' });
    }
    this.format = recordingFormat(!!this.folder);
    this.baseName = `overshoulder-${stamp()}`;
    this.parts = [];
    this.active = true;
    await this.audio.resume();
    if (videoTrack) await this.switchVideo(videoTrack);
  }

  switchVideo(videoTrack) {
    this.queue = this.queue.then(async () => {
      if (!this.active || this.current?.videoTrack === videoTrack) return;
      await this.#endPart();
      if (videoTrack) await this.#beginPart(videoTrack);
    });
    return this.queue;
  }

  async stop() {
    this.active = false;
    this.queue = this.queue.then(() => this.#endPart());
    await this.queue;
    return { parts: [...this.parts], toFolder: !!this.folder };
  }

  async #beginPart(videoTrack) {
    const [mimeType, ext] = this.format;
    const name = `${this.baseName}-${t('parte')}${this.parts.length + 1}.${ext}`;
    const stream = new MediaStream([videoTrack, ...this.mix.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
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
    this.current = { recorder, done, videoTrack };
    this.parts.push(name);
  }

  async #endPart() {
    const current = this.current;
    if (!current) return;
    this.current = null;
    if (current.recorder.state !== 'inactive') current.recorder.stop();
    await current.done;
  }
}
