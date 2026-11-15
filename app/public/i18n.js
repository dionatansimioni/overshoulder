// Tradução da interface. O texto em português é a chave; EN dá a versão em inglês.
// translatePage() troca os nós de texto e os atributos (placeholder, title, aria-label, alt) da página;
// textos montados pelo JavaScript passam por t().

const EN = {
  // --- páginas e títulos
  'Overshoulder · Sala': 'Overshoulder · Room',
  'Overshoulder · Configurar': 'Overshoulder · Setup',
  'Overshoulder · Minha conta': 'Overshoulder · My account',
  'Overshoulder · Administração': 'Overshoulder · Administration',
  'Overshoulder · Convite': 'Overshoulder · Invitation',
  'Overshoulder · Redefinir administrador': 'Overshoulder · Reset administrator',
  Voltar: 'Back',
  'Minha conta': 'My account',
  Administração: 'Administration',
  Sair: 'Sign out',
  Salvar: 'Save',
  Copiar: 'Copy',
  'Copiado!': 'Copied!',
  'Copiados!': 'Copied!',
  Cancelar: 'Cancel',
  'Conectado como': 'Signed in as',
  Português: 'Português',
  English: 'English',

  // --- página inicial
  'Suas salas': 'Your rooms',
  '+ Criar sala': '+ Create room',
  'As salas que você criar ou visitar neste navegador aparecem aqui.':
    'Rooms you create or visit in this browser show up here.',
  'Compartilhe sua tela': 'Share your screen',
  'Crie uma sala, mande o link e pronto: quem recebe entra só com o nome, sem conta.':
    'Create a room, send the link and you are done: whoever gets it joins with just a name, no account.',
  Fechar: 'Close',
  'Mais opções': 'More options',
  'Na sala "Jogando juntos", qualquer um pode mostrar a tela': 'In a "Playing together" room, anyone can share their screen',
  'Ao vivo': 'Live now',
  'Fora do ar': 'Offline',
  'Esquecer {name}': 'Forget {name}',
  'Esquecer esta sala neste navegador': 'Forget this room in this browser',
  Sala: 'Room',
  convidado: 'guest',
  'Sua sala': 'Your room',
  'Sala de outra pessoa': "Someone else's room",
  '{n} sala(s) com a chave em outro navegador: veja em Administração.':
    '{n} room(s) with the key in another browser: see Administration.',
  'Link para convidar': 'Invite link',
  'Quem abrir o link entra só com o nome, sem conta.': 'Whoever opens the link joins with just a name, no account.',
  'Compartilhe a tela com seu público, direto no navegador e com criptografia de ponta a ponta.':
    'Share your screen with your audience, right in the browser, with end-to-end encryption.',
  Usuário: 'Username',
  Senha: 'Password',
  Entrar: 'Sign in',
  'Entrar na sala': 'Join the room',
  'Entrar com login da empresa': 'Sign in with your company account',
  'Código de verificação': 'Verification code',
  'O código de 6 dígitos do seu app autenticador, ou um código de recuperação.':
    'The 6-digit code from your authenticator app, or a recovery code.',
  Confirmar: 'Confirm',
  'Proteja sua conta: ative a verificação em duas etapas (2FA).':
    'Protect your account: turn on two-step verification (2FA).',
  'Exigir login da empresa para assistir': 'Require a company sign-in to watch',
  'Criar sala': 'Create room',
  'Recebeu um link de alguém? É só abrir o link, não precisa de conta.':
    'Got a link from someone? Just open it, no account needed.',
  'Login feito, mas sua conta da empresa não tem permissão para transmitir. Peça ao administrador.':
    'You are signed in, but your company account is not allowed to broadcast. Ask the administrator.',
  'O e-mail da sua conta não pertence a um domínio permitido neste servidor.':
    "Your account's email is not from a domain allowed on this server.",
  'Não foi possível concluir o login da empresa. Tente de novo.': 'Could not complete the company sign-in. Try again.',
  'O login da empresa expirou. Tente de novo.': 'The company sign-in expired. Try again.',
  'O login da empresa foi cancelado.': 'The company sign-in was cancelled.',
  'O provedor de login da empresa não respondeu. Tente mais tarde.':
    'The company sign-in provider did not respond. Try again later.',
  'O login da empresa está desligado neste servidor.': 'Company sign-in is turned off on this server.',
  'Erro inesperado. Tente de novo.': 'Unexpected error. Try again.',

  // --- configuração inicial
  'Configurar o servidor': 'Set up the server',
  'Crie a conta de administrador. O código de configuração aparece nos logs do servidor:':
    'Create the administrator account. The setup code is shown in the server logs:',
  'Código de configuração': 'Setup code',
  'Usuário do administrador': 'Administrator username',
  'Pelo menos 12 caracteres. Uma frase longa é mais fácil de lembrar e mais segura.':
    'At least 12 characters. A long phrase is easier to remember and more secure.',
  'Confirme a senha': 'Confirm the password',
  'Limite de pessoas por sala': 'People per room limit',
  'Cada espectador em 720p usa cerca de 3 Mbps de saída do servidor; em 1080p, até 7 Mbps.':
    'Each viewer at 720p uses about 3 Mbps of server upload; at 1080p, up to 7 Mbps.',
  'Qualidade padrão das transmissões': 'Default broadcast quality',
  'Qualidade máxima permitida': 'Maximum allowed quality',
  'Quem transmite pode escolher até a qualidade máxima. Acima de 720p, a sala mostra quanto de banda cada pessoa consome.':
    'Broadcasters can choose up to the maximum quality. Above 720p, the room shows how much bandwidth each person uses.',
  'Sala cheia em {quality}: o servidor envia cerca de {mbps} Mbps ({gb} GB por hora).':
    'Full room at {quality}: the server sends about {mbps} Mbps ({gb} GB per hour).',
  'Cada pessoa recebe até {mbps} Mbps.': 'Each person receives up to {mbps} Mbps.',
  'Confira a banda e a franquia do servidor antes de subir a qualidade.':
    "Check the server's bandwidth and data cap before raising the quality.",
  'Com 1 pessoa assistindo, o servidor envia cerca de {mbps} Mbps ({gb} GB por hora).':
    'With 1 person watching, the server sends about {mbps} Mbps ({gb} GB per hour).',
  'Com {people} pessoas assistindo, o servidor envia cerca de {mbps} Mbps ({gb} GB por hora).':
    'With {people} people watching, the server sends about {mbps} Mbps ({gb} GB per hour).',
  'Criar administrador': 'Create administrator',
  'As senhas não são iguais.': 'The passwords do not match.',

  // --- minha conta
  'Verificação em duas etapas (2FA)': 'Two-step verification (2FA)',
  'Este servidor exige 2FA. Configure agora para continuar usando a sua conta.':
    'This server requires 2FA. Set it up now to keep using your account.',
  'Além da senha, o login pede um código de 6 dígitos de um app autenticador no celular (Google Authenticator, Aegis, 1Password, Bitwarden). Recomendado: protege a conta mesmo se a senha vazar.':
    'Besides the password, signing in asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Aegis, 1Password, Bitwarden). Recommended: it protects your account even if the password leaks.',
  'Ativar 2FA': 'Turn on 2FA',
  '1. Escaneie o QR code com o app autenticador (ou digite a chave).':
    '1. Scan the QR code with the authenticator app (or type the key).',
  'QR code para o app autenticador': 'QR code for the authenticator app',
  'Chave:': 'Key:',
  '2. Digite o código que o app mostra': '2. Type the code the app shows',
  'Confirmar e ativar': 'Confirm and turn on',
  'Guarde estes códigos de recuperação num lugar seguro. Cada um vale uma vez, caso você perca o celular. Eles não serão mostrados de novo; só o administrador pode gerar outros.':
    'Keep these recovery codes somewhere safe. Each one works once, in case you lose your phone. They will not be shown again; only the administrator can generate new ones.',
  'Copiar códigos': 'Copy codes',
  'O 2FA está': '2FA is',
  ativo: 'on',
  'Senha, para desativar o 2FA': 'Password, to turn off 2FA',
  'Desativar 2FA': 'Turn off 2FA',
  '. O administrador exige 2FA neste servidor, então ele não pode ser desativado.':
    '. The administrator requires 2FA on this server, so it cannot be turned off.',
  'Trocar senha': 'Change password',
  'Senha atual': 'Current password',
  'Nova senha': 'New password',
  'Pelo menos 12 caracteres. As suas outras sessões serão encerradas.':
    'At least 12 characters. Your other sessions will be signed out.',
  'Confirme a nova senha': 'Confirm the new password',
  'Senha alterada.': 'Password changed.',
  'As senhas novas não são iguais.': 'The new passwords do not match.',

  // --- administração
  Configurações: 'Settings',
  'Exigir 2FA de todas as contas': 'Require 2FA for every account',
  'Quem ainda não tem 2FA (inclusive você) precisará configurar antes de continuar.':
    'Anyone without 2FA yet (including you) will need to set it up before continuing.',
  'Configurações salvas.': 'Settings saved.',
  'Login da empresa (SSO)': 'Company sign-in (SSO)',
  'OpenID Connect: Google Workspace, Microsoft Entra ID, Keycloak, Authentik e outros. Cadastre no provedor um aplicativo "web" com este endereço de retorno:':
    'OpenID Connect: Google Workspace, Microsoft Entra ID, Keycloak, Authentik and others. Register a "web" application with the provider using this redirect URI:',
  'Ativar login da empresa': 'Turn on company sign-in',
  'Emissor (issuer)': 'Issuer',
  'Domínios de e-mail permitidos': 'Allowed email domains',
  'empresa.com.br, filial.com': 'company.com, branch.com',
  'Só quem tiver e-mail desses domínios entra pelo login da empresa.':
    'Only people with an email from these domains can sign in with the company account.',
  'Grupo que pode transmitir': 'Group allowed to broadcast',
  'overshoulder-transmissores': 'overshoulder-broadcasters',
  'E-mails que podem transmitir': 'Emails allowed to broadcast',
  'ana@empresa.com.br, beto@empresa.com.br': 'ana@company.com, bob@company.com',
  'Quem está no grupo (se o provedor enviar a lista de grupos) ou nesta lista vira transmissor no primeiro login. O administrador continua com usuário e senha.':
    'People in the group (if the provider sends the groups list) or on this list become broadcasters on their first sign-in. The administrator keeps signing in with username and password.',
  'Novas salas exigem login da empresa por padrão': 'New rooms require a company sign-in by default',
  'Todas as salas exigem login da empresa (obrigatório)': 'Every room requires a company sign-in (mandatory)',
  'Login da empresa salvo.': 'Company sign-in saved.',
  'Salvo (deixe vazio para manter)': 'Saved (leave empty to keep it)',
  Transmissores: 'Broadcasters',
  'Pessoas autorizadas a criar salas e transmitir por este servidor, mesmo sem você presente. Elas não mexem nas configurações.':
    'People allowed to create rooms and broadcast on this server, even when you are not around. They cannot change settings.',
  'Novos códigos de recuperação de': 'New recovery codes for',
  '. Entregue por um canal seguro; os antigos deixaram de valer.':
    '. Hand them over through a secure channel; the old ones no longer work.',
  Convites: 'Invitations',
  'O convite é um link de uso único que vale 48 horas. A pessoa escolhe o próprio usuário e senha; você nunca vê a senha.':
    'An invitation is a single-use link valid for 48 hours. The person picks their own username and password; you never see the password.',
  'Gerar convite': 'Create invitation',
  'Link do convite': 'Invitation link',
  administrador: 'administrator',
  transmissor: 'broadcaster',
  'login da empresa ({email})': 'company sign-in ({email})',
  '2FA ativo': '2FA on',
  'sem 2FA': 'no 2FA',
  revogado: 'revoked',
  '{n} sala(s) ao vivo': '{n} live room(s)',
  'Novos códigos': 'New codes',
  'Remover 2FA': 'Remove 2FA',
  'Remover o 2FA de {name}? A conta poderá configurá-lo de novo.': "Remove {name}'s 2FA? The account can set it up again.",
  Reativar: 'Reactivate',
  Revogar: 'Revoke',
  'Revogar {name}? As sessões e as salas ao vivo dessa pessoa serão encerradas agora.':
    "Revoke {name}? This person's sessions and live rooms will end now.",
  Excluir: 'Delete',
  'Excluir a conta {name}? Isso não pode ser desfeito.': 'Delete the account {name}? This cannot be undone.',
  'Convite pendente, vale até {date}': 'Pending invitation, valid until {date}',

  // --- convite e redefinição
  'Criar conta de transmissor': 'Create a broadcaster account',
  'Você foi convidado para transmitir por este servidor. Escolha seu usuário e senha.':
    'You were invited to broadcast on this server. Choose your username and password.',
  'Pelo menos 12 caracteres. Depois, ative o 2FA em "Minha conta".':
    'At least 12 characters. Then turn on 2FA in "My account".',
  'Criar conta': 'Create account',
  'Link de convite incompleto. Peça o link de novo.': 'Incomplete invitation link. Ask for the link again.',
  'Redefinir a conta de administrador': 'Reset the administrator account',
  'Este link foi gerado pelo comando no servidor e vale uma vez. A senha será trocada, o 2FA removido e as outras sessões encerradas.':
    'This link was generated by the command on the server and works once. The password will be changed, 2FA removed and other sessions signed out.',
  Redefinir: 'Reset',
  'Link incompleto. Gere outro com o comando no servidor.': 'Incomplete link. Generate another one with the command on the server.',

  // --- sala: entrada
  'Seu nome': 'Your name',
  'Link incompleto: falta a chave da sala. Peça o link de novo.': 'Incomplete link: the room key is missing. Ask for the link again.',
  'Seu navegador não suporta criptografia de ponta a ponta. Use Chrome, Edge, Firefox ou Safari atualizados.':
    'Your browser does not support end-to-end encryption. Use an up-to-date Chrome, Edge, Firefox or Safari.',
  'Não foi possível entrar na sala.': 'Could not join the room.',
  'Você entrou como {name} ({email}) pelo login da empresa.': 'You signed in as {name} ({email}) with your company account.',
  'O e-mail da sua conta não pertence a um domínio permitido nesta sala.':
    "Your account's email is not from a domain allowed in this room.",
  'Você é o anfitrião desta sala.': 'You are the host of this room.',
  'Você entrou na sala.': 'You joined the room.',

  // --- sala: barra, vídeo e controles
  'Link para os amigos': 'Link for your audience',
  'Copiar convite': 'Copy invite',
  'Gera um link novo; o atual deixa de funcionar para quem ainda não entrou':
    'Creates a new link; the current one stops working for anyone who has not joined yet',
  'Novo link': 'New link',
  'Aguardando a transmissão começar…': 'Waiting for the broadcast to start…',
  'Clique no botão de tela, embaixo, para começar a transmitir.': 'Click the screen button below to start broadcasting.',
  'Microfone ligado': 'Microphone on',
  '● Gravando': '● Recording',
  'Tela cheia': 'Full screen',
  'Ligar microfone': 'Turn microphone on',
  'Desligar microfone': 'Turn microphone off',
  'Compartilhar tela': 'Share screen',
  'Parar de compartilhar': 'Stop sharing',
  'Gravar a transmissão': 'Record the broadcast',
  'Parar a gravação': 'Stop recording',
  'Ajustes da transmissão': 'Broadcast settings',
  'Encerrar sala': 'End room',
  Qualidade: 'Quality',
  'H.264 (mais leve)': 'H.264 (lightest)',
  Microfone: 'Microphone',
  'Padrão do sistema': 'System default',
  'Áudio do jogo': 'Game audio',
  'Só o da captura': 'Capture audio only',
  Listar: 'List',
  'Clique em “Listar” para ver os microfones e dispositivos de áudio. No Linux, o navegador só captura áudio de abas: para o áudio do jogo, escolha o “Monitor of …” da sua saída de som.':
    'Click “List” to see microphones and audio devices. On Linux, the browser only captures tab audio: for game audio, pick the “Monitor of …” device of your sound output.',
  'Dispositivos carregados. No Linux, escolha o “Monitor of …” da sua saída de som.':
    'Devices loaded. On Linux, pick the “Monitor of …” device of your sound output.',
  '{name} está apresentando': '{name} is presenting',
  'Este navegador não permite compartilhar a tela. Use Chrome, Edge ou Firefox no computador.':
    'This browser cannot share the screen. Use Chrome, Edge or Firefox on a computer.',
  'Erro ao compartilhar: {error}': 'Error while sharing: {error}',
  'Permissão de microfone negada.': 'Microphone permission denied.',
  'Erro no microfone: {error}': 'Microphone error: {error}',
  'Não foi possível trocar o microfone.': 'Could not switch the microphone.',
  'Permissão de áudio negada.': 'Audio permission denied.',
  'Não foi possível descriptografar a transmissão. O link está completo?': 'Could not decrypt the broadcast. Is the link complete?',
  'A sala foi encerrada.': 'The room has ended.',
  'Você foi removido da sala pelo anfitrião.': 'The host removed you from the room.',
  'Você foi desconectado. Recarregue a página para voltar.': 'You were disconnected. Reload the page to come back.',
  'Encerrar a sala para todos?': 'End the room for everyone?',
  'Não foi possível encerrar a sala.': 'Could not end the room.',
  'Não foi possível concluir a ação.': 'Could not complete the action.',

  // --- sala: chat, pessoas e moderação
  Pessoas: 'People',
  'Desligar chat': 'Turn chat off',
  'Ligar chat': 'Turn chat on',
  'Conversar na sala': 'Chat with the room',
  'O anfitrião desligou o chat': 'The host turned the chat off',
  'Categorias de emoji': 'Emoji categories',
  '{n} pessoa na sala': '{n} person in the room',
  '{n} pessoas na sala': '{n} people in the room',
  '{name} entrou.': '{name} joined.',
  '{name} saiu.': '{name} left.',
  'Mensagem não enviada.': 'Message not sent.',
  alguém: 'someone',
  anfitrião: 'host',
  apresentando: 'presenting',
  você: 'you',
  'Passar a vez': 'Hand over',
  'Retomar a vez': 'Take back',
  Remover: 'Remove',
  'Remover {name} da sala? O link da sala será trocado para que essa pessoa não volte.':
    'Remove {name} from the room? The room link will change so this person cannot come back.',
  '{name} foi removido.': '{name} was removed.',
  '{name} agora pode apresentar.': '{name} can present now.',
  'Você retomou a vez de apresentar.': 'You took back the presenter role.',
  'O anfitrião passou a vez para você: compartilhe a tela ou ligue o microfone.':
    'The host handed you the presenter role: share your screen or turn your microphone on.',
  'A vez de apresentar voltou para o anfitrião.': 'The presenter role went back to the host.',
  '{why} O link antigo não serve mais: envie o novo a quem ainda vai entrar.':
    '{why} The old link no longer works: send the new one to anyone still joining.',
  'Gerar um link novo? O link atual deixa de funcionar para quem ainda não entrou.':
    'Create a new link? The current link stops working for anyone who has not joined yet.',
  'Link da sala trocado.': 'Room link changed.',
  'Você ligou o chat.': 'You turned the chat on.',
  'Você desligou o chat para quem assiste.': 'You turned the chat off for viewers.',

  // --- sala: tipos, telas, câmera e pedidos
  'Tipo de sala': 'Room type',
  'Jogando juntos': 'Playing together',
  'Todos falam e mostram a tela, como numa call.': 'Everyone talks and can share their screen, like a call.',
  Live: 'Live',
  'Você apresenta; o público assiste, conversa no chat e pode pedir a palavra.':
    'You present; the audience watches, chats and can ask to speak.',
  'Qualquer um pode mostrar a tela': 'Anyone can share their screen',
  'Telas ao vivo': 'Live screens',
  'Sua transmissão': 'Your broadcast',
  'Tela de {name}': "{name}'s screen",
  'Câmera de {name}': "{name}'s camera",
  'Ligar câmera': 'Turn camera on',
  'Desligar câmera': 'Turn camera off',
  'Permissão de câmera negada.': 'Camera permission denied.',
  'Erro na câmera: {error}': 'Camera error: {error}',
  'Não foi possível trocar a câmera.': 'Could not switch the camera.',
  'Esconder câmera': 'Hide camera',
  'Mostrar câmera': 'Show camera',
  'Inverter câmera e tela': 'Swap camera and screen',
  'Voltar a tela para o centro': 'Put the screen back in the middle',
  'Pedir a palavra': 'Ask to speak',
  'Desistir de falar': 'Cancel the request to speak',
  'Pedir para mostrar a tela': 'Ask to share your screen',
  'Desistir de mostrar a tela': 'Cancel the request to share your screen',
  'O anfitrião liberou sua fala.': 'The host let you speak.',
  'O anfitrião encerrou sua fala.': 'The host ended your turn to speak.',
  'O anfitrião liberou você para mostrar a tela.': 'The host let you share your screen.',
  'O anfitrião encerrou sua permissão de mostrar a tela.': 'The host ended your permission to share your screen.',
  '{name} pediu a palavra.': '{name} asked to speak.',
  '{name} pediu para mostrar a tela.': '{name} asked to share their screen.',
  Aprovar: 'Approve',
  Recusar: 'Decline',
  'Senha do convite': 'Invitation password',
  'Crie sua conta para transmitir por este servidor. O administrador precisa aprovar antes do primeiro login.':
    'Create your account to broadcast on this server. The administrator needs to approve it before your first sign-in.',
  'Crie sua conta para transmitir por este servidor.': 'Create your account to broadcast on this server.',
  'Conta criada! Ela aguarda a aprovação do administrador; depois disso, é só entrar com seu usuário e senha.':
    'Account created! It is waiting for the administrator to approve it; after that, just sign in with your username and password.',
  'Este servidor só aceita transmissores convidados pelo administrador.': 'This server only accepts broadcasters invited by the administrator.',
  'Já tenho conta': 'I already have an account',
  'Quer transmitir por aqui?': 'Want to broadcast here?',
  'Criar conta': 'Create account',
  'Cadastro de transmissores': 'Broadcaster sign-up',
  'Só por convite': 'Invitation only',
  'Qualquer um pede; eu aprovo': 'Anyone can ask; I approve',
  'Livre: qualquer um cria conta e transmite': 'Open: anyone can create an account and broadcast',
  'Com cadastro aberto, a página de entrada mostra "Criar conta" (endereço /cadastro).':
    'With sign-up open, the home page shows "Create account" (address /cadastro).',
  'aguardando aprovação': 'waiting for approval',
  'Salas fixas': 'Permanent rooms',
  'Salas que não somem: o link continua o mesmo, com os mesmos convites. Boa para o canal da comunidade ou a live semanal. A chave de criptografia é criada neste navegador e fica só nos links; o servidor nunca a vê.':
    'Rooms that do not go away: the link stays the same, with the same invitations. Good for a community channel or a weekly stream. The encryption key is created in this browser and lives only in the links; the server never sees it.',
  'Nome da sala': 'Room name',
  'Ex.: Sala do clã': 'E.g.: Clan room',
  Tipo: 'Type',
  'Criar sala fixa': 'Create permanent room',
  '{n} pessoa(s) agora': '{n} person(s) now',
  vazia: 'empty',
  'chave em outro navegador': 'key in another browser',
  'Entrar como anfitrião': 'Join as host',
  'Nova chave': 'New key',
  'Criar chave': 'Create key',
  'Criar uma chave nova? Os links atuais param de funcionar: quem entrar com eles não verá nem ouvirá nada.':
    'Create a new key? The current links stop working: anyone joining with them will not see or hear anything.',
  'Excluir a sala fixa {name}? Quem estiver nela sai agora.': 'Delete the permanent room {name}? Everyone in it leaves now.',
  'Aguardando o anfitrião liberar sua entrada…': 'Waiting for the host to let you in…',
  'Convites e entrada': 'Invitations and entry',
  'Sala de espera: eu libero cada pessoa': 'Waiting room: I let each person in',
  'Nome do convite': 'Invitation name',
  'Ex.: Discord do clã': 'E.g.: clan Discord',
  'Limite de pessoas': 'People limit',
  'Sem limite': 'No limit',
  Validade: 'Valid for',
  'Sem validade': 'No expiry',
  '30 minutos': '30 minutes',
  '1 hora': '1 hour',
  '1 dia': '1 day',
  '7 dias': '7 days',
  'Senha (opcional)': 'Password (optional)',
  'Criar convite': 'Create invitation',
  'Convite padrão': 'Default invitation',
  '{used} de {max} pessoas': '{used} of {max} people',
  '{used} pessoas': '{used} people',
  'vale até {when}': 'valid until {when}',
  'com senha': 'with password',
  revogado: 'revoked',
  'Link do convite': 'Invitation link',
  'Revogar este convite? O link deixa de funcionar e quem entrou por ele sai da sala.':
    'Revoke this invitation? The link stops working and everyone who joined through it leaves the room.',
  'Convite revogado. {n} pessoa(s) saíram da sala.': 'Invitation revoked. {n} person(s) left the room.',
  'Sala de espera ligada: você libera cada pessoa que chegar.': 'Waiting room on: you let in each person who arrives.',
  'Sala de espera desligada.': 'Waiting room off.',
  'Convite “{label}” criado.': 'Invitation “{label}” created.',
  'Link do convite copiado.': 'Invitation link copied.',
  '{name} está na sala de espera.': '{name} is in the waiting room.',
  'Deixar entrar': 'Let in',
  '{name} foi removido. O convite por onde a pessoa entrou ganhou um link novo.':
    '{name} was removed. The invitation they used got a new link.',
  'mostrando a tela': 'sharing screen',
  câmera: 'camera',
  microfone: 'microphone',
  'Liberar a fala': 'Let speak',
  'Tirar a fala': 'Stop speaking',
  'Liberar a tela': 'Let share screen',
  'Tirar a tela': 'Stop screen',
  Câmera: 'Camera',
  'Câmera sobre a tela': 'Camera over the screen',
  Posição: 'Position',
  Tamanho: 'Size',
  Formato: 'Shape',
  'Canto superior esquerdo': 'Top left corner',
  'Canto superior direito': 'Top right corner',
  'Canto inferior esquerdo': 'Bottom left corner',
  'Canto inferior direito': 'Bottom right corner',
  P: 'S',
  G: 'L',
  Retângulo: 'Rectangle',
  Círculo: 'Circle',
  tela: 'screen',

  // --- sala: gravação
  'Não foi possível gravar: {error}': 'Could not record: {error}',
  'Este navegador não consegue gravar vídeo.': 'This browser cannot record video.',
  'Gravando na pasta escolhida. Todos na sala veem o aviso de gravação.':
    'Recording to the chosen folder. Everyone in the room sees the recording notice.',
  'Gravando. O arquivo será baixado quando você parar. Todos na sala veem o aviso de gravação.':
    'Recording. The file will be downloaded when you stop. Everyone in the room sees the recording notice.',
  'Nada foi gravado: não havia vídeo na tela.': 'Nothing was recorded: there was no video on screen.',
  'Gravação salva: {parts}': 'Recording saved: {parts}',
  'Gravação salva na pasta escolhida: {parts}': 'Recording saved to the chosen folder: {parts}',
  parte: 'part',

  // --- emojis
  'Usados recentemente': 'Recently used',
  'Os emojis que você usar aparecem aqui.': 'The emojis you use show up here.',
  Rostos: 'Faces',
  'Gestos e pessoas': 'Gestures and people',
  'Corações e símbolos': 'Hearts and symbols',
  'Jogos e atividades': 'Games and activities',
  'Animais e natureza': 'Animals and nature',
  'Comida e bebida': 'Food and drink',
  'Objetos e viagem': 'Objects and travel',
};

