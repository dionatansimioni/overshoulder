import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import {
  USERNAME_RE,
  createLimiter,
  createSessions,
  hashPassword,
  parseCookies,
  passwordProblem,
  randomToken,
  safeEqual,
  sha256,
  verifyPasswordOrDummy,
} from './auth.js';
import { renderSVG } from 'uqr';
import { log } from './log.js';
import { createStore } from './store.js';
import { newRecoveryCodes, newSecret, normalizeRecoveryCode, otpauthUri, verifyCode } from './totp.js';

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
const HOST_KEY_SECRET = env('HOST_KEY_SECRET');
const DATA_DIR = env('DATA_DIR');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DEFAULT_MAX_PARTICIPANTS = Number(env('MAX_PARTICIPANTS', '16'));
const SESSION_MAX_MS = Number(env('SESSION_MAX_MS', String(12 * 3600_000)));
const SESSION_IDLE_MS = Number(env('SESSION_IDLE_MS', String(2 * 3600_000)));
const INVITE_TTL_MS = Number(env('INVITE_TTL_MS', String(48 * 3600_000)));

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_TTL = '8h';
const COOKIE = 'overshoulder_session';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const VENDOR_DIR = path.join(here, 'node_modules', 'livekit-client', 'dist');
// Só esses arquivos do livekit-client são servidos em /vendor/
const VENDOR_FILES = new Set(['livekit-client.esm.mjs', 'livekit-client.e2ee.worker.mjs']);

// Páginas: caminho → arquivo em public/
const PAGES = {
  '/': 'index.html',
  '/configurar': 'setup.html',
  '/conta': 'account.html',
  '/admin': 'admin.html',
  '/convite': 'invite.html',
  '/redefinir': 'reset.html',
};

const rooms = new RoomServiceClient(INTERNAL_URL, API_KEY, API_SECRET);
const store = createStore(DATA_DIR);
const sessions = createSessions({ maxMs: SESSION_MAX_MS, idleMs: SESSION_IDLE_MS });

// Tentativas erradas: por IP e por conta, 10 a cada 10 minutos
const ipLimiter = createLimiter({ max: 10, windowMs: 10 * 60_000 });
const accountLimiter = createLimiter({ max: 10, windowMs: 10 * 60_000 });

// Salas abertas e quem as criou (só na memória: as salas também são efêmeras)
const roomOwners = new Map();

// --- utilidades ---------------------------------------------------------

const hostKeyFor = (roomId) =>
  crypto.createHmac('sha256', HOST_KEY_SECRET).update(`host:${roomId}`).digest('base64url');

// Atrás de proxy, vale o último IP do X-Forwarded-For: é o que o proxy acrescentou.
// Os anteriores vêm do próprio cliente e podem ser forjados para burlar o limite de tentativas.
const clientIp = (req) => {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const last = fwd && String(fwd).split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
};

// WebSocket só para o próprio site e para o LiveKit configurado
const LIVEKIT_ORIGIN = new URL(PUBLIC_URL).origin;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    `media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' ${LIVEKIT_ORIGIN}; ` +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self), display-capture=(self)',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
};

const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });

// Erro com status e mensagem que podem ir para o cliente (e um código opcional para a interface)
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_BODY = 4096;

// Lê o corpo como um objeto JSON; qualquer outra coisa é erro do cliente
const readJson = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.removeAllListeners('data');
        req.resume();
        reject(new HttpError(413, 'Requisição grande demais.'));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return reject(new HttpError(400, 'JSON inválido.'));
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body))
        return reject(new HttpError(400, 'Formato de requisição inválido.'));
      resolve(body);
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

// --- contas e sessões ----------------------------------------------------

const settings = () => ({ maxParticipants: DEFAULT_MAX_PARTICIPANTS, require2fa: false, ...store.state.settings });
const findUser = (pred) => store.state.users.find(pred);
const hasAdmin = () => store.state.users.some((u) => u.role === 'admin');

