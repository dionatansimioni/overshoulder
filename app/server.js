import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource } from 'livekit-server-sdk';
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
import { translateError, wantsEnglish } from './i18n-server.js';
import { log } from './log.js';
import { createStore } from './store.js';
import { authorizationUrl, discover, finishLogin, forgetDiscovery, newAttempt, validIssuer } from './oidc.js';
import { createUpdateChecker, DEFAULT_URL as UPDATE_DEFAULT_URL, INSTALL_METHODS, parseVersion } from './update-check.js';
import { createUsageMeter } from './usage.js';
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
// Só para mostrar no painel: o TURN é configurado pelo supervisor
const TURN_DOMAIN = process.env.TURN_DOMAIN ?? '';
const SESSION_MAX_MS = Number(env('SESSION_MAX_MS', String(12 * 3600_000)));
const SESSION_IDLE_MS = Number(env('SESSION_IDLE_MS', String(2 * 3600_000)));
// Link de nova senha que o admin gera para um transmissor
const PASSWORD_RESET_TTL_MS = Number(env('PASSWORD_RESET_TTL_MS', String(24 * 3600_000)));
const INVITE_TTL_MS = Number(env('INVITE_TTL_MS', String(48 * 3600_000)));
const BAN_CHECK_MS = Number(env('BAN_CHECK_MS', '2000'));
// Sala privada: quanto tempo ela espera o anfitrião voltar (recarregar a página, rede caída) antes de acabar
const PRIVATE_GRACE_MS = Number(env('PRIVATE_GRACE_MS', '30000'));
// Endereço público do site: usado no redirect_uri do login corporativo
const PUBLIC_ORIGIN = env('PUBLIC_ORIGIN', `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const SSO_REDIRECT_URI = `${PUBLIC_ORIGIN}/api/sso/callback`;
// Versão (da tag da publicação) e como o servidor foi instalado: base do aviso de nova versão
const APP_VERSION = process.env.APP_VERSION || 'dev';
const INSTALL_METHOD = INSTALL_METHODS.includes(process.env.INSTALL_METHOD) ? process.env.INSTALL_METHOD : null;
// UPDATE_CHECK=off desliga a consulta de vez (ex.: servidor sem internet)
const UPDATE_CHECK_OFF = process.env.UPDATE_CHECK === 'off';
const UPDATE_CHECK_URL = env('UPDATE_CHECK_URL', UPDATE_DEFAULT_URL);
const UPDATE_CHECK_DELAY_MS = Number(env('UPDATE_CHECK_DELAY_MS', '60000'));
const UPDATE_CHECK_INTERVAL_MS = Number(env('UPDATE_CHECK_INTERVAL_MS', String(24 * 3600_000)));
// Painel de uso: métricas do LiveKit (só em 127.0.0.1)
const LIVEKIT_METRICS_URL = env('LIVEKIT_METRICS_URL', 'http://127.0.0.1:6789/metrics');
const USAGE_POLL_MS = Number(env('USAGE_POLL_MS', '60000'));
const UPDATE_MANUAL_GAP_MS = Number(env('UPDATE_MANUAL_GAP_MS', '60000'));

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_TTL = '8h';
const COOKIE = 'overshoulder_session';
// Espectador que entrou com o login corporativo (não é uma conta)
const VIEWER_COOKIE = 'overshoulder_viewer';
// Liga a tentativa de login corporativo ao navegador que a começou
const SSO_STATE_COOKIE = 'overshoulder_sso';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const VENDOR_DIR = path.join(here, 'node_modules', 'livekit-client', 'dist');
// Só esses arquivos do livekit-client são servidos em /vendor/
const VENDOR_FILES = new Set(['livekit-client.esm.mjs', 'livekit-client.e2ee.worker.mjs']);

// Páginas: caminho → arquivo em public/
const PAGES = {
  '/': 'index.html',
  // Servidor só por convite: a página inicial não mostra o login; quem tem conta entra por aqui
  '/login': 'index.html',
  '/setup': 'setup.html',
  '/account': 'account.html',
  '/admin': 'admin.html',
  '/invite': 'invite.html',
  '/signup': 'invite.html',
  '/reset': 'reset.html',
  '/new-password': 'newpassword.html',
  '/mobile': 'mobile.html',
};
// Endereços antigos, em português: redirecionam para os novos. O que vem depois do # (chave da sala,
// código do convite, token de redefinição) o navegador mantém sozinho no redirecionamento.
const LEGACY_PAGES = {
  '/configurar': '/setup',
  '/conta': '/account',
  '/convite': '/invite',
  '/cadastro': '/signup',
  '/redefinir': '/reset',
  '/nova-senha': '/new-password',
  '/celular': '/mobile',
};
// Arquivos do app instalável (PWA): o service worker precisa estar na raiz para valer no site todo
const ROOT_FILES = { '/manifest.webmanifest': 'manifest.webmanifest', '/sw.js': 'sw.js' };

const rooms = new RoomServiceClient(INTERNAL_URL, API_KEY, API_SECRET);
const store = createStore(DATA_DIR);
const sessions = createSessions({ maxMs: SESSION_MAX_MS, idleMs: SESSION_IDLE_MS });
const viewerSessions = createSessions({ maxMs: SESSION_MAX_MS, idleMs: SESSION_IDLE_MS });
const ssoAttempts = new Map(); // hash do state → { attempt, next, expires }

// Tentativas erradas: por IP e por conta, 10 a cada 10 minutos
const ipLimiter = createLimiter({ max: 10, windowMs: 10 * 60_000 });
const accountLimiter = createLimiter({ max: 10, windowMs: 10 * 60_000 });
// Cadastro aberto: poucas contas novas por IP, e um teto de contas esperando aprovação
const signupLimiter = createLimiter({ max: 5, windowMs: 60 * 60_000 });
const MAX_PENDING = 50;
const SIGNUP_MODES = ['invite', 'approval', 'open'];
// Qualidades de transmissão, da mais leve à mais pesada (os detalhes de cada uma ficam em public/room.js)
const QUALITIES = ['720p30', '720p60', '1080p30', '1080p60', '1440p60'];
// Sem teto baixo: o admin decide, e o painel avisa da banda acima de algumas centenas de pessoas
const MAX_PEOPLE = 5000;
const validPeople = (n) => Number.isInteger(n) && n >= 2 && n <= MAX_PEOPLE;

// Salas abertas (só na memória: as salas também são efêmeras). O link público (/r/<código>) é
// separado do nome interno da sala no LiveKit: trocar o código invalida o link antigo sem
// derrubar quem já está assistindo.
// Sala: { name, owner, code (do convite padrão), type, openScreens, chat, recording, requireSso, banned,
//         speakers (quem pode falar na Live), sharers (quem pode mostrar a tela), requests,
//         invites, joinedBy (identidade → convite e ingresso), waiting, lobby }
const liveRooms = new Map(); // nome interno → sala
const roomCodes = new Map(); // código público de um convite → { name, inviteId }
// Ingressos: quem entrou guarda um no navegador e volta sem gastar o convite de novo, mesmo se o
// link tiver sido trocado depois. Só o hash fica no servidor.
const roomTickets = new Map(); // hash do ingresso → { name, inviteId }
const ROOM_TYPES = ['together', 'live'];
const SCREEN_SOURCES = [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA];
const HOST_SOURCES = [TrackSource.MICROPHONE, ...SCREEN_SOURCES];
const tokenVerifier = new TokenVerifier(API_KEY, API_SECRET);
const VIEWER_ID_RE = /^v-[0-9a-f]{12}$/;

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
    // discord.com: o anfitrião anuncia a sala no Discord direto do navegador (o servidor não vê o link)
    `media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' ${LIVEKIT_ORIGIN} https://discord.com; ` +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=(self), display-capture=(self)',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
};

