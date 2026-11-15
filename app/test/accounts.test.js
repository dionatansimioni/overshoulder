import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ADMIN, api, get, sessionFrom, setupAdmin, startServer, waitForLiveKit, launchBrowser } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [];
const fresh = async (port, env) => {
  const s = await startServer(port, env);
  servers.push(s);
  return s;
};

before(waitForLiveKit);
after(() => servers.forEach((s) => s.stop()));

describe('configuração inicial', () => {
  test('antes de configurar, nada funciona sem o código dos logs', async () => {
    const s = await fresh(13030);
    assert.deepEqual((await get(s.url, '/api/state')).body, { setupDone: false, require2fa: false, signup: 'approval', sso: null, user: null, viewer: null });
    assert.equal((await api(s.url, '/api/rooms', {})).status, 401);
    assert.equal((await api(s.url, '/api/login', ADMIN)).status, 401);
    const wrong = await api(s.url, '/api/setup', { code: 'AAAA-BBBB-CCCC', ...ADMIN });
    assert.equal(wrong.status, 403);
  });

  test('recusa usuário inválido, senhas fracas e limite fora da faixa', async () => {
    const s = await fresh(13031);
    const code = await s.setupCode();
    const attempt = (fields) => api(s.url, '/api/setup', { code, ...ADMIN, ...fields });
    for (const username of ['ab', 'Com Espaço', 'x'.repeat(33), '<script>', 42]) {
      assert.equal((await attempt({ username })).status, 400, `usuário ${username}`);
    }
    for (const password of ['curta', 'password1234', 'qwertyuiopasdfgh', 'aaaaaaaaaaaaaaaa', 'meu-admin-favorito', 'x'.repeat(129), 12345678901234]) {
      const r = await attempt({ password });
      assert.equal(r.status, 400, `senha ${password}`);
      assert.match(r.body.error, /senha|Senha/);
    }
    for (const maxParticipants of [1, 5001, 2.5, '16']) {
      assert.equal((await attempt({ maxParticipants })).status, 400, `limite ${maxParticipants}`);
    }
    assert.equal((await get(s.url, '/api/state')).body.setupDone, false);
  });

  test('cria o admin, entra logado e não deixa configurar de novo', async () => {
    const s = await fresh(13032);
    const code = await s.setupCode();
    const r = await api(s.url, '/api/setup', { code: code.toLowerCase(), ...ADMIN, maxParticipants: 120 });
    assert.equal(r.status, 201);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Secure/, 'sem HTTPS na frente, o cookie não pode exigir Secure');
    const session = { cookie: sessionFrom(r) };

    assert.deepEqual((await get(s.url, '/api/state', session)).body, {
      setupDone: true,
      require2fa: false,
      signup: 'approval',
      sso: null,
      user: { username: 'admin', role: 'admin', totp: false, needs2fa: false },
      viewer: null,
    });
    assert.equal((await api(s.url, '/api/setup', { code, username: 'outro', password: ADMIN.password })).status, 409);
    assert.equal((await api(s.url, '/api/rooms', {}, session)).status, 201);
  });

  test('dados persistem no volume, sem senha em texto e com permissão 600', async () => {
    const first = await fresh(13033);
    await setupAdmin(first);
    first.stop();
    const file = path.join(first.dataDir, 'state.json');
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(ADMIN.password));

    await sleep(200);
    const again = await fresh(13033, { DATA_DIR: first.dataDir });
    assert.equal((await get(again.url, '/api/state')).body.setupDone, true);
    assert.equal((await api(again.url, '/api/login', ADMIN)).status, 200);
    await sleep(100);
    assert.doesNotMatch(again.output(), /setupCode/, 'configurado: não imprime mais código');
  });
});