// O cookie de sessão é Secure quando o acesso chega por HTTPS através do proxy (Caddy)
const sessionCookie = (req, id, maxAgeSec) => {
  const secure = TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
};

const startSession = (req, user) => {
  const id = sessions.create(user.id);
  return { 'Set-Cookie': sessionCookie(req, id, Math.floor(SESSION_MAX_MS / 1000)) };
};

const currentSession = (req) => {
  const id = parseCookies(req.headers.cookie)[COOKIE];
  const session = sessions.get(id);
  if (!session) return null;
  const user = findUser((u) => u.id === session.userId);
  if (!user || user.disabled) {
    sessions.destroy(id);
    return null;
  }
  return { id, session, user };
};

const needs2fa = (user) => settings().require2fa && !user.totp;

// Exige sessão válida e, se pedido, um papel; devolve { id, session, user }.
// Com "Exigir 2FA" ligado, quem ainda não tem 2FA só pode configurá-lo (setup2fa: true).
const requireUser = (req, { role, setup2fa = false } = {}) => {
  const current = currentSession(req);
  if (!current) throw new HttpError(401, 'Faça login para continuar.');
  if (!setup2fa && needs2fa(current.user))
    throw new HttpError(403, 'Este servidor exige verificação em duas etapas. Configure o 2FA para continuar.', '2fa_required');
  if (role && current.user.role !== role) throw new HttpError(403, 'Sem permissão para isso.');
  return current;
};

const publicUser = (user) => ({
  username: user.username,
  role: user.role,
  totp: !!user.totp,
  needs2fa: needs2fa(user),
});

// Login com 2FA em duas etapas: a senha certa gera um tíquete de 5 minutos para o código
const LOGIN_TICKET_MS = 5 * 60_000;
const loginTickets = new Map();

// Código de uso único para criar a conta de administrador; aparece nos logs enquanto não houver admin
let setupCode = null;
const newSetupCode = () => {
  const raw = crypto.randomBytes(10).toString('base64url').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
  setupCode = raw.match(/.{4}/g).join('-');
  log.warn('configuração pendente: abra /configurar e use o código', { setupCode });
};

// --- API: configuração inicial e login ----------------------------------------

const getState = async (req, res) => {
  const current = currentSession(req);
  json(res, 200, {
    setupDone: hasAdmin(),
    require2fa: settings().require2fa,
    user: current && publicUser(current.user),
  });
};

const setup = async (req, res) => {
  const ip = clientIp(req);
  if (hasAdmin()) return json(res, 409, { error: 'O servidor já foi configurado.' });
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });

  const { code, username, password, maxParticipants } = await readJson(req);
  if (typeof code !== 'string' || !setupCode || !safeEqual(code.trim().toUpperCase(), setupCode)) {
    ipLimiter.fail(ip);
    log.warn('código de configuração incorreto');
    return json(res, 403, { error: 'Código de configuração incorreto. Veja o código atual nos logs do servidor.' });
  }
  const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(name))
    return json(res, 400, { error: 'Usuário: de 3 a 32 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado.' });
  const problem = passwordProblem(password, name);
  if (problem) return json(res, 400, { error: problem });
  const limit = maxParticipants === undefined ? DEFAULT_MAX_PARTICIPANTS : maxParticipants;
  if (!Number.isInteger(limit) || limit < 2 || limit > 500)
    return json(res, 400, { error: 'Limite de pessoas por sala: de 2 a 500.' });

  const user = {
    id: randomToken(12),
    username: name,
    role: 'admin',
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  // Confere de novo: outra requisição pode ter configurado enquanto o hash era calculado
  if (hasAdmin()) return json(res, 409, { error: 'O servidor já foi configurado.' });
  store.update((s) => {
    s.users.push(user);
    s.settings.maxParticipants = limit;
  });
  setupCode = null;
  log.info('servidor configurado', { user: user.username });
  json(res, 201, { user: publicUser(user) }, startSession(req, user));
};

