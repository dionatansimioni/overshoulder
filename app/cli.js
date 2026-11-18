// Comandos para quem tem acesso ao servidor: docker exec overshoulder overshoulder <comando>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const RESET_TTL_MS = Number(process.env.ADMIN_RESET_TTL_MS ?? 15 * 60_000);
// Idioma: OVERSHOULDER_LANG=pt ou en; sem ela, o LANG (pt* → português, o resto → inglês)
const PT = /^pt/i.test(process.env.OVERSHOULDER_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '');
const m = (pt, en) => (PT ? pt : en);

const commands = {
  version: () => console.log(process.env.APP_VERSION || 'dev'),
  // Gera um link de uso único, válido por 15 minutos, para redefinir a senha do admin e remover o 2FA dele
  'reset-admin': () => {
    const stateFile = path.join(DATA_DIR, 'state.json');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    const admin = state?.users.find((u) => u.role === 'admin');
    if (!admin) {
      console.error(
        m(
          'O servidor ainda não foi configurado: abra /configurar com o código que aparece nos logs.',
          "The server isn't set up yet: open /configurar with the code shown in the logs.",
        ),
      );
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
    const minutes = Math.round(RESET_TTL_MS / 60_000);
    console.log(
      m(
        `Link para redefinir a conta "${admin.username}" (vale uma vez, por ${minutes} minutos):`,
        `Link to reset the "${admin.username}" account (works once, for ${minutes} minutes):`,
      ),
    );
    console.log(`${base}/redefinir#${token}`);
    console.log(
      m(
        'A senha será trocada e o 2FA da conta, removido. Todas as sessões dela serão encerradas.',
        "The password will be changed and the account's 2FA removed. All its sessions will be ended.",
      ),
    );
  },
};

const [command] = process.argv.slice(2);
if (!commands[command]) {
  console.error(m(`Uso: overshoulder <comando>\nComandos: `, `Usage: overshoulder <command>\nCommands: `) + Object.keys(commands).join(', '));
  process.exit(1);
}
commands[command]();
