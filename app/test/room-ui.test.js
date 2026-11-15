import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { CONNECTION_LABELS, connectionType } from '../public/connection-type.js';
import { launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let browser;

// WAV mono de 4 s: sílabas de 180 ms com 90 ms de pausa, tom entre 180 e 420 Hz, volume alto
const speechLikeWav = () => {
  const rate = 16000;
  const samples = new Int16Array(rate * 4);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const inSyllable = t % 0.27 < 0.18;
    const freq = 180 + 240 * ((Math.sin(t * 7) + 1) / 2);
    const envelope = inSyllable ? Math.sin((Math.PI * (t % 0.27)) / 0.18) : 0;
    samples[i] = Math.round(26000 * envelope * (Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(4 * Math.PI * freq * t)) / 1.4);
  }
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'overshoulder-audio-')), 'fala.wav');
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
};

before(async () => {
  await waitForLiveKit();
  s = await startServer(13220);
  await setupAdmin(s);
  // Microfone falso com "sílabas" de tom variável: o bipe padrão do Chromium é curto demais para o
  // LiveKit reconhecer como fala de forma estável
  browser = await launchBrowser({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${speechLikeWav()}`],
  });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

// Página nova que falha o teste em qualquer erro de JavaScript
const newPage = async () => {
  const page = await (await browser.newContext({ permissions: ['microphone', 'camera'] })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const hostRoom = async (type = 'live') => {
  const host = await newPage();
  await loginInBrowser(host.page, s.url);
  await host.page.click('#new-room');
  await host.page.click(`#create-${type}`);
  await host.page.waitForURL(/#k=/);
  await host.page.fill('#name', 'Ana');
  await host.page.click('#join-form button[type="submit"]');
  await host.page.waitForSelector('#room:not([hidden])');
  return host;
};

const join = async (link, name = 'Beto') => {
  const viewer = await newPage();
  await viewer.page.goto(link);
  await viewer.page.fill('#name', name);
  await viewer.page.click('#join-form button[type="submit"]');
  await viewer.page.waitForSelector('#room:not([hidden])');
  return viewer;
};

// Ids dos controles visíveis de um grupo, na ordem da tela
const visibleIds = (page, group) =>
  page.$$eval(`${group} > button, ${group} > label`, (els) =>
    els.filter((e) => e.offsetParent !== null).map((e) => e.id || e.className),
  );

describe('barra de controles', () => {
  test('quem transmite: entradas à esquerda; volume, tela cheia, gravar, ajustes e encerrar à direita', async () => {
    const host = await hostRoom();
    assert.deepEqual(await visibleIds(host.page, '#host-controls'), ['mic', 'camera', 'share']);
    const right = await visibleIds(host.page, '#viewer-controls');
    assert.deepEqual(right.filter((id) => id !== 'record'), ['volume', 'fullscreen', 'settings-btn', 'end']);
    if (right.includes('record')) assert.deepEqual(right.slice(-3), ['record', 'settings-btn', 'end']);
    const left = (await host.page.locator('#host-controls').boundingBox()).x;
    const rightX = (await host.page.locator('#viewer-controls').boundingBox()).x;
    assert.ok(left < rightX, 'entradas ficam à esquerda');

    // Resolução e taxa ficam nos ajustes, com os da transmissão
    await host.page.click('#settings-btn');
    assert.ok(await host.page.isVisible('#broadcast-settings'));
    assert.ok(await host.page.locator('#settings #stats').count(), 'a resolução e os Mbps ficam nos ajustes');
    assert.deepEqual(host.errors, []);
  });

  test('quem só assiste vê os ajustes sem as opções de transmissão, e os pedidos à esquerda', async () => {
    const host = await hostRoom('live');
    const viewer = await join(await host.page.inputValue('#invite-link'));
    assert.ok(await viewer.page.isHidden('#host-controls'));
    assert.deepEqual(await visibleIds(viewer.page, '#request-controls'), ['raise-hand', 'ask-screen']);
    await viewer.page.click('#settings-btn');
    assert.ok(await viewer.page.isVisible('#settings'));
    assert.ok(await viewer.page.isHidden('#broadcast-settings'));
    assert.deepEqual(viewer.errors, []);
  });
});

describe('microfone e sala só de voz', () => {
  test('o botão do microfone mostra o volume captado', async () => {
    const host = await hostRoom('together');
    await host.page.click('#mic');
    await host.page.waitForSelector('#mic.on');
    // O bipe do microfone falso faz o anel do botão crescer
    await host.page.waitForFunction(() => parseFloat(document.querySelector('#mic').style.getPropertyValue('--level')) > 0.1);
    await host.page.click('#mic');
    await host.page.waitForSelector('#mic:not(.on)');
    assert.equal(await host.page.evaluate(() => document.querySelector('#mic').style.getPropertyValue('--level')), '');
    assert.deepEqual(host.errors, []);
  });

  test('sem ninguém transmitindo, a tela mostra quem está na sala e destaca quem fala', async () => {
    const host = await hostRoom('together');
    assert.ok(await host.page.isVisible('#voice-stage'));
    assert.ok(await host.page.isHidden('#overlay'), 'nada de tela preta com aviso');
    assert.match(await host.page.textContent('#voice-hint'), /Ninguém está transmitindo/);
    const viewer = await join(await host.page.inputValue('#invite-link'));
    await host.page.waitForFunction(() => document.querySelectorAll('#voice-people li').length === 2);
    assert.match(await host.page.textContent('#voice-people'), /Ana \(você\).*Beto/s);

    await viewer.page.click('#mic');
    await host.page.waitForSelector('#voice-people li.speaking', { timeout: 20_000 });
    assert.match(await host.page.textContent('#voice-people li.speaking'), /Beto/);

    // Com a câmera ligada, a tela de voz dá lugar ao vídeo
    await host.page.click('#camera');
    await viewer.page.waitForSelector('#voice-stage', { state: 'hidden' });
    assert.deepEqual(host.errors, []);
    assert.deepEqual(viewer.errors, []);
  });
});

describe('tipo de conexão', () => {
  test('lê UDP, TCP e TURN das estatísticas do WebRTC', () => {
    const stats = (local, extra = {}) => [
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
      { id: 'P', type: 'candidate-pair', localCandidateId: 'L', ...extra },
      { id: 'L', type: 'local-candidate', ...local },
    ];
    assert.equal(connectionType(stats({ candidateType: 'host', protocol: 'udp' })), 'udp');
    assert.equal(connectionType(stats({ candidateType: 'srflx', protocol: 'tcp' })), 'tcp');
    assert.equal(connectionType(stats({ candidateType: 'relay', protocol: 'udp' })), 'turn');
    assert.equal(connectionType([]), null);
    // Sem o transporte, vale o par marcado como selecionado
    assert.equal(connectionType(stats({ protocol: 'tcp' }, { selected: true }).slice(1)), 'tcp');
  });

  test('anfitrião e espectador veem nos ajustes que o vídeo vai por UDP', async () => {
    const host = await hostRoom();
    const link = await host.page.inputValue('#invite-link');
    const viewer = await join(link);
    for (const { page, errors } of [host, viewer]) {
      await page.waitForFunction((text) => document.querySelector('#conn-type').textContent === text, CONNECTION_LABELS.udp, { timeout: 15000 });
      assert.deepEqual(errors, []);
    }
    assert.doesNotMatch(await viewer.page.textContent('#messages'), /UDP/);
  });
});
