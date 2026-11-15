// Ponto de entrada da imagem única: prepara configuração e segredos, sobe LiveKit,
// app e Caddy, reinicia quem cair ou travar e repassa o sinal de desligar.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? '/data';
const RUN_DIR = path.join(os.tmpdir(), 'overshoulder');
const APP_PORT = 3000;
const LIVEKIT_PORT = 7880;
const TURN_INTERNAL_PORT = 5349;

const fail = (msg) => {
  log.error(msg);
  process.exit(1);
};

// --- configuração ----------------------------------------------------------

const port = (name, fallback) => {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(v) || v < 1 || v > 65535) fail(`${name} inválida: use um número de porta.`);
  return v;
};

const config = {
  domain: process.env.DOMAIN ?? '',
  tls: process.env.TLS ?? 'acme',
  httpPort: port('HTTP_PORT', 80),
  httpsPort: port('HTTPS_PORT', 443),
  rtcTcpPort: port('RTC_TCP_PORT', 7881),
  rtcUdpPort: port('RTC_UDP_PORT', 7882),
  nodeIp: process.env.NODE_IP ?? '',
  turnDomain: process.env.TURN_DOMAIN ?? '',
  certFile: process.env.TLS_CERT ?? path.join(DATA_DIR, 'certs', 'cert.pem'),
  keyFile: process.env.TLS_KEY ?? path.join(DATA_DIR, 'certs', 'key.pem'),
  certCheckMs: Number(process.env.CERT_CHECK_INTERVAL_MS ?? 60_000),
  trustedProxies: (process.env.TRUSTED_PROXIES ?? 'private_ranges').trim().split(/\s+/),
  maxParticipants: Number(process.env.MAX_PARTICIPANTS ?? 16),
  watchdogMs: Number(process.env.WATCHDOG_INTERVAL_MS ?? 15_000),
};

// Os domínios vão para o Caddyfile: só nomes de host e IPv4, nada que mude a sintaxe
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
if (!HOST_RE.test(config.domain))
  fail('DOMAIN ausente ou inválido: informe o domínio (ex.: live.empresa.com) ou o IP do servidor.');
if (config.turnDomain && (!HOST_RE.test(config.turnDomain) || /^[\d.]+$/.test(config.turnDomain) || config.turnDomain === config.domain))
  fail('TURN_DOMAIN inválido: use um subdomínio próprio para o TURN (ex.: turn.live.empresa.com), diferente de DOMAIN.');
// O LiveKit anuncia o TURN sempre na porta 443, e o TURN só faz sentido onde só a 443 passa
if (config.turnDomain && config.httpsPort !== 443) fail('TURN_DOMAIN exige HTTPS_PORT=443: o TURN é anunciado na porta 443.');
if (!['acme', 'local', 'custom', 'proxy'].includes(config.tls))
  fail('TLS inválido: use "acme" (Let\'s Encrypt), "local", "custom" (certificado seu) ou "proxy" (atrás de outro proxy, como o do Coolify).');
// Atrás de outro proxy, a 443 é dele: o Caddy daqui não consegue separar o TURN pelo nome
if (config.tls === 'proxy' && config.turnDomain)
  fail('TURN_DOMAIN não funciona com TLS=proxy: a porta 443 é do outro proxy. Deixe TURN_DOMAIN vazio.');
// Vão para o Caddyfile: só "private_ranges", IPs e faixas CIDR
const PROXY_RE = /^(private_ranges|[\d.]+(\/\d{1,2})?|[\da-f:]+(\/\d{1,3})?)$/i;
if (!config.trustedProxies.every((p) => PROXY_RE.test(p) && /[\d_]/.test(p)))
  fail('TRUSTED_PROXIES inválido: use "private_ranges" ou IPs e faixas separados por espaço (ex.: 10.0.1.0/24).');
