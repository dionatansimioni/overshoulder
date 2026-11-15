// Duração no WebM (EBML), sem dependências: o navegador e os testes usam o mesmo código.
// O MediaRecorder grava o WebM em fluxo e não sabe a duração no começo. Aqui o elemento Duration
// (em ms, com a escala padrão de 1 ms) entra no Info do Segment, como os editores esperam.

const ID = { segment: 0x18538067, info: 0x1549a966, duration: 0x4489 };

// Tamanho de um número EBML (id ou tamanho) pelo primeiro byte: os zeros à esquerda dizem quantos bytes
const vintLength = (byte) => {
  for (let n = 1; n <= 8; n++) if (byte & (0x100 >> n)) return n;
  throw new Error('EBML inválido');
};
const readId = (b, at) => {
  const n = vintLength(b[at]);
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[at + i];
  return { value: v, length: n };
};
const readSize = (b, at) => {
  const n = vintLength(b[at]);
  let v = b[at] & (0xff >> n);
  let unknown = v === 0xff >> n;
  for (let i = 1; i < n; i++) {
    v = v * 256 + b[at + i];
    if (b[at + i] !== 0xff) unknown = false;
  }
  return { value: v, length: n, unknown };
};
const sizeBytes = (value, length = 8) => {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x100 >> length;
  return out;
};

export const withWebmDuration = async (blob, durationMs) => {
  // O cabeçalho (EBML, Segment e Info) fica nos primeiros bytes; o resto do arquivo não muda
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64 * 1024)).arrayBuffer());
  let at = 0;
  const ebml = readId(head, at);
  const ebmlSize = readSize(head, at + ebml.length);
  at += ebml.length + ebmlSize.length + ebmlSize.value;
  const segment = readId(head, at);
  if (segment.value !== ID.segment) throw new Error('sem Segment');
  const segmentSizeAt = at + segment.length;
  const segmentSize = readSize(head, segmentSizeAt);
  at = segmentSizeAt + segmentSize.length;
  while (at < head.length) {
    const id = readId(head, at);
    const size = readSize(head, at + id.length);
    const dataAt = at + id.length + size.length;
    if (id.value === ID.info) {
      const data = head.slice(dataAt, dataAt + size.value);
      for (let i = 0; i < data.length; ) {
        const child = readId(data, i);
        const childSize = readSize(data, i + child.length);
        if (child.value === ID.duration) return blob;
        i += child.length + childSize.length + childSize.value;
      }
      const duration = new Uint8Array(11);
      duration.set([0x44, 0x89, 0x88]);
      new DataView(duration.buffer).setFloat64(3, durationMs);
      const info = new Uint8Array(4 + 8 + data.length + duration.length);
      info.set(head.slice(at, at + id.length));
      info.set(sizeBytes(data.length + duration.length), id.length);
      info.set(data, id.length + 8);
      info.set(duration, id.length + 8 + data.length);
      const before = head.slice(0, at);
      // Segment com tamanho conhecido cresce junto (o do MediaRecorder costuma ser "desconhecido")
      if (!segmentSize.unknown) {
        const grown = segmentSize.value + info.length - (dataAt + size.value - at);
        before.set(sizeBytes(grown, segmentSize.length), segmentSizeAt);
      }
      return new Blob([before, info, blob.slice(dataAt + size.value)], { type: blob.type });
    }
    if (size.unknown) break;
    at = dataAt + size.value;
  }
  throw new Error('sem Info');
};