// Mensagens de erro saem em inglês quando a página pede (Accept-Language)
const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj.error && wantsEnglish(res.req) ? { ...obj, error: translateError(obj.error) } : obj), {
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
  '.webmanifest': 'application/manifest+json',
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

const SSO_DEFAULTS = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  domains: [],
  broadcasterGroup: '',
  broadcasterEmails: [],
  roomsDefault: true,
  forceRooms: false,
};
const settings = () => ({
  maxParticipants: DEFAULT_MAX_PARTICIPANTS,
  require2fa: false,
  signup: 'approval',
  defaultQuality: '720p30',
  maxQuality: '1440p60',
  updateCheck: true,
  monthlyQuotaGb: 0,
  ...store.state.settings,
});
const ssoSettings = () => ({ ...SSO_DEFAULTS, ...store.state.settings.sso });
const ssoReady = () => {
  const sso = ssoSettings();
  return sso.enabled && !!sso.issuer && !!sso.clientId && !!sso.clientSecret && sso.domains.length > 0;
};
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
  if (!user || user.disabled || user.pending) {
    sessions.destroy(id);
    return null;
  }
  return { id, session, user };
};

// Contas que entram pelo login corporativo têm o 2FA do próprio provedor
const needs2fa = (user) => settings().require2fa && !user.totp && !user.sso;

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
  ...(user.sso && { sso: true }),
});

const currentViewer = (req) => viewerSessions.get(parseCookies(req.headers.cookie)[VIEWER_COOKIE]);

// Login com 2FA em duas etapas: a senha certa gera um tíquete de 5 minutos para o código
const LOGIN_TICKET_MS = 5 * 60_000;
const loginTickets = new Map();

// Código de uso único para criar a conta de administrador; aparece nos logs enquanto não houver admin
let setupCode = null;
const newSetupCode = () => {
  const raw = crypto.randomBytes(10).toString('base64url').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
  setupCode = raw.match(/.{4}/g).join('-');
  log.warn('configuração pendente: abra /setup e use o código', { setupCode });
};

// --- API: configuração inicial e login ----------------------------------------

const getState = async (req, res) => {
  const current = currentSession(req);
  const viewer = currentViewer(req);
  const sso = ssoSettings();
  json(res, 200, {
    setupDone: hasAdmin(),
    require2fa: settings().require2fa,
    signup: settings().signup,
    sso: ssoReady() ? { roomsDefault: sso.roomsDefault, forceRooms: sso.forceRooms } : null,
    user: current && publicUser(current.user),
    viewer: viewer ? { name: viewer.name, email: viewer.email } : null,
  });
};

// Primeiro passo da configuração: confere o código antes de pedir o resto (mesmo limite de tentativas)
const checkSetupCode = async (req, res) => {
  const ip = clientIp(req);
  if (hasAdmin()) return json(res, 409, { error: 'O servidor já foi configurado.' });
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
  const { code } = await readJson(req);
  if (typeof code !== 'string' || !setupCode || !safeEqual(code.trim().toUpperCase(), setupCode)) {
    ipLimiter.fail(ip);
    log.warn('código de configuração incorreto');
    return json(res, 403, { error: 'Código de configuração incorreto. Veja o código atual nos logs do servidor.' });
  }
  json(res, 200, { ok: true });
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
  if (!validPeople(limit)) return json(res, 400, { error: 'Limite de pessoas por sala: de 2 a 5000.' });

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
  if (user.pending) {
    log.info('login de conta aguardando aprovação', { user: user.username });
    return json(res, 403, { error: 'Sua conta aguarda a aprovação do administrador.', code: 'pending' });
  }
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

// O que a tela Geral mostra: sem o SSO (o segredo do cliente é só de escrita, com rota própria) e
// sem o webhook do Discord (também com rota própria)
const settingsView = () => {
  const { sso, discordWebhook, ...rest } = settings();
  return rest;
};

const getSettings = async (req, res) => {
  requireUser(req, { role: 'admin' });
  json(res, 200, { ...settingsView(), turnDomain: TURN_DOMAIN });
};

const updateSettings = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const { require2fa, maxParticipants, signup, defaultQuality, maxQuality, updateCheck, monthlyQuotaGb } = await readJson(req);
  const changes = {};
  if (monthlyQuotaGb !== undefined) {
    if (typeof monthlyQuotaGb !== 'number' || !Number.isFinite(monthlyQuotaGb) || monthlyQuotaGb < 0 || monthlyQuotaGb > 1_000_000)
      return json(res, 400, { error: 'Franquia mensal: de 0 (sem franquia) a 1000000 GB.' });
    changes.monthlyQuotaGb = Math.round(monthlyQuotaGb * 10) / 10;
  }
  if (updateCheck !== undefined) {
    if (typeof updateCheck !== 'boolean') return json(res, 400, { error: 'updateCheck deve ser verdadeiro ou falso.' });
    changes.updateCheck = updateCheck;
  }
  if (signup !== undefined) {
    if (!SIGNUP_MODES.includes(signup)) return json(res, 400, { error: 'Modo de cadastro inválido.' });
    changes.signup = signup;
  }
  if (require2fa !== undefined) {
    if (typeof require2fa !== 'boolean') return json(res, 400, { error: 'require2fa deve ser verdadeiro ou falso.' });
    changes.require2fa = require2fa;
  }
  if (maxParticipants !== undefined) {
    if (!validPeople(maxParticipants)) return json(res, 400, { error: 'Limite de pessoas por sala: de 2 a 5000.' });
    changes.maxParticipants = maxParticipants;
  }
  for (const [field, value] of Object.entries({ defaultQuality, maxQuality })) {
    if (value === undefined) continue;
    if (!QUALITIES.includes(value)) return json(res, 400, { error: 'Qualidade inválida.' });
    changes[field] = value;
  }
  const merged = { ...settings(), ...changes };
  if (QUALITIES.indexOf(merged.defaultQuality) > QUALITIES.indexOf(merged.maxQuality))
    return json(res, 400, { error: 'A qualidade padrão não pode passar da máxima.' });
  store.update((s) => Object.assign(s.settings, changes));
  log.info('configuração alterada', { user: user.username, ...changes });
  json(res, 200, settingsView());
};

// --- API: painel de uso -------------------------------------------------------

const usageMeter = createUsageMeter({ metricsUrl: LIVEKIT_METRICS_URL, store, quotaGb: () => settings().monthlyQuotaGb, log });

const getUsage = async (req, res) => {
  requireUser(req, { role: 'admin' });
  let live = null;
  try {
    const list = await rooms.listRooms();
    live = { rooms: list.length, participants: list.reduce((n, r) => n + (r.numParticipants ?? 0), 0) };
  } catch {}
  json(res, 200, { ...usageMeter.view(), live });
};

// --- API: aviso de nova versão ---------------------------------------------

const updateChecker = createUpdateChecker({ current: APP_VERSION, url: UPDATE_CHECK_URL, log });
// Compilação local ("dev") não tem versão para comparar
const updateCheckActive = () => !UPDATE_CHECK_OFF && !!parseVersion(APP_VERSION) && settings().updateCheck;
const updateView = () => ({
  ...updateChecker.view(),
  method: INSTALL_METHOD,
  enabled: settings().updateCheck,
  disabledByEnv: UPDATE_CHECK_OFF,
  devBuild: !parseVersion(APP_VERSION),
});

const getUpdate = async (req, res) => {
  requireUser(req, { role: 'admin' });
  json(res, 200, updateView());
};