describe('login e sessões', () => {
  let s;
  before(async () => {
    s = await fresh(13034);
    await setupAdmin(s);
  });

  test('erro genérico para usuário inexistente e senha errada', async () => {
    const unknown = await api(s.url, '/api/login', { username: 'ninguem', password: ADMIN.password });
    const wrong = await api(s.url, '/api/login', { username: 'admin', password: 'senha errada mesmo' });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.error, wrong.body.error);
  });

  test('login, sessão e logout', async () => {
    const r = await api(s.url, '/api/login', { username: ' ADMIN ', password: ADMIN.password });
    assert.equal(r.status, 200);
    const session = { cookie: sessionFrom(r) };
    assert.equal((await get(s.url, '/api/state', session)).body.user.username, 'admin');
    assert.equal((await api(s.url, '/api/logout', {}, session)).status, 200);
    assert.equal((await get(s.url, '/api/state', session)).body.user, null);
    assert.equal((await api(s.url, '/api/rooms', {}, session)).status, 401);
  });

  test('cookie forjado ou de outra sessão não vale', async () => {
    for (const cookie of ['overshoulder_session=abc', 'overshoulder_session=', 'outro=1']) {
      assert.equal((await api(s.url, '/api/rooms', {}, { cookie })).status, 401, cookie);
    }
  });

  test('requisição de outra origem é recusada (CSRF)', async () => {
    const { cookie } = await setupLogin(s);
    const evil = await api(s.url, '/api/rooms', {}, { cookie, Origin: 'https://site-malicioso.example' });
    assert.equal(evil.status, 403);
    const ok = await api(s.url, '/api/rooms', {}, { cookie, Origin: s.url });
    assert.equal(ok.status, 201);
  });

  test('troca de senha exige a atual, valida a nova e derruba as outras sessões', async () => {
    const t = await fresh(13035);
    const mine = await setupAdmin(t);
    const other = await setupLogin(t);
    const change = (fields) => api(t.url, '/api/account/password', fields, mine);

    assert.equal((await change({ current: 'errada', password: 'nova senha bem comprida' })).status, 403);
    assert.equal((await change({ current: ADMIN.password, password: 'curta' })).status, 400);
    assert.equal((await change({ current: ADMIN.password, password: 'nova senha bem comprida' })).status, 200);

    assert.equal((await api(t.url, '/api/rooms', {}, other)).status, 401, 'outra sessão foi encerrada');
    assert.equal((await api(t.url, '/api/rooms', {}, mine)).status, 201, 'a sessão atual continua');
    assert.equal((await api(t.url, '/api/login', ADMIN)).status, 401);
    assert.equal((await api(t.url, '/api/login', { username: 'admin', password: 'nova senha bem comprida' })).status, 200);
  });

  test('sessão expira depois de um tempo sem uso', async () => {
    const t = await fresh(13036, { SESSION_IDLE_MS: '600' });
    const session = await setupAdmin(t);
    assert.equal((await api(t.url, '/api/rooms', {}, session)).status, 201);
    await sleep(900);
    assert.equal((await api(t.url, '/api/rooms', {}, session)).status, 401);
  });

  test('sessão expira no tempo máximo mesmo em uso', async () => {
    const t = await fresh(13037, { SESSION_MAX_MS: '1500' });
    const session = await setupAdmin(t);
    for (let i = 0; i < 3; i++) {
      await sleep(400);
      assert.equal((await get(t.url, '/api/state', session)).body.user?.username, 'admin');
    }
    await sleep(600);
    assert.equal((await get(t.url, '/api/state', session)).body.user, null);
  });

  test('limite por conta vale mesmo trocando de IP', async () => {
    const t = await fresh(13038, { TRUST_PROXY: '1' });
    await setupAdmin(t);
    for (let i = 0; i < 10; i++) {
      await api(t.url, '/api/login', { username: 'admin', password: 'errada' }, { 'X-Forwarded-For': `198.51.100.${i}` });
    }
    const r = await api(t.url, '/api/login', ADMIN, { 'X-Forwarded-For': '203.0.113.50' });
    assert.equal(r.status, 429);
  });

  test('atrás de HTTPS o cookie é Secure', async () => {
    const t = await fresh(13039, { TRUST_PROXY: '1' });
    await setupAdmin(t);
    const r = await api(t.url, '/api/login', ADMIN, { 'X-Forwarded-Proto': 'https' });
    assert.match(r.headers.get('set-cookie'), /; Secure/);
  });
});

// Login extra do admin, para ter uma segunda sessão
const setupLogin = async (s) => ({ cookie: sessionFrom(await api(s.url, '/api/login', ADMIN)) });

describe('no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('página inicial leva à configuração, que cria o admin e já deixa criar sala', async () => {
    const s = await fresh(13040);
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${s.url}/`);
    await page.waitForURL(`${s.url}/configurar`);
    await page.fill('#code', await s.setupCode());
    await page.fill('#username', 'dona');
    await page.fill('#password', 'frase longa e segura demais');
    await page.fill('#password2', 'frase longa e diferente');
    await page.click('#setup-form button');
    assert.match(await page.textContent('#setup-error'), /não são iguais/);

    await page.fill('#password2', 'frase longa e segura demais');
    await page.click('#setup-form button');
    await page.waitForURL(`${s.url}/`);
    await page.waitForSelector('#signed-in:not([hidden])');
    assert.equal(await page.textContent('#me'), 'dona');

    await page.click('#create-form button');
    await page.waitForURL(/\/r\/[A-Za-z0-9_-]{22}#k=.+&h=/);

    await page.goto(`${s.url}/configurar`);
    await page.waitForURL(`${s.url}/`);
    assert.deepEqual(errors, []);
  });
});
