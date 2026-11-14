import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { ADMIN, api, jwtPayload, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const ROOM_ID = 'a'.repeat(22);
const SECRET_LEAKS = /\bat \S+:\d+:\d+|\/app\/|node_modules|server\.js|Error:|stack|LIVEKIT|API_SECRET|HOST_KEY/i;

let server;
let base;
let session;

before(async () => {
  await waitForLiveKit();
  server = await startServer(13010);
  base = server.url;
  session = await setupAdmin(server);
});
after(() => server?.stop());

const createRoom = async () => (await api(base, '/api/rooms', {}, session)).body;

const rawRequest = (route, { method = 'GET', body, headers = {} } = {}) =>
  fetch(base + route, { method, body, headers, redirect: 'manual' });

// Envia o caminho exatamente como escrito: o fetch normalizaria '..' antes de enviar
const exactPath = (route) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base);
    http
      .get({ hostname, port, path: route }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });

// Cada grupo de testes usa um servidor próprio: as senhas erradas de um grupo
// contam no limite de tentativas e bloqueariam os grupos seguintes
const ownServer = (port) => {
  let previous;
  before(async () => {
    previous = { server, base, session };
    server = await startServer(port);
    base = server.url;
    session = await setupAdmin(server);
  });
  after(() => {
    server.stop();
    ({ server, base, session } = previous);
  });
};

describe('cabeçalhos de segurança em todas as respostas', () => {
  const responses = async () => {
    const { roomId } = await createRoom();
    return {
      'página inicial': await rawRequest('/'),
      'página da sala': await rawRequest(`/r/${ROOM_ID}`),
      'arquivo estático': await rawRequest('/static/style.css'),
      'biblioteca vendor': await rawRequest('/vendor/livekit-client.esm.mjs'),
      'não encontrado': await rawRequest('/nao-existe'),
      'método não permitido': await rawRequest('/', { method: 'PUT' }),
      'API com sucesso': await rawRequest('/api/token', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
        headers: { 'Content-Type': 'application/json' },
      }),
      'API com erro': await rawRequest('/api/rooms', { method: 'POST', body: '{"password":"x"}' }),
    };
  };

  test('CSP, nosniff, frame, referrer e permissões', async () => {
    for (const [name, res] of Object.entries(await responses())) {
      const h = res.headers;
      assert.match(h.get('content-security-policy') ?? '', /default-src 'self'/, name);
      assert.match(h.get('content-security-policy') ?? '', /frame-ancestors 'none'/, name);
      assert.equal(h.get('x-content-type-options'), 'nosniff', name);
      assert.equal(h.get('x-frame-options'), 'DENY', name);
      assert.equal(h.get('referrer-policy'), 'no-referrer', name);
      assert.ok(h.get('permissions-policy'), name);
      assert.equal(h.get('x-powered-by'), null, name);
      assert.equal(h.get('server'), null, name);
    }
  });

  test('CSP só permite WebSocket para o próprio site e o LiveKit configurado', async () => {
    const csp = (await rawRequest('/')).headers.get('content-security-policy');
    const connect = csp.match(/connect-src ([^;]+)/)[1].split(/\s+/);
    assert.deepEqual(connect.sort(), ["'self'", 'ws://127.0.0.1:17880'].sort());
  });

  test('respostas da API não ficam em cache', async () => {
    const res = await rawRequest('/api/rooms', { method: 'POST', body: '{}' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-type'), /application\/json/);
  });
});

describe('métodos e rotas', () => {
  test('métodos de escrita fora da API são recusados', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'POST']) {
      for (const route of ['/', `/r/${ROOM_ID}`, '/static/room.js']) {
        assert.equal((await rawRequest(route, { method })).status, 405, `${method} ${route}`);
      }
    }
  });

  test('rotas da API só aceitam POST', async () => {
    for (const route of ['/api/rooms', '/api/token', '/api/rooms/end']) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.notEqual((await rawRequest(route, { method })).status, 200, `${method} ${route}`);
      }
    }
  });

  test('código-fonte, segredos e pastas internas não são servidos', async () => {
    for (const route of [
      '/.env',
      '/server.js',
      '/package.json',
      '/package-lock.json',
      '/Dockerfile',
      '/.git/config',
      '/node_modules/livekit-server-sdk/package.json',
      '/test/helpers.js',
      '/public/room.js',
      '/static/',
      '/vendor/',
    ]) {
      const res = await rawRequest(route);
      assert.equal(res.status, 404, route);
    }
  });

  test('travessia de diretório não escapa da pasta pública', async () => {
    const home = (await exactPath('/')).body;
    for (const route of [
      '/static/..',
      '/static/...',
      '/static/..%2fserver.js',
      '/static/%2e%2e%2fserver.js',
      '/static/%252e%252e%252fserver.js',
      '/static/..%5cserver.js',
      '/static/room.js%00.css',
      '/static/../server.js',
      '/vendor/../server.js',
      '/vendor/..%2f..%2fserver.js',
      '/r/../../server.js',
      '/static/Room.js',
    ]) {
      const res = await exactPath(route);
      assert.doesNotMatch(res.body, /import http|createServer|CREATE_PASSWORD|"dependencies"/, route);
      // O servidor resolve '..' dentro do próprio site (ex.: /static/.. vira /): no máximo uma página pública
      if (res.status !== 404) assert.equal(res.body, home, `${route} devolveu algo além da página inicial`);
    }
  });
});