const login = async (req, res) => {
  const ip = clientIp(req);
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });

  const { username, password } = await readJson(req);
  const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (accountLimiter.blocked(name)) return json(res, 429, { error: 'Muitas tentativas nesta conta. Espere alguns minutos.' });

  const user = findUser((u) => u.username === name);
  const ok = typeof password === 'string' && (await verifyPasswordOrDummy(password, user?.passwordHash));
  if (!ok || user.disabled) {
    ipLimiter.fail(ip);
    if (user) accountLimiter.fail(name);
    log.warn('login falhou', user ? { user: user.username } : {});
    return json(res, 401, { error: 'Usuário ou senha incorretos.' });
  }
  accountLimiter.reset(name);
  if (user.totp) {
    const ticket = randomToken();
    for (const [key, t] of loginTickets) if (t.expires < Date.now()) loginTickets.delete(key);
    loginTickets.set(sha256(ticket), { userId: user.id, expires: Date.now() + LOGIN_TICKET_MS, attempts: 0 });
    log.info('senha correta, aguardando 2FA', { user: user.username });
    return json(res, 200, { next: 'totp', ticket });
  }
  log.info('login', { user: user.username });
  json(res, 200, { user: publicUser(user) }, startSession(req, user));
};

// Segunda etapa do login: código do app autenticador ou um código de recuperação
const loginTotp = async (req, res) => {
  const ip = clientIp(req);
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
  const { ticket, code } = await readJson(req);
  const key = typeof ticket === 'string' ? sha256(ticket) : '';
  const pending = loginTickets.get(key);
  const user = pending && pending.expires > Date.now() && findUser((u) => u.id === pending.userId);
  if (!user || user.disabled || !user.totp) {
    loginTickets.delete(key);
    return json(res, 401, { error: 'O login expirou. Entre com a senha de novo.' });
  }
  if (accountLimiter.blocked(user.username))
    return json(res, 429, { error: 'Muitas tentativas nesta conta. Espere alguns minutos.' });

  const step = verifyCode(user.totp.secret, typeof code === 'string' ? code.trim() : '', user.totp.lastStep);
  const recoveryHash = step === null ? sha256(normalizeRecoveryCode(code)) : null;
  const recoveryIndex = recoveryHash ? user.totp.recovery.indexOf(recoveryHash) : -1;
  if (step === null && recoveryIndex < 0) {
    pending.attempts++;
    if (pending.attempts >= 5) loginTickets.delete(key);
    ipLimiter.fail(ip);
    accountLimiter.fail(user.username);
    log.warn('2FA falhou', { user: user.username });
    return json(res, 401, { error: 'Código incorreto.' });
  }

  loginTickets.delete(key);
  accountLimiter.reset(user.username);
  store.update(() => {
    if (step !== null) user.totp.lastStep = step;
    else user.totp.recovery.splice(recoveryIndex, 1);
  });
  if (step === null)
    log.warn('código de recuperação usado', { user: user.username, restantes: user.totp.recovery.length });
  log.info('login', { user: user.username, metodo: step === null ? 'recuperação' : '2FA' });
  json(res, 200, { user: publicUser(user) }, startSession(req, user));
};

const logout = async (req, res) => {
  const current = currentSession(req);
  if (current) sessions.destroy(current.id);
  json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
};

const changePassword = async (req, res) => {
  const { id, user } = requireUser(req, { setup2fa: true });
  const { current, password } = await readJson(req);
  if (typeof current !== 'string' || !(await verifyPasswordOrDummy(current, user.passwordHash))) {
    log.warn('troca de senha recusada', { user: user.username });
    return json(res, 403, { error: 'Senha atual incorreta.' });
  }
  const problem = passwordProblem(password, user.username);
  if (problem) return json(res, 400, { error: problem });
  const passwordHash = await hashPassword(password);
  store.update(() => {
    user.passwordHash = passwordHash;
  });
  sessions.destroyUser(user.id, id);
  log.info('senha alterada', { user: user.username });
  json(res, 200, { ok: true });
};

