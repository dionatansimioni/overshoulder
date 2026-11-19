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
    assert.deepEqual(token.body.room, { type: 'live', private: false }, 'sem tipo informado, a sala é Live');
    await api(s.url, '/api/rooms/end', { roomId: room.roomId, hostKey: room.hostKey });

    const fixed = (await api(s.url, '/api/admin/rooms', { title: 'Sala do clã', type: 'together' }, admin)).body;
    const fixedToken = await api(s.url, '/api/token', { roomId: fixed.roomId, name: 'Beto' });
    assert.deepEqual(fixedToken.body.room, { type: 'together', private: false, title: 'Sala do clã' });
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
    assert.ok(await page.isVisible('#join-copy'), 'o botão de copiar o convite já está na tela');
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

    // Esquecer é destrutivo: o X fica vermelho com o mouse em cima
    await home.hover('#my-rooms button.forget');
    await home.waitForTimeout(250);
    const [r, g] = (await home.$eval('#my-rooms button.forget', (b) => getComputedStyle(b).color)).match(/\d+/g).map(Number);
    assert.ok(r > 200 && g < 140, `X vermelho no hover (rgb ${r}, ${g})`);
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
    // Ao encerrar, o anfitrião volta sozinho para a página inicial (o aviso do LiveKit pode chegar antes da
    // resposta de /api/rooms/end, e a navegação cancela essa resposta: por isso o teste espera só a URL)
    await page.click('#end');
    await page.waitForURL(`${s.url}/`);
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

  test('Configurações reúne Minha conta e Administração num menu; Sair é um botão', async () => {
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    assert.ok(await page.isHidden('#settings-menu'));
    assert.equal(await page.getAttribute('#settings-menu-btn', 'aria-expanded'), 'false');
    await page.click('#settings-menu-btn');
    assert.ok(await page.isVisible('#settings-menu'));
    assert.equal(await page.getAttribute('#settings-menu-btn', 'aria-expanded'), 'true');
    const items = await page.$$eval('#settings-menu [role="menuitem"]:not([hidden])', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href')]));
    assert.deepEqual(items, [['Minha conta', '/account'], ['Administração', '/admin']]);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/account', 'o foco vai ao primeiro item');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-link');
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#settings-menu'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-menu-btn');
    // Clicar fora fecha
    await page.click('#settings-menu-btn');
    await page.click('.app-main', { position: { x: 5, y: 5 } });
    assert.ok(await page.isHidden('#settings-menu'));
    assert.equal(await page.locator('.side-footer a[href="/account"]:visible').count(), 0, 'conta e administração só no menu');
    assert.doesNotMatch((await page.getAttribute('#logout', 'class')) ?? '', /\blink\b/, 'Sair é um botão, não um link');
    for (const sel of ['#settings-menu-btn', '#logout', '#new-room-side']) assert.ok(await page.isVisible(`${sel} svg.icon`), `${sel} com ícone`);
    await page.click('#settings-menu-btn');
    await page.click('#admin-link');
    await page.waitForURL(`${s.url}/admin`);
    assert.deepEqual(errors, []);
  });

  test('suas salas: ícone do tipo e dois cliques para renomear (Enter ou clicar fora salva, Esc desiste)', async () => {
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    const rooms = await page.evaluate(async () => {
      const make = (type) => fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }).then((r) => r.json());
      const [together, live] = [await make('together'), await make('live')];
      const entry = (r, type, at) => ({ code: r.roomId, k: 'k'.repeat(43), h: r.hostKey, type, at });
      localStorage.setItem('rooms', JSON.stringify([entry(together, 'together', 2), entry(live, 'live', 1)]));
      return [together.roomId, live.roomId];
    });
    await page.reload();
    await page.waitForSelector('#my-rooms li .room-type');
    assert.deepEqual(await page.$$eval('#my-rooms .room-type', (els) => els.map((e) => e.className)), ['room-type type-together', 'room-type type-live']);
    assert.equal(await page.locator('#my-rooms .room-type svg.icon').count(), 2);
    const name = page.locator('#my-rooms li').first().locator('b');
    assert.equal(await name.getAttribute('title'), 'Dê dois cliques para renomear');

    await name.dblclick();
    const input = page.locator('#my-rooms input.room-rename');
    await input.waitFor();
    assert.equal(new URL(page.url()).pathname, '/', 'dois cliques não abrem a sala');
    await input.fill('Ranked com a galera');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#my-rooms li b').textContent === 'Ranked com a galera');
    // Fica guardado no navegador e sobrevive à atualização da lista
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#my-rooms li b')?.textContent === 'Ranked com a galera');

    // Clicar fora também salva; Esc desiste
    await page.locator('#my-rooms li').nth(1).locator('b').dblclick();
    await page.locator('#my-rooms input.room-rename').fill('Live de sexta');
    await page.click('.app-main', { position: { x: 5, y: 5 } });
    await page.waitForFunction(() => document.querySelectorAll('#my-rooms li b')[1].textContent === 'Live de sexta');
    await page.locator('#my-rooms li').nth(1).locator('b').dblclick();
    await page.locator('#my-rooms input.room-rename').fill('outro');
    await page.locator('#my-rooms input.room-rename').press('Escape');
    assert.equal(await page.locator('#my-rooms li b').nth(1).textContent(), 'Live de sexta');
    // Nome vazio volta ao nome original
    await page.locator('#my-rooms li').first().locator('b').dblclick();
    await page.locator('#my-rooms input.room-rename').fill('');
    await page.locator('#my-rooms input.room-rename').press('Enter');
    await page.waitForFunction(() => document.querySelector('#my-rooms li b').textContent === 'Sua sala');

    // Um clique só abre a sala
    await page.locator('#my-rooms li').first().locator('b').click();
    await page.waitForURL(new RegExp(`/r/${rooms[0]}`));
    assert.deepEqual(errors, []);
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

