import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { get, launchBrowser, loginInBrowser, setupAdmin, startServer } from './helpers.js';

let browser;
const servers = [];
const fresh = async (port, env) => {
  const s = await startServer(port, env);
  servers.push(s);
  await setupAdmin(s);
  return s;
};

before(async () => (browser = await launchBrowser()));
after(async () => {
  await browser?.close();
  servers.forEach((s) => s.stop());
});

// Página nova que falha o teste em qualquer erro de JavaScript
const newPage = async (options = {}) => {
  const page = await (await browser.newContext(options)).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const visiblePages = (page) => page.$$eval('.admin-page', (els) => els.filter((e) => !e.hidden).map((e) => e.id));
const current = (page) => page.getAttribute('.admin-nav button[aria-current="page"]', 'data-page').then((p) => `#${p}`);

describe('administração com menu lateral', () => {
  test('uma seção por vez, com endereço próprio e Voltar do navegador', async () => {
    const s = await fresh(13200);
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.waitForSelector('#geral:not([hidden])');
    assert.deepEqual(await visiblePages(page), ['geral']);
    assert.equal(await current(page), '#geral');

    await page.click('.admin-nav button[data-page="salas"]');
    await page.waitForSelector('#salas:not([hidden])');
    assert.deepEqual(await visiblePages(page), ['salas']);
    assert.equal(await current(page), '#salas');
    await page.click('.admin-nav button[data-page="avancado"]');
    await page.waitForSelector('#avancado:not([hidden])');
    assert.deepEqual(await visiblePages(page), ['avancado']);

    await page.goBack();
    await page.waitForSelector('#salas:not([hidden])');
    assert.deepEqual(await visiblePages(page), ['salas']);

    // Endereço direto abre a seção; seção desconhecida cai em Geral
    await page.goto(`${s.url}/admin#transmissores`);
    await page.waitForSelector('#transmissores:not([hidden])');
    await page.goto(`${s.url}/admin#nada`);
    await page.waitForSelector('#geral:not([hidden])');
    assert.deepEqual(errors, []);
  });

  test('tudo que se clica no painel é botão: nada de link simples', async () => {
    const s = await fresh(13206);
    const { page } = await newPage();
    await loginInBrowser(page, s.url);
    for (const section of ['geral', 'uso', 'salas', 'transmissores', 'convites', 'avancado']) {
      await page.goto(`${s.url}/admin#${section}`);
      await page.waitForSelector(`#${section}:not([hidden])`);
      await page.waitForLoadState('networkidle');
      const plain = await page.$$eval('a', (links) =>
        links.filter((a) => a.offsetParent !== null && !a.classList.contains('button')).map((a) => a.textContent.trim()),
      );
      assert.deepEqual(plain, [], `links simples em ${section}`);
    }
  });

  test('SSO e TURN ficam em Avançado; o TURN mostra se está ligado', async () => {
    const off = await fresh(13201);
    const { page } = await newPage();
    await loginInBrowser(page, off.url);
    await page.goto(`${off.url}/admin#avancado`);
    await page.waitForSelector('#avancado:not([hidden])');
    assert.ok(await page.isVisible('#sso-form'));
    assert.match(await page.textContent('#turn-status'), /^Desligado/);

    const on = await fresh(13202, { TURN_DOMAIN: 'turn.exemplo.com' });
    const admin = await newPage();
    await loginInBrowser(admin.page, on.url);
    await admin.page.goto(`${on.url}/admin#avancado`);
    await admin.page.waitForSelector('#avancado:not([hidden])');
    assert.equal(await admin.page.textContent('#turn-status'), 'Ligado: a porta 443 atende o TURN em turn.exemplo.com.');
  });

  test('o domínio do TURN só aparece para o admin', async () => {
    const s = await fresh(13203, { TURN_DOMAIN: 'turn.exemplo.com' });
    assert.equal((await get(s.url, '/api/admin/settings')).status, 401);
    assert.doesNotMatch(JSON.stringify((await get(s.url, '/api/state')).body), /turn\.exemplo/);
  });

  test('pelo teclado: Tab chega ao menu e Enter abre a seção', async () => {
    const s = await fresh(13204);
    const { page } = await newPage();
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.waitForSelector('#geral:not([hidden])');
    await page.focus('.admin-nav button[data-page="convites"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#convites:not([hidden])');
    assert.equal(await current(page), '#convites');
  });

  test('no celular o menu fica em cima e cabe na tela', async () => {
    const s = await fresh(13205);
    const { page, errors } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.waitForSelector('#geral:not([hidden])');
    for (const href of ['#geral', '#salas', '#transmissores', '#convites', '#avancado']) {
      const box = await page.locator(`.admin-nav button[data-page="${href.slice(1)}"]`).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `${href} dentro da tela`);
    }
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'sem rolagem lateral');
    assert.deepEqual(errors, []);
  });
});
