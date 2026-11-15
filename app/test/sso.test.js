import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { CLIENT, startOidcMock } from './oidc-mock.js';
import { api, createRoom, get, jwtPayload, loginInBrowser, setupAdmin, startServer, waitForLiveKit, launchBrowser } from './helpers.js';

let oidc;
let s;
let admin;
const servers = [];

const SSO_CONFIG = {
  enabled: true,
  clientId: CLIENT.id,
  clientSecret: CLIENT.secret,
  domains: 'empresa.com.br',
  broadcasterGroup: 'overshoulder-transmissores',
  broadcasterEmails: 'chefe@empresa.com.br',
};

const freshServer = async (port) => {
  const server = await startServer(port);
  servers.push(server);
  const session = await setupAdmin(server);
  const r = await api(server.url, '/api/admin/sso', { ...SSO_CONFIG, issuer: oidc.issuer }, session);
  assert.equal(r.status, 200, r.text);
  return { server, session };
};

before(async () => {
  await waitForLiveKit();
  oidc = await startOidcMock(14000);
  ({ server: s, session: admin } = await freshServer(13100));
});
after(() => {
  oidc?.stop();
  servers.forEach((x) => x.stop());
});
beforeEach(() => {
  oidc.user = { sub: 'u-1', email: 'ana@empresa.com.br', name: 'Ana Souza', groups: [] };
  oidc.tamper = {};
});

const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]);
const cookieHeader = (list) => list.filter((c) => !c.endsWith('=')).join('; ');

