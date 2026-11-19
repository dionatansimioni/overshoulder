import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ADMIN, api, get, launchBrowser, loginInBrowser, sessionFrom, setupAdmin, startServer } from './helpers.js';

const PASSWORD = 'uma frase longa de teste';
let s;
let admin;

before(async () => {
  s = await startServer(13140);
  admin = await setupAdmin(s);
});
after(() => s?.stop());

const setMode = async (signup) => assert.equal((await api(s.url, '/api/admin/settings', { signup }, admin)).status, 200);
const signup = (username, password = PASSWORD) => api(s.url, '/api/signup', { username, password });
const login = (username, password = PASSWORD) => api(s.url, '/api/login', { username, password });
const users = async () => (await get(s.url, '/api/admin/users', admin)).body.users;

describe('cadastro de transmissores', () => {
  test('padrão "com aprovação": a conta nasce pendente e só entra depois de aprovada', async () => {
    assert.equal((await get(s.url, '/api/state')).body.signup, 'approval');
    const r = await signup('beto');
    assert.equal(r.status, 201);
    assert.deepEqual(r.body, { pending: true });
    assert.equal(sessionFrom(r), undefined, 'conta pendente não ganha sessão');

    const denied = await login('beto');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'pending');
    assert.equal(denied.body.error, 'Sua conta aguarda a aprovação do administrador.');
    assert.equal((await login('beto', 'senha errada de teste')).status, 401, 'senha errada não revela a pendência');
    assert.equal((await users()).find((u) => u.username === 'beto').pending, true);

    assert.equal((await api(s.url, '/api/admin/users/approve', { username: 'beto' })).status, 401);
    assert.equal((await api(s.url, '/api/admin/users/approve', { username: 'beto' }, admin)).status, 200);
    assert.equal((await api(s.url, '/api/admin/users/approve', { username: 'beto' }, admin)).status, 400, 'já aprovada');
    const ok = await login('beto');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, 'broadcaster');
    assert.equal((await api(s.url, '/api/rooms', {}, { cookie: sessionFrom(ok) })).status, 201);
  });

  test('validação: usuário, senha fraca e usuário repetido', async () => {
    assert.equal((await signup('A')).status, 400);
    assert.equal((await signup('carla', '123456789012')).status, 400, 'senha vazada');
    assert.equal((await signup('beto')).status, 409);
    assert.equal((await signup(ADMIN.username)).status, 409);
  });

  test('"só convite" fecha o cadastro; "livre" já entra transmitindo', async () => {
    await setMode('invite');
    assert.equal((await get(s.url, '/api/state')).body.signup, 'invite');
    assert.equal((await signup('davi')).status, 403);

    await setMode('open');
    const r = await signup('davi');
    assert.equal(r.status, 201);
    assert.equal(r.body.user.username, 'davi');
    const cookie = { cookie: sessionFrom(r) };
    assert.equal((await api(s.url, '/api/rooms', {}, cookie)).status, 201);
    assert.equal((await api(s.url, '/api/admin/settings', { signup: 'invite' }, cookie)).status, 403, 'transmissor não muda o modo');
    assert.equal((await api(s.url, '/api/admin/settings', { signup: 'festa' }, admin)).status, 400);
  });

  test('limite de cadastros por IP', async () => {
    // Já foram 2 contas criadas deste IP (beto e davi); o limite é 5 por hora
    for (const name of ['eva', 'fabio', 'gil']) assert.equal((await signup(name)).status, 201, name);
    assert.equal((await signup('hugo')).status, 429);
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('a página de cadastro segue o modo; o admin aprova pela administração', async () => {
    const page = await (await browser.newContext()).newPage();
    await setMode('invite');
    await page.goto(`${s.url}/`);
    // Só por convite: a página inicial diz que o servidor é particular, sem login nem cadastro
    await page.waitForSelector('#private-view:not([hidden])');
    assert.ok(await page.isHidden('#login-form'));
    assert.ok(await page.isHidden('#signup-link'));
    await page.goto(`${s.url}/signup`);
    await page.waitForSelector('#signup-closed:not([hidden])');
    assert.ok(await page.isHidden('#invite-form'));

    await setMode('approval');
    await page.goto(`${s.url}/`);
    await page.click('#signup-link a');
    await page.waitForURL(/\/signup$/);
    await page.waitForSelector('#intro-approval:not([hidden])');
    // O limite de cadastros deste IP acabou no teste anterior: o resto usa um servidor novo
    const s2 = await startServer(13141);
    try {
      const admin2 = await setupAdmin(s2);
      const p2 = await (await browser.newContext()).newPage();
      await p2.goto(`${s2.url}/signup`);
      await p2.fill('#username', 'iris');
      await p2.fill('#password', PASSWORD);
      await p2.fill('#password2', PASSWORD);
      await p2.click('#invite-form button');
      await p2.waitForSelector('#signup-done:not([hidden])');
      assert.ok(await p2.isHidden('#invite-form'));

      const a = await (await browser.newContext()).newPage();
      await loginInBrowser(a, s2.url);
      await a.goto(`${s2.url}/admin#transmissores`);
      const row = a.locator('#users li[data-username="iris"]');
      await row.waitFor();
      assert.match(await row.textContent(), /aguardando aprovação/);
      await row.locator('button', { hasText: 'Aprovar' }).click();
      await a.waitForFunction(() => !/aguardando/.test(document.querySelector('#users li[data-username="iris"]').textContent));

      await loginInBrowser(p2, s2.url, { username: 'iris', password: PASSWORD });
      await p2.waitForSelector('#signed-in:not([hidden])');

      // Modo livre: cria a conta e já cai na página inicial logado
      await api(s2.url, '/api/admin/settings', { signup: 'open' }, admin2);
      const p3 = await (await browser.newContext()).newPage();
      await p3.goto(`${s2.url}/signup`);
      await p3.waitForSelector('#intro-open:not([hidden])');
      await p3.fill('#username', 'joana');
      await p3.fill('#password', PASSWORD);
      await p3.fill('#password2', PASSWORD);
      await p3.click('#invite-form button');
      await p3.waitForURL(`${s2.url}/`);
      await p3.waitForSelector('#signed-in:not([hidden])');
      assert.equal(await p3.textContent('#me'), 'joana');
    } finally {
      s2.stop();
    }
  });
});
