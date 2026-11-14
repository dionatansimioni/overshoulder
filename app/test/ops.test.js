import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, api, startServer, waitForLiveKit } from './helpers.js';

let server;

before(async () => {
  await waitForLiveKit();
  server = await startServer(13020);
});
after(() => server?.stop());

test('/healthz responde ok quando app e LiveKit estão no ar', async () => {
  const res = await fetch(`${server.url}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('/healthz responde 503 sem detalhes quando o LiveKit não responde', async () => {
  const broken = await startServer(13021, { LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:1' });
  try {
    const res = await fetch(`${broken.url}/healthz`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: 'unavailable' });
  } finally {
    broken.stop();
  }
});

test('logs são JSON por linha e não expõem dados pessoais nem segredos', async () => {
  const { body: room } = await api(server.url, '/api/rooms', { password: PASSWORD });
  await api(server.url, '/api/rooms', { password: 'senha-errada-qualquer' });
  await api(server.url, '/api/token', { roomId: room.roomId, hostKey: room.hostKey, name: 'Fulana de Tal' });
  await api(server.url, '/api/rooms/end', { roomId: room.roomId, hostKey: room.hostKey });
  await new Promise((r) => setTimeout(r, 200));

  const lines = server.output().trim().split('\n');
  assert.ok(lines.length >= 3, 'deveria registrar início, sala criada e encerrada');
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.ok(entry.time && entry.level && entry.msg, line);
  }
  const all = server.output();
  for (const secret of [PASSWORD, 'senha-errada-qualquer', room.roomId, room.hostKey, 'Fulana', process.env.TEST_API_SECRET]) {
    assert.ok(!all.includes(secret), `log contém ${secret.slice(0, 6)}…`);
  }
  assert.match(all, /"msg":"sala criada"/);
  assert.match(all, /"msg":"sala encerrada"/);
  assert.match(all, /"msg":"senha incorreta"/);
});
