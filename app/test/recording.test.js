import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { api, createRoom, jwtPayload, loginInBrowser, setupAdmin, startServer, waitForLiveKit, launchBrowser } from './helpers.js';

const livekit = new RoomServiceClient('http://127.0.0.1:17880', process.env.TEST_API_KEY, process.env.TEST_API_SECRET);
let s;
let admin;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13090);
  admin = await setupAdmin(s);
  browser = await launchBrowser({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

describe('API', () => {
  test('aviso de gravação exige a chave de anfitrião e vai para os metadados da sala', async () => {
    const r = await createRoom(s.url, admin);
    assert.equal((await api(s.url, '/api/rooms/recording', { roomId: r.roomId, hostKey: 'chute', enabled: true })).status, 403);
    assert.equal((await api(s.url, '/api/rooms/recording', { roomId: r.roomId, hostKey: r.hostKey, enabled: 1 })).status, 400);
    assert.equal((await api(s.url, '/api/rooms/recording', { roomId: r.roomId, hostKey: r.hostKey, enabled: true })).status, 200);
    const name = jwtPayload((await api(s.url, '/api/token', { roomId: r.roomId })).body.token).video.room;
    assert.equal(JSON.parse((await livekit.listRooms([name]))[0].metadata).recording, true);
  });
});

describe('no navegador', () => {
  // Página do anfitrião; o script inicial troca o seletor de pasta (ou o remove, para testar o download)
  const hostPage = async (initScript) => {
    const context = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true });
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await loginInBrowser(page, s.url);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    await page.fill('#name', 'Ana');
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
    return page;
  };

  const viewerPage = async (link) => {
    const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    await page.goto(link);
    await page.fill('#name', 'Beto');
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
    return page;
  };

  const share = async (page) => {
    await page.click('#share');
    await page.waitForSelector('#share.on');
  };

  const messages = (page) => page.textContent('#messages');

  test('sem seletor de pasta: grava tela e voz e baixa um MP4 ao parar; a sala vê o aviso', async () => {
    const host = await hostPage(() => {
      window.showDirectoryPicker = undefined;
    });
    const viewer = await viewerPage(await host.inputValue('#invite-link'));
    await share(host);
    await host.click('#mic');
    await host.waitForSelector('#mic.on');

    await host.click('#record');
    await host.waitForSelector('#record.recording');
    await viewer.waitForSelector('#rec-badge:not([hidden])');
    await host.waitForTimeout(3000);

    const [download] = await Promise.all([host.waitForEvent('download'), host.click('#record')]);
    assert.match(download.suggestedFilename(), /^overshoulder-\d{4}-\d{2}-\d{2}-\d{4}-tela-parte1\.mp4$/);
    const file = fs.readFileSync(await download.path());
    assert.ok(file.length > 20_000, `${file.length} bytes`);
    assert.equal(file.subarray(4, 8).toString(), 'ftyp', 'cabeçalho MP4');
    assert.ok(file.includes(Buffer.from('avc1')), 'vídeo H.264');
    assert.ok(file.includes(Buffer.from('Opus')), 'áudio Opus');

    await viewer.waitForSelector('#rec-badge', { state: 'hidden' });
    assert.match(await messages(host), /Gravação salva: overshoulder-.*-tela-parte1\.mp4/);
    assert.deepEqual(host.errors, []);
  });

  test('com seletor de pasta: o arquivo cresce durante a gravação e cada trecho de vídeo vira uma parte', async () => {
    const host = await hostPage(() => {
      // Pasta falsa: registra o que seria escrito em cada arquivo
      window.__files = {};
      window.showDirectoryPicker = async () => ({
        getFileHandle: async (name) => ({
          createWritable: async () => {
            const f = (window.__files[name] = { writes: 0, bytes: 0, closed: false });
            return {
              write: async (blob) => {
                f.writes++;
                f.bytes += blob.size;
              },
              close: async () => {
                f.closed = true;
              },
            };
          },
        }),
      });
    });
    await share(host);
    await host.click('#record');
    await host.waitForSelector('#record.recording');
    await host.waitForFunction(() => Object.values(window.__files)[0]?.writes >= 2, null, { timeout: 10_000 });
    const growing = await host.evaluate(() => Object.values(window.__files)[0]);
    assert.equal(growing.closed, false, 'ainda gravando, o arquivo já recebeu dados');

    // Parar a tela fecha a parte 1; voltar a compartilhar abre a parte 2
    await host.click('#share');
    await host.waitForSelector('#share:not(.on)');
    await share(host);
    await host.waitForFunction(() => Object.keys(window.__files).length === 2, null, { timeout: 10_000 });
    await host.waitForTimeout(1500);
    await host.click('#record');
    await host.waitForSelector('#record:not(.recording)');

    const files = await host.evaluate(() => window.__files);
    const names = Object.keys(files).sort();
    assert.equal(names.length, 2);
    assert.match(names[0], /-tela-parte1\.webm$/, 'na pasta grava WebM, que cresce a cada segundo');
    assert.match(names[1], /-tela-parte2\.webm$/);
    for (const name of names) {
      assert.ok(files[name].closed, `${name} fechado`);
      assert.ok(files[name].bytes > 5_000, `${name}: ${files[name].bytes} bytes`);
    }
    assert.match(await messages(host), /Gravação salva na pasta escolhida: .*parte1\.webm, .*parte2\.webm/);
    assert.deepEqual(host.errors, []);
  });

  test('cancelar a escolha da pasta não começa a gravar', async () => {
    const host = await hostPage(() => {
      window.showDirectoryPicker = async () => {
        throw new DOMException('cancelado', 'AbortError');
      };
    });
    await share(host);
    await host.click('#record');
    await host.waitForTimeout(500);
    assert.ok(await host.isHidden('#rec-badge'));
    assert.equal(await host.getAttribute('#record', 'aria-pressed'), 'false');
    assert.doesNotMatch(await messages(host), /Gravando|Não foi possível/);
  });

  test('anfitrião fecha a aba gravando: o aviso some para a sala', async () => {
    const host = await hostPage(() => {
      window.showDirectoryPicker = undefined;
    });
    const viewer = await viewerPage(await host.inputValue('#invite-link'));
    await share(host);
    await host.click('#record');
    await viewer.waitForSelector('#rec-badge:not([hidden])');
    await host.close({ runBeforeUnload: true });
    await viewer.waitForSelector('#rec-badge', { state: 'hidden', timeout: 10_000 });
  });

  test('anfitrião some sem avisar (sem beacon): o servidor desliga o aviso sozinho', async () => {
    const host = await hostPage(() => {
      window.showDirectoryPicker = undefined;
      navigator.sendBeacon = () => true;
    });
    const viewer = await viewerPage(await host.inputValue('#invite-link'));
    await share(host);
    await host.click('#record');
    await viewer.waitForSelector('#rec-badge:not([hidden])');
    await host.context().close();
    // O LiveKit espera ~20 s por uma reconexão antes de dar o anfitrião como saído
    await viewer.waitForSelector('#rec-badge', { state: 'hidden', timeout: 45_000 });
  });

  test('quem recebe a vez de apresentar não grava', async () => {
    const host = await hostPage();
    const viewer = await viewerPage(await host.inputValue('#invite-link'));
    await host.click('#tab-people');
    await host.locator('#people li button[data-action="screen"]').first().click();
    await viewer.waitForSelector('#host-controls:not([hidden])');
    assert.ok(await viewer.isHidden('#record'));
  });
});
