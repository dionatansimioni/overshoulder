import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { addUsage, monthOf, outgoingBytes } from '../usage.js';
import { api, get, launchBrowser, loginInBrowser, sessionFrom, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

// LiveKit falso: só a página de métricas, com o contador de bytes enviados que cada teste escolher
const metrics = { bytes: 0 };
let mock;
const METRICS_URL = 'http://127.0.0.1:13398/metrics';
const metricsText = () =>
  [
    '# TYPE livekit_packet_bytes counter',
    `livekit_packet_bytes{country="",direction="outgoing",node_id="N",node_type="MEDIA",transmission="initial"} ${metrics.bytes * 0.9}`,
    `livekit_packet_bytes{country="",direction="outgoing",node_id="N",node_type="MEDIA",transmission="retransmit"} ${metrics.bytes * 0.1}`,
    'livekit_packet_bytes{country="",direction="incoming",node_id="N",node_type="MEDIA",transmission="initial"} 999999999999',
  ].join('\n');

const servers = [];
const fresh = async (port, env = {}) => {
  const s = await startServer(port, { LIVEKIT_METRICS_URL: METRICS_URL, USAGE_POLL_MS: '100', ...env });
  servers.push(s);
  return s;
};
const usage = async (s, admin) => (await get(s.url, '/api/admin/usage', admin)).body;
const tick = () => new Promise((r) => setTimeout(r, 400));

before(async () => {
  await waitForLiveKit();
  mock = http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(metricsText());
    })
    .listen(13398, '127.0.0.1');
});
after(() => {
  servers.forEach((s) => s.stop());
  mock?.close();
});

describe('leitura das métricas e meses', () => {
  test('soma só os bytes enviados, de todas as séries, e ignora lixo', () => {
    metrics.bytes = 1000;
    assert.equal(outgoingBytes(metricsText()), 1000);
    assert.equal(outgoingBytes(''), 0);
    assert.equal(outgoingBytes('livekit_packet_bytes{direction="outgoing"} NaN\nlivekit_packet_bytes{direction="outgoing"} -5'), 0);
    assert.equal(outgoingBytes('outro_livekit_packet_bytes{direction="outgoing"} 50'), 0);
  });

  test('virada do mês passa o total para o histórico, com no máximo 12 meses', () => {
    const u = addUsage({}, 10, '2026-01');
    assert.deepEqual(u, { month: '2026-01', bytesOut: 10, warned: 0 });
    addUsage(u, 5, '2026-01');
    addUsage(u, 1, '2026-02');
    assert.equal(u.bytesOut, 1);
    assert.deepEqual(u.history, [{ month: '2026-01', bytesOut: 15 }]);
    for (let m = 3; m <= 15; m++) addUsage(u, m, `2027-${String(m).padStart(2, '0')}`);
    assert.equal(u.history.length, 12);
  });
});

