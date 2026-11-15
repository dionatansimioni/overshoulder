import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { api, jwtPayload, launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const livekit = new RoomServiceClient('http://127.0.0.1:17880', process.env.TEST_API_KEY, process.env.TEST_API_SECRET);
let s;
let admin;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13130);
  admin = await setupAdmin(s);
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const newRoom = async () => (await api(s.url, '/api/rooms', { type: 'together' }, admin)).body;
const join = (body) => api(s.url, '/api/token', { name: 'Beto', ...body });
const host = (room, route, body = {}) => api(s.url, route, { roomId: room.roomId, hostKey: room.hostKey, ...body });
const metadata = async (token) => {
  const name = jwtPayload(token).video.room;
  return JSON.parse((await livekit.listRooms([name]))[0].metadata);
};

describe('API', () => {
  test('ingresso: voltar não gasta o convite e funciona mesmo depois de o link mudar', async () => {
    const room = await newRoom();
    const first = await join({ roomId: room.roomId });
    assert.equal(first.status, 200);
    assert.match(first.body.ticket, /^[\w-]{40,}$/);
    const back = await join({ roomId: room.roomId, ticket: first.body.ticket });
    assert.equal(back.status, 200);
    assert.equal(back.body.ticket, undefined, 'quem volta com ingresso não ganha outro');

    let list = (await host(room, '/api/rooms/invites/list')).body;
    assert.equal(list.invites.length, 1);
    assert.equal(list.invites[0].isDefault, true);
    assert.equal(list.invites[0].used, 1, 'voltar com ingresso não conta de novo');

    const { roomId: newCode } = (await host(room, '/api/rooms/link')).body;
    assert.equal((await join({ roomId: room.roomId })).status, 404, 'link antigo sem ingresso');
    assert.equal((await join({ roomId: room.roomId, ticket: first.body.ticket })).status, 200, 'link antigo com ingresso');
    assert.equal((await join({ roomId: room.roomId, ticket: 'inventado' })).status, 404);
    list = (await api(s.url, '/api/rooms/invites/list', { roomId: newCode, hostKey: room.hostKey })).body;
    assert.equal(list.invites[0].code, newCode);
  });

  test('só o anfitrião mexe nos convites e na sala de espera', async () => {
    const room = await newRoom();
    for (const route of ['/api/rooms/invites', '/api/rooms/invites/list', '/api/rooms/invites/revoke', '/api/rooms/waiting', '/api/rooms/lobby']) {
      assert.equal((await api(s.url, route, { roomId: room.roomId, hostKey: 'errada' })).status, 403, route);
    }
  });

  test('criar convite: valida limite, validade e senha', async () => {
    const room = await newRoom();
    for (const bad of [{ maxUses: 0 }, { maxUses: 1.5 }, { maxUses: '3' }, { expiresInMinutes: 0 }, { expiresInMinutes: 60 * 24 * 31 }, { password: 123 }]) {
      assert.equal((await host(room, '/api/rooms/invites', bad)).status, 400, JSON.stringify(bad));
    }
    const before = Date.now();
    const inv = (await host(room, '/api/rooms/invites', { label: '  Clã  ', expiresInMinutes: 60, maxUses: 5 })).body;
    assert.equal(inv.label, 'Clã');
    assert.equal(inv.maxUses, 5);
    assert.equal(inv.hasPassword, false);
    const expires = Date.parse(inv.expiresAt);
    assert.ok(expires >= before + 3_600_000 && expires <= Date.now() + 3_600_000);
    assert.ok(!('passwordHash' in inv));
  });

  test('limite de pessoas: o convite fecha quando enche, e quem entrou volta com o ingresso', async () => {
    const room = await newRoom();
    const inv = (await host(room, '/api/rooms/invites', { label: 'Um só', maxUses: 1 })).body;
    const first = await join({ roomId: inv.code });
    assert.equal(first.status, 200);
    const second = await join({ roomId: inv.code });
    assert.equal(second.status, 410);
    assert.equal(second.body.code, 'invite_closed');
    assert.match(second.body.error, /limite de pessoas/);
    assert.equal((await join({ roomId: inv.code, ticket: first.body.ticket })).status, 200);
    assert.equal((await join({ roomId: room.roomId })).status, 200, 'o convite padrão continua aberto');
  });

  test('senha do convite: pedida, conferida e com limite de tentativas', async () => {
    const room = await newRoom();
    const inv = (await host(room, '/api/rooms/invites', { label: 'Com senha', password: 'abacaxi' })).body;
    assert.equal(inv.hasPassword, true);
    const none = await join({ roomId: inv.code });
    assert.equal(none.status, 401);
    assert.equal(none.body.code, 'password_required');
    const wrong = await join({ roomId: inv.code, password: 'banana' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'password_required');
    assert.equal((await join({ roomId: inv.code, password: 'abacaxi' })).status, 200);
    assert.equal((await join({ roomId: room.roomId })).status, 200, 'o convite padrão não pede senha');
    for (let i = 0; i < 9; i++) await join({ roomId: inv.code, password: 'errada' });
    assert.equal((await join({ roomId: inv.code, password: 'abacaxi' })).status, 429, 'tentativas demais');
  });

  test('revogar: o link morre, os ingressos também, e o convite padrão não pode ser revogado', async () => {
    const room = await newRoom();
    const list = (await host(room, '/api/rooms/invites/list')).body;
    assert.equal((await host(room, '/api/rooms/invites/revoke', { inviteId: list.invites[0].id })).status, 400);
    assert.equal((await host(room, '/api/rooms/invites/revoke', { inviteId: 'nao-existe' })).status, 404);

    const inv = (await host(room, '/api/rooms/invites', { label: 'Stream' })).body;
    const a = await join({ roomId: inv.code });
    const b = await join({ roomId: room.roomId });
    const r = await host(room, '/api/rooms/invites/revoke', { inviteId: inv.id });
    assert.deepEqual(r.body, { removed: 1 }, 'só quem entrou por este convite');
    assert.equal((await join({ roomId: inv.code })).status, 404);
    assert.equal((await join({ roomId: inv.code, ticket: a.body.ticket })).status, 404, 'ingresso do convite revogado');
    assert.equal((await join({ roomId: room.roomId, ticket: b.body.ticket })).status, 200, 'os outros convites seguem');
    const after = (await host(room, '/api/rooms/invites/list')).body.invites.find((i) => i.id === inv.id);
    assert.equal(after.revoked, true);
  });

  test('sala de espera: quem chega espera; o anfitrião deixa entrar ou recusa', async () => {
    const room = await newRoom();
    const hostToken = (await api(s.url, '/api/token', { roomId: room.roomId, hostKey: room.hostKey })).body.token;
    assert.equal((await host(room, '/api/rooms/waiting', { enabled: 'sim' })).status, 400);
    assert.deepEqual((await host(room, '/api/rooms/waiting', { enabled: true })).body, { waiting: true });

    const wait = await join({ roomId: room.roomId, name: 'Carla' });
    assert.equal(wait.status, 202);
    const { lobbyId } = wait.body;
    let meta = await metadata(hostToken);
    assert.equal(meta.waiting, true);
    assert.equal(meta.lobby.length, 1);
    assert.equal(meta.lobby[0].name, 'Carla');
    assert.notEqual(meta.lobby[0].id, lobbyId, 'o segredo de quem espera não aparece para a sala');
    assert.equal((await join({ roomId: room.roomId, lobbyId })).status, 202, 'ainda esperando');
    assert.equal((await host(room, '/api/rooms/lobby', { lobbyId, admit: true })).status, 404, 'o anfitrião usa o id público');
    assert.equal((await host(room, '/api/rooms/lobby', { lobbyId: meta.lobby[0].id, admit: true })).status, 200);
    const inside = await join({ roomId: room.roomId, lobbyId, name: 'Outro nome' });
    assert.equal(inside.status, 200);
    assert.equal(jwtPayload(inside.body.token).name, 'Carla', 'entra com o nome que o anfitrião aprovou');
    assert.equal((await join({ roomId: room.roomId, ticket: inside.body.ticket })).status, 200, 'o ingresso pula a espera');
    assert.equal((await join({ roomId: room.roomId, lobbyId })).status, 202, 'o mesmo pedido não entra duas vezes');

    const denied = await join({ roomId: room.roomId, name: 'Davi' });
    meta = await metadata(hostToken);
    const davi = meta.lobby.find((w) => w.name === 'Davi');
    await host(room, '/api/rooms/lobby', { lobbyId: davi.id, admit: false });
    const no = await join({ roomId: room.roomId, lobbyId: denied.body.lobbyId });
    assert.equal(no.status, 403);
    assert.equal(no.body.code, 'lobby_denied');

    // Desligar a sala de espera deixa entrar quem estava esperando
    const eva = await join({ roomId: room.roomId, name: 'Eva' });
    await host(room, '/api/rooms/waiting', { enabled: false });
    assert.equal((await join({ roomId: room.roomId, lobbyId: eva.body.lobbyId })).status, 200);
  });
});

describe('no navegador', () => {
  const page = async () => {
    const p = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    return p;
  };

  const hostRoom = async () => {
    const h = await page();
    await loginInBrowser(h, s.url);
    await h.click('#new-room');
    await h.click('#create-together');
    await h.waitForURL(/#k=/);
    await h.fill('#name', 'Ana');
    await h.click('#join-form button');
    await h.waitForSelector('#room:not([hidden])');
    await h.click('#tab-people');
    await h.click('#invites-panel summary');
    await h.waitForSelector('#invites li');
    return h;
  };

  const createInvite = async (h, { label, max, password }) => {
    await h.fill('#invite-label', label);
    if (max) await h.fill('#invite-max', String(max));
    if (password) await h.fill('#invite-pass', password);
    const response = h.waitForResponse((r) => r.url().endsWith('/api/rooms/invites'));
    await h.click('#invite-form button');
    const inv = await (await response).json();
    await h.waitForSelector(`#invites li[data-invite="${inv.id}"]`);
    return { ...inv, link: (await h.inputValue('#invite-link')).replace(/\/r\/[^#]+/, `/r/${inv.code}`) };
  };

  test('convite com senha e limite; recarregar volta sem gastar o convite; revogar tira da sala', async () => {
    const h = await hostRoom();
    const inv = await createInvite(h, { label: 'Clã', max: 1, password: 'abacaxi' });
    assert.match(await h.textContent(`#invites li[data-invite="${inv.id}"]`), /Clã.*0 de 1 pessoas · com senha/);

    const beto = await page();
    await beto.goto(inv.link);
    await beto.fill('#name', 'Beto');
    await beto.click('#join-form button');
    await beto.waitForSelector('#password-row:not([hidden])');
    assert.match(await beto.textContent('#join-error'), /pede uma senha/);
    await beto.fill('#invite-password', 'abacaxi');
    await beto.click('#join-form button');
    await beto.waitForSelector('#room:not([hidden])');

    // Recarregar: o ingresso do navegador entra de novo, sem senha e sem contar outra pessoa
    await beto.reload();
    await beto.click('#join-form button');
    await beto.waitForSelector('#room:not([hidden])');
    assert.ok(await beto.isHidden('#password-row'));

    // O convite encheu: outra pessoa não entra por ele (nem chega a pedir a senha)
    const carla = await page();
    await carla.goto(inv.link);
    await carla.fill('#name', 'Carla');
    await carla.click('#join-form button');
    await carla.waitForFunction(() => /limite de pessoas/.test(document.querySelector('#join-error').textContent));

    await h.click('#invites-panel summary');
    await h.click('#invites-panel summary');
    await h.waitForFunction((id) => /1 de 1 pessoas/.test(document.querySelector(`#invites li[data-invite="${id}"]`).textContent), inv.id);
    h.once('dialog', (d) => d.accept());
    await h.click(`#invites li[data-invite="${inv.id}"] [data-action="revoke"]`);
    await beto.waitForSelector('#ended:not([hidden])');
    await h.waitForFunction((id) => /revogado/.test(document.querySelector(`#invites li[data-invite="${id}"]`).textContent), inv.id);
    for (const p of [h, beto, carla]) assert.deepEqual(p.errors, []);
  });

  test('sala de espera: a pessoa espera e entra quando o anfitrião libera', async () => {
    const h = await hostRoom();
    await h.check('#waiting-toggle');
    await h.waitForFunction(() => /Sala de espera ligada/.test(document.querySelector('#messages').textContent));

    const beto = await page();
    await beto.goto(await h.inputValue('#invite-link'));
    await beto.fill('#name', 'Beto');
    await beto.click('#join-form button');
    await beto.waitForSelector('#waiting-msg:not([hidden])');

    await h.waitForSelector('#requests-count:not([hidden])');
    const entry = h.locator('#lobby li', { hasText: 'Beto está na sala de espera.' });
    await entry.waitFor();
    // Com o painel de convites aberto, a fila continua inteira à vista (não é espremida)
    const lobby = await h.evaluate(() => ({ shown: document.querySelector('#lobby').clientHeight, needed: document.querySelector('#lobby').scrollHeight }));
    assert.ok(lobby.shown >= lobby.needed, `fila espremida: ${lobby.shown}px de ${lobby.needed}px`);
    await entry.locator('button', { hasText: 'Deixar entrar' }).click();
    await beto.waitForSelector('#room:not([hidden])');
    await h.waitForSelector('#lobby', { state: 'hidden' });

    const carla = await page();
    await carla.goto(await h.inputValue('#invite-link'));
    await carla.fill('#name', 'Carla');
    await carla.click('#join-form button');
    const refuse = h.locator('#lobby li', { hasText: 'Carla' });
    await refuse.waitFor();
    await refuse.locator('button', { hasText: 'Recusar' }).click();
    await carla.waitForFunction(() => /não liberou sua entrada/.test(document.querySelector('#join-error').textContent));
    assert.ok(await carla.isHidden('#waiting-msg'));
  });
});
