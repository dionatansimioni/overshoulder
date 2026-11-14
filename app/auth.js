// Senhas, sessões e limites de tentativas.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const here = path.dirname(fileURLToPath(import.meta.url));

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');

export const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// --- senhas ----------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
};

export const verifyPassword = async (password, stored) => {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
};

// Conta inexistente também gasta o tempo de um scrypt: a resposta não revela quais usuários existem
const DUMMY_HASH = await hashPassword(randomToken());
export const verifyPasswordOrDummy = async (password, stored) => {
  const ok = await verifyPassword(password, stored ?? DUMMY_HASH);
  return ok && !!stored;
};

const COMMON = new Set(
  fs.readFileSync(path.join(here, 'data', 'common-passwords.txt'), 'utf8').split('\n').filter(Boolean),
);

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

// Regras do NIST SP 800-63B: tamanho mínimo, sem exigir símbolos, recusando senhas conhecidas
export const passwordProblem = (password, username = '') => {
  if (typeof password !== 'string' || password.length < 12) return 'A senha precisa ter pelo menos 12 caracteres.';
  if (password.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Essa senha aparece em listas de senhas vazadas. Escolha outra.';
  if (new Set(lower).size < 4) return 'A senha repete poucos caracteres. Escolha outra.';
  if (username.length >= 3 && lower.includes(username.toLowerCase())) return 'A senha não pode conter o nome de usuário.';
  return null;
};

// --- limites de tentativas -----------------------------------------------

export const createLimiter = ({ max, windowMs }) => {
  const hits = new Map();
  const current = (key) => {
    const h = hits.get(key);
    if (h && Date.now() - h.since > windowMs) hits.delete(key);
    return hits.get(key);
  };
  return {
    blocked: (key) => (current(key)?.count ?? 0) >= max,
    fail: (key) => {
      const h = current(key);
      if (h) h.count++;
      else hits.set(key, { count: 1, since: Date.now() });
    },
    reset: (key) => hits.delete(key),
  };
};

// --- sessões ---------------------------------------------------------------

// Sessões ficam só na memória: reiniciar o servidor desloga todo mundo, o que é aceitável
export const createSessions = ({ maxMs, idleMs }) => {
  const sessions = new Map();

  const get = (id) => {
    if (typeof id !== 'string') return null;
    const key = sha256(id);
    const s = sessions.get(key);
    if (!s) return null;
    const now = Date.now();
    if (now - s.createdAt > maxMs || now - s.lastSeen > idleMs) {
      sessions.delete(key);
      return null;
    }
    s.lastSeen = now;
    return s;
  };

  return {
    create(userId, extra = {}) {
      const id = randomToken();
      const now = Date.now();
      sessions.set(sha256(id), { userId, createdAt: now, lastSeen: now, ...extra });
      return id;
    },
    get,
    destroy(id) {
      if (typeof id === 'string') sessions.delete(sha256(id));
    },
    // Encerra todas as sessões de uma conta, menos (opcionalmente) a atual
    destroyUser(userId, exceptId) {
      const keep = exceptId && sha256(exceptId);
      for (const [key, s] of sessions) if (s.userId === userId && key !== keep) sessions.delete(key);
    },
  };
};

export const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, v.join('=')]),
  );
