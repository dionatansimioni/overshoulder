// Login corporativo (OpenID Connect): Authorization Code + PKCE, com state e nonce.
// O ID token é validado pela assinatura (JWKS do provedor), emissor, audiência, validade e nonce.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const b64url = (buf) => buf.toString('base64url');

// HTTPS obrigatório, exceto para provedores na própria máquina (testes e desenvolvimento)
export const validIssuer = (issuer) => {
  try {
    const u = new URL(issuer);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    return (u.protocol === 'https:' || (u.protocol === 'http:' && local)) && !u.search && !u.hash;
  } catch {
    return false;
  }
};

const discoveryCache = new Map();
const jwksCache = new Map();

// Lê /.well-known/openid-configuration; o emissor declarado precisa ser exatamente o configurado
export const discover = async (issuer) => {
  const key = issuer.replace(/\/+$/, '');
  if (discoveryCache.has(key)) return discoveryCache.get(key);
  const res = await fetch(`${key}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`o provedor respondeu ${res.status} na descoberta`);
  const meta = await res.json();
  if (meta.issuer?.replace(/\/+$/, '') !== key) throw new Error('o emissor declarado pelo provedor não confere');
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (!validIssuer(new URL(meta[field]).origin)) throw new Error(`${field} inseguro ou inválido`);
  }
  discoveryCache.set(key, meta);
  return meta;
};

export const forgetDiscovery = () => {
  discoveryCache.clear();
  jwksCache.clear();
};

// Dados de uma tentativa de login: ficam no servidor, ligados ao navegador por um cookie
export const newAttempt = () => {
  const verifier = b64url(crypto.randomBytes(32));
  return {
    state: b64url(crypto.randomBytes(24)),
    nonce: b64url(crypto.randomBytes(24)),
    verifier,
    challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
  };
};

export const authorizationUrl = (meta, { clientId, redirectUri, attempt }) => {
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: attempt.challenge,
    code_challenge_method: 'S256',
  });
  return url.toString();
};

// Troca o código pelo ID token (autenticação do cliente por client_secret_basic) e o valida
export const finishLogin = async (meta, { clientId, clientSecret, redirectUri, code, attempt }) => {
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: attempt.verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`o provedor recusou o código (${res.status})`);
  const { id_token: idToken } = await res.json();
  if (typeof idToken !== 'string') throw new Error('o provedor não devolveu um ID token');

  if (!jwksCache.has(meta.jwks_uri)) jwksCache.set(meta.jwks_uri, createRemoteJWKSet(new URL(meta.jwks_uri)));
  const { payload } = await jwtVerify(idToken, jwksCache.get(meta.jwks_uri), {
    issuer: meta.issuer,
    audience: clientId,
    clockTolerance: 30,
  });
  if (payload.nonce !== attempt.nonce) throw new Error('nonce do ID token não confere');
  if (typeof payload.email !== 'string' || !payload.email.includes('@')) throw new Error('o provedor não informou o e-mail');
  // Alguns provedores (Entra ID) não enviam email_verified; quem envia "false" é recusado
  if (payload.email_verified === false) throw new Error('e-mail não verificado no provedor');
  return {
    subject: `${meta.issuer}|${payload.sub}`,
    email: payload.email.toLowerCase(),
    name: String(payload.name ?? payload.email).trim().slice(0, 32),
    groups: Array.isArray(payload.groups) ? payload.groups.map(String) : [],
  };
};