describe('entradas malformadas', () => {
  ownServer(13013);
  test('JSON inválido devolve 400 sem detalhes internos', async () => {
    for (const route of ['/api/login', '/api/token', '/api/rooms/end']) {
      const r = await api(base, route, '{"password": ');
      assert.equal(r.status, 400, route);
      assert.doesNotMatch(r.text, SECRET_LEAKS, route);
    }
  });

  test('corpo grande demais devolve 413', async () => {
    const r = await api(base, '/api/login', { password: 'x'.repeat(10_000) });
    assert.equal(r.status, 413);
    assert.doesNotMatch(r.text, SECRET_LEAKS);
  });

  test('JSON que não é objeto não derruba a API', async () => {
    for (const body of ['null', '[]', '"texto"', '42', 'true']) {
      for (const route of ['/api/login', '/api/token', '/api/rooms/end']) {
        const r = await api(base, route, body);
        assert.ok([400, 403].includes(r.status), `${route} ${body}: ${r.status}`);
      }
    }
  });

  test('campos com tipos errados não derrubam a API nem passam pela senha', async () => {
    for (const password of [null, 0, 1, true, [], {}, [ADMIN.password], { toString: ADMIN.password }]) {
      const r = await api(base, '/api/login', { username: ADMIN.username, password });
      assert.equal(r.status, 401, JSON.stringify(password));
    }
    for (const roomId of [null, 42, [], {}, ['a'.repeat(22)]]) {
      assert.equal((await api(base, '/api/token', { roomId })).status, 400, JSON.stringify(roomId));
      assert.equal((await api(base, '/api/rooms/end', { roomId, hostKey: 'x' })).status, 400);
    }
  });

  test('erros nunca expõem detalhes internos', async () => {
    const attempts = [
      api(base, '/api/login', { username: ADMIN.username, password: 'errada' }),
      api(base, '/api/token', { roomId: 'b'.repeat(22) }),
      api(base, '/api/rooms/end', { roomId: 'b'.repeat(22), hostKey: 'x' }),
      api(base, '/api/token', '{'),
    ];
    for (const r of await Promise.all(attempts)) {
      assert.doesNotMatch(r.text, SECRET_LEAKS, r.text);
      assert.equal(typeof r.body.error, 'string');
    }
  });
});

describe('tokens do LiveKit', () => {
  ownServer(13014);
  const verifySignature = (token) => {
    const [header, payload, signature] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.TEST_API_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return expected === signature;
  };

  test('espectador só assiste e conversa: não publica nem administra', async () => {
    const { roomId } = await createRoom();
    const { body } = await api(base, '/api/token', { roomId, name: 'Beto' });
    assert.ok(verifySignature(body.token));
    const claims = jwtPayload(body.token);
    assert.match(claims.video.room, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(claims.video.room, roomId, 'o nome interno da sala não é o código do link');
    assert.equal(claims.video.roomJoin, true);
    assert.equal(claims.video.canPublish, false);
    assert.deepEqual(claims.video.canPublishSources ?? [], []);
    assert.equal(claims.video.canPublishData, true);
    for (const grant of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'ingressAdmin', 'hidden', 'recorder', 'agent']) {
      assert.ok(!claims.video[grant], grant);
    }
  });

  test('anfitrião publica só tela, áudio da tela e microfone', async () => {
    const { roomId, hostKey } = await createRoom();
    const { body } = await api(base, '/api/token', { roomId, hostKey, name: 'Ana' });
    const claims = jwtPayload(body.token);
    assert.equal(claims.video.canPublish, true);
    assert.deepEqual([...claims.video.canPublishSources].sort(), ['microphone', 'screen_share', 'screen_share_audio']);
    assert.ok(!claims.video.roomAdmin);
    assert.ok(!claims.video.canUpdateOwnMetadata);
  });

  test('token expira em até 8 horas', async () => {
    const { roomId } = await createRoom();
    const claims = jwtPayload((await api(base, '/api/token', { roomId })).body.token);
    assert.ok(claims.exp - claims.nbf <= 8 * 3600, `${claims.exp - claims.nbf}s`);
  });

  test('identidade é gerada pelo servidor e o nome é limitado a 32 caracteres', async () => {
    const { roomId } = await createRoom();
    const name = `<img src=x onerror=alert(1)>${'x'.repeat(100)}`;
    const claims = jwtPayload((await api(base, '/api/token', { roomId, name })).body.token);
    assert.match(claims.sub, /^v-[0-9a-f]{12}$/);
    assert.equal(claims.name.length, 32);
    const again = jwtPayload((await api(base, '/api/token', { roomId, name })).body.token);
    assert.notEqual(again.sub, claims.sub, 'cada entrada recebe uma identidade nova');
  });

  test('chave de anfitrião de uma sala não vale em outra', async () => {
    const a = await createRoom();
    const b = await createRoom();
    const cross = await api(base, '/api/token', { roomId: b.roomId, hostKey: a.hostKey });
    assert.equal(cross.body.role, 'viewer');
    assert.equal((await api(base, '/api/rooms/end', { roomId: b.roomId, hostKey: a.hostKey })).status, 403);
  });
});

