import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { api, createRoom, get, jwtPayload, loginInBrowser, setupAdmin, startServer, waitForLiveKit, launchBrowser } from './helpers.js';

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

// Caixas de nível superior de um MP4 e a duração do filme (mvhd), para conferir que o arquivo não é fragmentado
const topLevel = (b) => {
  const out = [];
  for (let at = 0; at + 8 <= b.length; at += b.readUInt32BE(at)) out.push(b.toString('latin1', at + 4, at + 8));
  return out;
};
const movieDuration = (b) => {
  let at = 0;
  while (b.toString('latin1', at + 4, at + 8) !== 'moov') at += b.readUInt32BE(at);
  const mvhd = at + 8;
  return b.readUInt32BE(mvhd + 24) / b.readUInt32BE(mvhd + 20);
};

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

describe('gravação experimental: configuração', () => {
  const recordingOf = async (r) => (await api(s.url, '/api/token', { roomId: r.roomId, hostKey: r.hostKey })).body.recording;

  test('vem desligada; o admin liga por padrão no servidor e o token informa', async () => {
    const r = await createRoom(s.url, admin);
    assert.equal((await get(s.url, '/api/admin/settings', admin)).body.recording, false);
    assert.equal(await recordingOf(r), false);
    assert.equal((await api(s.url, '/api/admin/settings', { recording: true }, admin)).status, 200);
    try {
      assert.equal((await get(s.url, '/api/admin/settings', admin)).body.recording, true);
      assert.equal(await recordingOf(r), true);
    } finally {
      await api(s.url, '/api/admin/settings', { recording: false }, admin);
    }
    assert.equal(await recordingOf(r), false);
  });

  test('valor que não é verdadeiro ou falso é recusado, e sem sessão de admin não muda nada', async () => {
    for (const bad of ['sim', 1, null, {}, []]) {
      assert.equal((await api(s.url, '/api/admin/settings', { recording: bad }, admin)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api(s.url, '/api/admin/settings', { recording: true })).status, 401);
    assert.equal((await get(s.url, '/api/admin/settings', admin)).body.recording, false);
  });
});

describe('no navegador', () => {
  // Página do anfitrião; o script inicial troca o seletor de pasta (ou o remove, para testar o download)
  const hostPage = async (initScript) => {
    const context = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true });
    // A gravação é experimental e vem desligada: estes testes ligam como o anfitrião faria nos ajustes
    await context.addInitScript(() => { try { localStorage.setItem('recording', '1'); } catch {} });
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
    // AAC quando o navegador grava AAC (Chrome no Windows e no Mac); senão, Opus
    assert.ok(file.includes(Buffer.from('mp4a')) || file.includes(Buffer.from('Opus')), 'áudio AAC ou Opus');

    // Reescrito como MP4 comum (índice e duração): o Windows e os editores conseguem pular na timeline
    assert.deepEqual(topLevel(file), ['ftyp', 'moov', 'mdat'], 'moov antes do mdat, sem fragmentos');
    assert.ok(movieDuration(file) > 1, `duração no cabeçalho: ${movieDuration(file)} s`);

    await viewer.waitForSelector('#rec-badge', { state: 'hidden' });
    assert.match(await messages(host), /Gravação salva: overshoulder-.*-tela-parte1\.mp4/);
    assert.deepEqual(host.errors, []);
  });

  test('com seletor de pasta: grava MP4 e cada trecho de vídeo vira uma parte', async () => {
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
    // O navegador só grava o arquivo final ao fechar; durante a gravação ele está aberto
    await host.waitForFunction(() => Object.keys(window.__files).length === 1, null, { timeout: 10_000 });
    await host.waitForTimeout(2000);
    assert.equal(await host.evaluate(() => Object.values(window.__files)[0].closed), false, 'ainda gravando');

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
    assert.match(names[0], /-tela-parte1\.mp4$/, 'na pasta também grava MP4, o formato que abre em mais programas');
    assert.match(names[1], /-tela-parte2\.mp4$/);
    for (const name of names) {
      assert.ok(files[name].closed, `${name} fechado`);
      assert.ok(files[name].bytes > 5_000, `${name}: ${files[name].bytes} bytes`);
    }
    assert.match(await messages(host), /Gravação salva na pasta escolhida: .*parte1\.mp4, .*parte2\.mp4/);
    assert.deepEqual(host.errors, []);
  });

  test('na pasta, o MP4 gravado é reescrito como MP4 comum ao parar', async () => {
    // OPFS é uma pasta de verdade do navegador, com getFile() e createWritable()
    const host = await hostPage(() => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) await root.removeEntry(name);
        return root;
      };
    });
    await share(host);
    await host.click('#record');
    await host.waitForSelector('#record.recording');
    await host.waitForTimeout(3000);
    await host.click('#record');
    await host.waitForSelector('#record:not(.recording)');
    await host.waitForFunction(() => /Gravação salva na pasta/.test(document.querySelector('#messages').textContent));
    const bytes = await host.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name, handle] of root.entries()) if (name.endsWith('.mp4')) return [...new Uint8Array(await (await handle.getFile()).arrayBuffer())];
      return null;
    });
    assert.ok(bytes, 'arquivo na pasta');
    const file = Buffer.from(bytes);
    assert.deepEqual(topLevel(file), ['ftyp', 'moov', 'mdat']);
    assert.ok(movieDuration(file) > 1, `duração: ${movieDuration(file)} s`);
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

  test('vem desligada: o botão só aparece quando o anfitrião liga nos ajustes, com aviso de desempenho', async () => {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    await loginInBrowser(page, s.url);
    await page.click('#new-room');
    await page.click('#create-live');
    await page.waitForURL(/#k=/);
    await page.fill('#name', 'Ana');
    await page.click('#join-form button');
    await page.waitForSelector('#room:not([hidden])');
    assert.ok(await page.isHidden('#record'), 'sem ligar, não há botão');

    await page.click('#settings-btn');
    assert.match(await page.textContent('#recording-settings'), /experimental/);
    // Recusar o aviso deixa tudo como estava
    let dialog = null;
    page.once('dialog', (d) => ((dialog = d.message()), d.dismiss()));
    await page.check('#recording-enabled', { noWaitAfter: true }).catch(() => {});
    assert.match(dialog, /experimental.*processador.*mais lentos/s);
    assert.equal(await page.isChecked('#recording-enabled'), false);
    assert.ok(await page.isHidden('#record'));

    page.once('dialog', (d) => d.accept());
    await page.check('#recording-enabled');
    await page.waitForSelector('#record:not([hidden])');
    // A escolha fica neste navegador
    await page.reload();
    await page.fill('#name', 'Ana');
    await page.click('#join-form button');
    await page.waitForSelector('#record:not([hidden])');

    await page.click('#settings-btn');
    await page.uncheck('#recording-enabled');
    await page.waitForSelector('#record', { state: 'hidden' });
    await context.close();
  });

  test('no painel de administração: ligar pede confirmação e salva o padrão do servidor', async () => {
    const page = await (await browser.newContext()).newPage();
    await loginInBrowser(page, s.url);
    await page.goto(`${s.url}/admin`);
    await page.waitForSelector('#recording');
    assert.equal(await page.isChecked('#recording'), false);
    page.once('dialog', (d) => d.dismiss());
    await page.check('#recording', { noWaitAfter: true }).catch(() => {});
    assert.equal(await page.isChecked('#recording'), false, 'recusar o aviso não liga');
    page.once('dialog', (d) => d.accept());
    await page.check('#recording');
    await page.click('#settings-form button[type="submit"]');
    await page.waitForSelector('#settings-ok:not([hidden])');
    try {
      assert.equal((await get(s.url, '/api/admin/settings', admin)).body.recording, true);
    } finally {
      await api(s.url, '/api/admin/settings', { recording: false }, admin);
    }
    await page.context().close();
  });

  test('quem só assiste não vê a gravação nos ajustes', async () => {
    const host = await hostPage();
    const viewer = await viewerPage(await host.inputValue('#invite-link'));
    await viewer.click('#settings-btn');
    assert.ok(await viewer.isHidden('#recording-settings'));
    assert.ok(await viewer.isHidden('#record'));
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
