import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { codeAt, currentStep } from '../totp.js';
import { ADMIN, api, createRoom, get, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROADCASTER = { username: 'bia', password: 'transmissora de domingo' };
const servers = [];
const fresh = async (port, env) => {
  const s = await startServer(port, env);
  servers.push(s);
  return s;
};
before(waitForLiveKit);
after(() => servers.forEach((s) => s.stop()));

const tokenOf = (path) => path.split('#')[1];
const invite = async (s, admin) => (await api(s.url, '/api/admin/invites', {}, admin)).body;
const addBroadcaster = async (s, admin, who = BROADCASTER) => {
  const r = await api(s.url, '/api/invites/accept', { token: tokenOf((await invite(s, admin)).path), ...who });
  assert.equal(r.status, 201, r.text);
  return { cookie: sessionFrom(r) };
};

describe('convites', () => {
  let s;
  let admin;
  before(async () => {
    s = await fresh(13060);
    admin = await setupAdmin(s);
  });

  test('convite vale uma vez e cria um transmissor já logado', async () => {
    const inv = await invite(s, admin);
    assert.match(inv.path, /^\/convite#[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(inv.path);

    assert.equal((await api(s.url, '/api/invites/accept', { token, username: 'ab', password: BROADCASTER.password })).status, 400);
    assert.equal((await api(s.url, '/api/invites/accept', { token, username: 'bia', password: 'fraca' })).status, 400);
    assert.equal((await api(s.url, '/api/invites/accept', { token, username: 'admin', password: BROADCASTER.password })).status, 409);

    const ok = await api(s.url, '/api/invites/accept', { token, ...BROADCASTER });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.role, 'broadcaster');
    const session = { cookie: sessionFrom(ok) };
    assert.equal((await api(s.url, '/api/rooms', {}, session)).status, 201, 'transmissor cria sala');

    const reuse = await api(s.url, '/api/invites/accept', { token, username: 'outra', password: BROADCASTER.password });
    assert.equal(reuse.status, 401);
    assert.equal((await api(s.url, '/api/invites/accept', { token: 'inventado', ...BROADCASTER })).status, 401);
  });

  test('convite cancelado ou expirado não vale', async () => {
    const inv = await invite(s, admin);
    const { body } = await get(s.url, '/api/admin/invites', admin);
    assert.ok(body.invites.some((i) => i.id === inv.id));
    assert.ok(!JSON.stringify(body).includes(tokenOf(inv.path)), 'a lista não mostra o link');
    assert.equal((await api(s.url, '/api/admin/invites/cancel', { id: inv.id }, admin)).status, 200);
    assert.equal((await api(s.url, '/api/invites/accept', { token: tokenOf(inv.path), username: 'caio', password: BROADCASTER.password })).status, 401);

    const t = await fresh(13061, { INVITE_TTL_MS: '300' });
    const a = await setupAdmin(t);
    const late = await invite(t, a);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await api(t.url, '/api/invites/accept', { token: tokenOf(late.path), ...BROADCASTER })).status, 401);
    assert.deepEqual((await get(t.url, '/api/admin/invites', a)).body.invites, []);
  });
});

describe('permissões do transmissor', () => {
  test('transmissor não acessa nada de administração', async () => {
    const s = await fresh(13062);
    const admin = await setupAdmin(s);
    const bia = await addBroadcaster(s, admin);
    for (const [method, route] of [
      ['GET', '/api/admin/settings'],
      ['POST', '/api/admin/settings'],
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users/revoke'],
      ['POST', '/api/admin/users/restore'],
      ['POST', '/api/admin/users/delete'],
      ['GET', '/api/admin/invites'],
      ['POST', '/api/admin/invites'],
      ['POST', '/api/admin/invites/cancel'],
      ['POST', '/api/admin/recovery-codes'],
      ['POST', '/api/admin/reset-2fa'],
    ]) {
      const r = method === 'GET' ? await get(s.url, route, bia) : await api(s.url, route, { username: 'admin', require2fa: false }, bia);
      assert.equal(r.status, 403, `${method} ${route}`);
      const anon = method === 'GET' ? await get(s.url, route) : await api(s.url, route, {});
      assert.equal(anon.status, 401, `${method} ${route} sem login`);
    }
    // O admin continua sem 2FA exigido e ninguém foi revogado
    assert.equal((await get(s.url, '/api/admin/settings', admin)).body.require2fa, false);
  });

  test('lista de contas não expõe senhas, segredos nem códigos', async () => {
    const s = await fresh(13063);
    const admin = await setupAdmin(s);
    const bia = await addBroadcaster(s, admin);
    const { body: setup } = await api(s.url, '/api/2fa/setup', {}, bia);
    await api(s.url, '/api/2fa/enable', { code: codeAt(setup.secret, currentStep()) }, bia);
    const { body } = await get(s.url, '/api/admin/users', admin);
    const text = JSON.stringify(body);
    for (const field of ['passwordHash', 'secret', 'recovery', 'scrypt', setup.secret, '"id"']) assert.ok(!text.includes(field), field);
    assert.deepEqual(
      body.users.map((u) => [u.username, u.role, u.totp]),
      [['admin', 'admin', false], ['bia', 'broadcaster', true]],
    );
  });
});

