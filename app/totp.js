// TOTP (RFC 6238): códigos de 6 dígitos que mudam a cada 30 s, compatíveis com os apps autenticadores.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export const base32Encode = (buf) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

export const base32Decode = (text) => {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

// Código do passo (janela de 30 s) informado, com o número de dígitos pedido
export const codeAt = (secret, step, digits = DIGITS) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
};

// Confere o código aceitando um passo antes e um depois (relógios levemente fora de hora).
// Devolve o passo usado, ou null. Passos já usados (<= lastStep) são recusados: o mesmo código não vale duas vezes.
export const verifyCode = (secret, code, lastStep = -1, now = Date.now()) => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue;
    const expected = codeAt(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return s;
  }
  return null;
};

export const otpauthUri = (secret, username, issuer = 'Overshoulder') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}` +
  `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// Códigos de recuperação: 10 de uso único, no formato xxxxx-xxxxx (50 bits cada)
export const newRecoveryCodes = () =>
  Array.from({ length: 10 }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

export const normalizeRecoveryCode = (code) =>
  typeof code === 'string' ? code.trim().toLowerCase().replace(/[^a-z2-7]/g, '') : '';
