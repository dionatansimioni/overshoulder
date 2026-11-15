import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { newer, parseRelease, RELEASES_PAGE } from '../update-check.js';
import { api, get, launchBrowser, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

// GitHub falso: responde o que cada teste pedir e conta as consultas
const github = { status: 200, body: {}, hits: 0 };
let mock;
const MOCK_URL = 'http://127.0.0.1:13399/repos/x/releases/latest';
const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `${RELEASES_PAGE}/tag/${tag}`, draft: false, prerelease: false, ...extra });

const servers = [];
const fresh = async (port, env = {}) => {
  const s = await startServer(port, {
    APP_VERSION: '0.1.0',
    INSTALL_METHOD: 'installer',
    UPDATE_CHECK_URL: MOCK_URL,
    UPDATE_CHECK_DELAY_MS: '100000000',
    UPDATE_MANUAL_GAP_MS: '0',
    ...env,
  });
  servers.push(s);
  return { s, admin: await setupAdmin(s) };
};
const view = async (s, admin) => (await get(s.url, '/api/admin/update', admin)).body;
const checkNow = (s, admin) => api(s.url, '/api/admin/update/check', {}, admin);

before(async () => {
  await waitForLiveKit();
  mock = http
    .createServer((req, res) => {
      github.hits++;
      res.writeHead(github.status, { 'Content-Type': 'application/json' });
      res.end(typeof github.body === 'string' ? github.body : JSON.stringify(github.body));
    })
    .listen(13399, '127.0.0.1');
});
after(() => {
  servers.forEach((s) => s.stop());
  mock?.close();
});

describe('comparação de versões e leitura da release', () => {
  test('compara versões semânticas', () => {
    assert.equal(newer('0.2.0', '0.1.0'), true);
    assert.equal(newer('v0.10.0', '0.9.9'), true);
    assert.equal(newer('0.1.0', '0.1.0'), false);
    assert.equal(newer('0.0.9', '0.1.0'), false);
    assert.equal(newer('0.2.0', 'dev'), false);
    assert.equal(newer('lixo', '0.1.0'), false);
  });

  test('aceita só releases publicadas, com versão válida e link das releases do projeto', () => {
    assert.deepEqual(parseRelease(release('v0.2.0')), { version: '0.2.0', notesUrl: `${RELEASES_PAGE}/tag/v0.2.0` });
    assert.equal(parseRelease(release('v0.2.0', { draft: true })), null);
    assert.equal(parseRelease(release('v0.2.0', { prerelease: true })), null);
    assert.equal(parseRelease(release('v0.2.0-rc1')), null);
    assert.equal(parseRelease(release('<script>')), null);
    assert.equal(parseRelease(null), null);
    assert.equal(parseRelease([]), null);
    // Link de outro site (ou com aspas) vira o link padrão das releases
    assert.equal(parseRelease(release('v0.2.0', { html_url: 'https://evil.example/x' })).notesUrl, `${RELEASES_PAGE}/tag/v0.2.0`);
    assert.equal(parseRelease(release('v0.2.0', { html_url: `${RELEASES_PAGE}/x" onclick="y` })).notesUrl, `${RELEASES_PAGE}/tag/v0.2.0`);
    assert.equal(parseRelease(release('v0.2.0', { html_url: 'javascript:alert(1)' })).notesUrl, `${RELEASES_PAGE}/tag/v0.2.0`);
  });
});

