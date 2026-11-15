import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, get, launchBrowser, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const BROADCASTER = { username: 'bia', password: 'transmissora de domingo' };
const NEW_PASSWORD = 'outra frase comprida qualquer';
const servers = [];
const fresh = async (port, env) => {
  const s = await startServer(port, env);
  servers.push(s);
  const admin = await setupAdmin(s);
  const inv = await api(s.url, '/api/admin/invites', {}, admin);
  const r = await api(s.url, '/api/invites/accept', { token: inv.body.path.split('#')[1], ...BROADCASTER });
  assert.equal(r.status, 201, r.text);
  return { s, admin, broadcaster: { cookie: sessionFrom(r) } };
};
const resetLink = (s, admin, username = BROADCASTER.username) => api(s.url, '/api/admin/users/reset-link', { username }, admin);
const tokenOf = (r) => r.body.path.split('#')[1];
const login = (s, password) => api(s.url, '/api/login', { username: BROADCASTER.username, password });

before(waitForLiveKit);
after(() => servers.forEach((s) => s.stop()));

describe('link de nova senha para transmissor', () => {
  test('o admin gera, a pessoa troca a senha, as sessões antigas acabam e o link vale uma vez', async () => {
    const { s, admin, broadcaster } = await fresh(13320);
    const r = await resetLink(s, admin);
    assert.equal(r.status, 200);
    assert.match(r.body.path, /^\/nova-senha#[A-Za-z0-9_-]{40,}$/);
    assert.ok(Date.parse(r.body.expiresAt) > Date.now() + 23 * 3600_000);

    const done = await api(s.url, '/api/password-reset', { token: tokenOf(r), password: NEW_PASSWORD });
    assert.equal(done.status, 200);
    // Não abre sessão: com 2FA, a pessoa ainda precisa passar pelo login completo
    assert.equal(done.headers.get('set-cookie'), null);
    assert.equal((await get(s.url, '/api/state', broadcaster)).body.user, null);
    assert.equal((await login(s, BROADCASTER.password)).status, 401);
    assert.equal((await login(s, NEW_PASSWORD)).status, 200);
    assert.equal((await api(s.url, '/api/password-reset', { token: tokenOf(r), password: 'mais uma frase comprida' })).status, 401);
    assert.match(s.output(), /link de nova senha gerado/);
    assert.doesNotMatch(s.output(), new RegExp(tokenOf(r)));
  });

  test('gerar outro invalida o anterior; link vencido ou de conta revogada não vale', async () => {
    const { s, admin } = await fresh(13321, { PASSWORD_RESET_TTL_MS: '300' });
    const first = await resetLink(s, admin);
    const second = await resetLink(s, admin);
    assert.equal((await api(s.url, '/api/password-reset', { token: tokenOf(first), password: NEW_PASSWORD })).status, 401);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await api(s.url, '/api/password-reset', { token: tokenOf(second), password: NEW_PASSWORD })).status, 401);

    const { s: s2, admin: admin2 } = await fresh(13322);
    const link = await resetLink(s2, admin2);
    assert.equal((await api(s2.url, '/api/admin/users/revoke', { username: BROADCASTER.username }, admin2)).status, 200);
    assert.equal((await api(s2.url, '/api/password-reset', { token: tokenOf(link), password: NEW_PASSWORD })).status, 401);
    assert.equal((await resetLink(s2, admin2)).status, 400);
  });

  test('só o admin gera, e não para a própria conta; senha fraca é recusada sem gastar o link', async () => {
    const { s, admin, broadcaster } = await fresh(13323);
    assert.equal((await api(s.url, '/api/admin/users/reset-link', { username: BROADCASTER.username })).status, 401);
    assert.equal((await resetLink(s, broadcaster)).status, 403);
    assert.equal((await resetLink(s, admin, 'admin')).status, 400);
    assert.equal((await resetLink(s, admin, 'ninguem')).status, 404);
    for (const bad of [null, 123, {}, []]) assert.notEqual((await resetLink(s, admin, bad)).status, 200, JSON.stringify(bad));
    const r = await resetLink(s, admin);
    assert.equal((await api(s.url, '/api/password-reset', { token: tokenOf(r), password: 'curta' })).status, 400);
    assert.equal((await api(s.url, '/api/password-reset', { token: tokenOf(r), password: NEW_PASSWORD })).status, 200);
  });

  test('tokens malformados não derrubam nada e contam no limite de tentativas', async () => {
    const { s } = await fresh(13324);
    const bads = [null, 5, {}, [], '', 'x'.repeat(500), 'nao-existe'];
    for (const token of bads) {
      const r = await api(s.url, '/api/password-reset', { token, password: NEW_PASSWORD });
      assert.equal(r.status, 401, JSON.stringify(token).slice(0, 30));
      assert.doesNotMatch(r.text, /at \S+:\d+|server\.js|stack/i);
    }
    let last;
    for (let i = 0; i < 5; i++) last = await api(s.url, '/api/password-reset', { token: 'outro', password: NEW_PASSWORD });
    assert.equal(last.status, 429);
  });
});

describe('link de nova senha no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('o admin copia o link em Transmissores e a pessoa troca a senha pela página', async () => {
    const { s } = await fresh(13325);
    const admin = await (await browser.newContext()).newPage();
    const errors = [];
    admin.on('pageerror', (err) => errors.push(err.message));
    await loginInBrowser(admin, s.url);
    await admin.goto(`${s.url}/admin#transmissores`);
    await admin.click('#users button:has-text("Link de nova senha")');
    await admin.waitForSelector('#user-reset:not([hidden])');
    assert.equal(await admin.textContent('#reset-for'), BROADCASTER.username);
    const link = await admin.inputValue('#reset-link');
    assert.match(link, new RegExp(`^${s.url}/nova-senha#`));

    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(link);
    assert.equal(new URL(page.url()).hash, '', 'o token sai da barra de endereço');
    await page.fill('#password', NEW_PASSWORD);
    await page.fill('#password2', NEW_PASSWORD);
    await page.click('#reset-form button');
    await page.waitForSelector('#reset-ok:not([hidden])');
    await page.waitForURL(`${s.url}/`);
    assert.equal((await login(s, NEW_PASSWORD)).status, 200);
    assert.deepEqual(errors, []);
  });
});
