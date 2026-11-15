import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13230);
  await setupAdmin(s);
  // Captura de tela aceita sozinha, sem o seletor do navegador
  browser = await launchBrowser({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const newPage = async () => {
  const page = await (await browser.newContext({ permissions: ['microphone', 'camera'] })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const enter = async (page, name) => {
  await page.fill('#name', name);
  await page.click('#join-form button[type="submit"]');
  await page.waitForSelector('#room:not([hidden])');
};

// Anfitrião compartilhando a tela e um espectador assistindo
const sharing = async () => {
  const host = await newPage();
  await loginInBrowser(host.page, s.url);
  await host.page.click('#new-room');
  await host.page.click('#create-live');
  await host.page.waitForURL(/#k=/);
  await enter(host.page, 'Ana');
  const viewer = await newPage();
  await viewer.page.goto(await host.page.inputValue('#invite-link'));
  await enter(viewer.page, 'Beto');
  await host.page.click('#share');
  await host.page.waitForSelector('#share.on');
  await viewer.page.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
  return { host, viewer };
};

const viewerPlaying = async (page) => {
  const t0 = await page.evaluate(() => document.querySelector('#video').currentTime);
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(() => document.querySelector('#video').currentTime);
  return t1 > t0 + 0.8;
};

const SEND = /^Transmitindo (\d+)×(\d+) · \d+ fps · [\d,]+ Mbps$/;

describe('prévia de quem transmite', () => {
  test('o selo mostra a qualidade que está saindo de fato', async () => {
    const { host } = await sharing();
    await host.page.waitForFunction(() => /Transmitindo \d+×\d+ · \d+ fps · [\d,]+ Mbps/.test(document.querySelector('#send-badge').textContent));
    assert.match(await host.page.textContent('#send-badge'), SEND);
    assert.deepEqual(host.errors, []);
  });

  test('trocar a qualidade vale na hora, sem parar o compartilhamento nem recarregar', async () => {
    const { host, viewer } = await sharing();
    await host.page.click('#settings-btn');
    await host.page.selectOption('#quality', '720p30');
    await host.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('Transmitindo agora em 720p · 30 fps'));
    assert.ok(await host.page.isVisible('#share.on'), 'o compartilhamento continua');
    // O selo passa a mostrar no máximo 720 linhas
    await host.page.waitForFunction(() => {
      const m = /(\d+)×(\d+)/.exec(document.querySelector('#send-badge').textContent);
      return m && Number(m[2]) <= 720;
    });
    await viewer.page.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
    assert.ok(await viewerPlaying(viewer.page), 'quem assiste continua recebendo');
    assert.deepEqual(host.errors, []);
    assert.deepEqual(viewer.errors, []);
  });

  test('esconder a própria tela para de reproduzir aqui; quem assiste continua vendo', async () => {
    const { host, viewer } = await sharing();
    await host.page.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
    await host.page.click('#hide-self');
    await host.page.waitForSelector('#self-hidden:not([hidden])');
    assert.equal(await host.page.evaluate(() => document.querySelector('#video').srcObject), null, 'nada é reproduzido');
    assert.equal(await host.page.getAttribute('#hide-self', 'aria-pressed'), 'true');
    assert.ok(await viewerPlaying(viewer.page), 'quem assiste continua recebendo');

    await host.page.click('#show-self');
    await host.page.waitForSelector('#self-hidden', { state: 'hidden' });
    await host.page.waitForFunction(() => document.querySelector('#video').srcObject !== null);
    assert.equal(await host.page.evaluate(() => localStorage.getItem('hide-self')), '0');
    assert.deepEqual(host.errors, []);
  });
});