describe('revogação', () => {
  test('revogar encerra sessões e salas ao vivo na hora; reativar devolve o acesso', async () => {
    const s = await fresh(13064);
    const admin = await setupAdmin(s);
    const bia = await addBroadcaster(s, admin);
    const room = await createRoom(s.url, bia);
    assert.equal((await api(s.url, '/api/token', { roomId: room.roomId })).status, 200);
    assert.equal((await get(s.url, '/api/admin/users', admin)).body.users.find((u) => u.username === 'bia').liveRooms, 1);

    const r = await api(s.url, '/api/admin/users/revoke', { username: 'bia' }, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.endedRooms, 1);
    assert.equal((await api(s.url, '/api/token', { roomId: room.roomId })).status, 404, 'a sala foi encerrada');
    assert.equal((await api(s.url, '/api/rooms', {}, bia)).status, 401, 'a sessão foi encerrada');
    assert.equal((await api(s.url, '/api/login', BROADCASTER)).status, 401, 'não consegue entrar de novo');

    assert.equal((await api(s.url, '/api/admin/users/restore', { username: 'bia' }, admin)).status, 200);
    assert.equal((await api(s.url, '/api/login', BROADCASTER)).status, 200);
  });

  test('admin não pode ser revogado nem excluído; excluir remove a conta', async () => {
    const s = await fresh(13065);
    const admin = await setupAdmin(s);
    await addBroadcaster(s, admin);
    for (const route of ['/api/admin/users/revoke', '/api/admin/users/delete']) {
      assert.equal((await api(s.url, route, { username: 'admin' }, admin)).status, 400, route);
    }
    assert.equal((await api(s.url, '/api/admin/users/revoke', { username: 'ninguem' }, admin)).status, 404);
    assert.equal((await api(s.url, '/api/admin/users/delete', { username: 'bia' }, admin)).status, 200);
    assert.equal((await api(s.url, '/api/login', BROADCASTER)).status, 401);
    assert.deepEqual((await get(s.url, '/api/admin/users', admin)).body.users.map((u) => u.username), ['admin']);
  });

  test('tokens de convite e de redefinição não aparecem nos logs', async () => {
    const s = await fresh(13066);
    const admin = await setupAdmin(s);
    const inv = await invite(s, admin);
    await api(s.url, '/api/invites/accept', { token: tokenOf(inv.path), ...BROADCASTER });
    await api(s.url, '/api/admin/users/revoke', { username: 'bia' }, admin);
    await new Promise((r) => setTimeout(r, 100));
    const logs = s.output();
    assert.ok(!logs.includes(tokenOf(inv.path)));
    assert.ok(!logs.includes(BROADCASTER.password));
    assert.match(logs, /"msg":"transmissor cadastrado","user":"bia","convidadoPor":"admin"/);
    assert.match(logs, /"msg":"transmissor revogado","user":"admin","conta":"bia"/);
  });
});