let lastManualCheck = 0;
const checkUpdateNow = async (req, res) => {
  requireUser(req, { role: 'admin' });
  if (!updateCheckActive()) return json(res, 409, { error: 'A verificação de novas versões está desligada.' });
  if (Date.now() - lastManualCheck < UPDATE_MANUAL_GAP_MS)
    return json(res, 429, { error: 'Verificado há pouco. Espere um minuto.' });
  lastManualCheck = Date.now();
  await updateChecker.check();
  json(res, 200, updateView());
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
  ...(u.sso && { sso: true, email: u.email }),
  disabled: !!u.disabled,
  pending: !!u.pending,
  createdAt: u.createdAt,
  liveRooms: [...liveRooms.values()].filter((r) => r.owner === u.id).length,
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
  json(res, 201, { id: invite.id, path: `/invite#${token}`, expiresAt: new Date(invite.expiresAt).toISOString() });
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

// Cadastro sem convite, conforme o modo escolhido pelo admin: com aprovação (a conta nasce pendente)
// ou livre (a conta já pode transmitir)
const signup = async (req, res) => {
  const mode = settings().signup;
  if (mode === 'invite') return json(res, 403, { error: 'Este servidor só aceita transmissores convidados pelo administrador.' });
  const ip = clientIp(req);
  if (signupLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
  const { username, password } = await readJson(req);
  const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(name))
    return json(res, 400, { error: 'Usuário: de 3 a 32 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado.' });
  const problem = passwordProblem(password, name);
  if (problem) return json(res, 400, { error: problem });
  if (findUser((u) => u.username === name)) return json(res, 409, { error: 'Esse usuário já existe. Escolha outro.' });
  if (mode === 'approval' && store.state.users.filter((u) => u.pending).length >= MAX_PENDING)
    return json(res, 503, { error: 'Muitos cadastros esperando aprovação. Tente mais tarde.' });
  signupLimiter.fail(ip);
  const user = {
    id: randomToken(12),
    username: name,
    role: 'broadcaster',
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
    ...(mode === 'approval' && { pending: true }),
  };
  if (findUser((u) => u.username === name)) return json(res, 409, { error: 'Esse usuário já existe. Escolha outro.' });
  store.update((st) => st.users.push(user));
  log.info(mode === 'approval' ? 'cadastro aguardando aprovação' : 'transmissor cadastrado', { user: user.username });
  if (mode === 'approval') return json(res, 201, { pending: true });
  json(res, 201, { user: publicUser(user) }, startSession(req, user));
};

const approveUser = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = broadcasterTarget((await readJson(req)).username);
  if (!target.pending) return json(res, 400, { error: 'Essa conta não está aguardando aprovação.' });
  store.update(() => {
    delete target.pending;
  });
  log.info('cadastro aprovado', { user: user.username, conta: target.username });
  json(res, 200, { ok: true });
};

// Encerra na hora as salas que a conta criou (quem estiver assistindo é desconectado)
const endRoomsOf = async (userId) => {
  let ended = 0;
  for (const [name, room] of liveRooms) {
    if (room.owner !== userId) continue;
    forgetRoom(name);
    await rooms.deleteRoom(name).catch(() => {});
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

// Transmissor esqueceu a senha: o admin gera um link de uso único (24 h) e entrega à pessoa.
// Gerar outro invalida o anterior. O 2FA continua: a pessoa entra depois pelo login normal.
const passwordResetLink = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const target = targetUser((await readJson(req)).username);
  if (target.role === 'admin') return json(res, 400, { error: 'Para a conta de administrador, use o comando reset-admin no servidor.' });
  if (target.sso) return json(res, 400, { error: 'Essa conta entra pelo login da empresa e não tem senha aqui.' });
  if (target.disabled || target.pending) return json(res, 400, { error: 'Reative ou aprove a conta antes.' });
  const token = randomToken();
  const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  store.update((st) => {
    st.passwordResets = (st.passwordResets ?? []).filter((r) => r.userId !== target.id && r.expiresAt > Date.now());
    st.passwordResets.push({ hash: sha256(token), userId: target.id, expiresAt });
  });
  log.warn('link de nova senha gerado', { user: user.username, conta: target.username });
  json(res, 200, { path: `/new-password#${token}`, expiresAt: new Date(expiresAt).toISOString() });
};

const passwordReset = async (req, res) => {
  const ip = clientIp(req);
  if (ipLimiter.blocked(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
  const { token, password } = await readJson(req);
  const hash = typeof token === 'string' && token.length <= 100 ? sha256(token) : null;
  const entry = hash && (store.state.passwordResets ?? []).find((r) => safeEqual(r.hash, hash) && r.expiresAt > Date.now());
  const target = entry && findUser((u) => u.id === entry.userId);
  if (!target || target.role === 'admin' || target.disabled || target.pending || target.sso) {
    ipLimiter.fail(ip);
    log.warn('link de nova senha inválido');
    return json(res, 401, { error: 'Link inválido, já usado ou expirado. Peça outro ao administrador.' });
  }
  const problem = passwordProblem(password, target.username);
  if (problem) return json(res, 400, { error: problem });
  const passwordHash = await hashPassword(password);
  store.update((st) => {
    target.passwordHash = passwordHash;
    st.passwordResets = st.passwordResets.filter((r) => r.userId !== target.id);
  });
  sessions.destroyUser(target.id);
  accountLimiter.reset(target.username);
  log.warn('senha trocada pelo link do admin', { user: target.username });
  json(res, 200, { ok: true });
};

// --- API: login corporativo (OIDC) -----------------------------------------

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const listOf = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/)).map((v) => String(v).trim().toLowerCase()).filter(Boolean);

const getSso = async (req, res) => {
  requireUser(req, { role: 'admin' });
  const { clientSecret, ...rest } = ssoSettings();
  json(res, 200, { ...rest, hasClientSecret: !!clientSecret, redirectUri: SSO_REDIRECT_URI });
};

// O segredo do cliente é só de escrita: nunca volta para a tela
const updateSso = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const body = await readJson(req);
  const next = ssoSettings();
  for (const flag of ['enabled', 'roomsDefault', 'forceRooms']) {
    if (body[flag] === undefined) continue;
    if (typeof body[flag] !== 'boolean') return json(res, 400, { error: `${flag} deve ser verdadeiro ou falso.` });
    next[flag] = body[flag];
  }
  for (const field of ['issuer', 'clientId', 'clientSecret', 'broadcasterGroup']) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string' || body[field].length > 500) return json(res, 400, { error: `${field} inválido.` });
    if (field === 'clientSecret' && !body[field]) continue;
    next[field] = body[field].trim();
  }
  if (body.domains !== undefined) next.domains = listOf(body.domains);
  if (body.broadcasterEmails !== undefined) next.broadcasterEmails = listOf(body.broadcasterEmails);

  if (next.issuer && !validIssuer(next.issuer)) return json(res, 400, { error: 'Emissor (issuer) inválido: use uma URL https.' });
  if (next.domains.some((d) => !DOMAIN_RE.test(d))) return json(res, 400, { error: 'Domínio de e-mail inválido na lista.' });
  if (next.broadcasterEmails.some((e) => !/^[^\s@]+@[^\s@]+$/.test(e))) return json(res, 400, { error: 'E-mail inválido na lista de transmissores.' });
  if (next.enabled) {
    if (!next.issuer || !next.clientId || !next.clientSecret || !next.domains.length)
      return json(res, 400, { error: 'Para ativar, preencha emissor, client ID, client secret e pelo menos um domínio de e-mail.' });
    forgetDiscovery();
    try {
      await discover(next.issuer);
    } catch (err) {
      return json(res, 400, { error: `Não foi possível falar com o provedor: ${err.message}.` });
    }
  }
  store.update((st) => (st.settings.sso = next));
  log.info('login corporativo configurado', { user: user.username, ativo: next.enabled, emissor: next.issuer });
  const { clientSecret, ...rest } = next;
  json(res, 200, { ...rest, hasClientSecret: !!clientSecret, redirectUri: SSO_REDIRECT_URI });
};

// --- anúncio no Discord ----------------------------------------------------------------------
// O admin guarda o webhook de um canal; quem tem conta o recebe e anuncia a sala direto do navegador,
// para o link (que leva a chave da sala) nunca passar pelo servidor. O token do webhook funciona como
// senha do canal: não vai para os logs nem para quem não tem conta.
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{15,25})\/([\w-]{20,128})\/?$/;

const getDiscord = async (req, res) => {
  requireUser(req);
  json(res, 200, { webhook: store.state.settings.discordWebhook || null });
};

const updateDiscord = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const { webhook } = await readJson(req);
  if (typeof webhook !== 'string' || webhook.length > 300) return json(res, 400, { error: 'Webhook inválido.' });
  let value = '';
  if (webhook.trim()) {
    const m = webhook.trim().match(DISCORD_WEBHOOK_RE);
    if (!m) return json(res, 400, { error: 'Isso não é um webhook do Discord. Copie a URL em Editar canal › Integrações › Webhooks.' });
    value = `https://discord.com/api/webhooks/${m[1]}/${m[2]}`;
  }
  store.update((st) => (st.settings.discordWebhook = value));
  log.info(value ? 'webhook do discord configurado' : 'webhook do discord removido', { user: user.username });
  json(res, 200, { webhook: value || null });
};

