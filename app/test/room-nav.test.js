import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13250);
  await setupAdmin(s);
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const newPage = async (options = {}) => {
  const page = await (await browser.newContext({ permissions: ['microphone', 'camera'], ...options })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const hostRoom = async (options) => {
  const host = await newPage(options);
  await loginInBrowser(host.page, s.url);
  await host.page.click('#new-room');
  await host.page.click('#create-together');
  await host.page.waitForURL(/#k=/);
  await host.page.fill('#name', 'Ana');
  await host.page.click('#join-form button[type="submit"]');
  await host.page.waitForSelector('#room:not([hidden])');
  return host;
};

describe('gaveta lateral na sala', () => {
  test('quem tem conta abre a gaveta: salas (a atual marcada), administração e Esc para fechar', async () => {
    const { page, errors } = await hostRoom();
    await page.waitForSelector('#nav-toggle:not([hidden])');
    assert.ok(await page.isHidden('#room-nav'));
    await page.click('#nav-toggle');
    assert.ok(await page.isVisible('#room-nav'));
    assert.equal(await page.getAttribute('#nav-toggle', 'aria-expanded'), 'true');
    await page.waitForSelector('#nav-rooms a[aria-current="page"]');
    assert.ok(await page.isVisible('#nav-admin'), 'o admin vê a administração');
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#room-nav'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'nav-toggle', 'o foco volta ao botão');
    assert.deepEqual(errors, []);
  });

  test('Administração e Minha conta abrem em outra aba: a live continua, e Voltar fecha a aba', async () => {
    const { page, errors } = await hostRoom();
    await page.click('#nav-toggle');
    for (const id of ['#nav-admin', '#nav-account']) {
      assert.equal(await page.getAttribute(id, 'target'), '_blank');
      assert.equal(await page.getAttribute(id, 'title'), 'Abre em outra aba: a live continua');
    }
    // Sem pergunta de sair da sala: nada é interrompido
    let asked = false;
    page.on('dialog', (d) => {
      asked = true;
      d.dismiss();
    });
    const [admin] = await Promise.all([page.context().waitForEvent('page'), page.click('#nav-admin')]);
    await admin.waitForSelector('#geral:not([hidden])');
    assert.equal(asked, false);
    assert.ok(await page.isVisible('#room'), 'a sala segue aberta na outra aba');
    assert.match(page.url(), /\/r\//);
    await Promise.all([admin.waitForEvent('close'), admin.click('[data-back]')]);
    assert.ok(admin.isClosed(), 'Voltar fecha a aba e a sala reaparece');
    assert.deepEqual(errors, []);
  });

  test('quem entra só pelo link, sem conta, não vê a gaveta', async () => {
    const host = await hostRoom();
    const viewer = await newPage();
    await viewer.page.goto(await host.page.inputValue('#invite-link'));
    await viewer.page.fill('#name', 'Beto');
    await viewer.page.click('#join-form button[type="submit"]');
    await viewer.page.waitForSelector('#room:not([hidden])');
    await viewer.page.waitForTimeout(500);
    assert.ok(await viewer.page.isHidden('#nav-toggle'));
  });

  test('o anfitrião confirma antes de sair por um link da gaveta', async () => {
    const { page } = await hostRoom();
    await page.click('#nav-toggle');
    page.once('dialog', (d) => d.dismiss());
    await page.click('#room-nav a[href="/"]');
    await page.waitForTimeout(500);
    assert.match(page.url(), /\/r\//, 'cancelou: continua na sala');
    page.once('dialog', (d) => d.accept());
    await page.click('#room-nav a[href="/"]');
    await page.waitForURL(`${s.url}/`);
  });

  test('"Criar sala" na gaveta leva à página inicial com a janela de criar aberta', async () => {
    const { page } = await hostRoom();
    await page.click('#nav-toggle');
    page.once('dialog', (d) => d.accept());
    await page.click('#room-nav a[href="/#criar"]');
    await page.waitForURL(`${s.url}/`);
    await page.waitForSelector('#create-dialog[open]');
  });

  test('no celular a gaveta cabe na tela', async () => {
    const { page, errors } = await hostRoom({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.click('#nav-toggle');
    // A gaveta desliza ao abrir: mede depois que a animação termina
    await page.locator('#room-nav').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await page.locator('#room-nav').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'gaveta dentro da tela');
    await page.click('#nav-backdrop', { position: { x: 380, y: 400 } });
    assert.ok(await page.isHidden('#room-nav'), 'tocar fora fecha');
    assert.deepEqual(errors, []);
  });
});
