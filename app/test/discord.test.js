import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ADMIN, api, get, launchBrowser, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

// Webhook falso, no formato do Discord (id numérico e token)
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${'a1B2-c3_D4'.repeat(6)}`;
const BIA = { username: 'bia', password: 'transmissora de domingo' };

let s;
let admin;
before(async () => {
  await waitForLiveKit();
  s = await startServer(13251);
  admin = await setupAdmin(s);
});
after(() => s?.stop());

const save = (webhook, who = admin) => api(s.url, '/api/admin/discord', { webhook }, who);
const broadcaster = async () => {
  const inv = (await api(s.url, '/api/admin/invites', {}, admin)).body;
  const r = await api(s.url, '/api/invites/accept', { token: inv.path.split('#')[1], ...BIA });
  return { cookie: sessionFrom(r) };
};

describe('webhook do Discord (API)', () => {
  test('só o admin salva; o endereço é validado e normalizado para discord.com', async () => {
    assert.equal((await api(s.url, '/api/admin/discord', { webhook: WEBHOOK })).status, 401);
    for (const bad of [
      'http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
      'https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
      'https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
      'https://discord.com/api/webhooks/123/curto',
      'https://discord.com/api/webhooks/123456789012345678/../../users/@me',
      'javascript:alert(1)',
      `${WEBHOOK}?wait=true`,
      'x'.repeat(400),
    ]) {
      assert.equal((await save(bad)).status, 400, bad);
    }
    for (const wrongType of [null, 42, ['x'], { a: 1 }]) assert.equal((await save(wrongType)).status, 400);

    const old = WEBHOOK.replace('https://discord.com', 'https://discordapp.com');
    const r = await save(old);
    assert.equal(r.status, 200);
    assert.equal(r.body.webhook, WEBHOOK);
  });

  test('quem tem conta lê o webhook; quem não tem, não', async () => {
    await save(WEBHOOK);
    assert.equal((await get(s.url, '/api/discord')).status, 401);
    const bia = await broadcaster();
    assert.equal((await save('', bia)).status, 403, 'transmissor não muda o webhook');
    const r = await get(s.url, '/api/discord', { Cookie: bia.cookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.webhook, WEBHOOK);
  });

  test('não vaza: fora das configurações gerais, do estado público e dos logs', async () => {
    await save(WEBHOOK);
    const settings = await get(s.url, '/api/admin/settings', { Cookie: admin.cookie });
    assert.doesNotMatch(JSON.stringify(settings.body), /webhooks|discord/i);
    assert.doesNotMatch(JSON.stringify((await get(s.url, '/api/state')).body), /webhooks/);
    assert.ok(!s.output().includes('a1B2-c3_D4'), 'o token do webhook não vai para os logs');
  });

  test('vazio desliga', async () => {
    await save(WEBHOOK);
    const r = await save('  ');
    assert.equal(r.status, 200);
    assert.equal(r.body.webhook, null);
    assert.equal((await get(s.url, '/api/discord', { Cookie: admin.cookie })).body.webhook, null);
  });

  test('a CSP deixa a página falar com o discord.com', async () => {
    const csp = (await fetch(`${s.url}/`)).headers.get('content-security-policy');
    assert.ok(csp.match(/connect-src ([^;]+)/)[1].split(/\s+/).includes('https://discord.com'));
  });
});

describe('no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('o admin salva o webhook no painel; na sala, o anfitrião anuncia e o cartão leva o convite', async () => {
    await save('');
    const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.fill('#discord-webhook', WEBHOOK.replace('https://discord.com', 'https://discordapp.com'));
    await page.click('#discord-form button');
    await page.waitForSelector('#discord-ok:not([hidden])');
    assert.equal(await page.inputValue('#discord-webhook'), WEBHOOK);

    // O Discord de mentira: guarda o que o navegador enviar
    const posted = [];
    await page.route('https://discord.com/api/webhooks/**', async (route) => {
      posted.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(`${s.url}/`);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/\/r\/[A-Za-z0-9_-]{22}#k=/);
    await page.fill('#name', 'Ana');
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
    await page.waitForSelector('#discord-announce:not([hidden])');
    page.once('dialog', (d) => d.accept());
    await page.click('#discord-announce');
    await page.waitForFunction(() => /Convite anunciado no Discord/.test(document.querySelector('#log').textContent));

    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, WEBHOOK);
    const invite = await page.inputValue('#invite-link');
    assert.equal(posted[0].body.content, invite);
    assert.equal(posted[0].body.embeds[0].url, invite);
    assert.equal(posted[0].body.embeds[0].title, 'Ana está ao vivo');
    assert.doesNotMatch(JSON.stringify(posted[0].body), /[#&]h=/, 'o anúncio não leva a chave de anfitrião');

    // Quem assiste não vê o botão nem recebe o webhook
    const viewer = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    await viewer.goto(invite);
    await viewer.fill('#name', 'Beto');
    await viewer.click('#join-form button');
    await viewer.waitForSelector('#room:not([hidden])');
    assert.ok(await viewer.isHidden('#discord-announce'));
    assert.deepEqual(errors, []);
  });
});