describe('redefinição do admin pelo comando no servidor', () => {
  const resetCommand = async (dataDir, env = {}) => {
    const { stdout } = await promisify(execFile)(process.execPath, ['cli.js', 'reset-admin'], {
      cwd: APP_DIR,
      env: { ...process.env, DATA_DIR: dataDir, DOMAIN: 'live.exemplo.com', HTTPS_PORT: '443', ...env },
    });
    return stdout.match(/https:\/\/live\.exemplo\.com\/redefinir#([A-Za-z0-9_-]+)/)[1];
  };

  test('link vale uma vez, troca a senha, remove o 2FA e encerra as sessões', async () => {
    const s = await fresh(13067);
    const admin = await setupAdmin(s);
    const { body: setup } = await api(s.url, '/api/2fa/setup', {}, admin);
    await api(s.url, '/api/2fa/enable', { code: codeAt(setup.secret, currentStep()) }, admin);

    const token = await resetCommand(s.dataDir);
    assert.equal((await api(s.url, '/api/admin-reset', { token: 'errado', password: 'nova frase de admin longa' })).status, 401);
    assert.equal((await api(s.url, '/api/admin-reset', { token, password: 'curta' })).status, 400, 'senha fraca não gasta o link');
    const ok = await api(s.url, '/api/admin-reset', { token, password: 'nova frase de acesso longa' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.totp, false, '2FA removido');
    assert.equal((await api(s.url, '/api/rooms', {}, admin)).status, 401, 'sessão antiga encerrada');
    assert.equal((await api(s.url, '/api/login', ADMIN)).status, 401);
    assert.equal((await api(s.url, '/api/login', { username: 'admin', password: 'nova frase de acesso longa' })).status, 200);
    assert.equal((await api(s.url, '/api/admin-reset', { token, password: 'outra frase de acesso' })).status, 401, 'uso único');
  });

  test('link expirado não vale e o comando recusa servidor sem configurar', async () => {
    const s = await fresh(13068);
    await setupAdmin(s);
    const token = await resetCommand(s.dataDir, { ADMIN_RESET_TTL_MS: '200' });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await api(s.url, '/api/admin-reset', { token, password: 'nova frase de acesso longa' })).status, 401);

    const empty = await fresh(13069);
    await assert.rejects(resetCommand(empty.dataDir), /não foi configurado/);
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => (browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })));
  after(() => browser?.close());

  const page = async () => {
    const p = await (await browser.newContext({ permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })).newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    return p;
  };

  test('admin convida pelo painel, transmissor se cadastra, transmite e é revogado ao vivo', async () => {
    const s = await fresh(13070);
    await setupAdmin(s);
    const adminPage = await page();
    await loginInBrowser(adminPage, s.url);
    await adminPage.click('#admin-link');
    await adminPage.waitForURL(`${s.url}/admin`);
    await adminPage.click('#new-invite');
    await adminPage.waitForSelector('#invite-box:not([hidden])');
    const link = await adminPage.inputValue('#invite-link');
    assert.match(link, /\/convite#/);

    const bia = await page();
    await bia.goto(link);
    assert.doesNotMatch(bia.url(), /#/, 'o convite sai da barra de endereço');
    await bia.fill('#username', BROADCASTER.username);
    await bia.fill('#password', BROADCASTER.password);
    await bia.fill('#password2', BROADCASTER.password);
    await bia.click('#invite-form button');
    await bia.waitForSelector('#signed-in:not([hidden])');
    assert.ok(await bia.isHidden('#admin-link'), 'transmissor não vê a administração');
    await bia.click('#create-form button');
    await bia.waitForURL(/#k=/);
    await bia.fill('#name', 'Bia');
    await bia.click('#join-form button');
    await bia.waitForSelector('#room:not([hidden])');

    const viewer = await page();
    await viewer.goto(await bia.inputValue('#invite-link'));
    await viewer.fill('#name', 'Caio');
    await viewer.click('#join-form button');
    await viewer.waitForSelector('#room:not([hidden])');

    await adminPage.reload();
    const row = adminPage.locator('#users li[data-username="bia"]');
    await row.waitFor();
    assert.match(await row.textContent(), /1 sala\(s\) ao vivo/);
    adminPage.once('dialog', (d) => d.accept());
    await row.locator('button', { hasText: 'Revogar' }).click();
    await adminPage.waitForFunction(() => document.querySelector('#users li[data-username="bia"]').textContent.includes('revogado'));

    await viewer.waitForFunction(() => document.querySelector('#overlay').textContent.includes('encerrada'));
    await bia.goto(`${s.url}/`);
    await bia.waitForSelector('#login-form:not([hidden])');
    for (const p of [adminPage, bia, viewer]) assert.deepEqual(p.errors, []);
  });

  test('admin muda as configurações pelo painel', async () => {
    const s = await fresh(13071);
    const admin = await setupAdmin(s);
    const p = await page();
    await loginInBrowser(p, s.url);
    await p.goto(`${s.url}/admin`);
    await p.waitForFunction(() => document.querySelector('#max').value === '16');
    await p.fill('#max', '150');
    await p.click('#settings-form button');
    await p.waitForSelector('#settings-ok:not([hidden])');
    assert.equal((await get(s.url, '/api/admin/settings', admin)).body.maxParticipants, 150);

    // Exigir 2FA vale para o próprio admin: sem 2FA, ele é levado a configurar
    await p.check('#require2fa');
    await p.click('#settings-form button');
    await p.waitForURL(`${s.url}/conta`);
    assert.ok(await p.isVisible('#required-2fa'));
    const saved = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'state.json'), 'utf8')).settings;
    assert.deepEqual(saved, { maxParticipants: 150, require2fa: true });
  });
});
