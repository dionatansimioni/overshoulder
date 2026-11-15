import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loginInBrowser, setupAdmin, startServer, waitForLiveKit, launchBrowser } from './helpers.js';

let server;
let browser;

before(async () => {
  await waitForLiveKit();
  server = await startServer(13002);
  await setupAdmin(server);
  browser = await launchBrowser({
    // Mídia falsa: microfone de teste e captura de tela aceita sozinha, sem o seletor do navegador
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
});
after(async () => {
  await browser?.close();
  server?.stop();
});

// Abre uma página nova que falha o teste em qualquer erro de JavaScript
const newPage = async () => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // A política do site bloqueia a câmera de propósito (o Overshoulder não usa câmera); o LiveKit
  // tenta enumerá-la ao mexer em dispositivos e o navegador registra o bloqueio. Não é erro do app.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Permissions policy violation: camera/.test(msg.text())) errors.push(msg.text());
  });
  return { page, errors };
};

const createRoomAsHost = async (page, name = 'Ana') => {
  await loginInBrowser(page, server.url);
  await page.click('#new-room');
  await page.click('#create-live');
  await page.waitForURL(/\/r\/[A-Za-z0-9_-]{22}#k=/);
  await page.fill('#name', name);
  await page.click('#join-form button');
  await page.waitForSelector('#room:not([hidden])');
};

const joinAsViewer = async (page, link, name = 'Beto') => {
  await page.goto(link);
  await page.fill('#name', name);
  await page.click('#join-form button');
  await page.waitForSelector('#room:not([hidden])');
};

test('página inicial carrega sem erros', async () => {
  const { page, errors } = await newPage();
  await page.goto(`${server.url}/`);
  await page.waitForSelector('#login-form:not([hidden])');
  assert.deepEqual(errors, []);
});

test('senha errada mostra erro na página', async () => {
  const { page } = await newPage();
  await page.goto(`${server.url}/`);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'errada');
  await page.click('#login-form button');
  await page.waitForSelector('#login-error:not([hidden])');
  assert.match(await page.textContent('#login-error'), /incorretos/);
});

test('link sem chave avisa e bloqueia a entrada', async () => {
  const { page } = await newPage();
  await page.goto(`${server.url}/r/${'c'.repeat(22)}`);
  assert.match(await page.textContent('#join-error'), /Link incompleto/);
  assert.ok(await page.isDisabled('#join-form button'));
});

test('anfitrião cria a sala, amigo entra e os dois conversam no chat', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  assert.ok(await host.page.isVisible('#host-controls'));
  const link = await host.page.inputValue('#invite-link');
  assert.doesNotMatch(link, /[#&]h=/, 'o convite não pode levar a chave de anfitrião');

  const viewer = await newPage();
  await joinAsViewer(viewer.page, link);
  assert.ok(await viewer.page.isVisible('#viewer-controls'));
  assert.ok(await viewer.page.isHidden('#host-controls'));

  await host.page.waitForFunction(() => document.querySelector('#count').textContent.startsWith('2'));

  await host.page.fill('#chat-input', 'oi, Beto');
  await host.page.press('#chat-input', 'Enter');
  await viewer.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('oi, Beto'));

  await viewer.page.fill('#chat-input', 'oi, Ana');
  await viewer.page.press('#chat-input', 'Enter');
  await host.page.waitForFunction(() => document.querySelector('#messages').textContent.includes('oi, Ana'));

  assert.deepEqual(host.errors, []);
  assert.deepEqual(viewer.errors, []);
});

test('anfitrião encerra a sala e o amigo é avisado', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  const viewer = await newPage();
  await joinAsViewer(viewer.page, await host.page.inputValue('#invite-link'));

  host.page.once('dialog', (d) => d.accept());
  await host.page.click('#end');
  await viewer.page.waitForFunction(() => document.querySelector('#overlay').textContent.includes('encerrada'));
});

test('painel de ajustes do anfitrião abre e fecha', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  assert.ok(await host.page.isHidden('#settings'));
  await host.page.click('#settings-btn');
  assert.ok(await host.page.isVisible('#settings'));
  assert.ok(await host.page.isVisible('#quality'));
  await host.page.keyboard.press('Escape');
  assert.ok(await host.page.isHidden('#settings'));
  await host.page.click('#settings-btn');
  await host.page.click('#player', { position: { x: 10, y: 10 } });
  assert.ok(await host.page.isHidden('#settings'));
  assert.deepEqual(host.errors, []);
});

test('mensagem do chat mostra avatar, autor e horário', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page, 'Zé');
  await host.page.fill('#chat-input', 'testando');
  await host.page.press('#chat-input', 'Enter');
  const msg = host.page.locator('#messages li.msg').last();
  assert.equal(await msg.locator('.avatar').textContent(), 'Z');
  assert.equal(await msg.locator('.author').textContent(), 'Zé');
  assert.match(await msg.locator('.time').textContent(), /\d{2}:\d{2}/);
  assert.equal(await msg.locator('.text').textContent(), 'testando');
});

