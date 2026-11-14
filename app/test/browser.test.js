import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { PASSWORD, startServer, waitForLiveKit } from './helpers.js';

let server;
let browser;

before(async () => {
  await waitForLiveKit();
  server = await startServer(13002);
  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
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
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  return { page, errors };
};

const createRoomAsHost = async (page, name = 'Ana') => {
  await page.goto(`${server.url}/`);
  await page.fill('#password', PASSWORD);
  await page.click('#create button');
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
  assert.ok(await page.isVisible('#create'));
  assert.deepEqual(errors, []);
});

test('senha errada mostra erro na página', async () => {
  const { page } = await newPage();
  await page.goto(`${server.url}/`);
  await page.fill('#password', 'errada');
  await page.click('#create button');
  await page.waitForSelector('#error:not([hidden])');
  assert.match(await page.textContent('#error'), /Senha incorreta/);
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