// --- API: 2FA --------------------------------------------------------------

const hashRecoveryCodes = (codes) => codes.map((c) => sha256(normalizeRecoveryCode(c)));

const setup2fa = async (req, res) => {
  const { session, user } = requireUser(req, { setup2fa: true });
  await readJson(req);
  if (user.totp) return json(res, 409, { error: 'O 2FA já está ativo nesta conta.' });
  const secret = newSecret();
  session.pendingTotp = secret;
  const uri = otpauthUri(secret, user.username);
  const qr = `data:image/svg+xml;base64,${Buffer.from(renderSVG(uri)).toString('base64')}`;
  json(res, 200, { secret, uri, qr });
};

const enable2fa = async (req, res) => {
  const { session, user } = requireUser(req, { setup2fa: true });
  const { code } = await readJson(req);
  if (user.totp) return json(res, 409, { error: 'O 2FA já está ativo nesta conta.' });
  if (!session.pendingTotp) return json(res, 400, { error: 'Comece a configuração do 2FA de novo.' });
  const step = verifyCode(session.pendingTotp, typeof code === 'string' ? code.trim() : '');
  if (step === null) return json(res, 400, { error: 'Código incorreto. Confira se o relógio do celular está certo.' });
  const recoveryCodes = newRecoveryCodes();
  store.update(() => {
    user.totp = { secret: session.pendingTotp, lastStep: step, recovery: hashRecoveryCodes(recoveryCodes) };
  });
  delete session.pendingTotp;
  log.info('2FA ativado', { user: user.username });
  json(res, 200, { recoveryCodes, user: publicUser(user) });
};

const disable2fa = async (req, res) => {
  const { user } = requireUser(req);
  const { password } = await readJson(req);
  if (!user.totp) return json(res, 409, { error: 'O 2FA não está ativo nesta conta.' });
  if (settings().require2fa) return json(res, 403, { error: 'O administrador exige 2FA neste servidor.' });
  if (typeof password !== 'string' || !(await verifyPasswordOrDummy(password, user.passwordHash))) {
    log.warn('desativar 2FA recusado', { user: user.username });
    return json(res, 403, { error: 'Senha incorreta.' });
  }
  store.update(() => {
    delete user.totp;
  });
  log.warn('2FA desativado', { user: user.username });
  json(res, 200, { user: publicUser(user) });
};

// --- API: administração -----------------------------------------------------

const getSettings = async (req, res) => {
  requireUser(req, { role: 'admin' });
  json(res, 200, settings());
};

const updateSettings = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const { require2fa, maxParticipants } = await readJson(req);
  const changes = {};
  if (require2fa !== undefined) {
    if (typeof require2fa !== 'boolean') return json(res, 400, { error: 'require2fa deve ser verdadeiro ou falso.' });
    changes.require2fa = require2fa;
  }
  if (maxParticipants !== undefined) {
    if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 500)
      return json(res, 400, { error: 'Limite de pessoas por sala: de 2 a 500.' });
    changes.maxParticipants = maxParticipants;
  }
  store.update((s) => Object.assign(s.settings, changes));
  log.info('configuração alterada', { user: user.username, ...changes });
  json(res, 200, settings());
};

const targetUser = (username) => {
  const target = typeof username === 'string' && findUser((u) => u.username === username.trim().toLowerCase());
  if (!target) throw new HttpError(404, 'Conta não encontrada.');
  return target;
};