describe('sala privada', () => {
  let p;
  let pAdmin;
  before(async () => {
    // Tolerância curta para o teste não esperar 30 s
    p = await startServer(13175, { PRIVATE_GRACE_MS: '1500' });
    pAdmin = await setupAdmin(p);
  });
  after(() => p?.stop());

  const privStatus = async (code) => (await api(p.url, '/api/rooms/status', { codes: [code] }, pAdmin)).body.status[code];

  test('API: cria privada, o token avisa e valor de tipo errado é recusado', async () => {
    const r = await api(p.url, '/api/rooms', { type: 'live', private: true }, pAdmin);
    assert.equal(r.status, 201);
    assert.equal(r.body.private, true);
    const token = await api(p.url, '/api/token', { roomId: r.body.roomId, name: 'Beto' });
    assert.deepEqual(token.body.room, { type: 'live', private: true });
    for (const value of ['sim', 1, null, {}]) {
      assert.equal((await api(p.url, '/api/rooms', { private: value }, pAdmin)).status, 400, JSON.stringify(value));
    }
    assert.equal((await api(p.url, '/api/rooms', {}, pAdmin)).body.private, false, 'por padrão não é privada');
  });

  test('acaba quando o anfitrião sai e passa a tolerância; antes de ele entrar, não acaba', async () => {
    const { page } = await newPage();
    await loginInBrowser(page, p.url);
    await page.click('#new-room');
    await page.click('#more-options summary');
    await page.check('#private-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    const code = new URL(page.url()).pathname.split('/').pop();

    // Ainda na antessala: o anfitrião nunca entrou, a sala espera
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal((await privStatus(code)).exists, true, 'sem o anfitrião ter entrado, a sala continua');

    await enterRoom(page);
    await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('Sala privada'));
    assert.equal(await page.evaluate(() => localStorage.getItem('rooms')), null, 'não fica guardada no navegador');

    // Fechar a aba como no navegador de verdade: a página avisa a saída ao servidor
    await page.close({ runBeforeUnload: true });
    // A vigia confere a cada 2 s; com a tolerância de 1,5 s, a sala some em poucos segundos
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      await new Promise((r) => setTimeout(r, 500));
      gone = !(await privStatus(code)).exists;
    }
    assert.ok(gone, 'a sala acabou depois que o anfitrião saiu');
  });

  test('recarregar a página dentro da tolerância não derruba a sala', async () => {
    const q = await startServer(13176, { PRIVATE_GRACE_MS: '8000' });
    try {
      await setupAdmin(q);
      const { page } = await newPage();
      await loginInBrowser(page, q.url);
      await page.click('#new-room');
      await page.click('#more-options summary');
      await page.check('#private-room');
      await page.click('#create-together');
      await page.waitForURL(/#k=/);
      await enterRoom(page);
      await page.reload();
      await enterRoom(page);
      assert.ok(await page.isVisible('#end'), 'continua anfitrião depois de recarregar');
    } finally {
      q.stop();
    }
  });

  test('ao sair com "esquecer as salas", a lista deste navegador fica vazia', async () => {
    const { page } = await newPage();
    await loginInBrowser(page, s.url);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    await page.goto(s.url);
    await page.waitForSelector('#my-rooms li');
    await page.check('#forget-on-logout');
    await page.click('#logout');
    await page.waitForSelector('#login-form:not([hidden])');
    assert.equal(await page.evaluate(() => localStorage.getItem('rooms')), '[]');
  });
});

describe('aviso de saída do anfitrião (segurança)', () => {
  test('só o anfitrião avisa, e a identidade precisa ter o formato do servidor', async () => {
    const room = await createRoom(s.url, admin);
    const call = (body) => api(s.url, '/api/rooms/host-left', { roomId: room.roomId, ...body });
    assert.equal((await call({ hostKey: 'errada', identity: 'h-0123456789ab' })).status, 403);
    for (const identity of [undefined, 42, 'v-0123456789ab', 'h-xyz', 'h-0123456789ab; drop', ['h-0123456789ab']]) {
      assert.equal((await call({ hostKey: room.hostKey, identity })).status, 400, JSON.stringify(identity));
    }
    assert.equal((await call({ hostKey: room.hostKey, identity: 'h-0123456789ab' })).status, 200);
    await api(s.url, '/api/rooms/end', { roomId: room.roomId, hostKey: room.hostKey });
  });
});
