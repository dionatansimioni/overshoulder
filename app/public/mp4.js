// MP4 que qualquer player abre: o MediaRecorder grava MP4 fragmentado (um moov sem amostras e, depois,
// pares moof+mdat de ~1 s). O Chrome toca e pula nele, mas o Windows (Filmes e TV), o QuickTime e muitos
// editores não têm índice nem duração para avançar. Aqui o arquivo é reescrito como MP4 comum:
// ftyp + moov (com as tabelas de amostras e a duração) + mdat. Os bytes de vídeo e áudio não são
// recodificados nem copiados para a memória: o mdat novo é montado com fatias do Blob original.
// Sem dependências: o navegador e os testes usam o mesmo código.

const MAX_32 = 0xffffffff;

// --- leitura -----------------------------------------------------------------

const type4 = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

const parseBox = (view, at, end) => {
  if (at + 8 > end) return null;
  let size = view.getUint32(at);
  let header = 8;
  if (size === 1) {
    size = Number(view.getBigUint64(at + 8));
    header = 16;
  } else if (size === 0) size = end - at;
  if (size < header || at + size > end) return null;
  return { type: type4(view, at + 4), start: at, header, end: at + size };
};

const children = (view, box) => {
  const out = [];
  for (let at = box.start + box.header; at < box.end; ) {
    const child = parseBox(view, at, box.end);
    if (!child) break;
    out.push(child);
    at = child.end;
  }
  return out;
};
const child = (view, box, type) => children(view, box).find((c) => c.type === type);

// Caixas de nível superior lidas aos poucos, sem trazer o arquivo todo para a memória
const scanTopLevel = async (blob) => {
  const out = [];
  for (let at = 0; at + 8 <= blob.size; ) {
    const view = new DataView(await blob.slice(at, Math.min(at + 16, blob.size)).arrayBuffer());
    const box = parseBox(view, 0, blob.size - at);
    if (!box) break;
    out.push({ ...box, start: at, end: at + box.end });
    at += box.end;
  }
  return out;
};

// --- escrita -----------------------------------------------------------------

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (...values) => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0));
  return out;
};
const box = (type, ...parts) => {
  const body = concat(parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
};
const fullBox = (type, version, flags, ...parts) => box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);

// Tabela de n linhas com 'cols' inteiros de 32 bits cada, antecedida pela contagem
const table = (type, version, rows, signed = false) => {
  const cols = rows.length ? rows[0].length : 0;
  const body = new Uint8Array(4 + rows.length * cols * 4);
  const view = new DataView(body.buffer);
  view.setUint32(0, rows.length);
  rows.forEach((row, r) => row.forEach((v, c) => (signed ? view.setInt32(4 + (r * cols + c) * 4, v) : view.setUint32(4 + (r * cols + c) * 4, v >>> 0))));
  return fullBox(type, version, 0, body);
};

// Copia a caixa trocando o campo de duração (mvhd, tkhd e mdhd mudam de lugar conforme a versão)
const withDuration = (bytes, durationOffsetV0, durationOffsetV1, duration) => {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  if (out[8] === 1) view.setBigUint64(durationOffsetV1, BigInt(Math.round(duration)));
  else view.setUint32(durationOffsetV0, Math.min(MAX_32, Math.round(duration)));
  return out;
};
const timescaleOf = (view, box) => view.getUint32(box.start + box.header + (view.getUint8(box.start + box.header) === 1 ? 20 : 12));

// --- fragmentos ----------------------------------------------------------------

