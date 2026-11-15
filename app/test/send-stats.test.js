import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createNetworkWatch, summarizeSend } from '../public/send-stats.js';

const layer = (over) => ({ frameWidth: 1920, frameHeight: 1080, framesPerSecond: 59.6, bytesSent: 0, packetsSent: 0, packetsLost: 0, qualityLimitationReason: 'none', timestamp: 0, ...over });

describe('resumo do envio', () => {
  test('usa a maior camada para resolução e fps e soma as camadas para taxa e perda', () => {
    const first = summarizeSend([layer({ bytesSent: 1_000_000, packetsSent: 1000, timestamp: 1000 }), layer({ frameWidth: 640, bytesSent: 200_000, packetsSent: 300, timestamp: 1000 })], null);
    assert.equal(first.width, 1920);
    assert.equal(first.fps, 60);
    assert.equal(first.mbps, null, 'sem retrato anterior, ainda sem taxa');
    const next = summarizeSend(
      [layer({ bytesSent: 1_750_000, packetsSent: 1900, packetsLost: 50, timestamp: 2000 }), layer({ frameWidth: 640, bytesSent: 325_000, packetsSent: 400, timestamp: 2000 })],
      first.snap,
    );
    // 875 000 bytes em 1 s = 7 Mbps; 50 perdidos de 1050
    assert.equal(next.mbps, 7);
    assert.ok(Math.abs(next.lossPct - (100 * 50) / 1050) < 1e-9);
  });

  test('sem camadas, ou contadores que voltam (troca de qualidade), não quebra', () => {
    assert.equal(summarizeSend([], null), null);
    assert.equal(summarizeSend(undefined, null), null);
    const s = summarizeSend([layer({ packetsLost: -1, timestamp: 5 })], { bytes: 0, sent: 0, lost: 0, time: 10 });
    assert.equal(s.mbps, null, 'relógio anterior maior: sem taxa');
  });
});

describe('avisos de rede', () => {
  test('banda: avisa uma vez depois de 6 s seguidos limitado, e de novo só num novo episódio', () => {
    const watch = createNetworkWatch();
    const limited = { limitedBy: 'bandwidth', lossPct: 0 };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(watch(limited).bandwidth);
    assert.deepEqual(results, [false, false, false, false, false, true, false, false]);
    watch({ limitedBy: 'none', lossPct: 0 });
    for (let i = 0; i < 5; i++) assert.equal(watch(limited).bandwidth, false);
    assert.equal(watch(limited).bandwidth, true);
  });

  test('pico curto não avisa; limitação por CPU não é banda', () => {
    const watch = createNetworkWatch();
    for (let i = 0; i < 5; i++) watch({ limitedBy: 'bandwidth', lossPct: 0 });
    assert.equal(watch({ limitedBy: 'cpu', lossPct: 0 }).bandwidth, false);
    for (let i = 0; i < 10; i++) assert.equal(watch({ limitedBy: 'cpu', lossPct: 0 }).bandwidth, false);
  });

  test('perda de pacotes: avisa com 5% ou mais por 6 s', () => {
    const watch = createNetworkWatch();
    for (let i = 0; i < 5; i++) assert.equal(watch({ limitedBy: 'none', lossPct: 8 }).loss, false);
    assert.equal(watch({ limitedBy: 'none', lossPct: 8 }).loss, true);
    const calm = createNetworkWatch();
    for (let i = 0; i < 10; i++) assert.equal(calm({ limitedBy: 'none', lossPct: 2 }).loss, false);
    for (let i = 0; i < 10; i++) assert.equal(calm({ limitedBy: 'none', lossPct: null }).loss, false);
  });
});