describe('limite de tentativas de senha', () => {
  const failTenTimes = async (url, headers) => {
    for (let i = 0; i < 10; i++) await api(url, '/api/login', { username: `x${i}`, password: 'errada' }, headers(i));
  };

  test('sem proxy confiável, X-Forwarded-For é ignorado', async () => {
    const s = await startServer(13011);
    await setupAdmin(s);
    try {
      await failTenTimes(s.url, (i) => ({ 'X-Forwarded-For': `198.51.100.${i}` }));
      const r = await api(s.url, '/api/login', ADMIN, { 'X-Forwarded-For': '203.0.113.9' });
      assert.equal(r.status, 429);
    } finally {
      s.stop();
    }
  });

  test('atrás de proxy, falsificar o começo do X-Forwarded-For não burla o limite', async () => {
    const s = await startServer(13012, { TRUST_PROXY: '1' });
    await setupAdmin(s);
    try {
      // O proxy acrescenta o IP real (203.0.113.7) ao fim; o começo vem do cliente e pode ser forjado
      await failTenTimes(s.url, (i) => ({ 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.7` }));
      const r = await api(s.url, '/api/login', ADMIN, { 'X-Forwarded-For': '192.0.2.1, 203.0.113.7' });
      assert.equal(r.status, 429);
    } finally {
      s.stop();
    }
  });
});

describe('no navegador', () => {
  ownServer(13015);
  let browser;
  before(async () => {
    browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  });
  after(() => browser?.close());

  // Registra tudo o que a página envia: URLs, corpos e quadros de WebSocket.
  // A permissão de microfone é só do ambiente de teste: sem ela o Chrome esconde os
  // endereços locais do WebRTC e não conecta ao LiveKit em 127.0.0.1.
  const watchedPage = async () => {
    const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    const sent = [];
    page.on('request', (r) => sent.push(r.url(), r.postData() ?? ''));
    page.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(Buffer.from(f.payload).toString('latin1'))));
    return { page, sent };
  };

  const join = async (page, name) => {
    await page.fill('#name', name);
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
  };

  test('a chave E2EE nunca sai do navegador e a de anfitrião sai da barra de endereço', async () => {
    const host = await watchedPage();
    await loginInBrowser(host.page, base);
    await host.page.click('#create-form button');
    await host.page.waitForURL(/#k=/);
    const key = new URLSearchParams(new URL(host.page.url()).hash.slice(1)).get('k');
    assert.ok(key && key.length >= 40);
    await join(host.page, 'Ana');
    assert.doesNotMatch(host.page.url(), /[#&]h=/);

    const viewer = await watchedPage();
    await viewer.page.goto(await host.page.inputValue('#invite-link'));
    await join(viewer.page, 'Beto');
    await viewer.page.fill('#chat-input', 'mensagem qualquer');
    await viewer.page.press('#chat-input', 'Enter');
    await host.page.locator('#messages li.msg', { hasText: 'mensagem qualquer' }).waitFor();

    for (const data of [...host.sent, ...viewer.sent]) assert.ok(!data.includes(key), 'a chave E2EE vazou para a rede');
  });

  test('nome e mensagem com HTML aparecem como texto, sem executar', async () => {
    const host = await watchedPage();
    await loginInBrowser(host.page, base);
    await host.page.click('#create-form button');
    await host.page.waitForURL(/#k=/);
    await join(host.page, 'Ana');

    const evil = '<img src=x onerror="window.__xss=1">';
    const viewer = await watchedPage();
    await viewer.page.goto(await host.page.inputValue('#invite-link'));
    await join(viewer.page, evil.slice(0, 32));
    await viewer.page.fill('#chat-input', `<script>window.__xss=2</script>${evil}`);
    await viewer.page.press('#chat-input', 'Enter');

    const msg = host.page.locator('#messages li.msg', { hasText: '<script>' });
    await msg.waitFor();
    assert.equal(await msg.locator('.text').textContent(), `<script>window.__xss=2</script>${evil}`);
    assert.equal(await msg.locator('img').count(), 0);
    assert.equal(await host.page.evaluate(() => window.__xss), undefined);
    assert.equal(await viewer.page.evaluate(() => window.__xss), undefined);
  });
});
