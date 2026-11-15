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

const newPage = async (init) => {
  const page = await (await browser.newContext({ permissions: ['microphone', 'camera'] })).newPage();
  if (init) await page.addInitScript(init);
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
const sharing = async ({ hostInit } = {}) => {
  const host = await newPage(hostInit);
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

describe('qualidade para quem assiste', () => {
  test('só as camadas que quem transmite envia; trocar vale na hora', async () => {
    const { host, viewer } = await sharing();
    await host.page.waitForFunction(() => /Transmitindo/.test(document.querySelector('#send-badge').textContent));
    const sentHeight = Number(/×(\d+)/.exec(await host.page.textContent('#send-badge'))[1]);

    await viewer.page.click('#settings-btn');
    await viewer.page.waitForSelector('#watch-quality-row:not([hidden])');
    const options = await viewer.page.$$eval('#watch-quality option', (os) => os.map((o) => o.textContent));
    assert.equal(options[0], 'Automática');
    const heights = options.slice(1).map((o) => Number(o.replace('p', '')));
    assert.ok(heights.length >= 2, `camadas: ${options}`);
    assert.ok(heights.every((h) => h <= Math.max(sentHeight, 720)), `nada acima do que é enviado (${sentHeight}p): ${options}`);

    const lowest = await viewer.page.$eval('#watch-quality', (sel) => sel.options[sel.options.length - 1].value);
    await viewer.page.selectOption('#watch-quality', lowest);
    const lowHeight = Math.min(...heights);
    await viewer.page.waitForFunction((h) => document.querySelector('#video').videoHeight <= h, lowHeight, { timeout: 20_000 });
    await viewer.page.selectOption('#watch-quality', 'auto');
    await viewer.page.waitForFunction((h) => document.querySelector('#video').videoHeight > h, lowHeight, { timeout: 20_000 });
    assert.deepEqual(viewer.errors, []);
  });
});

describe('avisos de rede para quem transmite', () => {
  // Altera as estatísticas do WebRTC sob comando do teste: banda limitada e pacotes perdidos
  const fakeNetwork = () => {
    const original = RTCRtpSender.prototype.getStats;
    window.fakeLost = 0;
    RTCRtpSender.prototype.getStats = async function () {
      const report = await original.call(this);
      const out = new Map();
      report.forEach((v, k) => {
        if (v.type === 'outbound-rtp' && window.fakeLimit) v = { ...v, qualityLimitationReason: 'bandwidth' };
        if (v.type === 'remote-inbound-rtp' && window.fakeLoss) v = { ...v, packetsLost: (window.fakeLost += 400) };
        out.set(k, v);
      });
      return out;
    };
  };

  test('banda insuficiente: avisa e oferece a qualidade de baixo', async () => {
    const { host } = await sharing();
    await host.page.evaluate(fakeNetwork);
    await host.page.click('#settings-btn');
    await host.page.selectOption('#quality', '1080p30');
    await host.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('1080p · 30 fps'));
    await host.page.keyboard.press('Escape');
    await host.page.evaluate(() => (window.fakeLimit = true));
    await host.page.waitForSelector('#net-warning:not([hidden])', { timeout: 20_000 });
    assert.equal(await host.page.textContent('#net-warning-text'), 'Sua internet não está dando conta de transmitir em 1080p · 30 fps.');
    assert.equal(await host.page.textContent('#net-warning-action'), 'Usar 720p · 60 fps');
    await host.page.evaluate(() => (window.fakeLimit = false));
    await host.page.click('#net-warning-action');
    assert.equal(await host.page.inputValue('#quality'), '720p60');
    await host.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('Transmitindo agora em 720p · 60 fps'));
    assert.ok(await host.page.isHidden('#net-warning'));
    assert.deepEqual(host.errors, []);
  });

  test('perda de pacotes alta: avisa com a porcentagem', async () => {
    const { host } = await sharing();
    await host.page.evaluate(fakeNetwork);
    await host.page.evaluate(() => (window.fakeLoss = true));
    await host.page.waitForSelector('#net-warning:not([hidden])', { timeout: 20_000 });
    assert.match(await host.page.textContent('#net-warning-text'), /^Sua conexão está perdendo muitos pacotes \(\d+%\)\./);
    assert.ok(await host.page.isHidden('#net-warning-action'));
    await host.page.click('#net-warning-close');
    assert.ok(await host.page.isHidden('#net-warning'));
  });
});

describe('áudio do jogo (Linux: "Monitor of …")', () => {
  // Como no Chrome do Linux: compartilhar a tela não traz o som do computador
  const linuxCapture = () => {
    const original = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = function (options) {
      return original.call(this, { ...options, audio: false });
    };
  };

  test('sem som da captura no Linux, o chat explica onde escolher o monitor da saída de som', async () => {
    const { host } = await sharing({ hostInit: linuxCapture });
    await host.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('Monitor of'));
  });

  test('escolher o áudio com a tela já compartilhada vale na hora, e desligar para de enviar', async () => {
    const { host, viewer } = await sharing({ hostInit: linuxCapture });
    const audios = () => viewer.page.evaluate(() => document.querySelectorAll('#audio-sink audio').length);
    assert.equal(await audios(), 0, 'sem microfone nem áudio do jogo, nada a ouvir');

    await host.page.click('#settings-btn');
    await host.page.click('#load-devices');
    await host.page.waitForFunction(() => document.querySelector('#audio-device').options.length > 1);
    const device = await host.page.$eval('#audio-device', (s) => ({ value: s.options[1].value, text: s.options[1].text }));
    await host.page.selectOption('#audio-device', device.value);
    await host.page.waitForFunction((text) => document.querySelector('#audio-status').textContent === `Enviando o áudio de: ${text}`, device.text);
    await viewer.page.waitForFunction(() => document.querySelectorAll('#audio-sink audio').length === 1);

    await host.page.selectOption('#audio-device', '');
    await host.page.waitForFunction(() => document.querySelector('#audio-status').textContent === '');
    await viewer.page.waitForFunction(() => document.querySelectorAll('#audio-sink audio').length === 0);
    assert.ok(await host.page.isVisible('#share.on'), 'a tela continua compartilhada');
    assert.deepEqual(host.errors, []);
    assert.deepEqual(viewer.errors, []);
  });
});
