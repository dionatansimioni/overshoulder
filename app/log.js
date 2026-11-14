// Logs em JSON, uma linha por evento. Nunca registrar senhas, chaves, IDs de sala nem nomes.
const write = (level, msg, fields) =>
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);

export const log = {
  info: (msg, fields = {}) => write('info', msg, fields),
  warn: (msg, fields = {}) => write('warn', msg, fields),
  error: (msg, fields = {}) => write('error', msg, fields),
};
