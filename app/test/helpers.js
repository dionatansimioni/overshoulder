import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HOST_KEY_SECRET = 'segredo-de-anfitriao-dos-testes';
export const ADMIN = { username: 'admin', password: 'cavalo correto bateria grampo' };

// Sobe o server.js de verdade, com dados num diretório temporário próprio,
// apontando para o LiveKit de teste (scripts/test.sh)
export const startServer = (port, extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const dataDir = extraEnv.DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'overshoulder-test-'));
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        LIVEKIT_API_KEY: process.env.TEST_API_KEY,
        LIVEKIT_API_SECRET: process.env.TEST_API_SECRET,
        LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:17880',
        LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:17880',
        HOST_KEY_SECRET,
        DATA_DIR: dataDir,
        TRUST_PROXY: '0',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let started = false;
    const onData = (chunk) => {
      output += chunk;
      if (!started && output.includes('ouvindo em')) {
        started = true;
        resolve({
          url: `http://127.0.0.1:${port}`,
          dataDir,
          stop: () => proc.kill(),
          output: () => output,
          // Código de configuração mais recente impresso nos logs
          setupCode: async () => {
            for (let i = 0; i < 40; i++) {
              const codes = [...output.matchAll(/"setupCode":"([A-Z0-9-]+)"/g)];
              if (codes.length) return codes.at(-1)[1];
              await new Promise((r) => setTimeout(r, 50));
            }
            throw new Error('código de configuração não apareceu nos logs');
          },
        });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => !started && reject(new Error(`servidor saiu (código ${code}):\n${output}`)));
  });

export const api = async (base, route, body, headers = {}) => {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers, text };
};

export const get = async (base, route, headers = {}) => {
  const res = await fetch(base + route, { headers });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};

// Valor "nome=valor" do cookie de sessão de uma resposta, pronto para o cabeçalho Cookie
export const sessionFrom = (res) => res.headers.get('set-cookie')?.split(';')[0];

// Configura o servidor pelo fluxo real (código dos logs) e devolve o cabeçalho de sessão do admin
export const setupAdmin = async (server, extra = {}) => {
  const r = await api(server.url, '/api/setup', { code: await server.setupCode(), ...ADMIN, ...extra });
  if (r.status !== 201) throw new Error(`configuração falhou: ${r.status} ${r.text}`);
  return { cookie: sessionFrom(r) };
};

export const createRoom = async (base, session) => (await api(base, '/api/rooms', {}, session)).body;

// Lê o conteúdo de um JWT sem validar (a validação é feita à parte nos testes)
export const jwtPayload = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

// O LiveKit de teste pode levar alguns segundos para aceitar conexões
export const waitForLiveKit = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch('http://127.0.0.1:17880/')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('LiveKit de teste não respondeu');
};

// Faz login pela página inicial, no navegador
export const loginInBrowser = async (page, base, { username, password } = ADMIN) => {
  await page.goto(`${base}/`);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#login-form button');
  await page.waitForSelector('#signed-in:not([hidden])');
};

// Os testes conferem textos em português: os navegadores abrem em pt-BR, a não ser que o
// contexto peça outro idioma (o teste de tradução usa en-US)
export const launchBrowser = async (options = {}) => {
  const browser = await chromium.launch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (contextOptions = {}) => newContext({ locale: 'pt-BR', ...contextOptions });
  return browser;
};
