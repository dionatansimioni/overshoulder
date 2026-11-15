// Comandos para quem tem acesso ao servidor: docker exec overshoulder overshoulder <comando>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const RESET_TTL_MS = Number(process.env.ADMIN_RESET_TTL_MS ?? 15 * 60_000);

const commands = {
  version: () => console.log(process.env.APP_VERSION || 'dev'),
  // Gera um link de uso único, válido por 15 minutos, para redefinir a senha do admin e remover o 2FA dele
  'reset-admin': () => {
    const stateFile = path.join(DATA_DIR, 'state.json');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    const admin = state?.users.find((u) => u.role === 'admin');
    if (!admin) {
      console.error('O servidor ainda não foi configurado: abra /configurar com o código que aparece nos logs.');
      process.exit(1);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('base64url');
    const file = path.join(DATA_DIR, 'admin-reset.json');
    fs.writeFileSync(file, JSON.stringify({ hash, expiresAt: Date.now() + RESET_TTL_MS }), { mode: 0o600 });
    // Com TLS=proxy, o endereço público é o do outro proxy, na 443
    const httpsPort = process.env.TLS === 'proxy' ? '443' : process.env.HTTPS_PORT;
    const port = httpsPort && httpsPort !== '443' ? `:${httpsPort}` : '';
    const base = process.env.DOMAIN ? `https://${process.env.DOMAIN}${port}` : '';
    console.log(`Link para redefinir a conta "${admin.username}" (vale uma vez, por ${Math.round(RESET_TTL_MS / 60_000)} minutos):`);
    console.log(`${base}/redefinir#${token}`);
    console.log('A senha será trocada e o 2FA da conta, removido. Todas as sessões dela serão encerradas.');
  },
};

const [command] = process.argv.slice(2);
if (!commands[command]) {
  console.error(`Uso: overshoulder <comando>\nComandos: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
commands[command]();