export const LANGS = ['pt-BR', 'en'];

// Escolha salva pela pessoa; senão, o idioma do navegador (português → pt-BR, o resto → inglês)
const pick = () => {
  try {
    const saved = localStorage.getItem('lang');
    if (LANGS.includes(saved)) return saved;
  } catch {}
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language ?? '']) {
    if (/^pt\b/i.test(l)) return 'pt-BR';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
};

export const lang = pick();

export const t = (text, vars = {}) =>
  (lang === 'en' ? (EN[text] ?? text) : text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// Exposto para os testes conferirem que todo texto tem tradução
export const dictionary = EN;

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

export const translatePage = (root = document.body) => {
  document.documentElement.lang = lang;
  document.title = t(document.title);
  if (lang === 'pt-BR') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text && EN[text]) node.nodeValue = node.nodeValue.replace(text, EN[text]);
  }
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (value && EN[value]) el.setAttribute(attr, EN[value]);
    }
  }
};

// Seletor de idioma: <span data-lang-switch></span> vira "Português · English"
export const mountLanguageSwitch = () => {
  for (const host of document.querySelectorAll('[data-lang-switch]')) {
    host.replaceChildren(
      ...LANGS.flatMap((l, i) => {
        const b = Object.assign(document.createElement('button'), {
          type: 'button',
          className: 'link',
          textContent: l === 'en' ? 'English' : 'Português',
        });
        b.setAttribute('aria-pressed', String(l === lang));
        b.addEventListener('click', () => {
          try {
            localStorage.setItem('lang', l);
          } catch {}
          location.reload();
        });
        return i ? [document.createTextNode(' · '), b] : [b];
      }),
    );
  }
};