// TLS=custom: o certificado é seu (ex.: o da empresa). Confere tudo antes de subir, com
// mensagens claras, em vez de deixar o Caddy falhar com um erro difícil de entender.
const PATH_RE = /^\/[\w./-]+$/;
const certProblem = () => {
  for (const [name, file] of [['TLS_CERT', config.certFile], ['TLS_KEY', config.keyFile]]) {
    if (!PATH_RE.test(file)) return `${name} inválido: use um caminho absoluto só com letras, números, ".", "_", "-" e "/".`;
    try {
      fs.accessSync(file, fs.constants.R_OK);
    } catch {
      return `${name}: não foi possível ler ${file}. Monte o arquivo no container (ex.: -v /etc/overshoulder/certs:/data/certs:ro) e confira se o usuário do container (uid 1000) pode lê-lo.`;
    }
  }
  let cert;
  try {
    cert = new crypto.X509Certificate(fs.readFileSync(config.certFile));
  } catch {
    return `TLS_CERT: ${config.certFile} não é um certificado PEM válido.`;
  }
  let key;
  try {
    key = crypto.createPrivateKey(fs.readFileSync(config.keyFile));
  } catch {
    return `TLS_KEY: ${config.keyFile} não é uma chave privada PEM válida (sem senha).`;
  }
  if (!cert.checkPrivateKey(key)) return 'TLS_KEY não corresponde ao certificado de TLS_CERT.';
  for (const name of [config.domain, config.turnDomain].filter(Boolean)) {
    const ok = /^[\d.]+$/.test(name) ? cert.checkIP(name) : cert.checkHost(name);
    if (!ok) return `O certificado de TLS_CERT não vale para ${name}.`;
  }
  if (new Date(cert.validTo) < new Date()) return `O certificado de TLS_CERT venceu em ${cert.validTo}.`;
  return null;
};
if (config.tls === 'custom') {
  const problem = certProblem();
  if (problem) fail(problem);
}
if (config.nodeIp && !/^\d{1,3}(\.\d{1,3}){3}$/.test(config.nodeIp)) fail('NODE_IP inválido: informe um IPv4.');
if (!Number.isInteger(config.maxParticipants) || config.maxParticipants < 2 || config.maxParticipants > 5000)
  fail('MAX_PARTICIPANTS inválido: use um número entre 2 e 5000.');

// --- segredos --------------------------------------------------------------

// Gerados na primeira subida e guardados no volume: sobrevivem a reinícios e atualizações
const loadSecrets = () => {
  const file = path.join(DATA_DIR, 'secrets.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const secrets = {
    livekitApiKey: `API${crypto.randomBytes(9).toString('base64url')}`,
    livekitApiSecret: crypto.randomBytes(32).toString('base64url'),
    hostKeySecret: crypto.randomBytes(32).toString('base64url'),
  };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  log.info('segredos gerados', { file });
  return secrets;
};

fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
let secrets;
try {
  secrets = loadSecrets();
} catch (err) {
  fail(`Não foi possível ler ou criar os segredos em ${DATA_DIR}: ${err.message}`);
}

// --- arquivos de configuração dos serviços --------------------------------

const livekitConfig = path.join(RUN_DIR, 'livekit.yaml');
fs.writeFileSync(
  livekitConfig,
  `port: ${LIVEKIT_PORT}
bind_addresses: [127.0.0.1]
logging:
  json: true
  level: info
rtc:
  tcp_port: ${config.rtcTcpPort}
  udp_port: ${config.rtcUdpPort}
  use_external_ip: ${config.nodeIp ? 'false' : 'true'}
room:
  auto_create: false
  empty_timeout: 300
  departure_timeout: 60
  max_participants: ${config.maxParticipants}
${
  // TURN/TLS para redes que só liberam a 443: o Caddy termina o TLS de turn.<domínio> e repassa
  config.turnDomain
    ? `turn:
  enabled: true
  domain: ${config.turnDomain}
  tls_port: ${TURN_INTERNAL_PORT}
  external_tls: true
`
    : ''
}`,
);

// Na porta HTTPS, conexões para turn.<domínio> vão para o TURN do LiveKit (TLS terminado aqui);
// todo o resto segue para o site, sem perder o IP de quem acessa
const turnRouting = config.turnDomain
  ? `
	servers :${config.httpsPort} {
		listener_wrappers {
			layer4 {
				@turn tls sni ${config.turnDomain}
				route @turn {
					tls
					proxy tcp/127.0.0.1:${TURN_INTERNAL_PORT}
				}
			}
			tls
		}
	}`
  : '';

// Rotas comuns aos dois modos: sinalização do LiveKit e o site
const routes = (forwardedFor) => `	# Sinalização WebRTC do LiveKit (WebSocket)
	handle /rtc* {
		reverse_proxy 127.0.0.1:${LIVEKIT_PORT}${forwardedFor}
	}

	handle {
		encode zstd gzip
		reverse_proxy 127.0.0.1:${APP_PORT}${forwardedFor}
	}`;

// TLS=proxy: outro proxy (Coolify, Traefik, Nginx…) cuida do HTTPS e repassa em HTTP.
// Só quem está em TRUSTED_PROXIES pode informar o IP e o protocolo de quem acessa; o app
// recebe um X-Forwarded-For com um IP só, o de quem acessa de verdade.
const proxyCaddyfile = () => `{
	auto_https off
	http_port ${config.httpPort}
	servers {
		trusted_proxies static ${config.trustedProxies.join(' ')}
		client_ip_headers X-Forwarded-For
		# Lê o X-Forwarded-For da direita para a esquerda: o que vem antes do último proxy confiável pode ser forjado
		trusted_proxies_strict
	}
	log {
		output stdout
		format json
	}
}

:${config.httpPort} {
${routes(` {
			header_up X-Forwarded-For {client_ip}
		}`)}
}
`;

