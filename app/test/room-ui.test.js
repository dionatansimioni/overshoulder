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
  page.$$eval(`${group} > button, ${group} > .volume`, (els) =>
    els.filter((e) => e.offsetParent !== null).map((e) => e.id || e.className),
  );

describe('barra de controles', () => {
  test('quem transmite: entradas à esquerda; volume, tela cheia, gravar, ajustes e encerrar à direita', async () => {
    const host = await hostRoom();
    assert.deepEqual(await visibleIds(host.page, '#host-controls'), ['mic', 'camera', 'share']);
    const right = await visibleIds(host.page, '#viewer-controls');
    assert.deepEqual(right.filter((id) => id !== 'record'), ['volume-box', 'fullscreen', 'chat-hide', 'settings-btn', 'end']);
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
    // Na Live, os pedidos só aparecem depois de o anfitrião ligar cada um
    assert.ok(await viewer.page.isHidden('#request-controls'), 'sem pedidos até o anfitrião ligar');
    await host.page.click('#tab-people');
    await host.page.check('#allow-speak');
    await viewer.page.waitForSelector('#raise-hand:not([hidden])');
    assert.ok(await viewer.page.isHidden('#ask-screen'), 'só o pedido que o anfitrião ligou');
    await host.page.check('#allow-screen');
    await viewer.page.waitForSelector('#ask-screen:not([hidden])');
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

describe('interface da sala', () => {
  test('convite em botões: o link não aparece, copiar avisa onde colar', async () => {
    const host = await hostRoom('live');
    await host.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: s.url });
    assert.ok(await host.page.isHidden('#invite-link'), 'o link completo não ocupa a tela');
    for (const id of ['#copy', '#new-link']) {
      assert.ok(await host.page.isVisible(`${id} svg.icon`), `${id} com ícone`);
    }
    await host.page.click('#copy');
    await host.page.waitForSelector('#toast:not([hidden])');
    assert.match(await host.page.textContent('#toast'), /Cole no Discord, no WhatsApp ou onde quiser/);
    assert.equal(await host.page.textContent('#copy .label'), 'Copiado!');
    assert.equal(await host.page.evaluate(() => navigator.clipboard.readText()), await host.page.inputValue('#invite-link'));
    assert.deepEqual(host.errors, []);
  });

  test('o ícone do volume liga e desliga o som sem perder o volume escolhido', async () => {
    const host = await hostRoom('live');
    await host.page.click('#mic');
    await host.page.waitForSelector('#mic.on');
    const viewer = await join(await host.page.inputValue('#invite-link'));
    // A voz da anfitriã chega como um <audio>; o mudo zera o volume dele
    await viewer.page.waitForSelector('#audio-sink audio', { state: 'attached' });
    const volumes = () => viewer.page.$$eval('#audio-sink audio', (els) => els.map((e) => e.volume));
    await viewer.page.$eval('#volume', (e) => {
      e.value = '0.5';
      e.dispatchEvent(new Event('input'));
    });
    assert.deepEqual(await volumes(), [0.5]);

    await viewer.page.click('#mute');
    assert.equal(await viewer.page.getAttribute('#mute', 'aria-pressed'), 'true');
    assert.equal(await viewer.page.getAttribute('#mute use', 'href'), '#i-volume-off');
    assert.deepEqual(await volumes(), [0]);
    assert.equal(await viewer.page.inputValue('#volume'), '0.5', 'o volume escolhido fica guardado');

    await viewer.page.click('#mute');
    assert.equal(await viewer.page.getAttribute('#mute', 'aria-pressed'), 'false');
    assert.deepEqual(await volumes(), [0.5]);
    assert.deepEqual(viewer.errors, []);
  });

  test('quem só assiste não vê sobre o vídeo quem apresenta nem o microfone ligado', async () => {
    const host = await hostRoom('live');
    await host.page.click('#mic');
    await host.page.click('#camera');
    await host.page.waitForSelector('#camera.on');
    const viewer = await join(await host.page.inputValue('#invite-link'));
    await viewer.page.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
    await viewer.page.waitForTimeout(500);
    assert.ok(await viewer.page.isHidden('#presenter-badge'));
    assert.ok(await viewer.page.isHidden('#mic-badge'));
    assert.deepEqual(viewer.errors, []);
  });

  test('o anfitrião tem a aba Registro com entradas e saídas; quem assiste não', async () => {
    const host = await hostRoom('live');
    assert.ok(await host.page.isVisible('#tab-log'));
    const viewer = await join(await host.page.inputValue('#invite-link'));
    assert.ok(await viewer.page.isHidden('#tab-log'), 'quem assiste não tem registro');

    await host.page.waitForFunction(() => /Beto entrou/.test(document.querySelector('#log').textContent));
    assert.doesNotMatch(await host.page.textContent('#messages'), /Beto entrou/, 'o chat fica só com as conversas');
    assert.equal(await host.page.textContent('#log-count'), '1', 'aviso de evento novo na aba');
    await host.page.click('#tab-log');
    assert.ok(await host.page.isVisible('#log'));
    assert.ok(await host.page.isHidden('#messages'));
    assert.ok(await host.page.isHidden('#log-count'), 'abrir a aba zera o aviso');
    // Ordem das abas: chat, pessoas, registro
    assert.deepEqual(await host.page.$$eval('.chat-header .tab:not([hidden])', (els) => els.map((e) => e.id)), ['tab-chat', 'tab-people', 'tab-log']);
    assert.deepEqual([...host.errors, ...viewer.errors], []);
  });

  test('pessoas na sala: um olho e o número', async () => {
    const host = await hostRoom('live');
    assert.ok(await host.page.isVisible('#count svg.icon'));
    assert.equal(await host.page.textContent('#count'), '1');
    assert.equal(await host.page.getAttribute('#count', 'title'), '1 pessoa na sala');
    await join(await host.page.inputValue('#invite-link'));
    await host.page.waitForFunction(() => document.querySelector('#count').textContent === '2');
    assert.equal(await host.page.getAttribute('#count', 'aria-label'), '2 pessoas na sala');
  });

  test('esconder o chat deixa o vídeo com a largura toda', async () => {
    const host = await hostRoom('live');
    const before = (await host.page.locator('#player').boundingBox()).width;
    await host.page.click('#chat-hide');
    assert.ok(await host.page.isHidden('.chat'));
    assert.equal(await host.page.getAttribute('#chat-hide', 'aria-pressed'), 'true');
    assert.ok((await host.page.locator('#player').boundingBox()).width > before + 200, 'o vídeo cresce');
    await host.page.click('#chat-hide');
    assert.ok(await host.page.isVisible('.chat'));
    assert.deepEqual(host.errors, []);
  });
});

describe('destaque da pergunta (Live)', () => {
  test('o anfitrião põe a pergunta do chat sobre o vídeo; quem entra depois também vê; só ele tira', async () => {
    const host = await hostRoom('live');
    const link = await host.page.inputValue('#invite-link');
    const viewer = await join(link);
    await viewer.page.fill('#chat-input', 'Qual build você está usando?');
    await viewer.page.press('#chat-input', 'Enter');
    const msg = host.page.locator('#messages li.msg', { hasText: 'Qual build' });
    await msg.waitFor();
    assert.equal(await viewer.page.locator('#messages .msg-highlight').count(), 0, 'quem assiste não destaca');

    await msg.hover();
    await msg.locator('.msg-highlight').click();
    assert.equal(await msg.locator('.msg-highlight').getAttribute('aria-pressed'), 'true');
    for (const page of [host.page, viewer.page]) {
      await page.waitForSelector('#highlight:not([hidden])');
      assert.equal(await page.textContent('#highlight-author'), 'Beto');
      assert.equal(await page.textContent('#highlight-text'), 'Qual build você está usando?');
    }
    assert.ok(await host.page.isVisible('#highlight-close'));
    assert.ok(await viewer.page.isHidden('#highlight-close'), 'quem assiste não tira o destaque');

    // Quem entra depois recebe o destaque que já está na tela
    const late = await join(link, 'Carla');
    await late.page.waitForSelector('#highlight:not([hidden])');
    assert.equal(await late.page.textContent('#highlight-text'), 'Qual build você está usando?');

    await host.page.click('#highlight-close');
    for (const page of [host.page, viewer.page, late.page]) await page.waitForSelector('#highlight', { state: 'hidden' });
    assert.equal(await msg.locator('.msg-highlight').getAttribute('aria-pressed'), 'false');
    assert.deepEqual([...host.errors, ...viewer.errors, ...late.errors], []);
  });

  test('na sala Jogando juntos não há destaque', async () => {
    const host = await hostRoom('together');
    const viewer = await join(await host.page.inputValue('#invite-link'));
    await viewer.page.fill('#chat-input', 'oi');
    await viewer.page.press('#chat-input', 'Enter');
    await host.page.locator('#messages li.msg', { hasText: 'oi' }).waitFor();
    assert.equal(await host.page.locator('#messages .msg-highlight').count(), 0);
  });
});

describe('link velho', () => {
  test('sala encerrada: em vez da entrada, o aviso com a volta para a página inicial', async () => {
    const host = await hostRoom('live');
    const link = await host.page.inputValue('#invite-link');
    host.page.once('dialog', (d) => d.accept());
    await host.page.click('#end');
    await host.page.waitForURL((url) => new URL(url).pathname === '/');

    const { page, errors } = await newPage();
    await page.goto(link);
    await page.waitForSelector('#ended:not([hidden])');
    assert.ok(await page.isHidden('#join'), 'sem prévia de câmera nem nome');
    assert.equal(await page.textContent('#ended-title'), 'Essa sala não existe mais');
    assert.match(await page.textContent('#ended-text'), /fale com o anfitrião/);
    assert.equal(await page.getAttribute('#ended-home', 'href'), '/');
    await page.waitForSelector('#ended-host:not([hidden])');
    assert.equal(await page.getAttribute('#ended-host a', 'href'), '/login', 'o anfitrião entra na conta');
    assert.deepEqual(errors, []);
  });

  test('quem tem conta não vê o convite para entrar; sala que existe abre a entrada normal', async () => {
    const host = await hostRoom('live');
    const link = await host.page.inputValue('#invite-link');
    await host.page.goto(`${s.url}/r/${'b'.repeat(22)}#k=${'c'.repeat(43)}`);
    await host.page.waitForSelector('#ended:not([hidden])');
    await host.page.waitForFunction(() => document.querySelector('#ended-host').hidden);

    const { page } = await newPage();
    await page.goto(link);
    await page.waitForLoadState('networkidle');
    assert.ok(await page.isVisible('#join'));
    assert.ok(await page.isHidden('#ended'));
  });
});