// Depois do login, só volta para páginas do próprio site (nada de redirecionamento aberto)
const safeNext = (next) => (typeof next === 'string' && /^\/(r\/[A-Za-z0-9_-]{22})?$/.test(next) ? next : '/');

const redirect = (res, location, headers = {}) =>
  send(res, 302, '', { Location: location, 'Cache-Control': 'no-store', ...headers });

const ssoStart = async (req, res) => {
  if (!ssoReady()) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  const sso = ssoSettings();
  const next = safeNext(new URL(req.url, 'http://x').searchParams.get('next'));
  let meta;
  try {
    meta = await discover(sso.issuer);
  } catch (err) {
    log.warn('login corporativo: provedor indisponível', { error: err.message });
    return redirect(res, `${next}?erro_sso=provedor`);
  }
  const attempt = newAttempt();
  for (const [key, a] of ssoAttempts) if (a.expires < Date.now()) ssoAttempts.delete(key);
  ssoAttempts.set(sha256(attempt.state), { attempt, next, expires: Date.now() + 10 * 60_000 });
  const secure = TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';
  // SameSite=Lax: o cookie precisa voltar na navegação que vem do provedor
  const cookie = `${SSO_STATE_COOKIE}=${attempt.state}; Path=/api/sso; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
  redirect(res, authorizationUrl(meta, { clientId: sso.clientId, redirectUri: SSO_REDIRECT_URI, attempt }), { 'Set-Cookie': cookie });
};

// Transmissor pelo SSO: e-mail na lista ou grupo configurado. A conta é criada no primeiro acesso.
const ssoAccount = (identity, sso) => {
  const group = sso.broadcasterGroup.toLowerCase();
  const allowed =
    sso.broadcasterEmails.includes(identity.email) ||
    (group && identity.groups.some((g) => g.toLowerCase().replace(/^\//, '') === group.replace(/^\//, '')));
  const existing = findUser((u) => u.sso === identity.subject);
  if (!allowed || existing?.disabled) return null;
  if (existing) return existing;
  const base = identity.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 28).padEnd(3, '0');
  let username = base;
  for (let i = 2; findUser((u) => u.username === username); i++) username = `${base}-${i}`;
  const user = { id: randomToken(12), username, role: 'broadcaster', sso: identity.subject, email: identity.email, createdAt: new Date().toISOString() };
  store.update((st) => st.users.push(user));
  log.info('transmissor cadastrado pelo login corporativo', { user: username });
  return user;
};

const ssoCallback = async (req, res) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const state = params.get('state') ?? '';
  const pending = ssoAttempts.get(sha256(state));
  ssoAttempts.delete(sha256(state));
  const clearState = `${SSO_STATE_COOKIE}=; Path=/api/sso; HttpOnly; SameSite=Lax; Max-Age=0`;
  const fail = (reason, why, next = '/') => {
    log.warn('login corporativo recusado', { motivo: why });
    redirect(res, `${next}${next.includes('?') ? '&' : '?'}erro_sso=${reason}`, { 'Set-Cookie': clearState });
  };
  // O state precisa ser o mesmo do cookie deste navegador: impede que alguém "logue" outra pessoa
  const cookieState = parseCookies(req.headers.cookie)[SSO_STATE_COOKIE];
  if (!pending || pending.expires < Date.now() || typeof cookieState !== 'string' || !safeEqual(cookieState, state))
    return fail('expirou', 'state inválido ou expirado');
  if (!ssoReady()) return fail('desligado', 'login corporativo desligado');
  if (params.get('error') || !params.get('code')) return fail('cancelado', params.get('error') ?? 'sem código', pending.next);

  const sso = ssoSettings();
  let identity;
  try {
    const meta = await discover(sso.issuer);
    identity = await finishLogin(meta, {
      clientId: sso.clientId,
      clientSecret: sso.clientSecret,
      redirectUri: SSO_REDIRECT_URI,
      code: params.get('code'),
      attempt: pending.attempt,
    });
  } catch (err) {
    return fail('falhou', err.message, pending.next);
  }
  if (!sso.domains.includes(identity.email.split('@')[1])) return fail('dominio', 'domínio de e-mail não permitido', pending.next);

  const cookies = [clearState];
  const secure = TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';
  const viewerId = viewerSessions.create(identity.subject, { name: identity.name, email: identity.email });
  cookies.push(`${VIEWER_COOKIE}=${viewerId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}${secure ? '; Secure' : ''}`);
  const account = pending.next === '/' ? ssoAccount(identity, sso) : null;
  if (account) {
    const id = sessions.create(account.id);
    cookies.push(sessionCookie(req, id, Math.floor(SESSION_MAX_MS / 1000)));
    log.info('login', { user: account.username, metodo: 'login corporativo' });
  } else {
    log.info('espectador entrou com o login corporativo');
  }
  redirect(res, pending.next === '/' && !account ? '/?erro_sso=sem_permissao' : pending.next, { 'Set-Cookie': cookies });
};

const ssoLogout = async (req, res) => {
  viewerSessions.destroy(parseCookies(req.headers.cookie)[VIEWER_COOKIE]);
  json(res, 200, { ok: true }, { 'Set-Cookie': `${VIEWER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
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

const newRoomId = () => crypto.randomBytes(16).toString('base64url');

// Estado de uma sala que vale só enquanto ela está no ar (zerado quando uma sala fixa volta)
const freshRoomState = () => ({
  chat: true,
  // Na Live, o público só vê os botões de pedir a palavra e de pedir a tela se o anfitrião ligar
  allowRequests: { speak: false, screen: false },
  recording: false,
  banned: new Set(),
  speakers: new Set(),
  sharers: new Set(),
  requests: new Map(),
  joinedBy: new Map(),
  lobby: new Map(),
});

const newRoomState = ({ name, owner, type, openScreens, requireSso, fixed = false, title = null, isPrivate = false }) => ({
  name,
  owner,
  code: null,
  type,
  openScreens,
  requireSso,
  fixed,
  title,
  // Sala privada: acaba quando o anfitrião sai e não fica guardada no navegador de ninguém
  private: isPrivate,
  hostSeen: false,
  hostLeftAt: null,
  // Conexões do anfitrião que avisaram a saída (aba fechada): o LiveKit ainda as lista por ~20 s
  hostsGone: new Set(),
  invites: new Map(),
  waiting: false,
  ...freshRoomState(),
});

// Salas fixas ficam no state.json: tipo, convites (com usos e senhas em hash) e ingressos (em hash)
const persistRoom = (room) => {
  if (!room.fixed) return;
  const record = {
    name: room.name,
    title: room.title,
    owner: room.owner,
    type: room.type,
    openScreens: room.openScreens,
    requireSso: room.requireSso,
    waiting: room.waiting,
    createdAt: room.createdAt,
    invites: [...room.invites.values()],
    tickets: Object.fromEntries([...roomTickets].filter(([, t]) => t.name === room.name).map(([hash, t]) => [hash, t.inviteId])),
  };
  store.update((st) => {
    st.rooms = (st.rooms ?? []).filter((r) => r.name !== room.name);
    st.rooms.push(record);
  });
};

const loadFixedRooms = () => {
  for (const r of store.state.rooms ?? []) {
    const room = newRoomState({ ...r, fixed: true });
    room.waiting = !!r.waiting;
    room.createdAt = r.createdAt;
    for (const invite of r.invites) {
      room.invites.set(invite.id, invite);
      if (!invite.revoked) roomCodes.set(invite.code, { name: r.name, inviteId: invite.id });
      if (invite.isDefault) room.code = invite.code;
    }
    for (const [hash, inviteId] of Object.entries(r.tickets ?? {})) roomTickets.set(hash, { name: r.name, inviteId });
    liveRooms.set(r.name, room);
  }
};

const createLiveKitRoom = (room) =>
  rooms.createRoom({
    name: room.name,
    emptyTimeout: 300,
    departureTimeout: 60,
    maxParticipants: settings().maxParticipants,
    metadata: metadataOf(room),
  });

// Uma sala fixa fora do ar volta quando alguém entra, com o estado do ar zerado
const ensureLive = async (room) => {
  if (await roomExists(room.name)) return true;
  if (!room.fixed) return false;
  Object.assign(room, freshRoomState());
  await createLiveKitRoom(room);
  log.info('sala fixa de volta ao ar');
  return true;
};

const forgetRoom = (name) => {
  const room = liveRooms.get(name);
  if (room) for (const invite of room.invites.values()) roomCodes.delete(invite.code);
  for (const [hash, ticket] of roomTickets) if (ticket.name === name) roomTickets.delete(hash);
  liveRooms.delete(name);
};

// Sala (e o convite do link) pelo código público; links trocados ou salas encerradas dão 404
const roomByCode = async (code) => {
  if (typeof code !== 'string' || !ROOM_ID_RE.test(code)) throw new HttpError(400, 'Sala inválida.');
  const entry = roomCodes.get(code);
  if (!entry || !(await ensureLive(liveRooms.get(entry.name)))) {
    if (entry) forgetRoom(entry.name);
    throw new HttpError(404, 'Essa sala não existe, já foi encerrada ou o link foi trocado pelo anfitrião.');
  }
  const room = liveRooms.get(entry.name);
  return { name: entry.name, room, invite: room.invites.get(entry.inviteId) };
};

// Quais salas da lista "suas salas" (guardada no navegador) seguem no ar, sem trazer de volta
// uma sala fixa vazia. Só para quem tem conta; quem não tem o código não descobre nada.
const STATUS_MAX = 50;
const roomStatus = async (req, res) => {
  requireUser(req);
  const { codes } = await readJson(req);
  if (!Array.isArray(codes) || codes.length > STATUS_MAX || !codes.every((c) => typeof c === 'string' && ROOM_ID_RE.test(c)))
    return json(res, 400, { error: 'Lista de salas inválida.' });
  const open = new Set((await rooms.listRooms()).map((r) => r.name));
  const status = {};
  for (const code of new Set(codes)) {
    const entry = roomCodes.get(code);
    const room = entry && liveRooms.get(entry.name);
    if (!room || (!room.fixed && !open.has(entry.name))) {
      status[code] = { exists: false };
      continue;
    }
    const online = open.has(entry.name) ? (await rooms.listParticipants(entry.name).catch(() => [])).length : 0;
    status[code] = { exists: true, fixed: room.fixed, online };
  }
  json(res, 200, { status });
};

// --- convites de sala ---------------------------------------------------------

const INVITE_LIMITS = { label: 40, maxUses: 10_000, minutes: 30 * 24 * 60, password: 128 };

const newInvite = (room, { label, maxUses = null, expiresAt = null, passwordHash = null, isDefault = false }) => {
  const invite = { id: randomToken(9), code: newRoomId(), label, maxUses, used: 0, expiresAt, passwordHash, revoked: false, isDefault };
  room.invites.set(invite.id, invite);
  roomCodes.set(invite.code, { name: room.name, inviteId: invite.id });
  return invite;
};

const defaultInvite = (room) => [...room.invites.values()].find((i) => i.isDefault);

// Troca o código de um convite: o link antigo deixa de valer (ingressos já dados continuam)
const rotateInvite = (room, invite) => {
  roomCodes.delete(invite.code);
  invite.code = newRoomId();
  roomCodes.set(invite.code, { name: room.name, inviteId: invite.id });
  if (invite.isDefault) room.code = invite.code;
  return invite.code;
};

const publicInvite = (invite) => ({
  id: invite.id,
  code: invite.code,
  label: invite.label,
  maxUses: invite.maxUses,
  used: invite.used,
  expiresAt: invite.expiresAt && new Date(invite.expiresAt).toISOString(),
  hasPassword: !!invite.passwordHash,
  revoked: invite.revoked,
  isDefault: invite.isDefault,
});

// Por que um convite não deixa entrar (ou null se deixa)
const inviteProblem = (invite) => {
  if (invite.revoked) return 'Este convite foi revogado.';
  if (invite.expiresAt && invite.expiresAt <= Date.now()) return 'Este convite expirou.';
  if (invite.maxUses !== null && invite.used >= invite.maxUses) return 'Este convite já atingiu o limite de pessoas.';
  return null;
};

// Tentativas de senha de convite: por IP e convite
const invitePasswordLimiter = createLimiter({ max: 10, windowMs: 10 * 60_000 });

// Ações do anfitrião: o código da sala e a chave de anfitrião precisam bater
const hostRoom = async ({ roomId, hostKey }) => {
  const found = await roomByCode(roomId);
  if (typeof hostKey !== 'string' || !safeEqual(hostKey, hostKeyFor(found.name)))
    throw new HttpError(403, 'Apenas o anfitrião pode fazer isso.');
  return found;
};

// O que cada participante pode fazer, pelo tipo da sala e pelo que o anfitrião liberou:
// "Jogando juntos": todos falam; mostrar a tela é livre ou liberado pelo anfitrião.
// "Live": só fala e mostra a tela quem o anfitrião liberou (mostrar a tela inclui falar).
const canSpeak = (room, id) => room.type === 'together' || room.speakers.has(id) || room.sharers.has(id);
const canShare = (room, id) => (room.type === 'together' && room.openScreens) || room.sharers.has(id);

const viewerPermission = (room, identity) => {
  const sources = [
    ...(canSpeak(room, identity) ? [TrackSource.MICROPHONE] : []),
    ...(canShare(room, identity) ? SCREEN_SOURCES : []),
  ];
  return { canSubscribe: true, canPublishData: room.chat, canPublish: sources.length > 0, canPublishSources: sources };
};

const metadataOf = (room) =>
  JSON.stringify({
    type: room.type,
    private: room.private,
    openScreens: room.openScreens,
    chat: room.chat,
    recording: room.recording,
    allowRequests: room.allowRequests,
    requests: [...room.requests.values()],
    waiting: room.waiting,
    lobby: [...room.lobby.values()].filter((e) => e.status === 'waiting').map(({ ref, name }) => ({ id: ref, name })),
  });

// Aplica as permissões atuais a quem já está na sala e avisa todos pelos metadados da sala
const syncRoom = async (name, room, identities) => {
  const targets = identities ?? (await rooms.listParticipants(name)).map((p) => p.identity).filter((id) => id.startsWith('v-'));
  await Promise.all(
    targets.map((id) =>
      rooms.updateParticipant(name, id, { permission: viewerPermission(room, id) }).catch(() => {}),
    ),
  );
  await rooms.updateRoomMetadata(name, metadataOf(room));
};


// Vigia das salas: quem foi removido e voltou com o token antigo é removido de novo, e o aviso de
// gravação é desligado se o anfitrião saiu (aba fechada, navegador travado, rede caída)
setInterval(async () => {
  for (const room of liveRooms.values()) {
    // Quem desistiu de esperar na sala de espera sai da fila depois de um tempo
    let lobbyChanged = false;
    for (const [id, entry] of room.lobby) {
      if (entry.expires < Date.now()) {
        room.lobby.delete(id);
        lobbyChanged = true;
      }
    }
    if (lobbyChanged) await rooms.updateRoomMetadata(room.name, metadataOf(room)).catch(() => {});
    if (!room.banned.size && !room.recording && !room.private) continue;
    try {
      const participants = await rooms.listParticipants(room.name);
      const hostHere = participants.some((p) => p.identity.startsWith('h-') && !room.hostsGone.has(p.identity));
      // Sala privada: depois que o anfitrião entrou, a saída dele por mais que a tolerância encerra a sala
      if (room.private) {
        if (hostHere) {
          room.hostSeen = true;
          room.hostLeftAt = null;
        } else if (room.hostSeen) {
          room.hostLeftAt ??= Date.now();
          if (Date.now() - room.hostLeftAt >= PRIVATE_GRACE_MS) {
            await rooms.deleteRoom(room.name).catch(() => {});
            forgetRoom(room.name);
            log.info('sala privada encerrada: o anfitrião saiu');
            continue;
          }
        }
      }
      for (const p of participants) {
        if (!room.banned.has(p.identity)) continue;
        await rooms.removeParticipant(room.name, p.identity).catch(() => {});
        log.warn('participante removido tentou voltar e foi removido de novo');
      }
      if (room.recording && !hostHere) {
        room.recording = false;
        await rooms.updateRoomMetadata(room.name, metadataOf(room));
        log.info('gravação encerrada: o anfitrião saiu da sala');
      }
    } catch {}
  }
}, BAN_CHECK_MS).unref();

// Tipo, telas livres e login da empresa de uma sala nova (rápida ou fixa)
const roomOptions = (body) => {
  if (body.requireSso !== undefined && typeof body.requireSso !== 'boolean')
    throw new HttpError(400, 'requireSso deve ser verdadeiro ou falso.');
  // Sem tipo informado, a sala é "Live": a mais restrita
  const type = body.type ?? 'live';
  if (!ROOM_TYPES.includes(type)) throw new HttpError(400, 'Tipo de sala inválido.');
  if (body.openScreens !== undefined && typeof body.openScreens !== 'boolean')
    throw new HttpError(400, 'openScreens deve ser verdadeiro ou falso.');
  const openScreens = type === 'together' && (body.openScreens ?? true);
  const sso = ssoSettings();
  // Sem SSO configurado, nenhuma sala exige; com "todas exigem", nenhuma fica aberta
  const requireSso = ssoReady() && (sso.forceRooms || (body.requireSso ?? sso.roomsDefault));
  return { type, openScreens, requireSso };
};

const createRoom = async (req, res) => {
  const { user } = requireUser(req);
  const body = await readJson(req);
  const { type, openScreens, requireSso } = roomOptions(body);
  if (body.private !== undefined && typeof body.private !== 'boolean')
    throw new HttpError(400, 'private deve ser verdadeiro ou falso.');
  const name = newRoomId();
  const room = newRoomState({ name, owner: user.id, type, openScreens, requireSso, isPrivate: body.private === true });
  room.code = newInvite(room, { label: 'Convite padrão', isDefault: true }).code;
  const { maxParticipants } = settings();
  await createLiveKitRoom(room);
  liveRooms.set(name, room);
  log.info('sala criada', { user: user.username, tipo: type, maxParticipants, exigeLogin: requireSso, privada: room.private });
  json(res, 201, { roomId: room.code, hostKey: hostKeyFor(name), requireSso, type, openScreens, private: room.private });
};

const LOBBY_TTL_MS = 10 * 60_000;

// Entrada de quem não é anfitrião: ingresso guardado no navegador, ou o convite do link (validade,
// limite de pessoas, senha) e, com a sala de espera ligada, a aprovação do anfitrião.
// Devolve o convite e o ingresso usados, ou responde (espera, erro) e devolve null.
const admitViewer = async (req, res, found, body, displayName) => {
  const { room, invite } = found;
  if (found.ticketHash) return { inviteId: invite.id, ticketHash: found.ticketHash };

  const entry = typeof body.lobbyId === 'string' && room.lobby.get(body.lobbyId);
  const problem = inviteProblem(invite);
  if (problem) throw new HttpError(410, problem, 'invite_closed');

  // Quem já está na fila passou pela senha; os demais passam agora
  if (!entry && invite.passwordHash) {
    const key = `${clientIp(req)}|${invite.id}`;
    if (invitePasswordLimiter.blocked(key)) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos.');
    if (typeof body.password !== 'string' || !body.password)
      throw new HttpError(401, 'Este convite pede uma senha.', 'password_required');
    if (!(await verifyPasswordOrDummy(body.password, invite.passwordHash))) {
      invitePasswordLimiter.fail(key);
      log.warn('senha de convite incorreta');
      throw new HttpError(403, 'Senha do convite incorreta.', 'password_required');
    }
  }

  if (room.waiting) {
    if (!entry || entry.inviteId !== invite.id) {
      const id = randomToken(12);
      // id: segredo de quem espera (para perguntar se já pode entrar); ref: o que o anfitrião vê
      room.lobby.set(id, { id, ref: randomToken(9), name: displayName, inviteId: invite.id, status: 'waiting', expires: Date.now() + LOBBY_TTL_MS });
      await rooms.updateRoomMetadata(room.name, metadataOf(room));
      json(res, 202, { waiting: true, lobbyId: id });
      return null;
    }
    if (entry.status === 'waiting') {
      entry.expires = Date.now() + LOBBY_TTL_MS;
      json(res, 202, { waiting: true, lobbyId: entry.id });
      return null;
    }
    room.lobby.delete(entry.id);
    if (entry.status === 'denied') throw new HttpError(403, 'O anfitrião não liberou sua entrada.', 'lobby_denied');
  }

  invite.used++;
  const ticket = randomToken();
  roomTickets.set(sha256(ticket), { name: room.name, inviteId: invite.id });
  persistRoom(room);
  // Quem passou pela sala de espera entra com o nome que o anfitrião aprovou
  return { inviteId: invite.id, ticketHash: sha256(ticket), ticket, name: entry?.name };
};

// Sala de quem tem um ingresso válido (o link pode ter mudado desde que a pessoa entrou)
const roomByTicket = async (ticket) => {
  if (typeof ticket !== 'string') return null;
  const ticketHash = sha256(ticket);
  const entry = roomTickets.get(ticketHash);
  const room = entry && liveRooms.get(entry.name);
  if (!room || !(await ensureLive(room))) return null;
  return { name: entry.name, room, invite: room.invites.get(entry.inviteId), ticketHash };
};

const issueToken = async (req, res) => {
  const body = await readJson(req);
  const found = (!body.hostKey && (await roomByTicket(body.ticket))) || (await roomByCode(body.roomId));
  const isHost = typeof body.hostKey === 'string' && safeEqual(body.hostKey, hostKeyFor(found.name));

  let displayName = (typeof body.name === 'string' ? body.name.trim().slice(0, 32) : '') || (isHost ? 'Anfitrião' : 'Espectador');
  // Sala que exige login corporativo: só entra quem fez login, e com o nome real do provedor
  if (found.room.requireSso && !isHost) {
    const viewer = currentViewer(req);
    const account = currentSession(req)?.user;
    if (!viewer && !account)
      throw new HttpError(401, 'Esta sala exige o login da empresa para assistir.', 'sso_required');
    displayName = viewer ? viewer.name : account.username;
  }
  const admitted = isHost ? null : await admitViewer(req, res, found, body, displayName);
  if (!isHost && !admitted) return;
  if (admitted?.name) displayName = admitted.name;
  const identity = `${isHost ? 'h' : 'v'}-${crypto.randomBytes(6).toString('hex')}`;
  if (admitted) found.room.joinedBy.set(identity, admitted);

  const at = new AccessToken(API_KEY, API_SECRET, { identity, name: displayName, ttl: TOKEN_TTL });
  at.addGrant({
    room: found.name,
    roomJoin: true,
    ...(isHost
      ? { canSubscribe: true, canPublishData: true, canPublish: true, canPublishSources: HOST_SOURCES }
      : viewerPermission(found.room, identity)),
  });

  json(res, 200, {
    token: await at.toJwt(),
    url: PUBLIC_URL,
    role: isHost ? 'host' : 'viewer',
    identity,
    // A página só oferece qualidades até a máxima do servidor (limite da interface, não do LiveKit)
    quality: { default: settings().defaultQuality, max: settings().maxQuality },
    // Para a lista "suas salas" da página inicial, guardada só no navegador
    room: { type: found.room.type, private: found.room.private, ...(found.room.fixed && { title: found.room.title }) },
    ...(admitted?.ticket && { ticket: admitted.ticket }),
  });
};

// Encerrar tira todos da sala. A sala rápida some; a fixa só sai do ar e volta quando alguém entrar.
const endRoom = async (req, res) => {
  const { name, room } = await hostRoom(await readJson(req));
  await rooms.deleteRoom(name).catch(() => {});
  if (!room.fixed) forgetRoom(name);
  log.info('sala encerrada');
  json(res, 200, { ok: true });
};

// --- API: moderação (anfitrião) ---------------------------------------------

const setChat = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled deve ser verdadeiro ou falso.' });
  room.chat = body.enabled;
  await syncRoom(name, room);
  log.info(room.chat ? 'chat ligado' : 'chat desligado');
  json(res, 200, { chat: room.chat });
};

// A gravação acontece no navegador do anfitrião; o servidor só avisa todos na sala que ela está ligada
const setRecording = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled deve ser verdadeiro ou falso.' });
  room.recording = body.enabled;
  await rooms.updateRoomMetadata(name, metadataOf(room));
  log.info(room.recording ? 'gravação iniciada' : 'gravação encerrada');
  json(res, 200, { recording: room.recording });
};