// Só o admin gera um conjunto novo de códigos de recuperação (para si ou para outra conta)
const regenerateRecoveryCodes = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = targetUser((await readJson(req)).username);
  if (!target.totp) return json(res, 400, { error: 'Essa conta não usa 2FA.' });
  const recoveryCodes = newRecoveryCodes();
  store.update(() => {
    target.totp.recovery = hashRecoveryCodes(recoveryCodes);
  });
  log.warn('códigos de recuperação gerados', { user: user.username, conta: target.username });
  json(res, 200, { recoveryCodes });
};

// Para quem perdeu o celular: remove o 2FA da conta, que pode configurá-lo de novo
const reset2fa = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = targetUser((await readJson(req)).username);
  store.update(() => {
    delete target.totp;
  });
  log.warn('2FA removido pelo admin', { user: user.username, conta: target.username });
  json(res, 200, { ok: true });
};

// --- API: transmissores e convites ----------------------------------------

const publicAccount = (u) => ({
  username: u.username,
  role: u.role,
  totp: !!u.totp,
  disabled: !!u.disabled,
  createdAt: u.createdAt,
  liveRooms: [...roomOwners.values()].filter((id) => id === u.id).length,
});

const listUsers = async (req, res) => {
  requireUser(req, { role: 'admin' });
  json(res, 200, { users: store.state.users.map(publicAccount) });
};

const pruneInvites = () => {
  const now = Date.now();
  if (store.state.invites.some((i) => i.expiresAt <= now))
    store.update((st) => (st.invites = st.invites.filter((i) => i.expiresAt > now)));
};

// O convite viaja só no fragmento (#) do link; o servidor guarda apenas o hash
const createInvite = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  await readJson(req);
  pruneInvites();
  const token = randomToken();
  const invite = { id: randomToken(9), hash: sha256(token), expiresAt: Date.now() + INVITE_TTL_MS, createdBy: user.username };
  store.update((st) => st.invites.push(invite));
  log.info('convite criado', { user: user.username });
  json(res, 201, { id: invite.id, path: `/convite#${token}`, expiresAt: new Date(invite.expiresAt).toISOString() });
};

const listInvites = async (req, res) => {
  requireUser(req, { role: 'admin' });
  pruneInvites();
  json(res, 200, {
    invites: store.state.invites.map((i) => ({ id: i.id, createdBy: i.createdBy, expiresAt: new Date(i.expiresAt).toISOString() })),
  });
};

const cancelInvite = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const { id } = await readJson(req);
  if (!store.state.invites.some((i) => i.id === id)) return json(res, 404, { error: 'Convite não encontrado.' });
  store.update((st) => (st.invites = st.invites.filter((i) => i.id !== id)));
  log.info('convite cancelado', { user: user.username });
  json(res, 200, { ok: true });
};

const acceptInvite = async (req, res) => {
  const ip = clientIp(req);
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
  const { token, username, password } = await readJson(req);
  pruneInvites();
  const hash = typeof token === 'string' ? sha256(token) : '';
  const invite = store.state.invites.find((i) => i.hash === hash);
  if (!invite) {
    ipLimiter.fail(ip);
    log.warn('convite inválido usado');
    return json(res, 401, { error: 'Convite inválido, já usado ou expirado. Peça um novo ao administrador.' });
  }
  const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(name))
    return json(res, 400, { error: 'Usuário: de 3 a 32 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado.' });
  if (findUser((u) => u.username === name)) return json(res, 409, { error: 'Esse usuário já existe. Escolha outro.' });
  const problem = passwordProblem(password, name);
  if (problem) return json(res, 400, { error: problem });

  const user = {
    id: randomToken(12),
    username: name,
    role: 'broadcaster',
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
    invitedBy: invite.createdBy,
  };
  // Confere de novo depois do hash: o convite vale uma vez só e o usuário pode ter sido criado nesse meio-tempo
  if (!store.state.invites.some((i) => i.hash === hash)) return json(res, 401, { error: 'Convite já usado.' });
  if (findUser((u) => u.username === name)) return json(res, 409, { error: 'Esse usuário já existe. Escolha outro.' });
  store.update((st) => {
    st.invites = st.invites.filter((i) => i.hash !== hash);
    st.users.push(user);
  });
  log.info('transmissor cadastrado', { user: user.username, convidadoPor: invite.createdBy });
  json(res, 201, { user: publicUser(user) }, startSession(req, user));
};

