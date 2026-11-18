import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13210);
  await setupAdmin(s);
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

// Página nova que falha o teste em qualquer erro de JavaScript
const newPage = async (options = {}) => {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'], ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { context, page, errors };
};

const hostRoom = async (page) => {
  await loginInBrowser(page, s.url);
  await page.click('#new-room');
  await page.click('#create-live');
  await page.waitForURL(/#k=/);
  await page.fill('#name', 'Ana');
  await page.click('#join-form button[type="submit"]');
  await page.waitForSelector('#room:not([hidden])');
};

describe('app instalável (PWA)', () => {
  test('manifesto na raiz, com nome, tela cheia e ícones que existem', async () => {
    const r = await fetch(`${s.url}/manifest.webmanifest`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/manifest+json');
    const m = await r.json();
    assert.equal(m.name, 'Overshoulder');
    assert.equal(m.start_url, '/');
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'ícone para Android');
    for (const icon of m.icons) {
      const res = await fetch(s.url + icon.src);
      assert.equal(res.status, 200, icon.src);
      assert.equal(res.headers.get('content-type'), icon.type, icon.src);
    }
  });

  test('toda página aponta o manifesto e a cor do app', () => {
    for (const file of fs.readdirSync('public').filter((f) => f.endsWith('.html') && f !== 'offline.html')) {
      const html = fs.readFileSync(`public/${file}`, 'utf8');
      assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/, file);
      assert.match(html, /<meta name="theme-color"/, file);
    }
  });

  test('service worker na raiz controla o site e, sem internet, mostra a página própria', async () => {
    const r = await fetch(`${s.url}/sw.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);

    const { context, page, errors } = await newPage();
    await page.goto(s.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'o service worker controla a página');

    await context.setOffline(true);
    await page.goto(`${s.url}/account`);
    await page.waitForSelector('#retry');
    assert.equal(await page.textContent('h2'), 'Sem conexão');
    assert.match(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), /rgb\(16, 13, 22\)/, 'com o visual do app');
    await context.setOffline(false);
    assert.deepEqual(errors, []);
  });

  test('o service worker não guarda a API nem as páginas', async () => {
    const sw = await (await fetch(`${s.url}/sw.js`)).text();
    assert.doesNotMatch(sw, /\/api\//);
    const { page } = await newPage();
    await page.goto(s.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) out.push(new URL(req.url).pathname);
      return out.sort();
    });
    assert.deepEqual(cached, ['/static/i18n.js', '/static/icon.svg', '/static/offline.html', '/static/offline.js', '/static/style.css']);
  });
});

describe('celular', () => {
  test('sem compartilhar tela no navegador, o botão fica desligado e o chat aponta o guia', async () => {
    const { page, errors } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.addInitScript(() => {
      delete MediaDevices.prototype.getDisplayMedia;
    });
    await hostRoom(page);
    assert.ok(await page.isDisabled('#share'));
    await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('/mobile'));
    assert.ok(await page.isEnabled('#camera'), 'a câmera continua disponível');
    assert.deepEqual(errors, []);
  });

  test('o guia do celular abre e explica scrcpy e AirPlay', async () => {
    const { page, errors } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await page.goto(`${s.url}/mobile`);
    const text = await page.textContent('main');
    assert.match(text, /scrcpy/);
    assert.match(text, /AirPlay/);
    assert.match(text, /Adicionar à Tela de Início/);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'sem rolagem lateral');
    assert.deepEqual(errors, []);
  });

  test('no iPhone, tela cheia usa o vídeo (webkitEnterFullscreen)', async () => {
    const { page, errors } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.addInitScript(() => {
      delete Element.prototype.requestFullscreen;
      HTMLVideoElement.prototype.webkitEnterFullscreen = function () {
        window.iosFullscreen = this.id;
      };
    });
    await hostRoom(page);
    await page.click('#fullscreen');
    assert.equal(await page.evaluate(() => window.iosFullscreen), 'video');
    assert.deepEqual(errors, []);
  });

  test('deitado, com vídeo tocando, o vídeo ocupa a altura e nada sai da tela', async () => {
    const { page, errors } = await newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await hostRoom(page);
    // Com vídeo de verdade, o tamanho natural dele (540 px) não pode esticar a sala
    await page.click('#camera');
    await page.waitForFunction(() => document.querySelector('#video').videoHeight > 0);
    const player = await page.locator('#player').boundingBox();
    assert.ok(player.height > 200, `vídeo alto o bastante (${player.height}px)`);
    for (const id of ['#player', '#invite-link', '#chat-input', '#fullscreen', '#share', '#camera']) {
      const box = await page.locator(id).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 844, `${id} dentro da tela na horizontal`);
      assert.ok(box.y >= 0 && box.y + box.height <= 390, `${id} dentro da tela na vertical (${box.y}+${box.height})`);
    }
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 844, 'sem rolagem lateral');
    assert.deepEqual(errors, []);
  });
});
