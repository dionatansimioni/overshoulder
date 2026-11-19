// Capturas das telas principais do app, para revisar o visual (antes e depois de mudanças) e para o site.
// Roda pela infraestrutura dos testes: ./scripts/screenshots.sh → app/.screenshots/*.png
import { test } from 'node:test';
import fs from 'node:fs';
import { launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from '../test/helpers.js';

const OUT = new URL('../.screenshots/', import.meta.url).pathname;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };

test('capturas', { timeout: 180_000 }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await waitForLiveKit();
  const s = await startServer(13990);
  const browser = await launchBrowser({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
  const shot = async (page, name, opts = {}) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${name}.png`, ...opts });
  };
  const ctx = (viewport = DESKTOP) =>
    browser.newContext({ viewport, permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'] }).then((c) => c.newPage());

  try {
    // Configuração inicial, antes de existir admin
    let p = await ctx();
    await p.goto(`${s.url}/setup`);
    await shot(p, '01-setup');
    await setupAdmin(s);

    p = await ctx();
    await p.goto(`${s.url}/`);
    await p.waitForSelector('#login-form:not([hidden])');
    await shot(p, '02-login');

    // Início com conta, e a janela de criar sala
    await loginInBrowser(p, s.url);
    await shot(p, '03-home');
    await p.click('#new-room');
    await shot(p, '04-create-room');
    await p.click('#create-live');
    await p.waitForURL(/\/r\/[A-Za-z0-9_-]{22}#k=/);
    await p.fill('#name', 'Ana');
    await shot(p, '05-lobby');
    await p.click('#join-form button');
    await p.waitForSelector('#room:not([hidden])');
    const link = await p.inputValue('#invite-link');

    // Quem assiste entra e conversa; o anfitrião compartilha a tela
    const v = await ctx();
    await v.goto(link);
    await v.fill('#name', 'Beto');
    await v.click('#join-form button');
    await v.waitForSelector('#room:not([hidden])');
    await v.fill('#chat-input', 'gg, que jogada!');
    await v.press('#chat-input', 'Enter');
    await p.click('#share');
    await p.waitForSelector('#share.on');
    await p.waitForTimeout(2500);
    await shot(p, '06-room-host');
    await p.click('#settings-btn');
    await shot(p, '07-room-settings');
    await p.click('#settings-btn');
    await v.waitForTimeout(1500);
    await shot(v, '08-room-viewer');

    const m = await ctx(MOBILE);
    await m.goto(link);
    await m.fill('#name', 'Caio');
    await m.click('#join-form button');
    await m.waitForSelector('#room:not([hidden])');
    await m.waitForTimeout(2000);
    await shot(m, '09-room-mobile');
    await m.click('#settings-btn');
    await m.waitForTimeout(500);
    await shot(m, '09b-room-mobile-settings');

    const ml = await ctx({ width: 844, height: 390 });
    await ml.goto(link);
    await ml.fill('#name', 'Duda');
    await ml.click('#join-form button[type="submit"]');
    await ml.waitForSelector('#room:not([hidden])');
    await ml.waitForTimeout(2000);
    await shot(ml, '09c-room-landscape');

    // Live: pergunta do chat em destaque sobre o vídeo
    await v.fill('#chat-input', 'Qual sensibilidade do mouse você usa nesse jogo?');
    await v.press('#chat-input', 'Enter');
    const question = p.locator('#messages li.msg', { hasText: 'sensibilidade' });
    await question.waitFor();
    await question.hover();
    await question.locator('.msg-highlight').click();
    await v.waitForSelector('#highlight:not([hidden])');
    await v.waitForTimeout(500);
    await shot(p, '06c-room-host-highlight');
    await shot(v, '08b-room-viewer-highlight');
    await m.waitForSelector('#highlight:not([hidden])');
    await shot(m, '09d-room-mobile-highlight');

    await p.click('#tab-log');
    await shot(p, '06b-room-host-log');

    // Link de uma sala que não existe mais
    const g = await ctx();
    await g.goto(`${s.url}/r/${'b'.repeat(22)}#k=${'c'.repeat(43)}`);
    await g.waitForSelector('#ended:not([hidden])');
    await g.waitForTimeout(500);
    await shot(g, '05b-room-gone');

    // Painel e conta
    await p.goto(`${s.url}/admin`);
    await p.waitForSelector('#geral:not([hidden])');
    await shot(p, '10-admin', { fullPage: true });
    await p.goto(`${s.url}/admin#convites`);
    await shot(p, '11-admin-invite');
    await p.goto(`${s.url}/admin#sobre`);
    await p.waitForTimeout(500);
    await shot(p, '11b-admin-about');
    await p.goto(`${s.url}/account`);
    await shot(p, '12-account', { fullPage: true });

    const mh = await ctx(MOBILE);
    await loginInBrowser(mh, s.url);
    await shot(mh, '13-home-mobile', { fullPage: true });
  } finally {
    await browser.close();
    s.stop();
  }
});