describe('painel de uso', () => {
  test('soma as diferenças do contador, inclusive quando o LiveKit reinicia, e guarda no disco', async () => {
    metrics.bytes = 5e9;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overshoulder-usage-'));
    fs.writeFileSync(
      path.join(dataDir, 'state.json'),
      JSON.stringify({ version: 1, users: [], invites: [], settings: {}, usage: { month: '2026-01', bytesOut: 7e9 } }),
    );
    let s = await fresh(13310, { DATA_DIR: dataDir });
    const admin = await setupAdmin(s);
    await tick();
    // A primeira leitura é só a referência: o que veio antes de o app subir não conta
    let u = await usage(s, admin);
    assert.equal(u.metrics, true);
    assert.equal(u.month, monthOf());
    assert.equal(u.bytesOut, 0);
    assert.deepEqual(u.history, [{ month: '2026-01', bytesOut: 7e9 }]);
    metrics.bytes = 7e9;
    await tick();
    assert.equal((await usage(s, admin)).bytesOut, 2e9);
    // LiveKit reiniciou: o contador voltou para perto de zero
    metrics.bytes = 0.5e9;
    await tick();
    assert.equal((await usage(s, admin)).bytesOut, 2.5e9);

    s.stop();
    s = await fresh(13311, { DATA_DIR: dataDir });
    const again = { cookie: sessionFrom(await api(s.url, '/api/login', { username: 'admin', password: 'cavalo correto bateria grampo' })) };
    u = await usage(s, again);
    assert.equal(u.bytesOut, 2.5e9);
  });

  test('franquia: aviso a partir de 80%, nos logs uma vez', async () => {
    metrics.bytes = 0;
    const s = await fresh(13312);
    const admin = await setupAdmin(s);
    await tick();
    assert.equal((await api(s.url, '/api/admin/settings', { monthlyQuotaGb: 2 }, admin)).status, 200);
    metrics.bytes = 1.7e9;
    await tick();
    let u = await usage(s, admin);
    assert.equal(u.quotaGb, 2);
    assert.equal(u.percent, 85);
    assert.equal(u.warning, true);
    metrics.bytes = 1.8e9;
    await tick();
    assert.equal(s.output().match(/franquia de dados do mês/g).length, 1);
    assert.equal((await api(s.url, '/api/admin/settings', { monthlyQuotaGb: 0 }, admin)).status, 200);
    u = await usage(s, admin);
    assert.equal(u.percent, null);
    assert.equal(u.warning, false);
  });

  test('mostra as salas no ar e avisa quando as métricas não respondem', async () => {
    const s = await fresh(13313, { LIVEKIT_METRICS_URL: 'http://127.0.0.1:1/metrics' });
    const admin = await setupAdmin(s);
    const before = (await usage(s, admin)).live.rooms;
    assert.equal((await api(s.url, '/api/rooms', {}, admin)).status, 201);
    const u = await usage(s, admin);
    assert.equal(u.metrics, false);
    assert.equal(u.live.rooms, before + 1);
    assert.equal(typeof u.live.participants, 'number');
  });

  test('só o admin vê; a franquia só aceita números de 0 a 1000000', async () => {
    const s = await fresh(13314);
    const admin = await setupAdmin(s);
    assert.equal((await get(s.url, '/api/admin/usage')).status, 401);
    const inv = await api(s.url, '/api/admin/invites', {}, admin);
    const r = await api(s.url, '/api/invites/accept', {
      token: inv.body.path.split('#')[1],
      username: 'bia',
      password: 'frase comprida da transmissora',
    });
    assert.equal((await get(s.url, '/api/admin/usage', { cookie: sessionFrom(r) })).status, 403);
    for (const bad of [-1, '10', null, 1e7, {}, []]) {
      assert.equal((await api(s.url, '/api/admin/settings', { monthlyQuotaGb: bad }, admin)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api(s.url, '/api/admin/settings', { monthlyQuotaGb: 1e300 * 10 }, admin)).status, 400);
  });
});

describe('painel de uso no navegador', () => {
  let browser;
  before(async () => (browser = await launchBrowser()));
  after(() => browser?.close());

  test('o admin vê os números, salva a franquia e é avisado na página inicial', async () => {
    metrics.bytes = 0;
    const s = await fresh(13315);
    await setupAdmin(s);
    await tick();
    metrics.bytes = 9e9;
    await tick();
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await loginInBrowser(page, s.url);
    assert.equal(await page.isHidden('#usage-notice'), true);
    await page.goto(`${s.url}/admin#uso`);
    await page.waitForSelector('#uso:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#usage-month').textContent.includes('GB'));
    assert.match(await page.textContent('#usage-month'), /^9([.,]0+)? GB$/);
    assert.equal(await page.isHidden('#usage-quota'), true);
    await page.fill('#quota', '10');
    await page.click('#quota-form button');
    await page.waitForSelector('#quota-ok:not([hidden])');
    assert.equal(await page.isVisible('#usage-quota'), true);
    assert.match(await page.textContent('#usage-quota-text'), /90% da franquia de 10 GB/);
    await page.goto(`${s.url}/`);
    await page.waitForSelector('#usage-notice:not([hidden])');
    assert.match(await page.textContent('#usage-notice'), /90%/);
    assert.deepEqual(errors, []);
  });
});