describe('aviso de nova versão', () => {
  test('versão nova publicada aparece para o admin, com a forma de instalação', async () => {
    const { s, admin } = await fresh(13300);
    let v = await view(s, admin);
    assert.equal(v.current, '0.1.0');
    assert.equal(v.available, false);
    assert.equal(v.checkedAt, null);
    assert.equal(v.method, 'installer');
    github.status = 200;
    github.body = release('v0.2.0');
    v = (await checkNow(s, admin)).body;
    assert.equal(v.available, true);
    assert.equal(v.latest, '0.2.0');
    assert.equal(v.notesUrl, `${RELEASES_PAGE}/tag/v0.2.0`);
    assert.ok(v.checkedAt);
  });

  test('mesma versão, resposta com erro ou malformada não avisam nada', async () => {
    const { s, admin } = await fresh(13301);
    github.status = 200;
    github.body = release('v0.1.0');
    let v = (await checkNow(s, admin)).body;
    assert.equal(v.available, false);
    assert.equal(v.latest, '0.1.0');
    for (const [status, body] of [[500, {}], [200, 'não é json'], [200, release('v9.9.9', { draft: true })], [200, { tag_name: 123 }]]) {
      github.status = status;
      github.body = body;
      v = (await checkNow(s, admin)).body;
      assert.equal(v.available, false, JSON.stringify(body));
      assert.ok(v.error);
    }
  });

  test('desligada no admin ou por UPDATE_CHECK=off, nada é consultado', async () => {
    const { s, admin } = await fresh(13302, { UPDATE_CHECK_DELAY_MS: '50' });
    // Uma consulta agendada logo ao subir; depois, desligar impede as próximas
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await api(s.url, '/api/admin/settings', { updateCheck: false }, admin)).status, 200);
    const hits = github.hits;
    assert.equal((await checkNow(s, admin)).status, 409);
    assert.equal((await view(s, admin)).enabled, false);
    assert.equal(github.hits, hits);

    const off = await fresh(13303, { UPDATE_CHECK: 'off', UPDATE_CHECK_DELAY_MS: '50' });
    const before = github.hits;
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await checkNow(off.s, off.admin)).status, 409);
    assert.equal((await view(off.s, off.admin)).disabledByEnv, true);
    assert.equal(github.hits, before);
  });

  test('compilação local ("dev") não consulta', async () => {
    const { s, admin } = await fresh(13304, { APP_VERSION: '' });
    const v = await view(s, admin);
    assert.equal(v.current, 'dev');
    assert.equal(v.devBuild, true);
    assert.equal((await checkNow(s, admin)).status, 409);
  });

  test('verificação manual tem intervalo mínimo', async () => {
    const { s, admin } = await fresh(13305, { UPDATE_MANUAL_GAP_MS: '60000' });
    github.status = 200;
    github.body = release('v0.1.0');
    assert.equal((await checkNow(s, admin)).status, 200);
    assert.equal((await checkNow(s, admin)).status, 429);
  });

  test('só o admin vê e verifica; updateCheck só aceita verdadeiro ou falso', async () => {
    const { s, admin } = await fresh(13306);
    assert.equal((await get(s.url, '/api/admin/update')).status, 401);
    assert.equal((await api(s.url, '/api/admin/update/check', {})).status, 401);
    const inv = await api(s.url, '/api/admin/invites', {}, admin);
    const r = await api(s.url, '/api/invites/accept', {
      token: inv.body.path.split('#')[1],
      username: 'bia',
      password: 'frase comprida da transmissora',
    });
    const broadcaster = { cookie: sessionFrom(r) };
    assert.equal((await get(s.url, '/api/admin/update', broadcaster)).status, 403);
    assert.equal((await api(s.url, '/api/admin/update/check', {}, broadcaster)).status, 403);
    for (const bad of ['sim', 1, null, {}, []]) {
      assert.equal((await api(s.url, '/api/admin/settings', { updateCheck: bad }, admin)).status, 400, JSON.stringify(bad));
    }
    // INSTALL_METHOD desconhecido não chega à página
    const other = await fresh(13307, { INSTALL_METHOD: '<script>' });
    assert.equal((await view(other.s, other.admin)).method, null);
  });
});

describe('aviso de nova versão no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('o admin vê o aviso na página inicial e os passos da sua instalação em /admin', async () => {
    const { s, admin } = await fresh(13308);
    github.status = 200;
    github.body = release('v0.2.0');
    await checkNow(s, admin);
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await loginInBrowser(page, s.url);
    await page.waitForSelector('#update-notice:not([hidden])');
    assert.match(await page.textContent('#update-notice'), /Versão 0\.2\.0 disponível/);
    await page.click('#update-notice');
    await page.waitForSelector('#update-how:not([hidden])');
    assert.match(await page.textContent('#update-status'), /Versão 0\.2\.0 disponível\. Este servidor está na 0\.1\.0/);
    assert.match(await page.textContent('#update-steps'), /sudo overshoulder update/);
    assert.doesNotMatch(await page.textContent('#update-steps'), /docker compose pull/);
    assert.match(await page.textContent('#update-other'), /docker compose pull/);
    assert.equal(await page.getAttribute('#update-notes', 'href'), `${RELEASES_PAGE}/tag/v0.2.0`);

    // Desligar pela página
    await page.uncheck('#update-check');
    await page.waitForFunction(() => document.querySelector('#update-check-now').disabled);
    assert.match(await page.textContent('#update-status'), /desligada/);
    assert.deepEqual(errors, []);
  });

  test('sem saber a forma de instalação, mostra todas', async () => {
    const { s, admin } = await fresh(13309, { INSTALL_METHOD: '' });
    github.status = 200;
    github.body = release('v0.2.0');
    await checkNow(s, admin);
    const page = await (await browser.newContext()).newPage();
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.waitForSelector('#update-how:not([hidden])');
    const steps = await page.textContent('#update-steps');
    for (const cmd of ['sudo overshoulder update', 'docker compose pull', 'git pull', 'docker pull', 'Redeploy']) assert.match(steps, new RegExp(cmd));
  });
});
