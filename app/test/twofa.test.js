import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { base32Encode, codeAt, currentStep, verifyCode } from '../totp.js';
import { ADMIN, api, get, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit, launchBrowser } from './helpers.js';

const servers = [];
const fresh = async (port, env) => {
  const s = await startServer(port, env);
  servers.push(s);
  return s;
};
before(waitForLiveKit);
after(() => servers.forEach((s) => s.stop()));

// Código válido do próximo passo de 30 s: o do passo atual já foi gasto ao ativar
const nextCode = (secret, offset = 1) => codeAt(secret, currentStep() + offset);

const enable2fa = async (s, session) => {
  const { body: setup } = await api(s.url, '/api/2fa/setup', {}, session);
  const r = await api(s.url, '/api/2fa/enable', { code: codeAt(setup.secret, currentStep()) }, session);
  assert.equal(r.status, 200, r.text);
  return { secret: setup.secret, recoveryCodes: r.body.recoveryCodes };
};

describe('TOTP (RFC 6238)', () => {
  test('confere com os vetores oficiais da RFC 6238 (SHA-1)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    for (const [time, expected] of [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ]) {
      assert.equal(codeAt(secret, Math.floor(time / 30), 8), expected, `T=${time}`);
    }
  });

  test('aceita um passo antes e depois, recusa reuso e formatos errados', () => {
    const secret = base32Encode(Buffer.from('chave-de-teste-12345'));
    const now = Date.now();
    const step = currentStep(now);
    assert.equal(verifyCode(secret, codeAt(secret, step - 1), -1, now), step - 1);
    assert.equal(verifyCode(secret, codeAt(secret, step + 1), -1, now), step + 1);
    assert.equal(verifyCode(secret, codeAt(secret, step + 2), -1, now), null);
    assert.equal(verifyCode(secret, codeAt(secret, step), step, now), null, 'passo já usado');
    for (const bad of ['', '12345', '1234567', 'abcdef', 123456, null]) assert.equal(verifyCode(secret, bad, -1, now), null);
  });
});

describe('ativar e usar o 2FA', () => {
  let s;
  let session;
  before(async () => {
    s = await fresh(13050);
    session = await setupAdmin(s);
  });

  test('configuração devolve chave, QR em SVG e URI do autenticador', async () => {
    const r = await api(s.url, '/api/2fa/setup', {}, session);
    assert.equal(r.status, 200);
    assert.match(r.body.secret, /^[A-Z2-7]{32}$/);
    assert.match(r.body.uri, /^otpauth:\/\/totp\/Overshoulder:admin\?secret=[A-Z2-7]+&issuer=Overshoulder/);
    const svg = Buffer.from(r.body.qr.replace('data:image/svg+xml;base64,', ''), 'base64').toString();
    assert.match(svg, /^<svg /);
    assert.doesNotMatch(svg, /<script|on\w+=/i);
    assert.equal((await api(s.url, '/api/2fa/enable', { code: '000000' }, session)).status, 400);
  });

  test('ativa com o código certo, gera 10 códigos e pede o código no login', async () => {
    const { secret, recoveryCodes } = await enable2fa(s, session);
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);
    for (const c of recoveryCodes) assert.match(c, /^[a-z2-7]{5}-[a-z2-7]{5}$/);
    assert.equal((await get(s.url, '/api/state', session)).body.user.totp, true);
    assert.equal((await api(s.url, '/api/2fa/setup', {}, session)).status, 409);

    const first = await api(s.url, '/api/login', ADMIN);
    assert.equal(first.status, 200);
    assert.equal(first.body.next, 'totp');
    assert.equal(first.headers.get('set-cookie'), null, 'sem sessão antes do código');

    assert.equal((await api(s.url, '/api/login/totp', { ticket: first.body.ticket, code: '000000' })).status, 401);
    const code = nextCode(secret);
    const ok = await api(s.url, '/api/login/totp', { ticket: first.body.ticket, code });
    assert.equal(ok.status, 200);
    assert.ok(sessionFrom(ok));
    assert.equal((await api(s.url, '/api/login/totp', { ticket: first.body.ticket, code })).status, 401, 'tíquete vale uma vez');

    const again = await api(s.url, '/api/login', ADMIN);
    assert.equal((await api(s.url, '/api/login/totp', { ticket: again.body.ticket, code })).status, 401, 'código já usado');

    // Código de recuperação: vale uma vez, com ou sem hífen e maiúsculas
    const [rc] = recoveryCodes;
    const third = await api(s.url, '/api/login', ADMIN);
    assert.equal((await api(s.url, '/api/login/totp', { ticket: third.body.ticket, code: rc.toUpperCase().replace('-', ' ') })).status, 200);
    const fourth = await api(s.url, '/api/login', ADMIN);
    assert.equal((await api(s.url, '/api/login/totp', { ticket: fourth.body.ticket, code: rc })).status, 401);
  });

  test('tíquete forjado e tentativas demais encerram o login', async () => {
    assert.equal((await api(s.url, '/api/login/totp', { ticket: 'inventado', code: '123456' })).status, 401);
    const t = await fresh(13051);
    const admin = await setupAdmin(t);
    const { secret } = await enable2fa(t, admin);
    const { body } = await api(t.url, '/api/login', ADMIN);
    for (let i = 0; i < 5; i++) await api(t.url, '/api/login/totp', { ticket: body.ticket, code: '000000' });
    const r = await api(t.url, '/api/login/totp', { ticket: body.ticket, code: nextCode(secret) });
    assert.equal(r.status, 401);
    assert.match(r.body.error, /expirou/);
  });

  test('desativar exige a senha', async () => {
    const t = await fresh(13052);
    const admin = await setupAdmin(t);
    await enable2fa(t, admin);
    assert.equal((await api(t.url, '/api/2fa/disable', { password: 'errada' }, admin)).status, 403);
    assert.equal((await api(t.url, '/api/2fa/disable', { password: ADMIN.password }, admin)).status, 200);
    assert.equal((await api(t.url, '/api/login', ADMIN)).body.next, undefined);
  });

  test('segredo do 2FA, códigos e tíquetes não aparecem nos logs', async () => {
    const t = await fresh(13053);
    const admin = await setupAdmin(t);
    const { secret, recoveryCodes } = await enable2fa(t, admin);
    const { body } = await api(t.url, '/api/login', ADMIN);
    await api(t.url, '/api/login/totp', { ticket: body.ticket, code: '000000' });
    await api(t.url, '/api/login/totp', { ticket: body.ticket, code: recoveryCodes[1] });
    await new Promise((r) => setTimeout(r, 100));
    const logs = t.output();
    for (const value of [secret, body.ticket, ...recoveryCodes]) assert.ok(!logs.includes(value), value);
    assert.match(logs, /"msg":"2FA ativado","user":"admin"/);
    assert.match(logs, /"msg":"2FA falhou","user":"admin"/);
    assert.match(logs, /"msg":"código de recuperação usado","user":"admin"/);
  });
});

