import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PASSWORD = 'senha-dos-testes';

// Sobe o server.js de verdade, apontando para o LiveKit de teste (scripts/test.sh)
export const startServer = (port) =>
  new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        LIVEKIT_API_KEY: process.env.TEST_API_KEY,
        LIVEKIT_API_SECRET: process.env.TEST_API_SECRET,
        LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:17880',
        LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:17880',
        CREATE_PASSWORD: PASSWORD,
        HOST_KEY_SECRET: 'segredo-de-anfitriao-dos-testes',
        TRUST_PROXY: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('ouvindo em')) resolve({ url: `http://127.0.0.1:${port}`, stop: () => proc.kill() });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`servidor saiu (código ${code}):\n${output}`)));
  });

export const api = async (base, route, body) => {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

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