// Com TLS=custom, o Caddy usa os arquivos informados (a TURN_DOMAIN precisa estar no mesmo certificado)
const customTls = config.tls === 'custom' ? `	tls ${config.certFile} ${config.keyFile}\n\n` : '';
// Sem domínio (DOMAIN é um IP), o Let's Encrypt só emite certificados de curta duração (~6 dias),
// pelo perfil "shortlived"; o Caddy renova sozinho. Exige a porta 80 ou 443 acessível de fora.
const ipTls =
  config.tls === 'acme' && /^[\d.]+$/.test(config.domain)
    ? `	tls {\n\t\tissuer acme {\n\t\t\tprofile shortlived\n\t\t}\n\t}\n\n`
    : '';

const caddyfile = path.join(RUN_DIR, 'Caddyfile');
fs.writeFileSync(
  caddyfile,
  config.tls === 'proxy' ? proxyCaddyfile() : `{
	http_port ${config.httpPort}
	https_port ${config.httpsPort}
	# Quem acessa pelo IP não envia SNI; dentro do container o IP local é o da rede do Docker,
	# então o certificado precisa ser escolhido pelo domínio configurado
	default_sni ${config.domain}
	${config.tls === 'local' ? 'local_certs\n\tskip_install_trust' : ''}${config.tls === 'custom' ? '\n\tauto_https disable_certs' : ''}
	log {
		output stdout
		format json
	}${turnRouting}
}

${config.domain} {
${customTls}${ipTls}${routes('')}
}
${
  // Bloco só para o Caddy obter e renovar o certificado de turn.<domínio>
  config.turnDomain
    ? `
${config.turnDomain} {
${customTls}	respond "TURN do Overshoulder" 404
}
`
    : ''
}`,
);

// Com TLS=proxy, o endereço público é o do outro proxy, na 443
const publicPort = config.tls === 'proxy' ? 443 : config.httpsPort;
const publicHost = `${config.domain}${publicPort === 443 ? '' : `:${publicPort}`}`;
const publicUrl = `wss://${publicHost}`;

// --- processos -------------------------------------------------------------

// Cada serviço recebe só as variáveis de que precisa
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME ?? '/tmp' };

const services = {
  livekit: {
    cmd: process.env.LIVEKIT_BIN ?? '/usr/local/bin/livekit-server',
    args: ['--config', livekitConfig],
    env: {
      ...baseEnv,
      LIVEKIT_KEYS: `${secrets.livekitApiKey}: ${secrets.livekitApiSecret}`,
      ...(config.nodeIp && { NODE_IP: config.nodeIp }),
    },
  },
  app: {
    cmd: process.execPath,
    args: [path.join(here, 'server.js')],
    env: {
      ...baseEnv,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      LIVEKIT_API_KEY: secrets.livekitApiKey,
      LIVEKIT_API_SECRET: secrets.livekitApiSecret,
      LIVEKIT_INTERNAL_URL: `http://127.0.0.1:${LIVEKIT_PORT}`,
      LIVEKIT_PUBLIC_URL: publicUrl,
      PUBLIC_ORIGIN: `https://${publicHost}`,
      DATA_DIR,
      HOST_KEY_SECRET: secrets.hostKeySecret,
      MAX_PARTICIPANTS: String(config.maxParticipants),
      TURN_DOMAIN: config.turnDomain,
      TRUST_PROXY: '1',
      APP_VERSION: process.env.APP_VERSION ?? 'dev',
      ...(process.env.INSTALL_METHOD && { INSTALL_METHOD: process.env.INSTALL_METHOD }),
      ...(process.env.UPDATE_CHECK && { UPDATE_CHECK: process.env.UPDATE_CHECK }),
    },
  },
  caddy: {
    cmd: process.env.CADDY_BIN ?? '/usr/local/bin/caddy',
    args: ['run', '--config', caddyfile, '--adapter', 'caddyfile'],
    env: { ...baseEnv, XDG_DATA_HOME: DATA_DIR, XDG_CONFIG_HOME: RUN_DIR },
  },
};

let stopping = false;

// Repassa a saída de cada serviço como JSON, marcando de qual serviço veio
const pipeLogs = (name, stream) => {
  readline.createInterface({ input: stream }).on('line', (line) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {}
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      process.stdout.write(`${JSON.stringify({ ...entry, service: name })}\n`);
    } else if (line.trim()) {
      log.info(line, { service: name });
    }
  });
};