describe('exigir 2FA e ações do admin', () => {
  test('com 2FA exigido, conta sem 2FA só pode configurá-lo', async () => {
    const s = await fresh(13054);
    const admin = await setupAdmin(s);
    assert.equal((await api(s.url, '/api/admin/settings', { require2fa: 'sim' }, admin)).status, 400);
    assert.equal((await api(s.url, '/api/admin/settings', { require2fa: true }, admin)).status, 200);

    const blocked = await api(s.url, '/api/rooms', {}, admin);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, '2fa_required');
    assert.equal((await get(s.url, '/api/state', admin)).body.user.needs2fa, true);

    await enable2fa(s, admin);
    assert.equal((await api(s.url, '/api/rooms', {}, admin)).status, 201);
    assert.equal((await api(s.url, '/api/2fa/disable', { password: ADMIN.password }, admin)).status, 403, 'não dá para desativar');
  });

  test('admin gera códigos novos (os antigos deixam de valer) e remove o 2FA de uma conta', async () => {
    const s = await fresh(13055);
    const admin = await setupAdmin(s);
    const { recoveryCodes: old } = await enable2fa(s, admin);
    const r = await api(s.url, '/api/admin/recovery-codes', { username: 'admin' }, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.recoveryCodes.length, 10);

    const login = await api(s.url, '/api/login', ADMIN);
    assert.equal((await api(s.url, '/api/login/totp', { ticket: login.body.ticket, code: old[0] })).status, 401);
    assert.equal((await api(s.url, '/api/login/totp', { ticket: login.body.ticket, code: r.body.recoveryCodes[0] })).status, 200);

    assert.equal((await api(s.url, '/api/admin/recovery-codes', { username: 'ninguem' }, admin)).status, 404);
    assert.equal((await api(s.url, '/api/admin/reset-2fa', { username: 'admin' }, admin)).status, 200);
    assert.equal((await api(s.url, '/api/login', ADMIN)).body.next, undefined);
    assert.equal((await api(s.url, '/api/admin/recovery-codes', { username: 'admin' }, admin)).status, 400);
  });

  test('rotas de admin exigem login', async () => {
    const s = await fresh(13056);
    await setupAdmin(s);
    for (const route of ['/api/admin/settings', '/api/admin/recovery-codes', '/api/admin/reset-2fa']) {
      assert.equal((await api(s.url, route, {})).status, 401, route);
    }
    assert.equal((await get(s.url, '/api/admin/settings')).status, 401);
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('ativa o 2FA pela página da conta e entra com o código', async () => {
    const s = await fresh(13057);
    await setupAdmin(s);
    const page = await (await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loginInBrowser(page, s.url);
    assert.ok(await page.isVisible('#recommend-2fa'), 'recomenda ativar o 2FA');
    await page.click('#recommend-2fa');
    await page.waitForURL(`${s.url}/account`);
    await page.click('#start-2fa');
    await page.waitForSelector('#qr[src^="data:image/svg+xml"]');
    const secret = (await page.textContent('#secret')).replace(/\s/g, '');
    await page.fill('#enable-code', codeAt(secret, currentStep()));
    await page.click('#enable-form button');
    await page.waitForSelector('#recovery:not([hidden])');
    assert.equal(await page.locator('#recovery-codes li').count(), 10);

    await page.goto(`${s.url}/`);
    await page.click('#logout');
    await page.fill('#username', ADMIN.username);
    await page.fill('#password', ADMIN.password);
    await page.click('#login-form button');
    await page.waitForSelector('#totp-form:not([hidden])');
    await page.fill('#totp-code', nextCode(secret));
    await page.click('#totp-form button');
    await page.waitForSelector('#signed-in:not([hidden])');
    assert.ok(await page.isHidden('#recommend-2fa'), 'com 2FA ativo, não recomenda mais');
    assert.deepEqual(errors, []);
  });

  test('servidor que exige 2FA leva direto à configuração', async () => {
    const s = await fresh(13058);
    const admin = await setupAdmin(s);
    await api(s.url, '/api/admin/settings', { require2fa: true }, admin);
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${s.url}/`);
    await page.fill('#username', ADMIN.username);
    await page.fill('#password', ADMIN.password);
    await page.click('#login-form button');
    await page.waitForURL(`${s.url}/account`);
    assert.ok(await page.isVisible('#required-2fa'));
  });
});