const readFragment = (view, moof, moofStart, tracks) => {
  const runs = [];
  for (const traf of children(view, moof).filter((c) => c.type === 'traf')) {
    const tfhd = child(view, traf, 'tfhd');
    if (!tfhd) continue;
    const c = tfhd.start + tfhd.header;
    const flags = view.getUint32(c) & 0xffffff;
    const track = tracks.get(view.getUint32(c + 4));
    if (!track) continue;
    let p = c + 8;
    let base = moofStart;
    if (flags & 0x1) {
      base = Number(view.getBigUint64(p));
      p += 8;
    }
    if (flags & 0x2) p += 4;
    const def = { ...track.trex };
    if (flags & 0x8) def.duration = view.getUint32(p), (p += 4);
    if (flags & 0x10) def.size = view.getUint32(p), (p += 4);
    if (flags & 0x20) def.flags = view.getUint32(p), (p += 4);

    const tfdt = child(view, traf, 'tfdt');
    if (tfdt && track.start === null) {
      const tc = tfdt.start + tfdt.header;
      track.start = view.getUint8(tc) === 1 ? Number(view.getBigUint64(tc + 4)) : view.getUint32(tc + 4);
    }
    let next = base;
    for (const trun of children(view, traf).filter((x) => x.type === 'trun')) {
      const tc = trun.start + trun.header;
      const version = view.getUint8(tc);
      const tflags = view.getUint32(tc) & 0xffffff;
      const count = view.getUint32(tc + 4);
      let q = tc + 8;
      let at = next;
      if (tflags & 0x1) {
        at = base + view.getInt32(q);
        q += 4;
      }
      let first = null;
      if (tflags & 0x4) {
        first = view.getUint32(q);
        q += 4;
      }
      const runStart = at;
      for (let i = 0; i < count; i++) {
        let duration = def.duration;
        let size = def.size;
        let sflags = i === 0 && first !== null ? first : def.flags;
        let cto = 0;
        if (tflags & 0x100) duration = view.getUint32(q), (q += 4);
        if (tflags & 0x200) size = view.getUint32(q), (q += 4);
        if (tflags & 0x400) sflags = view.getUint32(q), (q += 4);
        if (tflags & 0x800) cto = version === 1 ? view.getInt32(q) : view.getUint32(q), (q += 4);
        track.samples.push({ duration, size, cto, sync: !(sflags & 0x10000) });
        at += size;
      }
      next = at;
      if (at > runStart) runs.push({ track, src: runStart, length: at - runStart, count });
    }
  }
  return runs;
};

// --- conversão -----------------------------------------------------------------

