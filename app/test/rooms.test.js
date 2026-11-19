import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { api, get, jwtPayload, launchBrowser, loginInBrowser, setupAdmin, startServer, waitForLiveKit } from './helpers.js';

const livekit = new RoomServiceClient('http://127.0.0.1:17880', process.env.TEST_API_KEY, process.env.TEST_API_SECRET);
let s;
let admin;
let browser;

before(async () => {
  await waitForLiveKit();
  s = await startServer(13120);
  admin = await setupAdmin(s);
  browser = await launchBrowser({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
});
after(async () => {
  await browser?.close();
  s?.stop();
});

const newRoom = async (body) => (await api(s.url, '/api/rooms', body, admin)).body;
const viewerToken = async (roomId) => (await api(s.url, '/api/token', { roomId, name: 'Beto' })).body;
const sources = (token) => [...(jwtPayload(token).video.canPublishSources ?? [])].sort();

describe('API', () => {
  test('tipo de sala: Live por padrão; Jogando juntos com telas livres por padrão', async () => {
    assert.equal((await api(s.url, '/api/rooms', { type: 'festa' }, admin)).status, 400);
    assert.equal((await api(s.url, '/api/rooms', { type: 'together', openScreens: 'sim' }, admin)).status, 400);

    const live = await newRoom({});
    assert.equal(live.type, 'live');
    assert.deepEqual(sources((await viewerToken(live.roomId)).token), [], 'na Live, quem assiste não publica nada');

    const together = await newRoom({ type: 'together' });
    assert.equal(together.openScreens, true);
    assert.deepEqual(sources((await viewerToken(together.roomId)).token), ['camera', 'microphone', 'screen_share', 'screen_share_audio']);

    const closed = await newRoom({ type: 'together', openScreens: false });
    assert.deepEqual(sources((await viewerToken(closed.roomId)).token), ['microphone'], 'todos falam, tela só com permissão');
    assert.equal((await newRoom({ type: 'live', openScreens: true })).openScreens, false, 'na Live a tela nunca é livre');
  });

  test('pedidos usam o token da própria sala', async () => {
    const live = await newRoom({});
    const { token } = await viewerToken(live.roomId);
    const request = (body) => api(s.url, '/api/rooms/request', body);
    assert.equal((await request({ kind: 'speak' })).status, 401);
    assert.equal((await request({ token: 'falso', kind: 'speak' })).status, 401);
    assert.equal((await request({ token: `${token}x`, kind: 'speak' })).status, 401, 'assinatura adulterada');
    assert.equal((await request({ token, kind: 'dançar' })).status, 400);
    const hostToken = (await api(s.url, '/api/token', { roomId: live.roomId, hostKey: live.hostKey })).body.token;
    assert.equal((await request({ token: hostToken, kind: 'speak' })).status, 400, 'o anfitrião não pede');

    // Na Live, os pedidos começam desligados: o anfitrião liga cada tipo
    assert.equal((await request({ token, kind: 'speak' })).status, 403, 'pedido desligado pelo anfitrião');
    const allow = (body) => api(s.url, '/api/rooms/allow-requests', { roomId: live.roomId, hostKey: live.hostKey, ...body });
    assert.deepEqual((await allow({ speak: true, screen: true })).body, { allowRequests: { speak: true, screen: true } });

    assert.deepEqual((await request({ token, kind: 'speak' })).body, { pending: true });
    const roomName = jwtPayload(token).video.room;
    const meta = async () => JSON.parse((await livekit.listRooms([roomName]))[0].metadata);
    assert.deepEqual((await meta()).requests, [{ identity: jwtPayload(token).sub, name: 'Beto', kind: 'speak' }]);
    assert.deepEqual((await request({ token, kind: 'speak', cancel: true })).body, { pending: false });
    assert.deepEqual((await meta()).requests, []);

    // Depois de o link ser trocado, o token antigo continua valendo para quem já está na sala
    await api(s.url, '/api/rooms/link', { roomId: live.roomId, hostKey: live.hostKey });
    assert.equal((await request({ token, kind: 'screen' })).status, 200);
  });

  test('pedidos da Live: só o anfitrião liga e desliga; desligar limpa a fila', async () => {
    const live = await newRoom({});
    const { token } = await viewerToken(live.roomId);
    const roomName = jwtPayload(token).video.room;
    const meta = async () => JSON.parse((await livekit.listRooms([roomName]))[0].metadata);
    const allow = (body) => api(s.url, '/api/rooms/allow-requests', body);
    assert.deepEqual((await meta()).allowRequests, { speak: false, screen: false }, 'começam desligados');

    // Permissões: sem a chave de anfitrião, com chave errada, ou com o token de quem assiste
    assert.notEqual((await allow({ roomId: live.roomId, speak: true })).status, 200);
    assert.notEqual((await allow({ roomId: live.roomId, hostKey: 'x'.repeat(43), speak: true })).status, 200);
    assert.notEqual((await allow({ token, speak: true })).status, 200, 'quem assiste não liga os pedidos');
    // Entrada malformada
    const host = { roomId: live.roomId, hostKey: live.hostKey };
    for (const body of [{}, { speak: 'sim' }, { screen: 1 }, { speak: null }]) {
      assert.equal((await allow({ ...host, ...body })).status, 400, JSON.stringify(body));
    }
    assert.deepEqual((await meta()).allowRequests, { speak: false, screen: false }, 'nada mudou');
    // Na sala "Jogando juntos" não existe essa opção
    const together = await newRoom({ type: 'together' });
    assert.equal((await allow({ roomId: together.roomId, hostKey: together.hostKey, speak: true })).status, 400);

    assert.equal((await allow({ ...host, speak: true })).status, 200);
    assert.deepEqual((await meta()).allowRequests, { speak: true, screen: false }, 'só o que foi mandado muda');
    const request = (body) => api(s.url, '/api/rooms/request', { token, ...body });
    assert.equal((await request({ kind: 'screen' })).status, 403, 'tela continua desligada');
    assert.equal((await request({ kind: 'speak' })).status, 200);
    assert.equal((await meta()).requests.length, 1);
    // Desligar descarta os pedidos daquele tipo; desistir de um pedido continua valendo
    assert.equal((await allow({ ...host, speak: false })).status, 200);
    assert.deepEqual((await meta()).requests, []);
    assert.equal((await request({ kind: 'speak', cancel: true })).status, 200);
  });

  test('link velho: a verificação diz se a sala existe, sem entregar nada além disso', async () => {
    const check = (roomId) => api(s.url, '/api/rooms/check', { roomId });
    const live = await newRoom({});
    const ok = await check(live.roomId);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { exists: true }, 'nem tipo, nem título, nem quem está');
    assert.equal((await check('b'.repeat(22))).status, 404, 'código que nunca existiu');

    // Link trocado: o código antigo some; o novo vale
    const { roomId: fresh } = (await api(s.url, '/api/rooms/link', { roomId: live.roomId, hostKey: live.hostKey })).body;
    assert.equal((await check(live.roomId)).status, 404);
    assert.equal((await check(fresh)).status, 200);

    // Sala encerrada
    assert.equal((await api(s.url, '/api/rooms/end', { roomId: fresh, hostKey: live.hostKey })).status, 200);
    const gone = await check(fresh);
    assert.equal(gone.status, 404);
    assert.match(gone.body.error, /não existe/);

    for (const roomId of [undefined, null, 42, [], {}, 'curto', 'b'.repeat(23), '../'.repeat(8)])
      assert.equal((await check(roomId)).status, 400, JSON.stringify(roomId));
  });

  test('Jogando juntos: o anfitrião libera ou fecha a tela para todos com a sala no ar', async () => {
    const together = await newRoom({ type: 'together', openScreens: false });
    const { token } = await viewerToken(together.roomId);
    const roomName = jwtPayload(token).video.room;
    const meta = async () => JSON.parse((await livekit.listRooms([roomName]))[0].metadata);
    const open = (body) => api(s.url, '/api/rooms/open-screens', body);
    const host = { roomId: together.roomId, hostKey: together.hostKey };
    assert.deepEqual(sources((await viewerToken(together.roomId)).token), ['microphone']);

    assert.notEqual((await open({ roomId: together.roomId, enabled: true })).status, 200, 'sem chave de anfitrião');
    assert.notEqual((await open({ token, enabled: true })).status, 200, 'quem assiste não muda');
    for (const enabled of [undefined, 'sim', 1, null]) assert.equal((await open({ ...host, enabled })).status, 400, String(enabled));
    const live = await newRoom({});
    assert.equal((await open({ roomId: live.roomId, hostKey: live.hostKey, enabled: true })).status, 400, 'a Live não tem essa opção');

    assert.deepEqual((await open({ ...host, enabled: true })).body, { openScreens: true });
    assert.equal((await meta()).openScreens, true);
    assert.deepEqual(sources((await viewerToken(together.roomId)).token), ['camera', 'microphone', 'screen_share', 'screen_share_audio']);
    assert.deepEqual((await open({ ...host, enabled: false })).body, { openScreens: false });
    assert.deepEqual(sources((await viewerToken(together.roomId)).token), ['microphone']);
  });

  test('limite de pessoas da sala: o anfitrião muda com ela no ar; o do servidor vale na hora', async () => {
    const room = await newRoom({});
    const { token } = await viewerToken(room.roomId);
    const roomName = jwtPayload(token).video.room;
    const meta = async () => JSON.parse((await livekit.listRooms([roomName]))[0].metadata);
    const limit = (body) => api(s.url, '/api/rooms/limit', body);
    const host = { roomId: room.roomId, hostKey: room.hostKey };
    const server = (await get(s.url, '/api/admin/settings', admin)).body.maxParticipants;
    assert.equal((await meta()).maxParticipants, server, 'começa com o limite do servidor');
    assert.equal((await meta()).customLimit, false);

    assert.notEqual((await limit({ roomId: room.roomId, max: 10 })).status, 200, 'sem chave de anfitrião');
    assert.notEqual((await limit({ token, max: 10 })).status, 200, 'quem assiste não muda');
    for (const max of [undefined, 1, 5001, 2.5, '10', true, []]) assert.equal((await limit({ ...host, max })).status, 400, JSON.stringify(max));

    assert.deepEqual((await limit({ ...host, max: 10 })).body, { maxParticipants: 10, customLimit: true });
    assert.equal((await meta()).maxParticipants, 10);
    assert.deepEqual((await limit({ ...host, max: null })).body.customLimit, false);

    // O admin muda o limite do servidor: as salas no ar mostram o novo na hora
    assert.equal((await api(s.url, '/api/admin/settings', { maxParticipants: 77 }, admin)).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await meta()).maxParticipants, 77);
    await api(s.url, '/api/admin/settings', { maxParticipants: server }, admin);
  });

  test('posição da câmera só aceita valores conhecidos', async () => {
    const room = await newRoom({ type: 'together' });
    const { token } = await viewerToken(room.roomId);
    for (const pip of [undefined, {}, { corner: 'meio', size: 'm', shape: 'rounded' }, { corner: 'br', size: 'xl', shape: 'rounded' }, { corner: 'br', size: 'm', shape: '<b>' }]) {
      assert.equal((await api(s.url, '/api/rooms/layout', { token, pip })).status, 400, JSON.stringify(pip));
    }
  });
});

