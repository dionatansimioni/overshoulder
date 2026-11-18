import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ADMIN, api, launchBrowser, setupAdmin, startServer } from './helpers.js';

const servers = [];
const fresh = async (port) => {
  const s = await startServer(port);
  servers.push(s);
  return s;
};
let browser;

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

const stepShown = async (page) => Number(await page.getAttribute('.steps li[aria-current]', 'data-step'));

describe('conferir o código no primeiro passo (API)', () => {
  test('código certo responde ok; errado, de tipo errado ou depois de configurar é recusado', async () => {
    const s = await fresh(13180);
    const code = await s.setupCode();
    assert.equal((await api(s.url, '/api/setup/check', { code: code.toLowerCase() })).status, 200);
    for (const wrong of ['XXXX-XXXX-XXXX', '', null, 42, [code], { code }]) {
      const r = await api(s.url, '/api/setup/check', { code: wrong });
      assert.equal(r.status, 403, JSON.stringify(wrong));
      assert.match(r.body.error, /Código de configuração incorreto/);
    }
    await setupAdmin(s);
    assert.equal((await api(s.url, '/api/setup/check', { code })).status, 409, 'servidor já configurado');
  });

  test('conferir o código gasta o mesmo limite de tentativas da configuração', async () => {
    const s = await fresh(13181);
    const code = await s.setupCode();
    for (let i = 0; i < 10; i++) await api(s.url, '/api/setup/check', { code: 'ERRADO' });
    assert.equal((await api(s.url, '/api/setup/check', { code })).status, 429);
    assert.equal((await api(s.url, '/api/setup', { code, ...ADMIN })).status, 429, 'nem pela configuração completa');
  });
});

describe('configuração em 3 passos (navegador)', () => {
  test('código errado fica no passo 1 com o erro; o certo avança', async () => {
    const s = await fresh(13182);
    const { page, errors } = await newPage();
    await page.goto(`${s.url}/setup`);
    assert.equal(await stepShown(page), 1);
    assert.equal(await page.textContent('#step-status'), 'Passo 1 de 3');
    assert.ok(await page.isHidden('#back'), 'sem Voltar no primeiro passo');

    await page.click('#next');
    assert.equal(await page.textContent('#setup-error'), 'Informe o código de configuração.');
    await page.fill('#code', 'XXXX-XXXX-XXXX');
    await page.click('#next');
    await page.waitForSelector('#setup-error:has-text("incorreto")');
    assert.equal(await stepShown(page), 1);

    await page.fill('#code', await s.setupCode());
    await page.click('#next');
    await page.waitForSelector('#username:visible');
    assert.equal(await stepShown(page), 2);
    assert.deepEqual(errors, []);
  });

  test('Voltar (botão e navegador) não perde o que foi digitado, e Avançar do navegador volta ao passo', async () => {
    const s = await fresh(13183);
    const { page, errors } = await newPage();
    await page.goto(`${s.url}/setup`);
    const code = await s.setupCode();
    await page.fill('#code', code);
    await page.click('#next');
    await page.fill('#username', 'dona');
    await page.fill('#password', 'frase longa e segura demais');
    await page.fill('#password2', 'frase longa e segura demais');
    await page.click('#next');
    await page.waitForSelector('#max:visible');
    assert.match(page.url(), /#passo-3$/);
    await page.fill('#max', '40');

    await page.goBack();
    await page.waitForSelector('#username:visible');
    assert.equal(await page.inputValue('#username'), 'dona');
    await page.click('#back');
    await page.waitForSelector('#code:visible');
    assert.equal(await page.inputValue('#code'), code);

    await page.goForward();
    await page.waitForSelector('#username:visible');
    await page.goForward();
    await page.waitForSelector('#max:visible');
    assert.equal(await page.inputValue('#max'), '40');
    assert.equal(await page.textContent('#next'), 'Criar administrador');

    await page.click('#next');
    await page.waitForURL(`${s.url}/`);
    await page.waitForSelector('#signed-in:not([hidden])');
    assert.equal(await page.textContent('#me'), 'dona');
    assert.deepEqual(errors, []);
  });

  test('senha recusada pelo servidor leva de volta ao passo da conta', async () => {
    const s = await fresh(13184);
    const { page } = await newPage();
    await page.goto(`${s.url}/setup`);
    await page.fill('#code', await s.setupCode());
    await page.click('#next');
    await page.fill('#username', 'dona');
    // 12 caracteres, mas fraca demais para o servidor
    await page.fill('#password', 'aaaaaaaaaaaa');
    await page.fill('#password2', 'aaaaaaaaaaaa');
    await page.click('#next');
    await page.waitForSelector('#max:visible');
    await page.click('#next');
    await page.waitForSelector('#username:visible');
    assert.equal(await stepShown(page), 2);
    assert.ok(await page.isVisible('#setup-error'));
  });

  test('tudo pelo teclado: Enter avança cada passo', async () => {
    const s = await fresh(13185);
    const { page } = await newPage();
    await page.goto(`${s.url}/setup`);
    await page.fill('#code', await s.setupCode());
    await page.press('#code', 'Enter');
    await page.waitForSelector('#username:visible');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'username', 'o foco vai ao primeiro campo');
    await page.keyboard.type('dona');
    await page.fill('#password', 'frase longa e segura demais');
    await page.fill('#password2', 'frase longa e segura demais');
    await page.press('#password2', 'Enter');
    await page.waitForSelector('#max:visible');
    await page.press('#max', 'Enter');
    await page.waitForURL(`${s.url}/`);
  });

  test('no celular os passos e os botões cabem na tela', async () => {
    const s = await fresh(13186);
    const { page, errors } = await newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    await page.goto(`${s.url}/setup`);
    await page.fill('#code', await s.setupCode());
    await page.click('#next');
    await page.waitForSelector('#username:visible');
    for (const id of ['.steps', '#back', '#next', '#password2']) {
      const box = await page.locator(id).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 360, `${id} dentro da tela`);
    }
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 360, 'sem rolagem lateral');
    assert.deepEqual(errors, []);
  });
});
