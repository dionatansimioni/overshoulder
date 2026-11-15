import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dictionary as SERVER_EN, translateError } from '../i18n-server.js';
import { CATEGORIES } from '../public/emoji.js';
import { dictionary as EN } from '../public/i18n.js';
import { ADMIN, api, launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(APP, 'public');
const read = (file) => fs.readFileSync(file, 'utf8');

// Textos que são iguais nos dois idiomas (marcas, termos técnicos, exemplos)
const NEUTRAL = new Set([
  'Overshoulder', 'Client ID', 'Client secret', 'Codec', 'VP9', 'AV1', 'Volume', 'Chat', 'Emojis',
  '720p · 30 fps', '720p · 60 fps', '1080p · 30 fps', '1080p · 60 fps', '1440p · 60 fps',
  'docker logs overshoulder', 'XXXX-XXXX-XXXX', 'M', '↖', '↗', '↙', '↘', 'https://login.microsoftonline.com/…/v2.0', '·', '.', '😊', '● Gravando',
]);

const htmlTexts = (html) => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg class="sprite"[\s\S]*?<\/svg>/, '');
  const texts = [...body.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter((s) => /\p{L}/u.test(s));
  const attrs = [...body.matchAll(/\s(?:placeholder|title|aria-label|alt)="([^"]+)"/g)].map((m) => m[1]);
  return [...texts, ...attrs];
};