// Devolve o Blob já como MP4 comum. Um arquivo que não é MP4 fragmentado volta como veio; erro de leitura
// ou arquivo estranho lança, e quem chama fica com o original.
export const toProgressiveMp4 = async (blob) => {
  const top = await scanTopLevel(blob);
  const ftyp = top.find((b) => b.type === 'ftyp');
  const moovBox = top.find((b) => b.type === 'moov');
  if (!ftyp || !moovBox) throw new Error('MP4 inválido');
  const moov = new Uint8Array(await blob.slice(moovBox.start, moovBox.end).arrayBuffer());
  const mv = new DataView(moov.buffer);
  const moovRoot = { type: 'moov', start: 0, header: moovBox.header, end: moov.length };
  const mvex = child(mv, moovRoot, 'mvex');
  if (!mvex) return blob;

  const mvhd = child(mv, moovRoot, 'mvhd');
  const movieScale = timescaleOf(mv, mvhd);
  const tracks = new Map();
  for (const trex of children(mv, mvex).filter((b) => b.type === 'trex')) {
    const c = trex.start + trex.header;
    tracks.set(mv.getUint32(c + 4), { id: mv.getUint32(c + 4), trex: { duration: mv.getUint32(c + 12), size: mv.getUint32(c + 16), flags: mv.getUint32(c + 20) }, samples: [], start: null });
  }
  const traks = children(mv, moovRoot).filter((b) => b.type === 'trak');
  for (const trak of traks) {
    const tkhd = child(mv, trak, 'tkhd');
    const c = tkhd.start + tkhd.header;
    const track = tracks.get(mv.getUint32(c + (mv.getUint8(c) === 1 ? 20 : 12)));
    if (!track) continue;
    const mdia = child(mv, trak, 'mdia');
    const hdlr = child(mv, mdia, 'hdlr');
    track.trak = trak;
    track.mdia = mdia;
    track.scale = timescaleOf(mv, child(mv, mdia, 'mdhd'));
    track.video = type4(mv, hdlr.start + hdlr.header + 8) === 'vide';
  }

  // Cada moof com os dados do mdat que vem depois: lidos na ordem do arquivo
  const runs = [];
  for (const b of top.filter((x) => x.type === 'moof')) {
    const bytes = new Uint8Array(await blob.slice(b.start, b.end).arrayBuffer());
    runs.push(...readFragment(new DataView(bytes.buffer), { type: 'moof', start: 0, header: b.header, end: bytes.length }, b.start, tracks));
  }
  const used = [...tracks.values()].filter((t) => t.trak && t.samples.length);
  if (!used.length) throw new Error('MP4 sem amostras');

  // Início de cada trilha em relação à primeira (áudio e vídeo raramente começam juntos)
  const startOf = (t) => (t.start ?? 0) / t.scale;
  const origin = Math.min(...used.map(startOf));
  const trackInfo = used.map((t) => {
    const mediaDuration = t.samples.reduce((n, s) => n + s.duration, 0);
    const delay = Math.round((startOf(t) - origin) * movieScale);
    return { t, mediaDuration, delay, movieDuration: delay + Math.round((mediaDuration / t.scale) * movieScale) };
  });
  const movieDuration = Math.max(...trackInfo.map((i) => i.movieDuration));

  const total = runs.reduce((n, r) => n + r.length, 0);
  const wide = blob.size + moov.length >= MAX_32 - 1024;

  const raw = (bx) => moov.subarray(bx.start, bx.end);
  const buildMoov = (offsets) => {
    const out = [withDuration(raw(mvhd), 24, 32, movieDuration)];
    for (const trak of traks) {
      const info = trackInfo.find((i) => i.t.trak === trak);
      if (!info) continue;
      const { t } = info;
      const tkhd = child(mv, trak, 'tkhd');
      const mdhd = child(mv, t.mdia, 'mdhd');
      const minf = child(mv, t.mdia, 'minf');
      const stbl = child(mv, minf, 'stbl');
      const s = t.samples;

      const stts = [];
      for (const { duration } of s) {
        const last = stts[stts.length - 1];
        if (last && last[1] === duration) last[0]++;
        else stts.push([1, duration]);
      }
      const ctts = [];
      for (const { cto } of s) {
        const last = ctts[ctts.length - 1];
        if (last && last[1] === cto) last[0]++;
        else ctts.push([1, cto]);
      }
      const hasCtts = ctts.some(([, cto]) => cto !== 0);
      const stss = t.video ? s.flatMap((x, i) => (x.sync ? [[i + 1]] : [])) : [];
      const chunks = offsets.filter((o) => o.track === t);
      const stsc = [];
      chunks.forEach((chunk, i) => {
        const last = stsc[stsc.length - 1];
        if (!last || last[1] !== chunk.count) stsc.push([i + 1, chunk.count, 1]);
      });
      const sizes = new Uint8Array(8 + s.length * 4);
      const sv = new DataView(sizes.buffer);
      sv.setUint32(4, s.length);
      s.forEach((x, i) => sv.setUint32(8 + i * 4, x.size));
      let chunkOffsets;
      if (wide) {
        const body = new Uint8Array(4 + chunks.length * 8);
        const bv = new DataView(body.buffer);
        bv.setUint32(0, chunks.length);
        chunks.forEach((c, i) => bv.setBigUint64(4 + i * 8, BigInt(c.offset)));
        chunkOffsets = fullBox('co64', 0, 0, body);
      } else chunkOffsets = table('stco', 0, chunks.map((c) => [c.offset]));

      const newStbl = box(
        'stbl',
        raw(child(mv, stbl, 'stsd')),
        table('stts', 0, stts),
        ...(hasCtts ? [table('ctts', ctts.some(([, c]) => c < 0) ? 1 : 0, ctts, ctts.some(([, c]) => c < 0))] : []),
        ...(stss.length && stss.length < s.length ? [table('stss', 0, stss)] : []),
        table('stsc', 0, stsc),
        fullBox('stsz', 0, 0, sizes),
        chunkOffsets,
      );
      const newMinf = box('minf', ...children(mv, minf).filter((c) => c.type !== 'stbl').map(raw), newStbl);
      const edts = info.delay
        ? [box('edts', fullBox('elst', 0, 0, u32(2, info.delay, MAX_32, 0x10000, info.movieDuration - info.delay, 0, 0x10000)))]
        : [];
      out.push(
        box(
          'trak',
          withDuration(raw(tkhd), 28, 36, info.movieDuration),
          ...edts,
          box('mdia', withDuration(raw(mdhd), 24, 32, info.mediaDuration), raw(child(mv, t.mdia, 'hdlr')), newMinf),
        ),
      );
    }
    return box('moov', ...out);
  };

  // O tamanho do moov não depende dos valores dos deslocamentos: mede com zeros e refaz com os certos
  const chunkList = runs.map((r) => ({ track: r.track, count: r.count, offset: 0 }));
  const ftypBytes = new Uint8Array(await blob.slice(ftyp.start, ftyp.end).arrayBuffer());
  const moovSize = buildMoov(chunkList).length;
  const mdatHeader = total + 8 > MAX_32 ? 16 : 8;
  let at = ftypBytes.length + moovSize + mdatHeader;
  chunkList.forEach((c, i) => {
    c.offset = at;
    at += runs[i].length;
  });
  const mdat = new Uint8Array(mdatHeader);
  const mdv = new DataView(mdat.buffer);
  if (mdatHeader === 8) mdv.setUint32(0, total + 8);
  else {
    mdv.setUint32(0, 1);
    mdv.setBigUint64(8, BigInt(total + 16));
  }
  mdat.set(new TextEncoder().encode('mdat'), 4);

  return new Blob([ftypBytes, buildMoov(chunkList), mdat, ...runs.map((r) => blob.slice(r.src, r.src + r.length))], { type: 'video/mp4' });
};
