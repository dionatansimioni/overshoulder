import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { withWebmDuration } from '../public/webm.js';
import { launchBrowser, startServer } from './helpers.js';

const bytes = (...parts) => Uint8Array.from(parts.flat());
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// WebM mínimo como o do MediaRecorder: Segment de tamanho desconhecido e Info sem Duration
const sample = ({ segmentSize = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] } = {}) =>
  bytes(
    [0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, ...ascii('webm')],
    [0x18, 0x53, 0x80, 0x67, ...segmentSize],
    [0x15, 0x49, 0xa9, 0x66, 0x8e, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x4d, 0x80, 0x84, ...ascii('test')],
    [0x16, 0x54, 0xae, 0x6b, 0x80],
    [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00],
  );

// Procura o elemento Duration (0x4489, tamanho 8) e devolve o valor em ms
const durationOf = (b) => {
  for (let i = 0; i < b.length - 11; i++) {
    if (b[i] === 0x44 && b[i + 1] === 0x89 && b[i + 2] === 0x88) return new DataView(b.buffer, b.byteOffset + i + 3, 8).getFloat64(0);
  }
  return null;
};

describe('duração no WebM', () => {
  test('insere a Duration no Info e mantém o resto do arquivo igual', async () => {
    const input = sample();
    assert.equal(durationOf(input), null);
    const out = new Uint8Array(await (await withWebmDuration(new Blob([input]), 1234.5)).arrayBuffer());
    assert.equal(durationOf(out), 1234.5);
    // Info cresce 11 bytes (Duration) e o tamanho dele passa a ocupar 8 bytes (antes 1)
    assert.equal(out.length, input.length + 11 + 7);
    assert.deepEqual(out.subarray(out.length - 20), input.subarray(input.length - 20), 'Tracks e Cluster intactos');
  });

  test('arquivo que já tem duração volta igual; arquivo que não é WebM dá erro', async () => {
    const once = await withWebmDuration(new Blob([sample()]), 500);
    const twice = await withWebmDuration(once, 999);
    assert.equal(twice, once);
    await assert.rejects(withWebmDuration(new Blob([bytes([0x00, 0x01, 0x02, 0x03])]), 1));
  });

  test('Segment com tamanho conhecido cresce junto', async () => {
    const input = sample({ segmentSize: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x24] });
    const out = new Uint8Array(await (await withWebmDuration(new Blob([input]), 10)).arrayBuffer());
    // 0x24 (36) + 18 bytes a mais
    assert.deepEqual([...out.subarray(16, 24)], [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36]);
    assert.equal(durationOf(out), 10);
  });

  describe('com um WebM gravado de verdade', () => {
    let s;
    let browser;
    before(async () => {
      s = await startServer(13240);
      browser = await launchBrowser();
    });
    after(async () => {
      await browser?.close();
      s?.stop();
    });

    test('o MediaRecorder grava sem duração; depois do ajuste, a duração está lá', async () => {
      const page = await (await browser.newContext()).newPage();
      // Página sem redirecionamento (o servidor de teste não está configurado)
      await page.goto(`${s.url}/static/offline.html`);
      const result = await page.evaluate(async () => {
        const { withWebmDuration } = await import('/static/webm.js');
        const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
        const ctx = canvas.getContext('2d');
        const timer = setInterval(() => {
          ctx.fillStyle = `hsl(${Date.now() % 360} 80% 50%)`;
          ctx.fillRect(0, 0, 320, 180);
        }, 30);
        const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp9' });
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const started = performance.now();
        rec.start(250);
        await new Promise((r) => setTimeout(r, 1500));
        await new Promise((r) => {
          rec.onstop = r;
          rec.stop();
        });
        clearInterval(timer);
        const raw = new Blob(chunks, { type: 'video/webm' });
        const fixed = await withWebmDuration(raw, performance.now() - started);
        return { raw: [...new Uint8Array(await raw.arrayBuffer())], fixed: [...new Uint8Array(await fixed.arrayBuffer())] };
      });
      assert.equal(durationOf(Uint8Array.from(result.raw)), null, 'o MediaRecorder não grava a duração');
      const ms = durationOf(Uint8Array.from(result.fixed));
      assert.ok(ms > 1300 && ms < 3000, `duração: ${ms} ms`);
    });
  });
});