test('mensagem enviada logo ao entrar chega com o nome certo', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  const viewer = await newPage();
  await joinAsViewer(viewer.page, await host.page.inputValue('#invite-link'), 'Beto');
  // Sem esperar o anfitrião ver a entrada: a mensagem pode chegar antes do aviso
  await viewer.page.fill('#chat-input', 'cheguei');
  await viewer.page.press('#chat-input', 'Enter');
  const msg = host.page.locator('#messages li.msg', { hasText: 'cheguei' });
  await msg.waitFor();
  assert.equal(await msg.locator('.author').textContent(), 'Beto');
});

test('anfitrião liga e desliga o microfone e o amigo vê o aviso', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  const viewer = await newPage();
  await joinAsViewer(viewer.page, await host.page.inputValue('#invite-link'));
  assert.ok(await viewer.page.isHidden('#mic'), 'só o anfitrião tem botão de microfone');
  assert.ok(await viewer.page.isHidden('#mic-badge'));

  await host.page.click('#mic');
  await host.page.waitForSelector('#mic.on[aria-pressed="true"]');
  await viewer.page.waitForSelector('#mic-badge:not([hidden])');

  await host.page.click('#mic');
  await host.page.waitForSelector('#mic:not(.on)[aria-pressed="false"]');
  await viewer.page.waitForSelector('#mic-badge', { state: 'hidden' });

  assert.deepEqual(host.errors, []);
  assert.deepEqual(viewer.errors, []);
});

test('lista de dispositivos preenche microfone e áudio do jogo', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  await host.page.click('#settings-btn');
  await host.page.click('#load-devices');
  await host.page.waitForFunction(() => document.querySelector('#mic-device').options.length > 1);
  assert.ok((await host.page.locator('#audio-device option').count()) > 1);
});

test('seletor de emojis insere no cursor, troca de categoria e guarda recentes', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  assert.ok(await host.page.isHidden('#emoji-picker'));

  await host.page.fill('#chat-input', 'boa partida');
  await host.page.click('#emoji-btn');
  assert.ok(await host.page.isVisible('#emoji-picker'));

  await host.page.click('#emoji-picker [data-category="jogos"]');
  await host.page.click('#emoji-picker .emoji-grid button[data-emoji="🎮"]');
  assert.equal(await host.page.inputValue('#chat-input'), 'boa partida🎮');
  assert.ok(await host.page.isVisible('#emoji-picker'), 'continua aberto para escolher mais');

  await host.page.keyboard.press('Escape');
  assert.ok(await host.page.isHidden('#emoji-picker'));

  await host.page.press('#chat-input', 'Enter');
  await host.page.locator('#messages li.msg', { hasText: 'boa partida🎮' }).waitFor();

  await host.page.click('#emoji-btn');
  await host.page.click('#emoji-picker [data-category="recentes"]');
  assert.ok(await host.page.isVisible('#emoji-picker .emoji-grid button[data-emoji="🎮"]'));
  assert.deepEqual(host.errors, []);
});

test('mensagem só com emojis aparece grande', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  for (const text of ['🎮🔥', 'gg 🔥']) {
    await host.page.fill('#chat-input', text);
    await host.page.press('#chat-input', 'Enter');
  }
  const texts = host.page.locator('#messages li.msg .text');
  await texts.nth(1).waitFor();
  assert.match(await texts.nth(0).getAttribute('class'), /jumbo/);
  assert.doesNotMatch(await texts.nth(1).getAttribute('class'), /jumbo/);
});

test('anfitrião compartilha a tela e o amigo recebe o vídeo decifrado', async () => {
  const host = await newPage();
  await createRoomAsHost(host.page);
  const viewer = await newPage();
  await joinAsViewer(viewer.page, await host.page.inputValue('#invite-link'));

  await host.page.click('#share');
  await host.page.waitForSelector('#share.on');
  await viewer.page.waitForSelector('#voice-stage', { state: 'hidden' });
  const playing = async () => viewer.page.evaluate(() => {
    const v = document.querySelector('#video');
    return { width: v.videoWidth, time: v.currentTime };
  });
  await viewer.page.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
  const before = await playing();
  await viewer.page.waitForTimeout(1500);
  const after = await playing();
  assert.ok(after.time > before.time + 1, `o vídeo avança: ${before.time} → ${after.time}`);
  await viewer.page.waitForFunction(() => /\d+×\d+ · [\d.]+ Mbps/.test(document.querySelector('#stats').textContent));

  await host.page.click('#share');
  await host.page.waitForSelector('#share:not(.on)');
  // Sem transmissão, volta a tela de quem está na sala (não uma tela preta)
  await viewer.page.waitForSelector('#voice-stage:not([hidden])');
  assert.equal(await viewer.page.textContent('#voice-hint'), 'Ninguém está transmitindo agora.');
  assert.deepEqual(host.errors, []);
  assert.deepEqual(viewer.errors, []);
});
