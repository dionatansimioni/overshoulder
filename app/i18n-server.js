// Mensagens de erro da API em inglês. O texto em português é a chave; a página informa o idioma
// pelo cabeçalho Accept-Language de cada pedido.

const EN = {
  'Requisição grande demais.': 'Request too large.',
  'JSON inválido.': 'Invalid JSON.',
  'Formato de requisição inválido.': 'Invalid request format.',
  'Faça login para continuar.': 'Sign in to continue.',
  'Este servidor exige verificação em duas etapas. Configure o 2FA para continuar.':
    'This server requires two-step verification. Set up 2FA to continue.',
  'Sem permissão para isso.': 'You are not allowed to do that.',
  'O servidor já foi configurado.': 'The server is already set up.',
  'Muitas tentativas. Espere alguns minutos.': 'Too many attempts. Wait a few minutes.',
  'Código de configuração incorreto. Veja o código atual nos logs do servidor.':
    'Wrong setup code. Check the current code in the server logs.',
  'Usuário: de 3 a 32 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado.':
    'Username: 3 to 32 characters, only lowercase letters, numbers, dot, hyphen and underscore.',
  'Limite de pessoas por sala: de 2 a 500.': 'People per room limit: from 2 to 500.',
  'Muitas tentativas nesta conta. Espere alguns minutos.': 'Too many attempts on this account. Wait a few minutes.',
  'Usuário ou senha incorretos.': 'Incorrect username or password.',
  'O login expirou. Entre com a senha de novo.': 'The sign-in expired. Enter your password again.',
  'Código incorreto.': 'Incorrect code.',
  'Senha atual incorreta.': 'Incorrect current password.',
  'O 2FA já está ativo nesta conta.': '2FA is already on for this account.',
  'Comece a configuração do 2FA de novo.': 'Start the 2FA setup again.',
  'Código incorreto. Confira se o relógio do celular está certo.': "Incorrect code. Check that your phone's clock is right.",
  'O 2FA não está ativo nesta conta.': '2FA is not on for this account.',
  'O administrador exige 2FA neste servidor.': 'The administrator requires 2FA on this server.',
  'Senha incorreta.': 'Incorrect password.',
  'Conta não encontrada.': 'Account not found.',
  'Essa conta não usa 2FA.': 'This account does not use 2FA.',
  'Convite não encontrado.': 'Invitation not found.',
  'Convite inválido, já usado ou expirado. Peça um novo ao administrador.':
    'Invalid, used or expired invitation. Ask the administrator for a new one.',
  'Esse usuário já existe. Escolha outro.': 'This username already exists. Choose another one.',
  'Convite já usado.': 'Invitation already used.',
  'A conta de administrador não pode ser revogada nem excluída.': 'The administrator account cannot be revoked or deleted.',
  'Emissor (issuer) inválido: use uma URL https.': 'Invalid issuer: use an https URL.',
  'Domínio de e-mail inválido na lista.': 'Invalid email domain in the list.',
  'E-mail inválido na lista de transmissores.': 'Invalid email in the broadcasters list.',
  'Para ativar, preencha emissor, client ID, client secret e pelo menos um domínio de e-mail.':
    'To turn it on, fill in issuer, client ID, client secret and at least one email domain.',
  'Link inválido ou expirado. Gere outro com o comando no servidor.':
    'Invalid or expired link. Generate another one with the command on the server.',
  'Sala inválida.': 'Invalid room.',
  'Essa sala não existe, já foi encerrada ou o link foi trocado pelo anfitrião.':
    'This room does not exist, has ended, or the host changed the link.',
  'Apenas o anfitrião pode fazer isso.': 'Only the host can do that.',
  'Esta sala exige o login da empresa para assistir.': 'This room requires a company sign-in to watch.',
  'Participante inválido.': 'Invalid participant.',
  'Tipo de sala inválido.': 'Invalid room type.',
  'Token da sala ausente.': 'Missing room token.',
  'Token da sala inválido.': 'Invalid room token.',
  'Pedido inválido.': 'Invalid request.',
  'O anfitrião não precisa pedir.': 'The host does not need to ask.',
  'Posição da câmera inválida.': 'Invalid camera position.',
  'Essa pessoa não está mais na sala.': 'This person is no longer in the room.',
  'Origem não permitida.': 'Origin not allowed.',
  'Método não permitido.': 'Method not allowed.',
  'Erro interno.': 'Internal error.',
  'A senha precisa ter pelo menos 12 caracteres.': 'The password must have at least 12 characters.',
  'A senha pode ter no máximo 128 caracteres.': 'The password can have at most 128 characters.',
  'Essa senha aparece em listas de senhas vazadas. Escolha outra.': 'This password appears in leaked password lists. Choose another one.',
  'A senha repete poucos caracteres. Escolha outra.': 'The password uses too few different characters. Choose another one.',
  'A senha não pode conter o nome de usuário.': 'The password cannot contain the username.',
};

// Mensagens com partes variáveis
const PATTERNS = [
  [/^(\w+) deve ser verdadeiro ou falso\.$/, '$1 must be true or false.'],
  [/^(\w+) inválido\.$/, 'Invalid $1.'],
  [/^Não foi possível falar com o provedor: (.*)\.$/, 'Could not reach the provider: $1.'],
];

export const dictionary = EN;
export const patterns = PATTERNS;

export const wantsEnglish = (req) => /^\s*en\b/i.test(req?.headers?.['accept-language'] ?? '');

export const translateError = (message) => {
  if (EN[message]) return EN[message];
  for (const [re, replacement] of PATTERNS) if (re.test(message)) return message.replace(re, replacement);
  return message;
};
