import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, createRoom, get, launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let admin;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13170);
  admin = await setupAdmin(s);
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const status = (codes, session = admin) => api(s.url, '/api/rooms/status', { codes }, session);

// Página nova que falha o teste em qualquer erro de JavaScript
const newPage = async (options = {}) => {
  const page = await (await browser.newContext({ permissions: ['microphone'], ...options })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const enterRoom = async (page, name = 'Ana') => {
  await page.fill('#name', name);
  await page.click('#join-form button[type="submit"]');
  await page.waitForSelector('#room:not([hidden])');
};

describe('situação das salas da barra lateral (API)', () => {
  test('diz quais salas seguem no ar e quantas pessoas há nelas', async () => {
    const room = await createRoom(s.url, admin);
    const unknown = 'z'.repeat(22);
    let r = await status([room.roomId, unknown]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.status[unknown], { exists: false });
    assert.deepEqual(r.body.status[room.roomId], { exists: true, fixed: false, online: 0 });

    await api(s.url, '/api/token', { roomId: room.roomId, hostKey: room.hostKey, name: 'Ana' });
    await api(s.url, '/api/rooms/end', { roomId: room.roomId, hostKey: room.hostKey });
    r = await status([room.roomId]);
    assert.deepEqual(r.body.status[room.roomId], { exists: false }, 'sala encerrada');
  });

  test('sala fixa vazia aparece sem voltar ao ar', async () => {
    const fixed = (await api(s.url, '/api/admin/rooms', { title: 'Sala do clã', type: 'together' }, admin)).body;
    const r = await status([fixed.roomId]);
    assert.deepEqual(r.body.status[fixed.roomId], { exists: true, fixed: true, online: 0 });
    // Consultar não recria a sala no LiveKit: a lista do admin continua mostrando ninguém
    const listed = (await get(s.url, '/api/admin/rooms', admin)).body.rooms.find((x) => x.id === fixed.id);
    assert.equal(listed.online, 0);
    await api(s.url, '/api/admin/rooms/delete', { id: fixed.id }, admin);
  });

  test('só quem tem conta consulta, e a lista precisa ser válida', async () => {
    assert.equal((await status(['a'.repeat(22)], {})).status, 401);
    for (const codes of [undefined, null, 'a'.repeat(22), [42], ['curto'], ['a'.repeat(22) + '/'], [{}], Array(51).fill('a'.repeat(22))]) {
      const r = await status(codes);
      assert.equal(r.status, 400, JSON.stringify(codes)?.slice(0, 40));
      assert.equal(r.body.error, 'Lista de salas inválida.');
    }
  });

  test('o token informa o tipo da sala e o nome da sala fixa', async () => {
    const room = await createRoom(s.url, admin);
    const token = await api(s.url, '/api/token', { roomId: room.roomId, name: 'Beto' });
    assert.deepEqual(token.body.room, { type: 'live' }, 'sem tipo informado, a sala é Live');
    await api(s.url, '/api/rooms/end', { roomId: room.roomId, hostKey: room.hostKey });

    const fixed = (await api(s.url, '/api/admin/rooms', { title: 'Sala do clã', type: 'together' }, admin)).body;
    const fixedToken = await api(s.url, '/api/token', { roomId: fixed.roomId, name: 'Beto' });
    assert.deepEqual(fixedToken.body.room, { type: 'together', title: 'Sala do clã' });
    await api(s.url, '/api/admin/rooms/delete', { id: fixed.id }, admin);
  });
});

describe('página inicial (navegador)', () => {
  test('em 2 cliques a sala existe e o link de convite já está na tela', async () => {
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    await page.click('#new-room');
    assert.ok(await page.isVisible('#create-dialog'));
    await page.click('#create-live');
    await page.waitForURL(/\/r\/[A-Za-z0-9_-]{22}#k=/);
    assert.ok(await page.isVisible('#join-invite-link'));
    const link = await page.inputValue('#join-invite-link');
    assert.match(link, /\/r\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(link, /h=/, 'o convite não leva a chave de anfitrião');
    assert.deepEqual(errors, []);
  });

  test('a barra lateral lista a sala criada, mostra quando está no ar e esquece', async () => {
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    assert.ok(await page.isVisible('#no-rooms'));
    await page.click('#new-room');
    await page.click('#create-together');
    await page.waitForURL(/#k=/);
    await enterRoom(page);

    const home = await page.context().newPage();
    await home.goto(s.url);
    await home.waitForSelector('#my-rooms li .dot.live');
    assert.equal(await home.locator('#my-rooms li').count(), 1);
    assert.match(await home.textContent('#my-rooms li'), /Sua sala.*Jogando juntos · 1 pessoa\(s\) agora/s);
    assert.ok(await home.isHidden('#no-rooms'));
    // O link da lista abre a sala como anfitrião
    assert.match(await home.getAttribute('#my-rooms a', 'href'), /^\/r\/[A-Za-z0-9_-]{22}#k=.+&h=/);

    await home.click('#my-rooms button.forget');
    assert.equal(await home.locator('#my-rooms li').count(), 0);
    assert.ok(await home.isVisible('#no-rooms'));
    assert.deepEqual(errors, []);
  });

  test('sala encerrada some da lista', async () => {
    const { page } = await newPage();
    await loginInBrowser(page, s.url);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    await enterRoom(page);
    page.on('dialog', (d) => d.accept());
    await Promise.all([page.waitForResponse('**/api/rooms/end'), page.click('#end')]);

    await page.goto(s.url);
    await page.waitForSelector('#signed-in:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#my-rooms li').length === 0);
    assert.ok(await page.isVisible('#no-rooms'));
  });

  test('admin vê as salas fixas com a chave deste navegador', async () => {
    const fixed = (await api(s.url, '/api/admin/rooms', { title: 'Live semanal', type: 'live' }, admin)).body;
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    await page.waitForSelector('#fixed-section:not([hidden])');
    assert.match(await page.textContent('#fixed-rooms'), /1 sala\(s\) com a chave em outro navegador/);

    await page.evaluate((id) => localStorage.setItem(`fixed-key:${id}`, 'chave-de-teste'), fixed.id);
    await page.reload();
    await page.waitForSelector('#fixed-rooms a');
    assert.match(await page.textContent('#fixed-rooms a'), /Live semanal.*Live · vazia/s);
    assert.match(await page.getAttribute('#fixed-rooms a', 'href'), /#k=chave-de-teste&h=/);
    await api(s.url, '/api/admin/rooms/delete', { id: fixed.id }, admin);
    assert.deepEqual(errors, []);
  });

  test('tudo pelo teclado: abrir a janela, fechar com Esc e criar com Enter', async () => {
    const { page } = await newPage();
    await loginInBrowser(page, s.url);
    await page.focus('#new-room');
    await page.keyboard.press('Enter');
    assert.ok(await page.isVisible('#create-dialog'));
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#create-dialog'));
    await page.focus('#new-room');
    await page.keyboard.press('Enter');
    await page.focus('#create-together');
    await page.keyboard.press('Enter');
    await page.waitForURL(/#k=/);
  });

  test('Voltar do navegador na sala leva de volta à página inicial', async () => {
    const { page } = await newPage();
    await loginInBrowser(page, s.url);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    await page.goBack();
    await page.waitForSelector('#signed-in:not([hidden])');
    assert.equal(new URL(page.url()).pathname, '/');
  });

  test('no celular nada some: criar sala e a lista de salas continuam à mão', async () => {
    const { page, errors } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await loginInBrowser(page, s.url);
    for (const id of ['#new-room', '#new-room-side', '#my-rooms', '#logout']) {
      const box = await page.locator(id).boundingBox();
      assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= 390, `${id} dentro da tela`);
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollWidth <= 390, `sem rolagem lateral (${scrollWidth}px)`);
    await page.click('#new-room');
    const cards = await page.locator('.type-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    assert.ok(cards.every((right) => right <= 390), 'cartões cabem na tela');
    assert.deepEqual(errors, []);
  });
});