// Literais em português passados a t(...) no primeiro argumento (inclusive em ternários)
const tLiterals = (src) => {
  const out = [];
  for (const m of src.matchAll(/\bt\(/g)) {
    let depth = 1;
    let i = m.index + 2;
    let arg = '';
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "'" || c === '`') {
        const end = src.indexOf(c, i + 1);
        arg += src.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 1 && c === ',') break;
      if (depth > 0) arg += c;
      i++;
    }
    for (const lit of arg.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      // u.role === 'admin' é comparação, não texto mostrado
      if (!/[=!]==\s*$/.test(arg.slice(0, lit.index))) out.push(lit[1]);
    }
  }
  return out;
};

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('dicionários', () => {
  test('todo texto das páginas tem tradução', () => {
    const missing = [];
    for (const file of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'))) {
      for (const text of htmlTexts(read(path.join(PUBLIC, file)))) {
        if (!NEUTRAL.has(text) && !EN[text]) missing.push(`${file}: ${text}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test('todo texto passado a t() nos scripts tem tradução', () => {
    const missing = [];
    for (const file of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.js') && f !== 'i18n.js')) {
      for (const text of tLiterals(read(path.join(PUBLIC, file)))) if (!EN[text]) missing.push(`${file}: ${text}`);
    }
    for (const c of CATEGORIES) if (!EN[c.label]) missing.push(`emoji.js: ${c.label}`);
    // Mensagens de volta do login corporativo ficam em objetos e passam por t() na hora de mostrar
    for (const file of ['home.js', 'room.js']) {
      const block = read(path.join(PUBLIC, file)).match(/const SSO_ERRORS = \{([\s\S]*?)\};/)[1];
      for (const m of block.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) if (!EN[m[1]]) missing.push(`${file}: ${m[1]}`);
    }
    assert.deepEqual(missing, []);
  });

  test('variáveis {nome} são as mesmas nos dois idiomas', () => {
    for (const [pt, en] of Object.entries(EN)) assert.equal(placeholders(en), placeholders(pt), pt);
  });

  test('toda mensagem de erro do servidor tem tradução', () => {
    const missing = [];
    for (const file of ['server.js', 'auth.js']) {
      const src = read(path.join(APP, file));
      for (const m of src.matchAll(/(?:error:\s*|HttpError\(\d+,\s*|return\s+)(['`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) {
        const msg = m[2].replace(/\$\{(\w+)(?:\.\w+)*\}/g, (_, v) => (v === 'err' ? 'erro qualquer' : 'campo'));
        if (!/\p{L}{3}/u.test(msg) || !msg.includes(' ') || msg.includes('HttpOnly')) continue;
        if (translateError(msg) === msg) missing.push(`${file}: ${m[2]}`);
      }
    }
    assert.deepEqual(missing, []);
    assert.ok(Object.keys(SERVER_EN).length > 40);
  });
});

describe('no navegador, em inglês', () => {
  let s;
  let browser;
  before(async () => {
    await waitForLiveKit();
    s = await startServer(13110);
    await setupAdmin(s);
    browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  });
  after(async () => {
    await browser?.close();
    s?.stop();
  });

  // Texto visível da página, sem o seletor de idioma (que mostra "Português" de propósito)
  const visibleText = (page) =>
    page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('[data-lang-switch]').forEach((e) => e.remove());
      document.body.append(clone);
      clone.style.position = 'absolute';
      const text = clone.innerText;
      clone.remove();
      return text;
    });
  const PORTUGUESE = /[ãõçáéíóúâêôà]/i;
  const assertEnglish = async (page, where) => {
    const text = await visibleText(page);
    const line = text.split('\n').find((l) => PORTUGUESE.test(l));
    assert.equal(line, undefined, `${where}: "${line}"`);
  };

  test('páginas, erros do servidor e sala aparecem em inglês, sem português sobrando', async () => {
    const context = await browser.newContext({ locale: 'en-US', permissions: ['microphone'] });
    const page = await context.newPage();
    await page.goto(`${s.url}/`);
    await page.waitForSelector('#login-form:not([hidden])');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    assert.equal(await page.textContent('#login-form button'), 'Sign in');
    await assertEnglish(page, 'login');

    await page.fill('#username', 'admin');
    await page.fill('#password', 'senha errada mesmo');
    await page.click('#login-form button');
    await page.waitForSelector('#login-error:not([hidden])');
    assert.equal(await page.textContent('#login-error'), 'Incorrect username or password.', 'erro do servidor traduzido');

    await loginInBrowser(page, s.url);
    await assertEnglish(page, 'início');
    for (const route of ['/conta', '/admin']) {
      await page.goto(`${s.url}${route}`);
      await page.waitForLoadState('networkidle');
      await assertEnglish(page, route);
    }

    await page.goto(`${s.url}/`);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    assert.equal(await page.textContent('#join-form button[type="submit"]'), 'Join the room');
    await assertEnglish(page, 'entrada da sala');
    await page.fill('#name', 'Ana');
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
    await page.click('#settings-btn');
    await assertEnglish(page, 'sala com ajustes');
    await page.keyboard.press('Escape');
    await page.click('#tab-people');
    await assertEnglish(page, 'aba Pessoas');
    assert.equal(await page.getAttribute('#share', 'aria-label'), 'Share screen');
    assert.equal(await page.textContent('#count'), '1 person in the room');

    const viewer = await (await browser.newContext({ locale: 'en-US', permissions: ['microphone'] })).newPage();
    await viewer.goto(await page.inputValue('#invite-link'));
    await viewer.fill('#name', 'Bob');
    await viewer.click('#join-form button');
    await viewer.waitForSelector('#room:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#count').textContent === '2 people in the room');
    await assertEnglish(viewer, 'espectador');
  });

  test('o seletor troca o idioma e a escolha fica salva', async () => {
    const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
    await page.goto(`${s.url}/`);
    await page.waitForSelector('#login-form:not([hidden])');
    await page.click('[data-lang-switch] button:has-text("Português")');
    await page.waitForSelector('#login-form:not([hidden])');
    assert.equal(await page.textContent('#login-form button'), 'Entrar');
    assert.equal(await page.getAttribute('html', 'lang'), 'pt-BR');
    await page.reload();
    assert.equal(await page.textContent('#login-form button'), 'Entrar', 'a escolha sobrevive ao recarregar');
    // Erros do servidor seguem a escolha, não o idioma do navegador
    const r = await page.evaluate(async () => {
      const { api } = await import('/static/ui.js');
      return api('/api/login', { username: 'x', password: 'y' }).catch((e) => e.message);
    });
    assert.equal(r, 'Usuário ou senha incorretos.');
  });

  test('navegador em português abre em pt-BR; outros idiomas, em inglês', async () => {
    for (const [locale, expected] of [['pt-BR', 'Entrar'], ['pt-PT', 'Entrar'], ['es-ES', 'Sign in'], ['de-DE', 'Sign in']]) {
      const page = await (await browser.newContext({ locale })).newPage();
      await page.goto(`${s.url}/`);
      await page.waitForSelector('#login-form:not([hidden])');
      assert.equal(await page.textContent('#login-form button'), expected, locale);
    }
    assert.ok(ADMIN && api);
  });
});