// O anfitrião fechou a aba (aviso do navegador ao sair): na sala privada, a tolerância começa agora,
// sem esperar o LiveKit perceber a queda
const HOST_IDENTITY_RE = /^h-[0-9a-f]{12}$/;
const hostLeft = async (req, res) => {
  const body = await readJson(req);
  const { room } = await hostRoom(body);
  if (typeof body.identity !== 'string' || !HOST_IDENTITY_RE.test(body.identity))
    return json(res, 400, { error: 'Identidade inválida.' });
  room.hostsGone.add(body.identity);
  // Quem avisa a saída esteve na sala, mesmo que a vigia não tenha chegado a vê-lo
  room.hostSeen = true;
  json(res, 200, { ok: true });
};

// Novo link para o convite padrão (o antigo deixa de valer; quem tem ingresso continua entrando)
const newLink = async (req, res) => {
  const { room } = await hostRoom(await readJson(req));
  const code = rotateInvite(room, defaultInvite(room));
  persistRoom(room);
  log.info('link da sala trocado');
  json(res, 200, { roomId: code });
};

// --- API: salas fixas (admin) ------------------------------------------------------

const TITLE_MAX = 60;

const publicFixedRoom = async (room) => ({
  id: room.name,
  title: room.title,
  type: room.type,
  openScreens: room.openScreens,
  requireSso: room.requireSso,
  roomId: room.code,
  hostKey: hostKeyFor(room.name),
  online: (await rooms.listParticipants(room.name).catch(() => [])).length,
});

