import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { ADMIN, api, get, jwtPayload, launchBrowser, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const livekit = new RoomServiceClient('http://127.0.0.1:17880', process.env.TEST_API_KEY, process.env.TEST_API_SECRET);
let s;
let admin;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13150);
  admin = await setupAdmin(s);
});
after(() => s?.stop());

const list = async () => (await get(s.url, '/api/admin/rooms', admin)).body.rooms;
const create = (body) => api(s.url, '/api/admin/rooms', body, admin);
const join = (body) => api(s.url, '/api/token', { name: 'Beto', ...body });
const inLiveKit = async (id) => (await livekit.listRooms([id])).length > 0;

describe('API', () => {
  test('só o admin cria, lista e exclui salas fixas; nome obrigatório e único', async () => {
    assert.equal((await api(s.url, '/api/admin/rooms', { title: 'X' })).status, 401);
    assert.equal((await get(s.url, '/api/admin/rooms')).status, 401);
    // Um transmissor (cadastro livre) também não pode
    await api(s.url, '/api/admin/settings', { signup: 'open' }, admin);
    const b = await api(s.url, '/api/signup', { username: 'beto', password: 'uma frase longa de teste' });
    const broadcaster = { cookie: sessionFrom(b) };
    assert.equal((await api(s.url, '/api/admin/rooms', { title: 'X' }, broadcaster)).status, 403);
    assert.equal((await api(s.url, '/api/admin/rooms/delete', { id: 'x' }, broadcaster)).status, 403);

    assert.equal((await create({ title: '   ' })).status, 400);
    assert.equal((await create({ title: 'Clã', type: 'festa' })).status, 400);
    const r = await create({ title: '  Sala do clã  ', type: 'together' });
    assert.equal(r.status, 201);
    assert.equal(r.body.title, 'Sala do clã');
    assert.equal(r.body.type, 'together');
    assert.equal(r.body.openScreens, true);
    assert.equal(r.body.online, 0);
    assert.match(r.body.hostKey, /^[\w-]{20,}$/);
    assert.equal((await create({ title: 'sala do CLÃ' })).status, 409);
    assert.equal(await inLiveKit(r.body.id), false, 'só vai ao ar quando alguém entra');
    assert.ok((await list()).some((x) => x.id === r.body.id));
  });

  test('vai ao ar quando alguém entra; encerrar tira todos, mas a sala e o link continuam', async () => {
    const room = (await create({ title: 'Live semanal', type: 'live' })).body;
    const host = await join({ roomId: room.roomId, hostKey: room.hostKey });
    assert.equal(host.status, 200);
    assert.equal(host.body.role, 'host');
    assert.equal(await inLiveKit(room.id), true);
    const viewer = await join({ roomId: room.roomId });
    assert.equal(viewer.status, 200);
    assert.equal(jwtPayload(viewer.body.token).video.room, room.id);

    assert.equal((await api(s.url, '/api/rooms/end', { roomId: room.roomId, hostKey: room.hostKey })).status, 200);
    assert.equal(await inLiveKit(room.id), false);
    const again = (await list()).find((x) => x.id === room.id);
    assert.equal(again.roomId, room.roomId, 'mesmo link');
    assert.equal((await join({ roomId: room.roomId, ticket: viewer.body.ticket })).status, 200, 'volta com o mesmo ingresso');
    assert.equal(await inLiveKit(room.id), true);
  });

  test('sobrevive a reiniciar o servidor: link, convites, senhas, usos e ingressos', async () => {
    const room = (await create({ title: 'Persistente', type: 'together' })).body;
    const host = (route, body = {}) => api(s.url, route, { roomId: room.roomId, hostKey: room.hostKey, ...body });
    const inv = (await host('/api/rooms/invites', { label: 'Com senha', password: 'abacaxi', maxUses: 2 })).body;
    const first = await join({ roomId: inv.code, password: 'abacaxi' });
    assert.equal(first.status, 200);
    await host('/api/rooms/waiting', { enabled: true });

    const state = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'state.json'), 'utf8'));
    const saved = state.rooms.find((r) => r.name === room.id);
    assert.equal(saved.title, 'Persistente');
    assert.ok(!JSON.stringify(saved).includes(first.body.ticket), 'ingresso só em hash');
    assert.ok(!JSON.stringify(saved).includes('abacaxi'), 'senha só em hash');

    s.stop();
    await new Promise((r) => setTimeout(r, 300));
    s = await startServer(13150, { DATA_DIR: s.dataDir });
    // As sessões ficam na memória: o admin entra de novo
    admin = { cookie: sessionFrom(await api(s.url, '/api/login', ADMIN)) };

    const back = (await list()).find((x) => x.id === room.id);
    assert.equal(back.roomId, room.roomId);
    const invites = (await host('/api/rooms/invites/list')).body;
    assert.equal(invites.waiting, true, 'sala de espera ligada continua ligada');
    const saw = invites.invites.find((i) => i.id === inv.id);
    assert.equal(saw.used, 1);
    assert.equal(saw.hasPassword, true);
    assert.equal((await join({ roomId: inv.code, ticket: first.body.ticket })).status, 200, 'ingresso de antes do reinício');
    assert.equal((await join({ roomId: inv.code })).status, 401, 'a senha continua sendo pedida');
    assert.equal((await join({ roomId: inv.code, password: 'abacaxi' })).status, 202, 'e a sala de espera também');
  });

  test('excluir: o link morre e a sala some do disco', async () => {
    const room = (await create({ title: 'Temporária' })).body;
    await join({ roomId: room.roomId, hostKey: room.hostKey });
    assert.equal((await api(s.url, '/api/admin/rooms/delete', { id: 'nao-existe' }, admin)).status, 404);
    assert.equal((await api(s.url, '/api/admin/rooms/delete', { id: room.id }, admin)).status, 200);
    assert.equal(await inLiveKit(room.id), false);
    assert.equal((await join({ roomId: room.roomId })).status, 404);
    const state = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'state.json'), 'utf8'));
    assert.ok(!state.rooms.some((r) => r.name === room.id));
  });

  test('salas rápidas não vão para o disco', async () => {
    const quick = (await api(s.url, '/api/rooms', {}, admin)).body;
    await join({ roomId: quick.roomId });
    const state = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'state.json'), 'utf8'));
    assert.ok(!JSON.stringify(state).includes(quick.roomId));
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => {
    browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  });
  after(() => browser?.close());

  test('o admin cria a sala fixa, entra como anfitrião e a pessoa entra pelo convite', async () => {
    const context = await browser.newContext({ permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
    const a = await context.newPage();
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    await loginInBrowser(a, s.url);
    await a.goto(`${s.url}/admin#salas`);
    await a.fill('#fixed-title', 'Canal da comunidade');
    await a.selectOption('#fixed-type', 'live');
    await a.click('#fixed-form button');
    const row = a.locator('#fixed-rooms li', { hasText: 'Canal da comunidade' });
    await row.waitFor();
    assert.match(await row.textContent(), /Live · vazia/);

    await row.locator('[data-action="copy"]').click();
    const link = await a.evaluate(() => navigator.clipboard.readText());
    assert.match(link, /\/r\/[\w-]+#k=[\w-]{43}$/);
    assert.ok(!link.includes('h='), 'o convite não leva a chave de anfitrião');

    await row.locator('[data-action="enter"]').click();
    await a.fill('#name', 'Ana');
    await a.click('#join-form button');
    await a.waitForSelector('#room:not([hidden])');
    assert.ok(await a.isVisible('#end'), 'entrou como anfitrião');

    const beto = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    await beto.goto(link);
    await beto.fill('#name', 'Beto');
    await beto.click('#join-form button');
    await beto.waitForSelector('#room:not([hidden])');
    // Para o anfitrião, quem entra e sai fica na aba Registro
    await a.waitForFunction(() => /Beto entrou/.test(document.querySelector('#log').textContent));

    // Em outro navegador a chave não está guardada: o admin vê o aviso
    const other = await (await browser.newContext()).newPage();
    await loginInBrowser(other, s.url);
    await other.goto(`${s.url}/admin#salas`);
    const elsewhere = other.locator('#fixed-rooms li', { hasText: 'Canal da comunidade' });
    await elsewhere.waitFor();
    assert.match(await elsewhere.textContent(), /2 pessoa\(s\) agora · chave em outro navegador/);
    assert.equal(await elsewhere.locator('[data-action="enter"]').count(), 0);
    assert.deepEqual(errors, []);
  });
});
