// Provedor OIDC falso para os testes: descoberta, JWKS, autorização (aprova sozinho o usuário
// configurado) e emissão de ID token assinado. Também sabe se comportar mal, para os testes de segurança.
import crypto from 'node:crypto';
import http from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export const CLIENT = { id: 'overshoulder-teste', secret: 'segredo-do-cliente-de-teste' };

export const startOidcMock = async (port) => {
  const issuer = `http://127.0.0.1:${port}`;
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'chave-1', alg: 'RS256', use: 'sig' };
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const codes = new Map();
  const mock = {
    issuer,
    user: { sub: 'u-1', email: 'ana@empresa.com.br', name: 'Ana Souza', groups: [] },
    // Alterações nas claims do ID token (ex.: { aud: 'outro' }) ou na assinatura (sign: 'outra-chave')
    tamper: {},
    requests: [],
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      mock.requests.push(Object.fromEntries(p));
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { ...Object.fromEntries(p), user: { ...mock.user } });
      const back = new URL(p.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state'));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const auth = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
      if (auth !== `${CLIENT.id}:${CLIENT.secret}`) return send(401, { error: 'invalid_client' });
      const grant = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (!grant || grant.redirect_uri !== form.get('redirect_uri')) return send(400, { error: 'invalid_grant' });
      const challenge = crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== grant.code_challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const { sign, ...claims } = mock.tamper;
      const { sub, ...profile } = grant.user;
      const idToken = await new SignJWT({ nonce: grant.nonce, ...profile, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'chave-1' })
        .setIssuer(claims.iss ?? issuer)
        .setAudience(claims.aud ?? CLIENT.id)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? '5m')
        .sign(sign === 'outra-chave' ? otherKey : privateKey);
      return send(200, { access_token: 'x', token_type: 'Bearer', id_token: idToken });
    }
    send(404, { error: 'not_found' });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  mock.stop = () => server.close();
  return mock;
};