const fixedRooms = () => [...liveRooms.values()].filter((r) => r.fixed);

const listFixedRooms = async (req, res) => {
  requireUser(req, { role: 'admin' });
  json(res, 200, { rooms: await Promise.all(fixedRooms().map(publicFixedRoom)) });
};

const createFixedRoom = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const body = await readJson(req);
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : '';
  if (!title) return json(res, 400, { error: 'Dê um nome à sala.' });
  if (fixedRooms().some((r) => r.title.toLowerCase() === title.toLowerCase()))
    return json(res, 409, { error: 'Já existe uma sala fixa com esse nome.' });
  const options = roomOptions(body);
  const room = newRoomState({ name: newRoomId(), owner: user.id, ...options, fixed: true, title });
  room.createdAt = new Date().toISOString();
  room.code = newInvite(room, { label: 'Convite padrão', isDefault: true }).code;
  liveRooms.set(room.name, room);
  persistRoom(room);
  log.info('sala fixa criada', { user: user.username, tipo: options.type });
  json(res, 201, await publicFixedRoom(room));
};

const deleteFixedRoom = async (req, res) => {
  const { user } = requireUser(req, { role: 'admin' });
  const { id } = await readJson(req);
  const room = typeof id === 'string' && liveRooms.get(id);
  if (!room?.fixed) return json(res, 404, { error: 'Sala não encontrada.' });
  await rooms.deleteRoom(room.name).catch(() => {});
  forgetRoom(room.name);
  store.update((st) => (st.rooms = (st.rooms ?? []).filter((r) => r.name !== room.name)));
  log.warn('sala fixa excluída', { user: user.username });
  json(res, 200, { ok: true });
};

