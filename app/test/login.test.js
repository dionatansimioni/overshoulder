import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ADMIN, api, launchBrowser, loginInBrowser, setupAdmin, startServer } from './helpers.js';

let s;
let admin;
let browser;

before(async () => {
  s = await startServer(13260);
  admin = await setupAdmin(s);
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const newPage = async (options = {}) => {
  const page = await (await browser.newContext(options)).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

const setSignup = async (signup) => assert.equal((await api(s.url, '/api/admin/settings', { signup }, admin)).status, 200);

describe('campo de senha', () => {
  test('o olho mostra e esconde a senha, e o envio volta a esconder', async () => {
    const { page, errors } = await newPage();
    await page.goto(`${s.url}/`);
    await page.waitForSelector('#login-form:not([hidden])');
    const reveal = page.locator('#login-form .password-field .reveal');
    assert.equal(await reveal.getAttribute('aria-label'), 'Mostrar senha');
    await page.fill('#password', 'segredo');
    await reveal.click();
    assert.equal(await page.getAttribute('#password', 'type'), 'text');
    assert.equal(await reveal.getAttribute('aria-pressed'), 'true');
    assert.equal(await reveal.getAttribute('aria-label'), 'Esconder senha');
    await page.fill('#username', 'ninguem');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#login-error:not([hidden])');
    assert.equal(await page.getAttribute('#password', 'type'), 'password', 'enviado, o campo volta a esconder');
    assert.deepEqual(errors, []);
  });

  test('todo campo de senha das páginas ganha o olho', async () => {
    const { page, errors } = await newPage();
    for (const path of ['/', '/reset', '/signup']) {
      await page.goto(`${s.url}${path}`);
      await page.waitForLoadState('networkidle');
      const missing = await page.$$eval('input[type="password"]', (els) => els.filter((e) => !e.closest('.password-field')).map((e) => e.id));
      assert.deepEqual(missing, [], `campos sem o olho em ${path}`);
    }
    assert.deepEqual(errors, []);
  });

  test('salvar a senha: o usuário volta preenchido no próximo login; desmarcado, não', async () => {
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    await page.click('#logout');
    await page.waitForSelector('#login-form:not([hidden])');
    assert.equal(await page.inputValue('#username'), ADMIN.username);
    assert.ok(await page.isChecked('#remember'), 'marcado por padrão');

    await page.fill('#password', ADMIN.password);
    await page.uncheck('#remember');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#signed-in:not([hidden])');
    await page.click('#logout');
    await page.waitForSelector('#login-form:not([hidden])');
    assert.equal(await page.inputValue('#username'), '', 'desmarcado, o navegador esquece o usuário');
    assert.deepEqual(errors, []);
  });
});

describe('servidor privado (cadastro só por convite)', () => {
  test('a página inicial não tem login: diz que o servidor é particular e aponta o site', async () => {
    await setSignup('invite');
    try {
      const { page, errors } = await newPage();
      await page.goto(`${s.url}/`);
      await page.waitForSelector('#private-view:not([hidden])');
      assert.equal(await page.locator('#login-form:visible, #username:visible, #password:visible').count(), 0, 'nenhum campo de login');
      assert.match(await page.textContent('#private-view'), /Servidor privado/);
      assert.match(await page.getAttribute('#own-server', 'href'), /^https:\/\/dionatansimioni\.github\.io\/overshoulder\//);
      assert.ok(await page.isHidden('#signup-link'));

      // Quem tem conta entra por /login, e depois volta para a página inicial
      await page.click('a[href="/login"]');
      await page.waitForSelector('#login-form:not([hidden])');
      await page.fill('#username', ADMIN.username);
      await page.fill('#password', ADMIN.password);
      await page.click('#login-form button[type="submit"]');
      await page.waitForSelector('#signed-in:not([hidden])');
      assert.equal(new URL(page.url()).pathname, '/');
      assert.ok(await page.isHidden('#private-view'));
      assert.deepEqual(errors, []);
    } finally {
      await setSignup('approval');
    }
  });

  test('/login é servido como página e, fora do modo convite, a página inicial mostra o login', async () => {
    const res = await fetch(`${s.url}/login`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /id="login-form"/);
    const { page } = await newPage();
    await page.goto(`${s.url}/`);
    await page.waitForSelector('#login-form:not([hidden])');
    assert.ok(await page.isHidden('#private-view'));
  });
});
