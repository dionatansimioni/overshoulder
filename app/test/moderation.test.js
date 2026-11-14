import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { chromium } from 'playwright';
import { api, createRoom, jwtPayload, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const livekit = new RoomServiceClient('http://127.0.0.1:17880', process.env.TEST_API_KEY, process.env.TEST_API_SECRET);
const servers = [];
let s;
let admin;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13080);
  servers.push(s);
  admin = await setupAdmin(s);
});
after(() => servers.forEach((x) => x.stop()));

const internalName = async (roomId) =>
  jwtPayload((await api(s.url, '/api/token', { roomId })).body.token).video.room;

// Permissões reais de um participante, direto da API do LiveKit (não da interface)
const permissionOf = async (roomName, identity) =>
  (await livekit.listParticipants(roomName)).find((p) => p.identity === identity)?.permission;

describe('API de moderação', () => {
  test('ações exigem a chave de anfitrião da própria sala', async () => {
    const a = await createRoom(s.url, admin);
    const b = await createRoom(s.url, admin);
    for (const route of ['/api/rooms/chat', '/api/rooms/link', '/api/rooms/presenter', '/api/rooms/kick']) {
      const extra = { enabled: false, identity: 'v-000000000000' };
      assert.equal((await api(s.url, route, { roomId: a.roomId, hostKey: 'chute', ...extra })).status, 403, route);
      assert.equal((await api(s.url, route, { roomId: a.roomId, hostKey: b.hostKey, ...extra })).status, 403, `${route} com chave de outra sala`);
      assert.equal((await api(s.url, route, { roomId: 'x', hostKey: a.hostKey, ...extra })).status, 400, route);
      assert.equal((await api(s.url, route, { roomId: 'z'.repeat(22), hostKey: a.hostKey, ...extra })).status, 404, route);
    }
  });

  test('valida participante e valores', async () => {
    const r = await createRoom(s.url, admin);
    const host = { roomId: r.roomId, hostKey: r.hostKey };
    for (const identity of ['h-000000000000', 'qualquer', 42, undefined]) {
      assert.equal((await api(s.url, '/api/rooms/kick', { ...host, identity })).status, 400, String(identity));
      assert.equal((await api(s.url, '/api/rooms/presenter', { ...host, identity })).status, 400, String(identity));
    }
    assert.equal((await api(s.url, '/api/rooms/kick', { ...host, identity: 'v-0123456789ab' })).status, 404);
    assert.equal((await api(s.url, '/api/rooms/presenter', { ...host, identity: 'v-0123456789ab' })).status, 404);
    assert.equal((await api(s.url, '/api/rooms/chat', { ...host, enabled: 'não' })).status, 400);
  });

  test('novo link: o código antigo deixa de valer, o novo funciona e o anfitrião continua anfitrião', async () => {
    const r = await createRoom(s.url, admin);
    const name = await internalName(r.roomId);
    const { body } = await api(s.url, '/api/rooms/link', { roomId: r.roomId, hostKey: r.hostKey });
    assert.match(body.roomId, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(body.roomId, r.roomId);
    assert.equal((await api(s.url, '/api/token', { roomId: r.roomId })).status, 404);
    const viewer = await api(s.url, '/api/token', { roomId: body.roomId });
    assert.equal(viewer.status, 200);
    assert.equal(jwtPayload(viewer.body.token).video.room, name, 'mesma sala no LiveKit');
    assert.equal((await api(s.url, '/api/token', { roomId: body.roomId, hostKey: r.hostKey })).body.role, 'host');
  });

  test('chat desligado: tokens novos de espectador não publicam dados', async () => {
    const r = await createRoom(s.url, admin);
    await api(s.url, '/api/rooms/chat', { roomId: r.roomId, hostKey: r.hostKey, enabled: false });
    const viewer = jwtPayload((await api(s.url, '/api/token', { roomId: r.roomId })).body.token);
    assert.equal(viewer.video.canPublishData, false);
    const host = jwtPayload((await api(s.url, '/api/token', { roomId: r.roomId, hostKey: r.hostKey })).body.token);
    assert.equal(host.video.canPublishData, true, 'o anfitrião continua falando no chat');
    const room = (await livekit.listRooms([await internalName(r.roomId)]))[0];
    assert.deepEqual(JSON.parse(room.metadata), { chat: false, presenter: null });
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => {
    browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  });
  after(() => browser?.close());

  // Cada página guarda a identidade e o token recebidos do servidor
  const newPage = async () => {
    const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('response', async (r) => {
      if (r.url().endsWith('/api/token') && r.ok()) page.lk = await r.json().catch(() => ({}));
    });
    return page;
  };

  const hostRoom = async () => {
    const host = await newPage();
    await loginInBrowser(host, s.url);
    await host.click('#create-form button');
    await host.waitForURL(/#k=/);
    await host.fill('#name', 'Ana');
    await host.click('#join-form button');
    await host.waitForSelector('#room:not([hidden])');
    return host;
  };

  const joinAs = async (link, name) => {
    const page = await newPage();
    await page.goto(link);
    await page.fill('#name', name);
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
    return page;
  };

  // Abre a aba Pessoas do anfitrião e espera a pessoa aparecer
  const personRow = async (host, identity) => {
    await host.click('#tab-people');
    const row = host.locator(`#people li[data-identity="${identity}"]`);
    await row.waitFor();
    return row;
  };

  test('anfitrião desliga e religa o chat; o LiveKit aplica a permissão', async () => {
    const host = await hostRoom();
    const viewer = await joinAs(await host.inputValue('#invite-link'), 'Beto');
    const roomName = jwtPayload(viewer.lk.token).video.room;

    await host.click('#chat-toggle');
    await viewer.waitForFunction(() => document.querySelector('#chat-input').disabled);
    assert.match(await viewer.getAttribute('#chat-input', 'placeholder'), /desligou o chat/);
    assert.equal((await permissionOf(roomName, viewer.lk.identity)).canPublishData, false);
    assert.equal(await host.isDisabled('#chat-input'), false, 'o anfitrião continua escrevendo');
    assert.equal(await host.textContent('#chat-toggle'), 'Ligar chat');

    await host.click('#chat-toggle');
    await viewer.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    assert.equal((await permissionOf(roomName, viewer.lk.identity)).canPublishData, true);
    await viewer.fill('#chat-input', 'voltou!');
    await viewer.press('#chat-input', 'Enter');
    await host.locator('#messages li.msg', { hasText: 'voltou!' }).waitFor();
    for (const p of [host, viewer]) assert.deepEqual(p.errors, []);
  });

  test('remover alguém: a pessoa sai, o link troca e voltar com o token antigo não adianta', async () => {
    const host = await hostRoom();
    const oldLink = await host.inputValue('#invite-link');
    const viewer = await joinAs(oldLink, 'Intruso');
    const stays = await joinAs(oldLink, 'Carla');

    const row = await personRow(host, viewer.lk.identity);
    host.once('dialog', (d) => d.accept());
    await row.locator('button[data-action="kick"]').click();
    await viewer.waitForFunction(() => document.querySelector('#overlay').textContent.includes('removido'));

    await host.waitForFunction((old) => document.querySelector('#invite-link').value !== old, oldLink);
    const newLink = await host.inputValue('#invite-link');
    assert.match(host.url(), new RegExp(new URL(newLink).pathname));

    // Link antigo não deixa entrar de novo
    const retry = await newPage();
    await retry.goto(oldLink);
    await retry.fill('#name', 'Intruso de novo');
    await retry.click('#join-form button');
    await retry.waitForSelector('#join-error:not([hidden])');
    assert.match(await retry.textContent('#join-error'), /link foi trocado/);

    // Voltar com o token que já tinha não adianta: o servidor remove de novo em segundos
    const rejoin = await viewer.evaluate(async ({ url, token }) => {
      const { Room, RoomEvent } = await import('/vendor/livekit-client.esm.mjs');
      const again = new Room();
      const started = Date.now();
      const removed = new Promise((resolve) => again.on(RoomEvent.Disconnected, (reason) => resolve(reason)));
      try {
        await again.connect(url, token);
      } catch (err) {
        return { refused: err.message };
      }
      const reason = await Promise.race([removed, new Promise((r) => setTimeout(() => r('ainda conectado'), 8000))]);
      return { reason, ms: Date.now() - started };
    }, viewer.lk);
    assert.ok(rejoin.refused || rejoin.reason !== 'ainda conectado', JSON.stringify(rejoin));
    if (!rejoin.refused) assert.ok(rejoin.ms < 5000, `removido de novo em ${rejoin.ms} ms`);

    // Quem não foi removido continua na sala, e o link novo funciona
    assert.ok(await stays.isHidden('#overlay') || !(await stays.textContent('#overlay')).includes('removido'));
    await joinAs(newLink, 'Dani');
    await host.waitForFunction(() => document.querySelector('#count').textContent.startsWith('3'));
  });

  test('passar a vez: o espectador apresenta e o anfitrião pega de volta', async () => {
    const host = await hostRoom();
    const link = await host.inputValue('#invite-link');
    const beto = await joinAs(link, 'Beto');
    const carla = await joinAs(link, 'Carla');
    const roomName = jwtPayload(beto.lk.token).video.room;
    assert.ok(await beto.isHidden('#host-controls'));

    const row = await personRow(host, beto.lk.identity);
    await row.locator('button[data-action="presenter"]').click();
    await beto.waitForSelector('#host-controls:not([hidden])');
    assert.ok(await beto.isHidden('#end'), 'quem apresenta não encerra a sala');
    assert.equal((await permissionOf(roomName, beto.lk.identity)).canPublish, true);
    assert.equal((await permissionOf(roomName, carla.lk.identity)).canPublish, false);
    await carla.waitForFunction(() => document.querySelector('#presenter-badge').textContent === 'Beto está apresentando');

    await beto.click('#mic');
    await beto.waitForSelector('#mic.on');
    await carla.waitForSelector('#mic-badge:not([hidden])');
    await host.waitForSelector('#mic-badge:not([hidden])');

    await host.locator(`#people li[data-identity="${beto.lk.identity}"] button[data-action="presenter"]`, { hasText: 'Retomar' }).click();
    await beto.waitForSelector('#host-controls', { state: 'hidden' });
    await carla.waitForSelector('#mic-badge', { state: 'hidden' });
    await carla.waitForSelector('#presenter-badge', { state: 'hidden' });
    assert.equal((await permissionOf(roomName, beto.lk.identity)).canPublish, false);
    for (const p of [host, beto, carla]) assert.deepEqual(p.errors, []);
  });

  test('espectador vê a lista de pessoas sem ações de moderação', async () => {
    const host = await hostRoom();
    const viewer = await joinAs(await host.inputValue('#invite-link'), 'Beto');
    await viewer.click('#tab-people');
    await viewer.locator('#people li').nth(1).waitFor();
    assert.equal(await viewer.locator('#people button').count(), 0);
    assert.ok(await viewer.isHidden('#chat-tools'));
    assert.ok(await viewer.isHidden('#new-link'));
  });
});