// Encerra na hora as salas que a conta criou (quem estiver assistindo é desconectado)
const endRoomsOf = async (userId) => {
  let ended = 0;
  for (const [roomId, owner] of roomOwners) {
    if (owner !== userId) continue;
    roomOwners.delete(roomId);
    await rooms.deleteRoom(roomId).catch(() => {});
    ended++;
  }
  return ended;
};

const broadcasterTarget = (username) => {
  const target = targetUser(username);
  if (target.role === 'admin') throw new HttpError(400, 'A conta de administrador não pode ser revogada nem excluída.');
  return target;
};

// Revogação imediata: desativa a conta, encerra as sessões e as salas ao vivo
const revokeUser = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = broadcasterTarget((await readJson(req)).username);
  store.update(() => {
    target.disabled = true;
  });
  sessions.destroyUser(target.id);
  const ended = await endRoomsOf(target.id);
  log.warn('transmissor revogado', { user: user.username, conta: target.username, salasEncerradas: ended });
  json(res, 200, { ok: true, endedRooms: ended });
};

const restoreUser = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = broadcasterTarget((await readJson(req)).username);
  store.update(() => {
    delete target.disabled;
  });
  log.info('transmissor reativado', { user: user.username, conta: target.username });
  json(res, 200, { ok: true });
};

const deleteUser = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = broadcasterTarget((await readJson(req)).username);
  store.update((st) => (st.users = st.users.filter((u) => u.id !== target.id)));
  sessions.destroyUser(target.id);
  const ended = await endRoomsOf(target.id);
  log.warn('transmissor excluído', { user: user.username, conta: target.username, salasEncerradas: ended });
  json(res, 200, { ok: true, endedRooms: ended });
};

// --- API: redefinição do admin (link gerado pelo comando no servidor) -----

const RESET_FILE = path.join(DATA_DIR, 'admin-reset.json');

const adminReset = async (req, res) => {
  const ip = clientIp(req);
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
  const { token, password } = await readJson(req);
  let pending = null;
  try {
    pending = JSON.parse(await fs.readFile(RESET_FILE, 'utf8'));
  } catch {}
  const valid =
    pending && typeof token === 'string' && pending.expiresAt > Date.now() && safeEqual(sha256(token), pending.hash);
  if (!valid) {
    ipLimiter.fail(ip);
    log.warn('link de redefinição do admin inválido');
    return json(res, 401, { error: 'Link inválido ou expirado. Gere outro com o comando no servidor.' });
  }
  const admin = findUser((u) => u.role === 'admin');
  const problem = passwordProblem(password, admin.username);
  if (problem) return json(res, 400, { error: problem });

  const passwordHash = await hashPassword(password);
  await fs.rm(RESET_FILE, { force: true });
  store.update(() => {
    admin.passwordHash = passwordHash;
    delete admin.totp;
    delete admin.disabled;
  });
  sessions.destroyUser(admin.id);
  accountLimiter.reset(admin.username);
  log.warn('admin redefinido pelo link do servidor', { user: admin.username });
  json(res, 200, { user: publicUser(admin) }, startSession(req, admin));
};

// --- API: salas -----------------------------------------------------------

const createRoom = async (req, res) => {
  const { user } = requireUser(req);
  await readJson(req);
  const roomId = crypto.randomBytes(16).toString('base64url');
  const { maxParticipants } = settings();
  await rooms.createRoom({ name: roomId, emptyTimeout: 300, departureTimeout: 60, maxParticipants });
  roomOwners.set(roomId, user.id);
  log.info('sala criada', { user: user.username, maxParticipants });
  json(res, 201, { roomId, hostKey: hostKeyFor(roomId) });
};