describe('no navegador', () => {
  // Guarda as conexões WebRTC da página, para contar quantos vídeos estão chegando de fato
  const WATCH_PEER_CONNECTIONS = () => {
    window.__pcs = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new Original(...args);
      window.__pcs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
  };

  // Fluxos de vídeo recebendo quadros agora (decodificados nos últimos instantes)
  const liveVideoStreams = async (p) => {
    const frames = () =>
      p.evaluate(async () => {
        const out = {};
        for (const pc of window.__pcs) {
          (await pc.getStats()).forEach((r) => {
            if (r.type === 'inbound-rtp' && r.kind === 'video') out[r.id] = r.framesDecoded ?? 0;
          });
        }
        return out;
      });
    const first = await frames();
    await p.waitForTimeout(1500);
    const second = await frames();
    return Object.keys(second).filter((id) => second[id] > (first[id] ?? 0)).length;
  };

  const page = async (initScript) => {
    const context = await browser.newContext({ permissions: ['microphone', 'camera'], acceptDownloads: true });
    if (initScript) await context.addInitScript(initScript);
    const p = await context.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    p.on('response', async (r) => {
      if (r.url().endsWith('/api/token') && r.ok()) p.lk = await r.json().catch(() => ({}));
    });
    return p;
  };

  const hostRoom = async (type, { openScreens = true, initScript } = {}) => {
    const host = await page();
    if (initScript) await host.context().addInitScript(initScript);
    await loginInBrowser(host, s.url);
    await host.click('#new-room');
    if (type === 'together' && !openScreens) {
      await host.click('#more-options summary');
      await host.uncheck('#open-screens');
    }
    await host.click(`#create-${type}`);
    await host.waitForURL(/#k=/);
    await host.fill('#name', 'Ana');
    await host.click('#join-form button');
    await host.waitForSelector('#room:not([hidden])');
    return host;
  };

  const join = async (link, name, initScript) => {
    const p = await page(initScript);
    await p.goto(link);
    await p.fill('#name', name);
    await p.click('#join-form button');
    await p.waitForSelector('#room:not([hidden])');
    return p;
  };

  const share = async (p) => {
    await p.click('#share');
    await p.waitForSelector('#share.on');
  };

  test('Jogando juntos: todos falam e duas pessoas mostram a tela ao mesmo tempo', async () => {
    const host = await hostRoom('together');
    const link = await host.inputValue('#invite-link');
    const beto = await join(link, 'Beto');
    const carla = await join(link, 'Carla', WATCH_PEER_CONNECTIONS);
    for (const id of ['#mic', '#share', '#camera']) assert.ok(await carla.isVisible(id), `${id} para todos`);
    assert.ok(await carla.isHidden('#raise-hand'));
    assert.ok(await carla.isHidden('#ask-screen'));
    assert.ok(await carla.isHidden('#end'));

    await share(host);
    await share(beto);
    await carla.waitForFunction(() => document.querySelectorAll('#screens .screen-chip').length === 2);
    const chips = carla.locator('#screens .screen-chip');
    assert.deepEqual((await chips.allTextContents()).sort(), ['Tela de Ana', 'Tela de Beto']);

    for (const name of ['Ana', 'Beto']) {
      await carla.click(`#screens .screen-chip:has-text("Tela de ${name}")`);
      await carla.waitForFunction((n) => document.querySelector('#presenter-badge').textContent === `${n} está apresentando`, name);
      await carla.waitForFunction(() => document.querySelector('#video').videoWidth > 0 && !document.querySelector('#video').paused);
      assert.equal(await carla.getAttribute(`#screens .screen-chip:has-text("Tela de ${name}")`, 'aria-selected'), 'true');
      // Duas telas ao vivo, mas só a escolhida chega: economiza a banda de quem assiste
      assert.equal(await liveVideoStreams(carla), 1, `só a tela de ${name} chegando`);
    }

    // Quem fala aparece na lista; a voz de Carla chega aos outros
    await carla.click('#mic');
    await carla.waitForSelector('#mic.on');
    await host.click('#tab-people');
    await host.waitForFunction(
      (id) => document.querySelector(`#people li[data-identity="${id}"]`)?.textContent.includes('microfone'),
      carla.lk.identity,
    );
    for (const p of [host, beto, carla]) assert.deepEqual(p.errors, []);
  });

  test('Jogando juntos com tela sob pedido: pedir, o anfitrião ver e aprovar', async () => {
    const host = await hostRoom('together', { openScreens: false });
    const beto = await join(await host.inputValue('#invite-link'), 'Beto');
    assert.ok(await beto.isVisible('#mic'), 'todos falam');
    assert.ok(await beto.isHidden('#share'));
    await beto.click('#ask-screen');
    await beto.waitForSelector('#ask-screen[aria-pressed="true"]');

    await host.waitForSelector('#requests-count:not([hidden])');
    assert.equal(await host.textContent('#requests-count'), '1');
    await host.click('#tab-people');
    const request = host.locator(`#requests li[data-identity="${beto.lk.identity}"][data-kind="screen"]`);
    await request.waitFor();
    assert.match(await request.textContent(), /Beto pediu para mostrar a tela/);
    await request.locator('button', { hasText: 'Aprovar' }).click();

    await beto.waitForSelector('#share:not([hidden])');
    assert.ok(await beto.isVisible('#camera'));
    await beto.waitForSelector('#ask-screen', { state: 'hidden' });
    await host.waitForSelector('#requests-count', { state: 'hidden' });
    assert.match(await beto.textContent('#messages'), /O anfitrião liberou você para mostrar a tela/);
  });

  test('Live: pedir a palavra, o anfitrião liberar e depois tirar', async () => {
    const host = await hostRoom('live');
    const beto = await join(await host.inputValue('#invite-link'), 'Beto');
    const roomName = jwtPayload(beto.lk.token).video.room;
    assert.ok(await beto.isHidden('#mic'));
    assert.ok(await beto.isHidden('#raise-hand'), 'pedir a palavra só depois de o anfitrião ligar');
    await host.click('#tab-people');
    await host.check('#allow-speak');
    await beto.waitForSelector('#raise-hand:not([hidden])');
    await beto.click('#raise-hand');
    const request = host.locator(`#requests li[data-identity="${beto.lk.identity}"][data-kind="speak"]`);
    await request.waitFor();
    // Desistir tira o pedido da fila do anfitrião
    await beto.click('#raise-hand');
    await request.waitFor({ state: 'detached' });
    await beto.click('#raise-hand');
    await request.waitFor();
    await request.locator('button', { hasText: 'Aprovar' }).click();

    await beto.waitForSelector('#mic:not([hidden])');
    assert.ok(await beto.isHidden('#share'), 'falar não libera a tela');
    const perm = (await livekit.listParticipants(roomName)).find((p) => p.identity === beto.lk.identity).permission;
    assert.deepEqual([...perm.canPublishSources], [2], 'só microfone');
    await beto.click('#mic');
    await beto.waitForSelector('#mic.on');

    await host.locator(`#people li[data-identity="${beto.lk.identity}"] button[data-action="speak"]`, { hasText: 'Tirar' }).click();
    await beto.waitForSelector('#mic', { state: 'hidden' });
    assert.match(await beto.textContent('#messages'), /O anfitrião encerrou sua fala/);
  });

  test('webcam sobre a tela: posição escolhida por quem transmite; esconder e inverter para quem assiste', async () => {
    const host = await hostRoom('live');
    const beto = await join(await host.inputValue('#invite-link'), 'Beto');
    await share(host);
    await host.click('#camera');
    await host.waitForSelector('#camera.on');
    await beto.waitForSelector('#pip:not([hidden])');
    assert.equal(await beto.getAttribute('#pip', 'class'), 'pip pip-br pip-m pip-rounded');
    const small = await beto.evaluate(
      () => document.querySelector('#pip').getBoundingClientRect().width / document.querySelector('#player').getBoundingClientRect().width,
    );
    assert.ok(small > 0.2 && small < 0.28, `câmera média ocupa ~24% da largura: ${small}`);
    await beto.waitForFunction(() => document.querySelector('#pip').videoWidth > 0);

    await host.click('#settings-btn');
    await host.click('#pip-layout [data-corner="tl"]');
    await host.click('#pip-layout [data-size="l"]');
    await host.click('#pip-layout [data-shape="circle"]');
    await beto.waitForFunction(() => document.querySelector('#pip').className === 'pip pip-tl pip-l pip-circle');
    // Tamanho e posição reais (não só a classe): grande = ~34% da largura, no canto superior esquerdo
    await beto.waitForTimeout(300);
    const box = await beto.evaluate(() => {
      const player = document.querySelector('#player').getBoundingClientRect();
      const pip = document.querySelector('#pip').getBoundingClientRect();
      return { ratio: pip.width / player.width, left: pip.left - player.left, top: pip.top - player.top, round: pip.width === pip.height };
    });
    assert.ok(box.ratio > 0.3 && box.ratio < 0.38, `largura ${box.ratio}`);
    assert.ok(box.left < 30 && box.top < 30, `posição ${box.left},${box.top}`);
    assert.ok(box.round, 'círculo é quadrado na caixa');
    assert.equal(await host.getAttribute('#pip-layout [data-corner="tl"]', 'aria-pressed'), 'true');

    await beto.click('#pip-hide');
    await beto.waitForSelector('#pip', { state: 'hidden' });
    await beto.click('#pip-hide');
    await beto.waitForSelector('#pip:not([hidden])');
    const before = await beto.evaluate(() => document.querySelector('#video').videoWidth);
    await beto.click('#pip-swap');
    await beto.waitForFunction((w) => document.querySelector('#video').videoWidth !== w, before);
    assert.equal(await beto.getAttribute('#pip-swap', 'aria-pressed'), 'true');
    assert.deepEqual(beto.errors, []);
  });

  test('só a câmera, sem tela: a câmera vira o vídeo principal', async () => {
    const host = await hostRoom('live');
    const beto = await join(await host.inputValue('#invite-link'), 'Beto');
    await host.click('#camera');
    await beto.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
    assert.ok(await beto.isHidden('#pip'));
    assert.ok(await beto.isHidden('#overlay'));
    assert.ok(await beto.isHidden('#voice-stage'), 'com câmera, a tela de voz some');
  });

  test('gravação com câmera: tela e câmera em arquivos separados', async () => {
    const host = await hostRoom('live', { initScript: () => (window.showDirectoryPicker = undefined) });
    await share(host);
    await host.click('#camera');
    await host.waitForSelector('#camera.on');
    await host.click('#record');
    await host.waitForSelector('#record.recording');
    await host.waitForTimeout(2500);
    const downloads = [];
    host.on('download', (d) => downloads.push(d));
    await host.click('#record');
    await host.waitForFunction(() => /Gravação salva/.test(document.querySelector('#messages').textContent));
    await host.waitForTimeout(500);
    const names = downloads.map((d) => d.suggestedFilename()).sort();
    assert.equal(names.length, 2, names.join(', '));
    assert.match(names[0], /-camera-parte1\.mp4$/);
    assert.match(names[1], /-tela-parte1\.mp4$/);
    const camera = fs.readFileSync(await downloads.find((d) => d.suggestedFilename().includes('camera')).path());
    assert.ok(camera.includes(Buffer.from('avc1')), 'câmera em vídeo');
    assert.ok(!camera.includes(Buffer.from('Opus')), 'câmera sem áudio');
  });
});
