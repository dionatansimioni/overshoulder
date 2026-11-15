import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13190);
  await setupAdmin(s);
  // Câmera e microfone falsos do Chromium: imagem de teste e um bipe
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

// Página nova que falha o teste em qualquer erro de JavaScript
const newPage = async (options = {}) => {
  const page = await (await browser.newContext({ permissions: ['microphone', 'camera'], ...options })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const createRoom = async (page, type) => {
  await loginInBrowser(page, s.url);
  await page.click('#new-room');
  await page.click(`#create-${type}`);
  await page.waitForURL(/#k=/);
};

const pressed = (page, id) => page.getAttribute(id, 'aria-pressed');
// Ligar pede a mídia ao navegador, que responde depois do clique
const turnedOn = (page, id) => page.waitForSelector(`${id}[aria-pressed="true"]`);
const cameraPlaying = (page) =>
  page.waitForFunction(() => {
    const v = document.querySelector('#preview-video');
    return v.srcObject && v.videoWidth > 0;
  });

describe('antessala', () => {
  test('nada é ligado sem clique; a câmera e o microfone ligam na prévia', async () => {
    const { page, errors } = await newPage();
    await createRoom(page, 'live');
    assert.equal(await page.evaluate(() => document.querySelector('#preview-video').srcObject), null);
    assert.ok(await page.isVisible('#preview-off'));
    assert.ok(await page.isHidden('#preview-devices'), 'sem permissão, a lista de dispositivos não aparece');
    assert.equal(await pressed(page, '#preview-camera'), 'false');

    await page.click('#preview-camera');
    await cameraPlaying(page);
    assert.equal(await pressed(page, '#preview-camera'), 'true');
    assert.ok(await page.isHidden('#preview-off'));
    await page.waitForSelector('#preview-devices:not([hidden])');
    assert.ok((await page.locator('#preview-camera-device option').count()) > 1, 'lista as câmeras');

    await page.click('#preview-mic');
    await turnedOn(page, '#preview-mic');
    // O bipe do microfone falso faz a barra de volume subir
    await page.waitForFunction(() => parseFloat(document.querySelector('#mic-level').style.width) > 0);

    await page.click('#preview-camera');
    assert.equal(await pressed(page, '#preview-camera'), 'false');
    assert.equal(await page.evaluate(() => document.querySelector('#preview-video').srcObject), null);
    assert.deepEqual(errors, []);
  });

  test('o anfitrião entra com microfone e câmera ligados na prévia, e a prévia é desligada', async () => {
    const { page, errors } = await newPage();
    await createRoom(page, 'live');
    await page.click('#preview-camera');
    await cameraPlaying(page);
    await page.click('#preview-mic');
    await page.fill('#name', 'Ana');
    await page.click('#join-form button[type="submit"]');
    await page.waitForSelector('#room:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#mic').getAttribute('aria-pressed') === 'true');
    await page.waitForFunction(() => document.querySelector('#camera').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.evaluate(() => document.querySelector('#preview-video').srcObject), null, 'prévia desligada');
    assert.deepEqual(errors, []);
  });

  test('na Live, quem assiste entra com o microfone desligado e é avisado', async () => {
    const host = await newPage();
    await createRoom(host.page, 'live');
    await host.page.fill('#name', 'Ana');
    await host.page.click('#join-form button[type="submit"]');
    await host.page.waitForSelector('#room:not([hidden])');

    const viewer = await newPage();
    await viewer.page.goto(await host.page.inputValue('#invite-link'));
    assert.ok(await viewer.page.isHidden('#join-invite'), 'o convite só aparece para o anfitrião');
    await viewer.page.click('#preview-mic');
    await viewer.page.click('#preview-camera');
    await cameraPlaying(viewer.page);
    await viewer.page.fill('#name', 'Beto');
    await viewer.page.click('#join-form button[type="submit"]');
    await viewer.page.waitForSelector('#room:not([hidden])');
    await viewer.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('Seu microfone fica desligado'));
    assert.match(await viewer.page.textContent('#messages'), /Sua câmera fica desligada/);
    assert.notEqual(await pressed(viewer.page, '#mic'), 'true');
    assert.deepEqual(viewer.errors, []);
  });

  test('pelo teclado: Tab chega aos botões da prévia e Espaço liga', async () => {
    const { page } = await newPage();
    await createRoom(page, 'together');
    await page.focus('#preview-mic');
    await page.keyboard.press('Space');
    await turnedOn(page, '#preview-mic');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preview-camera');
  });

  test('no celular, prévia e formulário cabem na tela', async () => {
    const { page, errors } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await createRoom(page, 'together');
    for (const id of ['.preview-video', '#preview-camera', '#name', '#join-form button[type="submit"]', '#join-copy']) {
      const box = await page.locator(id).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `${id} dentro da tela`);
    }
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'sem rolagem lateral');
    assert.deepEqual(errors, []);
  });
});