// --- API: convites e sala de espera (anfitrião) --------------------------------

const createRoomInvite = async (req, res) => {
  const body = await readJson(req);
  const { room } = await hostRoom(body);
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, INVITE_LIMITS.label) : 'Convite';
  const { maxUses = null, expiresInMinutes = null, password = '' } = body;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_LIMITS.maxUses))
    return json(res, 400, { error: 'Limite de pessoas do convite: de 1 a 10000, ou sem limite.' });
  if (expiresInMinutes !== null && (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > INVITE_LIMITS.minutes))
    return json(res, 400, { error: 'Validade do convite: de 1 minuto a 30 dias, ou sem validade.' });
  if (typeof password !== 'string' || password.length > INVITE_LIMITS.password)
    return json(res, 400, { error: 'Senha do convite inválida.' });
  const invite = newInvite(room, {
    label,
    maxUses,
    expiresAt: expiresInMinutes && Date.now() + expiresInMinutes * 60_000,
    passwordHash: password ? await hashPassword(password) : null,
  });
  persistRoom(room);
  log.info('convite de sala criado', { limite: maxUses, validadeMin: expiresInMinutes, senha: !!password });
  json(res, 201, publicInvite(invite));
};

const listInvitesOfRoom = async (req, res) => {
  const { room } = await hostRoom(await readJson(req));
  json(res, 200, { invites: [...room.invites.values()].map(publicInvite), waiting: room.waiting });
};

// Revogar um convite desliga o link e tira da sala quem entrou por ele (os outros convites seguem)
const revokeRoomInvite = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  const invite = room.invites.get(body.inviteId);
  if (!invite) return json(res, 404, { error: 'Convite não encontrado.' });
  if (invite.isDefault) return json(res, 400, { error: 'O convite padrão não pode ser revogado; gere um link novo para ele.' });
  invite.revoked = true;
  roomCodes.delete(invite.code);
  let removed = 0;
  for (const [identity, joined] of room.joinedBy) {
    if (joined.inviteId !== invite.id) continue;
    room.banned.add(identity);
    removed++;
    await rooms.removeParticipant(name, identity).catch(() => {});
  }
  for (const [hash, ticket] of roomTickets) if (ticket.inviteId === invite.id && ticket.name === name) roomTickets.delete(hash);
  persistRoom(room);
  log.warn('convite de sala revogado', { pessoasRemovidas: removed });
  json(res, 200, { removed });
};

const setWaiting = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled deve ser verdadeiro ou falso.' });
  room.waiting = body.enabled;
  // Desligar a sala de espera deixa entrar quem estava esperando
  if (!room.waiting) for (const entry of room.lobby.values()) if (entry.status === 'waiting') entry.status = 'admitted';
  persistRoom(room);
  await rooms.updateRoomMetadata(name, metadataOf(room));
  log.info(room.waiting ? 'sala de espera ligada' : 'sala de espera desligada');
  json(res, 200, { waiting: room.waiting });
};

const decideLobby = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  const entry = typeof body.lobbyId === 'string' && [...room.lobby.values()].find((e) => e.ref === body.lobbyId);
  if (!entry || entry.status !== 'waiting') return json(res, 404, { error: 'Essa pessoa não está mais esperando.' });
  if (typeof body.admit !== 'boolean') return json(res, 400, { error: 'admit deve ser verdadeiro ou falso.' });
  entry.status = body.admit ? 'admitted' : 'denied';
  entry.expires = Date.now() + LOBBY_TTL_MS;
  await rooms.updateRoomMetadata(name, metadataOf(room));
  log.info(body.admit ? 'entrada liberada na sala de espera' : 'entrada recusada na sala de espera');
  json(res, 200, { ok: true });
};

const participantIn = async (name, identity) => {
  if (typeof identity !== 'string' || !VIEWER_ID_RE.test(identity)) throw new HttpError(400, 'Participante inválido.');
  const present = (await rooms.listParticipants(name)).some((p) => p.identity === identity);
  if (!present) throw new HttpError(404, 'Essa pessoa não está mais na sala.');
};

// O anfitrião libera ou tira de alguém a fala e a tela. Liberar atende o pedido pendente.
const setPermissions = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  for (const field of ['speak', 'screen']) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean')
      return json(res, 400, { error: `${field} deve ser verdadeiro ou falso.` });
  }
  await participantIn(name, body.identity);
  const id = body.identity;
  for (const [field, set] of [['speak', room.speakers], ['screen', room.sharers]]) {
    if (body[field] === undefined) continue;
    if (body[field]) set.add(id);
    else set.delete(id);
    room.requests.delete(`${id}:${field}`);
  }
  await syncRoom(name, room, [id]);
  log.info('permissões de participante alteradas', { fala: canSpeak(room, id), tela: canShare(room, id) });
  json(res, 200, { speak: canSpeak(room, id), screen: canShare(room, id) });
};

