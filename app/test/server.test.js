import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PASSWORD, api, startServer, waitForLiveKit } from './helpers.js';

let server;
let base;

before(async () => {
  await waitForLiveKit();
  server = await startServer(13000);
  base = server.url;
});
after(() => server?.stop());

describe('arquivos', () => {
  test('página inicial com cabeçalhos de segurança', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(await res.text(), /<title>[^<]+<\/title>/);
  });

  test('página da sala responde em /r/<id>', async () => {
    const res = await fetch(`${base}/r/${'a'.repeat(22)}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /room\.js/);
  });

  test('ícones e estáticos com o tipo certo', async () => {
    for (const [file, type] of [
      ['icon.svg', 'image/svg+xml'],
      ['icon-180.png', 'image/png'],
      ['style.css', 'text/css'],
      ['room.js', 'text/javascript'],
    ]) {
      const res = await fetch(`${base}/static/${file}`);
      assert.equal(res.status, 200, file);
      assert.match(res.headers.get('content-type'), new RegExp(type.replace('+', '\\+')), file);
    }
  });

  test('vendor só entrega os arquivos liberados', async () => {
    assert.equal((await fetch(`${base}/vendor/livekit-client.esm.mjs`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/livekit-client.umd.js`)).status, 404);
  });

  test('caminhos desconhecidos ou suspeitos dão 404', async () => {
    assert.equal((await fetch(`${base}/static/..%2Fserver.js`)).status, 404);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/r/curto`)).status, 404);
  });
});

describe('API de salas', () => {
  test('senha errada é recusada', async () => {
    const r = await api(base, '/api/rooms', { password: 'errada' });
    assert.equal(r.status, 403);
  });

  test('cria sala, emite tokens e encerra', async () => {
    const created = await api(base, '/api/rooms', { password: PASSWORD });
    assert.equal(created.status, 201);
    const { roomId, hostKey } = created.body;
    assert.match(roomId, /^[A-Za-z0-9_-]{22}$/);

    const host = await api(base, '/api/token', { roomId, hostKey, name: 'Ana' });
    assert.equal(host.status, 200);
    assert.equal(host.body.role, 'host');
    assert.equal(host.body.url, 'ws://127.0.0.1:17880');
    assert.ok(host.body.token);

    const viewer = await api(base, '/api/token', { roomId, name: 'Beto' });
    assert.equal(viewer.body.role, 'viewer');

    const fakeHost = await api(base, '/api/token', { roomId, hostKey: 'chute', name: 'X' });
    assert.equal(fakeHost.body.role, 'viewer');

    assert.equal((await api(base, '/api/rooms/end', { roomId, hostKey: 'chute' })).status, 403);
    assert.equal((await api(base, '/api/rooms/end', { roomId, hostKey })).status, 200);
    assert.equal((await api(base, '/api/token', { roomId, name: 'Beto' })).status, 404);
  });

  test('sala inválida ou inexistente', async () => {
    assert.equal((await api(base, '/api/token', { roomId: 'x' })).status, 400);
    assert.equal((await api(base, '/api/token', { roomId: 'b'.repeat(22) })).status, 404);
  });
});

describe('limite de tentativas', () => {
  // Servidor separado: o bloqueio por IP afetaria os outros testes
  let other;
  before(async () => (other = await startServer(13001)));
  after(() => other?.stop());

  test('bloqueia depois de 10 senhas erradas', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await api(other.url, '/api/rooms', { password: 'errada' })).status, 403);
    }
    assert.equal((await api(other.url, '/api/rooms', { password: PASSWORD })).status, 429);
  });
});
