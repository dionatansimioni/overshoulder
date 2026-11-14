import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
};

const PORT = Number(env('PORT', '3000'));
const API_KEY = env('LIVEKIT_API_KEY');
const API_SECRET = env('LIVEKIT_API_SECRET');
const INTERNAL_URL = env('LIVEKIT_INTERNAL_URL', 'http://127.0.0.1:7880');
const PUBLIC_URL = env('LIVEKIT_PUBLIC_URL');
const CREATE_PASSWORD = env('CREATE_PASSWORD');
const HOST_KEY_SECRET = env('HOST_KEY_SECRET');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_TTL = '8h';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const VENDOR_DIR = path.join(here, 'node_modules', 'livekit-client', 'dist');
// Só esses arquivos do livekit-client são servidos em /vendor/
const VENDOR_FILES = new Set(['livekit-client.esm.mjs', 'livekit-client.e2ee.worker.mjs']);

const rooms = new RoomServiceClient(INTERNAL_URL, API_KEY, API_SECRET);

// --- utilidades ---------------------------------------------------------

const hostKeyFor = (roomId) =>
  crypto.createHmac('sha256', HOST_KEY_SECRET).update(`host:${roomId}`).digest('base64url');

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const clientIp = (req) => {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
};

// Limite simples de tentativas de senha por IP
const failures = new Map();
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_MAX = 10;

const isBlocked = (ip) => {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > FAIL_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= FAIL_MAX;
};

const recordFailure = (ip) => {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > FAIL_WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' ws: wss:; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=()',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
};

const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4096) {
        reject(new Error('corpo muito grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const serveFile = async (res, file) => {
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
  } catch {
    send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
};

const roomExists = async (roomId) => (await rooms.listRooms([roomId])).length > 0;

// --- API ----------------------------------------------------------------

const createRoom = async (req, res) => {
  const ip = clientIp(req);
  if (isBlocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });

  const { password } = await readJson(req);
  if (!safeEqual(password ?? '', CREATE_PASSWORD)) {
    recordFailure(ip);
    return json(res, 403, { error: 'Senha incorreta.' });
  }

  const roomId = crypto.randomBytes(16).toString('base64url');
  await rooms.createRoom({ name: roomId, emptyTimeout: 300, departureTimeout: 60, maxParticipants: 16 });
  json(res, 201, { roomId, hostKey: hostKeyFor(roomId) });
};

const issueToken = async (req, res) => {
  const { roomId, hostKey, name } = await readJson(req);
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return json(res, 400, { error: 'Sala inválida.' });

  const isHost = typeof hostKey === 'string' && safeEqual(hostKey, hostKeyFor(roomId));
  if (!(await roomExists(roomId))) return json(res, 404, { error: 'Essa sala não existe ou já foi encerrada.' });

  const displayName = String(name ?? '').trim().slice(0, 32) || (isHost ? 'Anfitrião' : 'Espectador');
  const identity = `${isHost ? 'h' : 'v'}-${crypto.randomBytes(6).toString('hex')}`;

  const at = new AccessToken(API_KEY, API_SECRET, { identity, name: displayName, ttl: TOKEN_TTL });
  at.addGrant({
    room: roomId,
    roomJoin: true,
    canSubscribe: true,
    canPublishData: true,
    canPublish: isHost,
    canPublishSources: isHost
      ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.MICROPHONE]
      : [],
  });

  json(res, 200, { token: await at.toJwt(), url: PUBLIC_URL, role: isHost ? 'host' : 'viewer' });
};

const endRoom = async (req, res) => {
  const { roomId, hostKey } = await readJson(req);
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return json(res, 400, { error: 'Sala inválida.' });
  if (typeof hostKey !== 'string' || !safeEqual(hostKey, hostKeyFor(roomId)))
    return json(res, 403, { error: 'Apenas o anfitrião pode encerrar a sala.' });

  if (await roomExists(roomId)) await rooms.deleteRoom(roomId);
  json(res, 200, { ok: true });
};

// --- roteamento ---------------------------------------------------------

const routes = {
  'POST /api/rooms': createRoom,
  'POST /api/token': issueToken,
  'POST /api/rooms/end': endRoom,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    const handler = routes[`${req.method} ${p}`];
    if (handler) return await handler(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método não permitido.' });

    if (p === '/') return await serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    if (/^\/r\/[A-Za-z0-9_-]{22}$/.test(p)) return await serveFile(res, path.join(PUBLIC_DIR, 'room.html'));
    if (p.startsWith('/vendor/')) {
      const name = p.slice('/vendor/'.length);
      if (VENDOR_FILES.has(name)) return await serveFile(res, path.join(VENDOR_DIR, name));
    }
    if (/^\/static\/[a-z0-9.-]+$/.test(p)) return await serveFile(res, path.join(PUBLIC_DIR, p.slice('/static/'.length)));

    send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Erro interno.' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Overshoulder ouvindo em http://127.0.0.1:${PORT}`));