const issueToken = async (req, res) => {
  const { roomId, hostKey, name } = await readJson(req);
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return json(res, 400, { error: 'Sala inválida.' });

  const isHost = typeof hostKey === 'string' && safeEqual(hostKey, hostKeyFor(roomId));
  if (!(await roomExists(roomId))) return json(res, 404, { error: 'Essa sala não existe ou já foi encerrada.' });

  const displayName = (typeof name === 'string' ? name.trim().slice(0, 32) : '') || (isHost ? 'Anfitrião' : 'Espectador');
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
  roomOwners.delete(roomId);
  log.info('sala encerrada');
  json(res, 200, { ok: true });
};

// Saúde do serviço para o healthcheck do Docker: app de pé e LiveKit respondendo
const healthz = async (req, res) => {
  try {
    const r = await fetch(INTERNAL_URL, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error(`LiveKit respondeu ${r.status}`);
    json(res, 200, { status: 'ok' });
  } catch (err) {
    log.warn('healthcheck falhou', { error: err.message });
    json(res, 503, { status: 'unavailable' });
  }
};

// --- roteamento ---------------------------------------------------------

const routes = {
  'GET /api/state': getState,
  'POST /api/setup': setup,
  'POST /api/login': login,
  'POST /api/login/totp': loginTotp,
  'POST /api/logout': logout,
  'POST /api/2fa/setup': setup2fa,
  'POST /api/2fa/enable': enable2fa,
  'POST /api/2fa/disable': disable2fa,
  'GET /api/admin/settings': getSettings,
  'POST /api/admin/settings': updateSettings,
  'POST /api/admin/recovery-codes': regenerateRecoveryCodes,
  'POST /api/admin/reset-2fa': reset2fa,
  'GET /api/admin/users': listUsers,
  'POST /api/admin/users/revoke': revokeUser,
  'POST /api/admin/users/restore': restoreUser,
  'POST /api/admin/users/delete': deleteUser,
  'GET /api/admin/invites': listInvites,
  'POST /api/admin/invites': createInvite,
  'POST /api/admin/invites/cancel': cancelInvite,
  'POST /api/invites/accept': acceptInvite,
  'POST /api/admin-reset': adminReset,
  'POST /api/account/password': changePassword,
  'POST /api/rooms': createRoom,
  'POST /api/token': issueToken,
  'POST /api/rooms/end': endRoom,
  'GET /healthz': healthz,
};

// Requisições que alteram algo precisam vir do próprio site (proteção contra CSRF,
// além do cookie SameSite=Strict)
const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    const handler = routes[`${req.method} ${p}`];
    if (handler) {
      if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
      return await handler(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método não permitido.' });

    if (PAGES[p]) return await serveFile(res, path.join(PUBLIC_DIR, PAGES[p]));
    if (/^\/r\/[A-Za-z0-9_-]{22}$/.test(p)) return await serveFile(res, path.join(PUBLIC_DIR, 'room.html'));
    if (p.startsWith('/vendor/')) {
      const name = p.slice('/vendor/'.length);
      if (VENDOR_FILES.has(name)) return await serveFile(res, path.join(VENDOR_DIR, name));
    }
    if (/^\/static\/[a-z0-9-]+(\.[a-z0-9]+)+$/.test(p)) return await serveFile(res, path.join(PUBLIC_DIR, p.slice('/static/'.length)));

    send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    if (err instanceof HttpError) {
      if (!res.headersSent) json(res, err.status, { error: err.message, ...(err.code && { code: err.code }) });
      return;
    }
    log.error('erro interno', { error: err.message, stack: err.stack });
    if (!res.headersSent) json(res, 500, { error: 'Erro interno.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log.info(`Overshoulder ouvindo em http://127.0.0.1:${PORT}`);
  if (!hasAdmin()) newSetupCode();
});