// Pedidos e ajustes feitos por quem está na sala: a identidade vem do próprio token do LiveKit,
// assinado pelo servidor, então ninguém age em nome de outra pessoa (e funciona com o chat desligado)
const participantFromToken = async (token) => {
  if (typeof token !== 'string') throw new HttpError(401, 'Token da sala ausente.');
  let claims;
  try {
    claims = await tokenVerifier.verify(token);
  } catch {
    throw new HttpError(401, 'Token da sala inválido.');
  }
  const room = liveRooms.get(claims.video?.room);
  if (!room || room.banned.has(claims.sub)) throw new HttpError(404, 'Essa sala não existe, já foi encerrada ou o link foi trocado pelo anfitrião.');
  return { room, identity: claims.sub, name: claims.name };
};

const REQUEST_KINDS = ['speak', 'screen'];

// Pedir a palavra ou para mostrar a tela (cancel: true desiste do pedido)
const requestPermission = async (req, res) => {
  const body = await readJson(req);
  const { room, identity, name } = await participantFromToken(body.token);
  if (!REQUEST_KINDS.includes(body.kind)) return json(res, 400, { error: 'Pedido inválido.' });
  if (!identity.startsWith('v-')) return json(res, 400, { error: 'O anfitrião não precisa pedir.' });
  const key = `${identity}:${body.kind}`;
  if (body.cancel !== true && room.type === 'live' && !room.allowRequests[body.kind])
    return json(res, 403, { error: 'O anfitrião não está aceitando esse pedido agora.' });
  if (body.cancel === true) room.requests.delete(key);
  else if (body.kind === 'speak' ? !canSpeak(room, identity) : !canShare(room, identity))
    room.requests.set(key, { identity, name, kind: body.kind });
  await rooms.updateRoomMetadata(room.name, metadataOf(room));
  json(res, 200, { pending: room.requests.has(key) });
};

// Na Live, o anfitrião escolhe se o público pode pedir a palavra e pedir para mostrar a tela.
// Desligar um tipo de pedido descarta os pedidos desse tipo que estavam na fila.
const setAllowRequests = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  if (room.type !== 'live') return json(res, 400, { error: 'Só a Live tem essa opção.' });
  const changes = {};
  for (const kind of REQUEST_KINDS) {
    if (body[kind] === undefined) continue;
    if (typeof body[kind] !== 'boolean') return json(res, 400, { error: 'Os pedidos devem ser ligados ou desligados.' });
    changes[kind] = body[kind];
  }
  if (!Object.keys(changes).length) return json(res, 400, { error: 'Os pedidos devem ser ligados ou desligados.' });
  room.allowRequests = { ...room.allowRequests, ...changes };
  for (const [key, r] of room.requests) if (!room.allowRequests[r.kind]) room.requests.delete(key);
  await rooms.updateRoomMetadata(name, metadataOf(room));
  log.info('pedidos do público', room.allowRequests);
  json(res, 200, { allowRequests: room.allowRequests });
};

const PIP = { corner: ['tl', 'tr', 'bl', 'br'], size: ['s', 'm', 'l'], shape: ['rounded', 'circle'] };

// Posição e estilo da câmera sobre a tela, escolhidos por quem transmite; vão para os atributos dela
const setLayout = async (req, res) => {
  const body = await readJson(req);
  const { room, identity } = await participantFromToken(body.token);
  const pip = body.pip ?? {};
  for (const [field, allowed] of Object.entries(PIP)) {
    if (!allowed.includes(pip[field])) return json(res, 400, { error: 'Posição da câmera inválida.' });
  }
  await rooms.updateParticipant(room.name, identity, { attributes: { pip: `${pip.corner}:${pip.size}:${pip.shape}` } });
  json(res, 200, { ok: true });
};

// Remove alguém da sala. Espectadores não têm conta, então o link também é trocado:
// sem isso, a pessoa voltaria com o mesmo link. O token que ela já tem continua válido no
// LiveKit (esta versão não aplica revokeTokenTs), por isso a identidade fica banida na sala.
const kick = async (req, res) => {
  const body = await readJson(req);
  const { name, room } = await hostRoom(body);
  await participantIn(name, body.identity);
  room.banned.add(body.identity);
  await rooms.removeParticipant(name, body.identity, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1) });
  room.speakers.delete(body.identity);
  room.sharers.delete(body.identity);
  for (const kind of REQUEST_KINDS) room.requests.delete(`${body.identity}:${kind}`);
  await rooms.updateRoomMetadata(name, metadataOf(room));
  // O ingresso da pessoa deixa de valer, e o convite por onde ela entrou ganha um link novo
  // (sem conta, é o único jeito de ela não voltar com o mesmo link)
  const joined = room.joinedBy.get(body.identity);
  if (joined) roomTickets.delete(joined.ticketHash);
  const invite = room.invites.get(joined?.inviteId) ?? defaultInvite(room);
  if (!invite.revoked) rotateInvite(room, invite);
  persistRoom(room);
  log.info('participante removido da sala');
  json(res, 200, { roomId: room.code, inviteRotated: invite.id });
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
  'POST /api/setup/check': checkSetupCode,
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
  'POST /api/admin/users/reset-link': passwordResetLink,
  'POST /api/password-reset': passwordReset,
  'GET /api/admin/invites': listInvites,
  'POST /api/admin/invites': createInvite,
  'POST /api/admin/invites/cancel': cancelInvite,
  'POST /api/invites/accept': acceptInvite,
  'POST /api/signup': signup,
  'POST /api/admin/users/approve': approveUser,
  'GET /api/admin/rooms': listFixedRooms,
  'POST /api/admin/rooms': createFixedRoom,
  'POST /api/admin/rooms/delete': deleteFixedRoom,
  'POST /api/admin-reset': adminReset,
  'GET /api/admin/sso': getSso,
  'GET /api/discord': getDiscord,
  'POST /api/admin/discord': updateDiscord,
  'POST /api/admin/sso': updateSso,
  'GET /api/admin/update': getUpdate,
  'GET /api/admin/usage': getUsage,
  'POST /api/admin/update/check': checkUpdateNow,
  'GET /api/sso/start': ssoStart,
  'GET /api/sso/callback': ssoCallback,
  'POST /api/sso/logout': ssoLogout,
  'POST /api/account/password': changePassword,
  'POST /api/rooms': createRoom,
  'POST /api/rooms/status': roomStatus,
  'POST /api/token': issueToken,
  'POST /api/rooms/end': endRoom,
  'POST /api/rooms/chat': setChat,
  'POST /api/rooms/link': newLink,
  'POST /api/rooms/invites': createRoomInvite,
  'POST /api/rooms/invites/list': listInvitesOfRoom,
  'POST /api/rooms/invites/revoke': revokeRoomInvite,
  'POST /api/rooms/waiting': setWaiting,
  'POST /api/rooms/lobby': decideLobby,
  'POST /api/rooms/recording': setRecording,
  'POST /api/rooms/host-left': hostLeft,
  'POST /api/rooms/permissions': setPermissions,
  'POST /api/rooms/request': requestPermission,
  'POST /api/rooms/allow-requests': setAllowRequests,
  'POST /api/rooms/layout': setLayout,
  'POST /api/rooms/kick': kick,
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
    if (LEGACY_PAGES[p]) return send(res, 301, '', { Location: LEGACY_PAGES[p] + url.search, 'Cache-Control': 'no-store' });
    if (ROOT_FILES[p]) return await serveFile(res, path.join(PUBLIC_DIR, ROOT_FILES[p]));
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
  loadFixedRooms();
  // A primeira leitura espera o LiveKit subir junto (na imagem, os dois começam ao mesmo tempo)
  setTimeout(usageMeter.poll, Math.min(5000, USAGE_POLL_MS)).unref();
  setInterval(usageMeter.poll, USAGE_POLL_MS).unref();
  const scheduledCheck = () => updateCheckActive() && updateChecker.check();
  setTimeout(scheduledCheck, UPDATE_CHECK_DELAY_MS).unref();
  setInterval(scheduledCheck, UPDATE_CHECK_INTERVAL_MS).unref();
});
