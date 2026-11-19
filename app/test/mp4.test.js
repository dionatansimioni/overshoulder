import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { toProgressiveMp4 } from '../public/mp4.js';

// fixtures/fragmented.mp4: 2 s de vídeo H.264 (30 fps, com B-frames) e áudio AAC, fragmentado como o do
// MediaRecorder (moov vazio + moof/mdat). Gerado com:
// ffmpeg -f lavfi -i testsrc2=size=160x90:rate=30 -f lavfi -i sine -t 2 -c:v libx264 -g 30 -bf 2 -c:a aac \
//   -movflags frag_keyframe+empty_moov+default_base_moof fragmented.mp4
const fragmented = fs.readFileSync(new URL('./fixtures/fragmented.mp4', import.meta.url));

const boxes = (b, start = 0, end = b.length) => {
  const out = [];
  for (let at = start; at + 8 <= end; ) {
    const size = b.readUInt32BE(at);
    out.push({ type: b.toString('latin1', at + 4, at + 8), start: at, end: at + size, body: at + 8 });
    at += size;
  }
  return out;
};
const find = (b, parent, type) => boxes(b, parent.body, parent.end).filter((x) => x.type === type);

describe('MP4 que qualquer player abre', () => {
  test('o fixture é fragmentado: moov sem amostras e vários moof', () => {
    const top = boxes(fragmented).map((x) => x.type);
    assert.equal(top[0], 'ftyp');
    assert.ok(top.filter((t) => t === 'moof').length >= 2);
  });

  test('vira ftyp + moov + mdat, com duração, índice e todas as amostras', async () => {
    const out = Buffer.from(await (await toProgressiveMp4(new Blob([fragmented]))).arrayBuffer());
    const top = boxes(out);
    assert.deepEqual(top.map((x) => x.type), ['ftyp', 'moov', 'mdat'], 'moov antes do mdat, sem moof');
    const moov = top[1];
    assert.equal(find(out, moov, 'mvex').length, 0, 'sem mvex: o arquivo deixa de ser fragmentado');

    const mvhd = find(out, moov, 'mvhd')[0];
    const movieScale = out.readUInt32BE(mvhd.body + 12);
    assert.ok(Math.abs(out.readUInt32BE(mvhd.body + 16) / movieScale - 2) < 0.1, 'duração do filme ~2 s');

    const traks = find(out, moov, 'trak');
    assert.equal(traks.length, 2);
    const mdat = top[2];
    const counts = [];
    for (const trak of traks) {
      const mdia = find(out, trak, 'mdia')[0];
      const stbl = find(out, find(out, mdia, 'minf')[0], 'stbl')[0];
      const table = (type) => find(out, stbl, type)[0];
      const stsz = table('stsz');
      const samples = out.readUInt32BE(stsz.body + 8);
      counts.push(samples);
      // soma dos tamanhos = bytes de mídia daquela trilha, dentro do mdat
      let bytes = 0;
      for (let i = 0; i < samples; i++) bytes += out.readUInt32BE(stsz.body + 12 + i * 4);
      assert.ok(bytes > 0 && bytes < mdat.end - mdat.body);
      // o primeiro bloco começa dentro do mdat
      const stco = table('stco');
      const first = out.readUInt32BE(stco.body + 8);
      assert.ok(first >= mdat.body && first < mdat.end, 'deslocamento aponta para o mdat');
      // a soma das durações (stts) bate com a duração da trilha (mdhd)
      const stts = table('stts');
      let total = 0;
      for (let i = 0; i < out.readUInt32BE(stts.body + 4); i++) total += out.readUInt32BE(stts.body + 8 + i * 8) * out.readUInt32BE(stts.body + 12 + i * 8);
      const mdhd = find(out, mdia, 'mdhd')[0];
      assert.equal(out.readUInt32BE(mdhd.body + 16), total, 'duração da trilha = soma das amostras');
      assert.ok(out.readUInt32BE(mdhd.body + 16) > 0);
    }
    assert.ok(counts.includes(60), `60 quadros de vídeo: ${counts}`);
    // Nenhum byte de mídia se perde: o mdat novo tem o mesmo conteúdo dos mdat antigos
    const oldPayload = boxes(fragmented).filter((x) => x.type === 'mdat').reduce((n, x) => n + x.end - x.body, 0);
    assert.equal(mdat.end - mdat.body, oldPayload);
  });

  test('o que já é MP4 comum volta igual; o que não é MP4 dá erro', async () => {
    const once = await toProgressiveMp4(new Blob([fragmented]));
    const twice = await toProgressiveMp4(once);
    assert.equal(twice, once, 'sem mvex, nada a fazer');
    await assert.rejects(toProgressiveMp4(new Blob([Buffer.from('isto não é um MP4 de jeito nenhum')])));
  });
});
