import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, createRoom, get, launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

let s;
let admin;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13160);
  admin = await setupAdmin(s);
  // Mídia falsa, como em browser.test.js: a sala pede o microfone ao entrar
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const setSettings = (body, session = admin) => api(s.url, '/api/admin/settings', body, session);

// Página nova que falha o teste em qualquer erro de JavaScript
const newPage = async () => {
  const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors };
};

describe('padrões de qualidade (API)', () => {
  test('padrão 720p e máxima 1440p, sem configurar nada', async () => {
    const r = await get(s.url, '/api/admin/settings', admin);
    assert.equal(r.body.defaultQuality, '720p30');
    assert.equal(r.body.maxQuality, '1440p60');
  });

  test('o admin muda a qualidade padrão e a máxima, e o token leva os dois', async () => {
    const r = await setSettings({ defaultQuality: '720p60', maxQuality: '1080p30' });
    assert.equal(r.status, 200);
    assert.equal(r.body.defaultQuality, '720p60');
    assert.equal(r.body.maxQuality, '1080p30');

    const room = await createRoom(s.url, admin);
    const host = await api(s.url, '/api/token', { roomId: room.roomId, hostKey: room.hostKey, name: 'Ana' });
    assert.deepEqual(host.body.quality, { default: '720p60', max: '1080p30' });
    const viewer = await api(s.url, '/api/token', { roomId: room.roomId, name: 'Beto' });
    assert.deepEqual(viewer.body.quality, { default: '720p60', max: '1080p30' }, 'quem assiste também pode apresentar');

    await setSettings({ defaultQuality: '720p30', maxQuality: '1440p60' });
  });

  test('qualidade desconhecida, de tipo errado ou padrão acima da máxima é recusada', async () => {
    for (const value of ['4k', '', null, 720, ['720p30'], { q: '720p30' }, '720P30']) {
      const a = await setSettings({ defaultQuality: value });
      assert.equal(a.status, 400, `padrão ${JSON.stringify(value)}`);
      assert.equal(a.body.error, 'Qualidade inválida.');
      assert.equal((await setSettings({ maxQuality: value })).status, 400, `máxima ${JSON.stringify(value)}`);
    }
    const above = await setSettings({ defaultQuality: '1080p60', maxQuality: '1080p30' });
    assert.equal(above.status, 400);
    assert.equal(above.body.error, 'A qualidade padrão não pode passar da máxima.');
    // Baixar só a máxima abaixo do padrão atual também é recusado, e nada muda
    await setSettings({ defaultQuality: '1080p30' });
    assert.equal((await setSettings({ maxQuality: '720p60' })).status, 400);
    const now = (await get(s.url, '/api/admin/settings', admin)).body;
    assert.equal(now.defaultQuality, '1080p30');
    assert.equal(now.maxQuality, '1440p60');
    await setSettings({ defaultQuality: '720p30' });
  });

  test('só o admin muda a qualidade', async () => {
    assert.equal((await setSettings({ maxQuality: '720p30' }, {})).status, 401);
    assert.equal((await get(s.url, '/api/admin/settings', admin)).body.maxQuality, '1440p60');
  });

  test('limite de pessoas sem teto baixo: até 5000', async () => {
    assert.equal((await setSettings({ maxParticipants: 1200 })).status, 200);
    assert.equal((await setSettings({ maxParticipants: 5000 })).status, 200);
    for (const maxParticipants of [5001, 1, 2.5, '300']) {
      const r = await setSettings({ maxParticipants });
      assert.equal(r.status, 400, `limite ${maxParticipants}`);
    }
    assert.equal((await get(s.url, '/api/admin/settings', admin)).body.maxParticipants, 5000);
    await setSettings({ maxParticipants: 16 });
  });
});

describe('padrões de qualidade (navegador)', () => {
  test('a sala oferece só até a máxima, começa na padrão e avisa da banda acima de 720p', async () => {
    await setSettings({ defaultQuality: '720p60', maxQuality: '1080p30' });
    const host = await newPage();
    await loginInBrowser(host.page, s.url);
    await host.page.click('#new-room');
    await host.page.click('#create-live');
    await host.page.waitForURL(/\/r\/[A-Za-z0-9_-]{22}#k=/);
    await host.page.fill('#name', 'Ana');
    await host.page.click('#join-form button');
    await host.page.waitForSelector('#room:not([hidden])');

    await host.page.click('#settings-btn');
    const options = await host.page.$$eval('#quality option', (os) => os.map((o) => o.value));
    assert.deepEqual(options, ['720p30', '720p60', '1080p30']);
    assert.equal(await host.page.inputValue('#quality'), '720p60');
    assert.ok(await host.page.isHidden('#quality-warning'), '720p não mostra aviso');

    await host.page.selectOption('#quality', '1080p30');
    assert.ok(await host.page.isVisible('#quality-warning'));
    assert.match(await host.page.textContent('#quality-warning'), /Cada pessoa recebe até 4,5 Mbps\. Confira a banda/);

    // Com alguém assistindo, o aviso mostra quanto o servidor envia
    const viewer = await newPage();
    await viewer.page.goto(await host.page.inputValue('#invite-link'));
    await viewer.page.fill('#name', 'Beto');
    await viewer.page.click('#join-form button');
    await viewer.page.waitForSelector('#room:not([hidden])');
    await host.page.keyboard.press('Escape');
    await host.page.waitForFunction(() => document.querySelector('#count').textContent.startsWith('2'));
    await host.page.click('#settings-btn');
    assert.match(await host.page.textContent('#quality-warning'), /Com 1 pessoa assistindo, o servidor envia cerca de 4,5 Mbps \(2 GB por hora\)/);

    await host.page.selectOption('#quality', '720p30');
    assert.ok(await host.page.isHidden('#quality-warning'));
    assert.deepEqual(host.errors, []);
    assert.deepEqual(viewer.errors, []);
    await setSettings({ defaultQuality: '720p30', maxQuality: '1440p60' });
  });

  test('o painel salva as qualidades e destaca a banda de salas grandes', async () => {
    const { page, errors } = await newPage();
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.waitForFunction(() => document.querySelector('#max').value === '16');
    assert.equal(await page.inputValue('#default-quality'), '720p30');
    assert.equal(await page.inputValue('#max-quality'), '1440p60');
    // 16 pessoas: 15 assistindo a 3 Mbps
    assert.match(await page.textContent('#max-hint'), /Sala cheia em 720p · 30 fps: o servidor envia cerca de 45 Mbps/);
    assert.doesNotMatch(await page.getAttribute('#max-hint', 'class'), /\bwarn\b/);

    await page.fill('#max', '300');
    assert.match(await page.textContent('#max-hint'), /cerca de 897 Mbps/);
    assert.match(await page.getAttribute('#max-hint', 'class'), /\bwarn\b/);

    await page.selectOption('#default-quality', '1080p30');
    await page.selectOption('#max-quality', '1080p60');
    await page.click('#settings-form button');
    await page.waitForSelector('#settings-ok:not([hidden])');
    const saved = (await get(s.url, '/api/admin/settings', admin)).body;
    assert.equal(saved.maxParticipants, 300);
    assert.equal(saved.defaultQuality, '1080p30');
    assert.equal(saved.maxQuality, '1080p60');
    assert.deepEqual(errors, []);
    await setSettings({ maxParticipants: 16, defaultQuality: '720p30', maxQuality: '1440p60' });
  });
});