// Faz o login corporativo seguindo os redirecionamentos, como o navegador faria
const ssoLogin = async (base, { next = '/', jar = [], stateCookie } = {}) => {
  const start = await fetch(`${base}/api/sso/start?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const startCookies = cookiesOf(start);
  const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const callback = authorize.headers.get('location');
  const cookie = cookieHeader([...jar, ...(stateCookie ? [stateCookie] : startCookies)]);
  const done = await fetch(callback, { redirect: 'manual', headers: { cookie } });
  return { location: done.headers.get('location'), cookies: cookiesOf(done), callback, startCookies };
};

const asHeader = (cookies) => ({ cookie: cookieHeader(cookies) });

describe('configuração pelo admin', () => {
  test('segredo do cliente nunca volta, e só o admin configura', async () => {
    const r = await get(s.url, '/api/admin/sso', admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.hasClientSecret, true);
    assert.equal(r.body.clientSecret, undefined);
    assert.ok(!JSON.stringify(r.body).includes(CLIENT.secret));
    assert.equal(r.body.redirectUri, `${s.url}/api/sso/callback`);
    assert.equal((await get(s.url, '/api/admin/sso')).status, 401);
    assert.equal((await api(s.url, '/api/admin/sso', { enabled: false })).status, 401);
  });

  test('valida os campos e a conversa com o provedor antes de ativar', async () => {
    const t = await startServer(13101);
    servers.push(t);
    const a = await setupAdmin(t);
    const save = (fields) => api(t.url, '/api/admin/sso', fields, a);
    assert.equal((await save({ enabled: true })).status, 400, 'faltam campos');
    assert.equal((await save({ ...SSO_CONFIG, issuer: 'http://login.exemplo.com' })).status, 400, 'http fora da máquina');
    assert.equal((await save({ ...SSO_CONFIG, issuer: 'javascript:alert(1)' })).status, 400);
    assert.equal((await save({ ...SSO_CONFIG, issuer: 'http://127.0.0.1:1' })).status, 400, 'provedor fora do ar');
    assert.equal((await save({ ...SSO_CONFIG, issuer: oidc.issuer, domains: 'não é domínio' })).status, 400);
    assert.equal((await save({ ...SSO_CONFIG, issuer: oidc.issuer, broadcasterEmails: 'sem-arroba' })).status, 400);
    assert.equal((await save({ ...SSO_CONFIG, issuer: oidc.issuer, enabled: 'sim' })).status, 400);
    assert.equal((await get(t.url, '/api/state')).body.sso, null, 'nada foi ativado');
    const ok = await save({ ...SSO_CONFIG, issuer: oidc.issuer });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.domains, ['empresa.com.br']);
    // Salvar sem o segredo mantém o anterior
    assert.equal((await save({ ...SSO_CONFIG, issuer: oidc.issuer, clientSecret: '' })).body.hasClientSecret, true);
    assert.deepEqual((await get(t.url, '/api/state')).body.sso, { roomsDefault: true, forceRooms: false });
  });
});

describe('login corporativo', () => {
  test('usa PKCE S256, state e nonce', async () => {
    oidc.requests.length = 0;
    await ssoLogin(s.url);
    const [req] = oidc.requests;
    assert.equal(req.code_challenge_method, 'S256');
    assert.match(req.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(req.state && req.nonce);
    assert.equal(req.client_id, CLIENT.id);
    assert.equal(req.redirect_uri, `${s.url}/api/sso/callback`);
    assert.equal(req.scope, 'openid email profile');
  });

  test('pessoa do domínio fora do grupo: vira espectador, não transmissor', async () => {
    const r = await ssoLogin(s.url);
    assert.equal(r.location, '/?erro_sso=sem_permissao');
    const state = (await get(s.url, '/api/state', asHeader(r.cookies))).body;
    assert.deepEqual(state.viewer, { name: 'Ana Souza', email: 'ana@empresa.com.br' });
    assert.equal(state.user, null);
    assert.equal((await api(s.url, '/api/rooms', {}, asHeader(r.cookies))).status, 401);
  });

  test('pessoa do grupo vira transmissor na primeira vez e reaproveita a conta depois', async () => {
    oidc.user = { sub: 'u-2', email: 'Bia.Lima@Empresa.com.br', name: 'Bia Lima', groups: ['/overshoulder-transmissores'] };
    const first = await ssoLogin(s.url);
    assert.equal(first.location, '/');
    const state = (await get(s.url, '/api/state', asHeader(first.cookies))).body;
    assert.equal(state.user.role, 'broadcaster');
    assert.equal(state.user.sso, true);
    assert.equal(state.user.username, 'bia.lima');
    assert.equal((await api(s.url, '/api/rooms', {}, asHeader(first.cookies))).status, 201);

    await ssoLogin(s.url);
    const users = (await get(s.url, '/api/admin/users', admin)).body.users.filter((u) => u.sso);
    assert.equal(users.filter((u) => u.email === 'bia.lima@empresa.com.br').length, 1, 'sem conta duplicada');
    // Conta do login corporativo não entra por senha
    assert.equal((await api(s.url, '/api/login', { username: 'bia.lima', password: 'qualquer senha longa' })).status, 401);
  });

  test('e-mail na lista de transmissores também transmite', async () => {
    oidc.user = { sub: 'u-3', email: 'chefe@empresa.com.br', name: 'Chefe', groups: [] };
    const r = await ssoLogin(s.url);
    assert.equal(r.location, '/');
    assert.equal((await get(s.url, '/api/state', asHeader(r.cookies))).body.user.role, 'broadcaster');
  });

  test('transmissor revogado volta a entrar só como espectador', async () => {
    oidc.user = { sub: 'u-4', email: 'caio@empresa.com.br', name: 'Caio', groups: ['overshoulder-transmissores'] };
    await ssoLogin(s.url);
    const username = (await get(s.url, '/api/admin/users', admin)).body.users.find((u) => u.email === 'caio@empresa.com.br').username;
    await api(s.url, '/api/admin/users/revoke', { username }, admin);
    const r = await ssoLogin(s.url);
    assert.equal(r.location, '/?erro_sso=sem_permissao');
    assert.equal((await get(s.url, '/api/state', asHeader(r.cookies))).body.user, null);
  });

  test('domínio não permitido é recusado e não abre sessão', async () => {
    oidc.user = { sub: 'u-5', email: 'alguem@gmail.com', name: 'Alguém', groups: ['overshoulder-transmissores'] };
    const r = await ssoLogin(s.url);
    assert.equal(r.location, '/?erro_sso=dominio');
    assert.deepEqual(r.cookies.filter((c) => !c.endsWith('=')), []);
  });

  test('ID tokens adulterados ou inválidos são recusados', async () => {
    for (const [label, tamper] of [
      ['outra audiência', { aud: 'outro-cliente' }],
      ['outro emissor', { iss: 'http://127.0.0.1:9' }],
      ['nonce trocado', { nonce: 'nonce-de-outra-tentativa' }],
      ['expirado', { exp: Math.floor(Date.now() / 1000) - 3600 }],
      ['assinado com outra chave', { sign: 'outra-chave' }],
      ['e-mail não verificado', { email_verified: false }],
      ['sem e-mail', { email: '' }],
    ]) {
      oidc.tamper = tamper;
      const r = await ssoLogin(s.url);
      assert.equal(r.location, '/?erro_sso=falhou', label);
      assert.deepEqual(r.cookies.filter((c) => !c.endsWith('=')), [], `${label}: sem sessão`);
    }
  });

  test('state de outro navegador ou reaproveitado não vale (CSRF de login)', async () => {
    const victim = await ssoLogin(s.url, { stateCookie: 'overshoulder_sso=state-do-atacante' });
    assert.equal(victim.location, '/?erro_sso=expirou');

    const first = await ssoLogin(s.url);
    assert.equal(first.location, '/?erro_sso=sem_permissao');
    const replay = await fetch(first.callback, { redirect: 'manual', headers: { cookie: cookieHeader(first.startCookies) } });
    assert.equal(replay.headers.get('location'), '/?erro_sso=expirou', 'o mesmo retorno não vale duas vezes');
  });

  test('o destino depois do login só pode ser página do próprio site', async () => {
    for (const next of ['https://site-malicioso.example', '//site-malicioso.example', '/../admin', '/r/curto', 'javascript:alert(1)']) {
      const r = await ssoLogin(s.url, { next });
      assert.match(r.location, /^\/(\?|$)/, `${next} → ${r.location}`);
    }
  });

  test('segredo do cliente, códigos e tokens não aparecem nos logs', async () => {
    await ssoLogin(s.url);
    const logs = s.output();
    assert.ok(!logs.includes(CLIENT.secret));
    assert.doesNotMatch(logs, /eyJ[A-Za-z0-9_-]+\.eyJ/, 'nenhum JWT nos logs');
    assert.match(logs, /"msg":"login corporativo configurado","user":"admin"/);
  });
});

describe('salas que exigem login', () => {
  test('sem login: 401 sso_required; com login: entra com o nome do provedor', async () => {
    const room = await createRoom(s.url, admin);
    assert.equal(room.requireSso, true, 'padrão do admin: exige');
    const anon = await api(s.url, '/api/token', { roomId: room.roomId, name: 'Qualquer' });
    assert.equal(anon.status, 401);
    assert.equal(anon.body.code, 'sso_required');

    const viewer = await ssoLogin(s.url, { next: `/r/${room.roomId}` });
    assert.equal(viewer.location, `/r/${room.roomId}`);
    const t = await api(s.url, '/api/token', { roomId: room.roomId, name: 'Nome Inventado' }, asHeader(viewer.cookies));
    assert.equal(t.status, 200);
    assert.equal(jwtPayload(t.body.token).name, 'Ana Souza');

    const host = await api(s.url, '/api/token', { roomId: room.roomId, hostKey: room.hostKey, name: 'Ana' });
    assert.equal(host.body.role, 'host', 'o anfitrião entra pela chave de anfitrião');
  });

  test('sala aberta continua aberta; "todas exigem" força o login', async () => {
    const open = await createRoom(s.url, { ...admin });
    const r = await api(s.url, '/api/rooms', { requireSso: false }, admin);
    assert.equal(r.body.requireSso, false);
    assert.equal((await api(s.url, '/api/token', { roomId: r.body.roomId })).status, 200);
    assert.ok(open);

    const t = await freshServer(13102);
    await api(t.server.url, '/api/admin/sso', { forceRooms: true }, t.session);
    const forced = await api(t.server.url, '/api/rooms', { requireSso: false }, t.session);
    assert.equal(forced.body.requireSso, true);

    await api(t.server.url, '/api/admin/sso', { enabled: false }, t.session);
    const off = await api(t.server.url, '/api/rooms', { requireSso: true }, t.session);
    assert.equal(off.body.requireSso, false, 'SSO desligado: nenhuma sala exige');
  });

  test('"Exigir 2FA" não bloqueia transmissor do login corporativo', async () => {
    const t = await freshServer(13103);
    await api(t.server.url, '/api/admin/settings', { require2fa: true }, t.session);
    oidc.user = { sub: 'u-9', email: 'dani@empresa.com.br', name: 'Dani', groups: ['overshoulder-transmissores'] };
    const r = await ssoLogin(t.server.url);
    assert.equal((await api(t.server.url, '/api/rooms', {}, asHeader(r.cookies))).status, 201);
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })));
  after(() => browser?.close());

  test('espectador entra numa sala fechada pelo login da empresa e aparece com o nome real', async () => {
    const host = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    await loginInBrowser(host, s.url);
    assert.ok(await host.isChecked('#require-sso'));
    await host.click('label:has(#type-live)');
    await host.click('#create-form button');
    await host.waitForURL(/#k=/);
    await host.fill('#name', 'Anfitriã');
    await host.click('#join-form button');
    await host.waitForSelector('#room:not([hidden])');
    const link = await host.inputValue('#invite-link');

    const viewer = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    const errors = [];
    viewer.on('pageerror', (e) => errors.push(e.message));
    await viewer.goto(link);
    await viewer.fill('#name', 'Nome Inventado');
    await viewer.click('#join-form button');
    await viewer.waitForSelector('#sso-join:not([hidden])');
    assert.match(await viewer.textContent('#join-error'), /login da empresa/);

    await viewer.click('#sso-join');
    await viewer.waitForURL((url) => url.pathname === new URL(link).pathname && url.hash.startsWith('#k='));
    assert.equal(new URL(viewer.url()).hash, new URL(link).hash, 'a chave E2EE voltou do login');
    await viewer.waitForFunction(() => document.querySelector('#name').readOnly);
    assert.equal(await viewer.inputValue('#name'), 'Ana Souza');
    await viewer.click('#join-form button');
    await viewer.waitForSelector('#room:not([hidden])');
    await viewer.fill('#chat-input', 'cheguei pelo SSO');
    await viewer.press('#chat-input', 'Enter');
    const msg = host.locator('#messages li.msg', { hasText: 'cheguei pelo SSO' });
    await msg.waitFor();
    assert.equal(await msg.locator('.author').textContent(), 'Ana Souza');
    assert.deepEqual(errors, []);
  });

  test('transmissor entra pelo botão de login da empresa na página inicial', async () => {
    oidc.user = { sub: 'u-10', email: 'eva@empresa.com.br', name: 'Eva', groups: ['overshoulder-transmissores'] };
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${s.url}/`);
    await page.click('#sso-login');
    await page.waitForSelector('#signed-in:not([hidden])');
    assert.equal(await page.textContent('#me'), 'eva');

    oidc.user = { sub: 'u-11', email: 'fabio@empresa.com.br', name: 'Fábio', groups: [] };
    const other = await (await browser.newContext()).newPage();
    await other.goto(`${s.url}/`);
    await other.click('#sso-login');
    await other.waitForSelector('#login-error:not([hidden])');
    assert.match(await other.textContent('#login-error'), /não tem permissão para transmitir/);
  });
});