const start = (name) => {
  const svc = services[name];
  svc.startedAt = Date.now();
  svc.proc = spawn(svc.cmd, svc.args, { env: svc.env, stdio: ['ignore', 'pipe', 'pipe'] });
  pipeLogs(name, svc.proc.stdout);
  pipeLogs(name, svc.proc.stderr);
  svc.proc.on('error', (err) => log.error('não foi possível iniciar o serviço', { service: name, error: err.message }));
  svc.proc.on('exit', (code, signal) => {
    svc.proc = null;
    if (stopping) return maybeExit();
    // Espera cada vez mais entre reinícios seguidos, até 30 s; volta a 1 s depois de 1 min estável
    svc.failures = Date.now() - svc.startedAt > 60_000 ? 0 : (svc.failures ?? 0) + 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.max(0, svc.failures - 1));
    log.warn('serviço parou; reiniciando', { service: name, code, signal, delayMs: delay });
    setTimeout(() => !stopping && start(name), delay);
  });
};

// Para um serviço: SIGTERM e, se não sair em 5 s (ex.: processo travado), SIGKILL.
// O evento 'exit' cuida de subir de novo.
const restart = (name, reason) => {
  const proc = services[name].proc;
  if (!proc) return;
  log.warn('reiniciando serviço travado', { service: name, reason });
  proc.kill('SIGTERM');
  const timer = setTimeout(() => proc.exitCode === null && proc.signalCode === null && proc.kill('SIGKILL'), 5000);
  proc.once('exit', () => clearTimeout(timer));
};

// --- vigia ----------------------------------------------------------------

// O Docker só marca o container como "unhealthy"; quem reinicia o serviço travado é o vigia.
// App sem responder → reinicia o app; app respondendo 503 (LiveKit fora) → reinicia o LiveKit.
const WATCHDOG_LIMIT = 3;
const strikes = { app: 0, livekit: 0 };
setInterval(async () => {
  if (stopping || !services.app.proc || !services.livekit.proc) return;
  let status;
  try {
    status = (await fetch(`http://127.0.0.1:${APP_PORT}/healthz`, { signal: AbortSignal.timeout(5000) })).status;
  } catch {
    status = null;
  }
  strikes.app = status === null ? strikes.app + 1 : 0;
  strikes.livekit = status === 503 ? strikes.livekit + 1 : 0;
  for (const name of ['app', 'livekit']) {
    if (strikes[name] >= WATCHDOG_LIMIT) {
      strikes[name] = 0;
      restart(name, 'healthcheck falhou 3 vezes seguidas');
    }
  }
}, config.watchdogMs).unref();

// --- desligamento ------------------------------------------------------------

const maybeExit = () => {
  if (Object.values(services).every((s) => !s.proc)) {
    log.info('Overshoulder parado');
    process.exit(0);
  }
};

const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  log.info('desligando', { signal });
  for (const svc of Object.values(services)) svc.proc?.kill('SIGTERM');
  setTimeout(() => {
    for (const svc of Object.values(services)) svc.proc?.kill('SIGKILL');
    process.exit(0);
  }, 10_000).unref();
  maybeExit();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log.info('iniciando Overshoulder', {
  domain: config.domain,
  tls: config.tls,
  httpsPort: config.tls === 'proxy' ? undefined : config.httpsPort,
  httpPort: config.httpPort,
  ...(config.tls === 'proxy' && { trustedProxies: config.trustedProxies.join(' ') }),
  rtcTcpPort: config.rtcTcpPort,
  rtcUdpPort: config.rtcUdpPort,
  maxParticipants: config.maxParticipants,
  turn: config.turnDomain || 'desligado',
});
for (const name of ['livekit', 'app', 'caddy']) start(name);

// TLS=custom: quando o certificado é trocado no disco (renovação), o Caddy recarrega sozinho.
// Um certificado novo com problema não substitui o que está valendo.
if (config.tls === 'custom') {
  const stamp = () => [config.certFile, config.keyFile].map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs).join('|');
  let last = stamp();
  setInterval(() => {
    const now = stamp();
    if (now === last || stopping) return;
    last = now;
    const problem = certProblem();
    if (problem) return log.error('certificado novo recusado; o anterior continua valendo', { problem });
    const reload = spawn(services.caddy.cmd, ['reload', '--config', caddyfile, '--adapter', 'caddyfile', '--force'], {
      env: services.caddy.env,
      stdio: 'ignore',
    });
    reload.on('exit', (code) =>
      code === 0 ? log.info('certificado novo carregado') : log.error('não foi possível recarregar o certificado', { code }),
    );
  }, config.certCheckMs).unref();
}
