# Plano: Owncord → Overshoulder, com deploy fácil

Decidido em 08/11/2026. Ponto de partida para continuar o trabalho: nada daqui foi implementado ainda.

## Onde paramos

- Etapa 0 feita: git local e testes automáticos (`./scripts/test.sh`).
- Etapa 1 feita: nome **Overshoulder** e ícone novo (pessoa vista por cima do ombro olhando uma tela).
- Feito em 14/11/2026, fora da ordem das etapas, a pedido do usuário:
  - Visual inspirado no Discord, com as cores do Overshoulder: barra de botões redondos, painel de ajustes, chat com avatares.
  - **Microfone só de quem transmite**: botão de voz e aviso "Microfone ligado" para os espectadores. O áudio extra do jogo passou a ser publicado como áudio da tela.
  - **Emojis no chat**: seletor próprio com recentes; mensagens só com emojis aparecem grandes.
  - **GIFs descartados**: a API do Tenor foi desligada em 30/06/2026, e GIPHY/KLIPY exigiriam uma chave por servidor.
- Etapa "imagem única" feita em 14/11/2026:
  - `Dockerfile` na raiz com LiveKit, app e Caddy, coordenados por `app/supervisor.js`, que reinicia serviços que caem e um vigia que reinicia serviços travados.
  - Segredos gerados em `/data/secrets.json`, `/healthz`, logs em JSON e `MAX_PARTICIPANTS`.
  - Mídia numa porta UDP só (7882) e testes da imagem em `scripts/test-image.sh`.
  - A instância de teste desta máquina roda pela imagem única (`docker compose up -d --build`, com `.env` em DOMAIN=192.168.0.102, HTTPS_PORT=8443).
- Etapa 2, partes 1 e 2, feitas em 14/11/2026:
  - Contas com onboarding em `/configurar` (código de uso único nos logs), conta de admin, login, sessões (12 h, ou 2 h sem uso) e troca de senha.
  - Senhas no padrão NIST, com a lista de senhas vazadas em `app/data/`; limite de tentativas por IP e por conta; checagem de origem contra CSRF.
  - Estado salvo em `/data/state.json`. `CREATE_PASSWORD` foi removida.
  - Parte 3 (2FA) feita: TOTP opcional com QR code, login em duas etapas, 10 códigos de recuperação de uso único, "Exigir 2FA" e, só para o admin, gerar códigos novos e remover o 2FA de uma conta. A página `/conta` também troca a senha.
  - Parte 4 feita: convites de uso único (48 h), contas de transmissor, revogação imediata (sessões e salas ao vivo), reativação e exclusão, painel `/admin` (configurações, transmissores e convites) e `overshoulder reset-admin` dentro do container.
  - **Etapa 2 concluída.**
- Etapa 3 (moderação) feita em 14/11/2026:
  - Aba *Pessoas* na sala; o anfitrião remove alguém, passa e retoma a vez de apresentar, desliga o chat de quem assiste e gera um link novo.
  - O link público (`/r/<código>`) é separado do nome interno da sala no LiveKit, e remover alguém troca o link.
  - **Limitação conhecida:** o LiveKit 1.13.10 não aplica `revokeTokenTs`, então quem foi removido ainda tem um token válido (8 h). Um vigia remove de novo, em até 2 s, quem voltar com ele; nesse intervalo a pessoa ainda poderia ver a transmissão, porque conhece a chave E2EE. Fechar de vez exigiria trocar a chave E2EE ao remover alguém (a estudar).
- Etapa 4 (gravação no navegador) feita em 14/11/2026:
  - Botão de gravar para o anfitrião: grava o vídeo exibido e a mistura de todo o áudio da sala, em partes quando a fonte do vídeo muda.
  - Na pasta (Chrome/Edge): WebM gravado a cada segundo. No download: MP4.
  - Aviso "● Gravando" para todos. Ele some na hora quando o anfitrião fecha a aba (sendBeacon) e, se o navegador travar ou a rede cair, em ~22 s: o tempo que o LiveKit espera por uma reconexão.
  - O compartilhamento de tela passou a ser testado de ponta a ponta (o Chromium dos testes compartilha tela com flags de mídia falsa).
- Etapa 5 (TURN/TLS na 443) feita em parte em 14/11/2026, **experimental**:
  - O Caddy é compilado com o caddy-l4 (v0.1.2). Com `TURN_DOMAIN`, a 443 leva `turn.<domínio>` ao TURN do LiveKit (TLS terminado no Caddy, `external_tls`) e o resto ao site, preservando o IP de quem acessa.
  - O LiveKit anuncia o TURN sempre na 443, então `TURN_DOMAIN` exige `HTTPS_PORT=443`.
  - **Comprovado:** a divisão da porta, o certificado do subdomínio e o STUN pelo TLS (teste da imagem). Numa sonda manual, o Chrome negociou TLS, autenticou e obteve uma alocação (candidato `relay`).
  - **Não comprovado:** a conexão completa só por TURN (`iceTransportPolicy: relay`) falhou no ambiente de teste (tudo no mesmo container, certificado local, IP interno do Docker); o TURN aloca, mas o vídeo não chega. Confirmar num servidor real com domínio e Let's Encrypt (por exemplo, a VPS da Hostinger) antes de tirar o "experimental".
  - Sondas usadas: a página do anfitrião conecta, e um `Room` à parte conecta com `rtcConfig: { iceTransportPolicy: 'relay' }`; o Chromium precisa confiar na CA do Caddy (NSS, via `certutil`) e resolver `turn.<domínio>` pelo `/etc/hosts`.
- Etapa 6 (SSO via OIDC) feita em 14/11/2026:
  - Authorization Code + PKCE (S256), `state` ligado ao navegador por cookie e `nonce`. O ID token é validado com `jose` 6.2.14 (assinatura pelo JWKS, emissor, audiência, validade, nonce); `email_verified: false` é recusado (ausente é aceito, porque o Entra ID não envia).
  - Configuração em `/admin` (segredo só de escrita). Domínios de e-mail permitidos; grupo ou lista de e-mails para transmitir. O admin é sempre local.
  - Espectador com login corporativo tem sessão própria (não é conta). Salas podem exigir o login para assistir, com o nome real no chat; o admin define o padrão ou torna obrigatório.
  - Contas de transmissor do SSO não entram por senha e não são afetadas por "Exigir 2FA" (o provedor cuida do MFA).
  - Testes com um provedor OIDC falso (`app/test/oidc-mock.js`), inclusive tokens adulterados, CSRF de login e redirecionamento aberto.
  - **Falta testar com um provedor real** (Google Workspace, Entra ID ou Keycloak).
- Etapa 7 (tradução pt-BR/en) feita em 14/11/2026:
  - O texto em português é a chave. `public/i18n.js` traduz os nós de texto e atributos da página e os textos montados por `t()`. `i18n-server.js` traduz as mensagens de erro da API pelo `Accept-Language` que a página envia.
  - O idioma vem do navegador (português → pt-BR; o resto → inglês), com seletor salvo no navegador.
  - `README.md` em inglês e `README.pt-BR.md` em português.
  - Testes: todo texto e toda mensagem precisa de tradução; em inglês, nenhuma tela mostra letras acentuadas do português. Os navegadores dos outros testes abrem em pt-BR (`launchBrowser`).
  - **Ainda em português:** os logs e o comando `reset-admin`, que são ferramentas de quem opera o servidor.
- Repositório privado publicado em 14/11/2026: github.com/dionatansimioni/overshoulder. O histórico foi reescrito para o e-mail `noreply` do GitHub antes do primeiro envio.
- Etapa 8 (publicação automatizada) feita em 14/11/2026:
  - `ci.yml` (testes e Trivy a cada envio) e `release.yml` (tag vX.Y.Z: imagem amd64 + arm64 no GHCR, SBOM e proveniência do BuildKit, assinatura cosign sem chave, SBOM CycloneDX atestado e release). Só `actions/checkout` e `sigstore/cosign-installer` como ações de terceiros, fixadas pelo hash.
  - A varredura encontrou 13 falhas altas: o LiveKit agora é compilado do código-fonte (v1.13.11, Go 1.27.4, x/net v0.62.0), o Caddy usa x/net v0.62.0 e o npm saiu da imagem.
  - LICENSE (AGPL-3.0) adicionada.
- **v0.1.0 publicada em 15/11/2026** (privada): o CI no GitHub passou (testes 8 min, varredura 5 min) e a publicação também (58 min, a maior parte compilando o arm64 no QEMU). Imagem `ghcr.io/dionatansimioni/overshoulder:0.1.0`, manifesto `sha256:20168a6292166bdab892babb382b780d6a4bafd1f9ac81169a1ed0fbc9f7d06a`, release com o SBOM.
  - **Atenção:** a assinatura sem chave registra no log de transparência público do Sigstore (Rekor) o nome do repositório, o fluxo e a tag. O conteúdo continua privado, mas a existência do projeto e da versão ficou pública. O que já foi registrado não pode ser apagado; para repositório privado, decidir se a assinatura fica desligada até a abertura.
  - Falta verificar a assinatura de fora (`cosign verify`): o token do `gh` desta máquina não tem `read:packages` (`gh auth refresh -h github.com -s read:packages`).
  - Melhoria possível: compilar o arm64 num runner ARM nativo em vez do QEMU (bem mais rápido; para repositório privado depende do plano do GitHub).
- Próximo da ordem: o instalador de um comando e o botão da Hostinger. Antes de divulgar: validar numa VPS real o TURN, o SSO com um provedor real e o certificado no IP.
- Ainda sem teste automático (o navegador headless não compartilha tela): compartilhamento de tela real e áudio do jogo. Testar à mão.
- O LiveKit avisa a entrada de quem só assiste em lotes de ~2,5 s (`batchedUpdates`), e não há configuração conhecida para isso. Por isso o chat espera até 10 s pelo nome de quem acabou de entrar.
- A pasta do projeto foi renomeada em 14/11/2026 para `/home/diolinux/claude/overshoulder` (antes `owncord`). Em 14/11/2026 a instância de teste foi religada na pasta nova (containers `overshoulder-*`). Para subir de novo nesta máquina, o Discourse ocupa a porta 80, então use a 8443: `export CADDY_GLOBAL_OPTIONS=$'local_certs\nhttp_port 8081\nhttps_port 8443' LIVEKIT_PUBLIC_URL=wss://192.168.0.102:8443` e depois `docker compose up -d --build`.
- O `.env` local tem a senha `senha-teste`: só serve para testes.
- A transmissão real (vídeo, áudio, E2EE e chat) ainda não foi testada num navegador, nem antes nem depois da troca de nome.

## Novo foco (15/11/2026): gamers e criadores de conteúdo

Estas decisões têm prioridade sobre as anteriores quando conflitarem.

Com a suspensão do Discord no Brasil, muita gente ficou sem compartilhar a tela dos jogos. O Overshoulder passa a mirar:
1. **gamers** que compartilham gameplay com os amigos e querem um lugar para jogar juntos;
2. **criadores de conteúdo** com lives exclusivas para a audiência;
3. **eventos** transmitidos.

Empresas deixam de ser o foco (mercado concorrido), mas a segurança continua num bom nível e o admin mantém controle e autonomia totais.

| Tema | Decisão |
|---|---|
| Transmissores | O admin escolhe o modo: **só convite**, **cadastro com aprovação** (padrão, com fila no `/admin`) ou **cadastro livre**. Revoga qualquer um a qualquer momento |
| Espectadores | **Sem conta.** Entram por convite de sala |
| Formatos de sala | **Salas fixas** criadas pelo admin (como canais do Discord, endereço permanente) e **salas rápidas** com link, abertas por qualquer transmissor |
| Tipos de sala | **"Jogando juntos"**: todos falam (como uma call) e, por padrão, qualquer um mostra a tela. **"Live"**: só quem apresenta fala; a audiência usa o chat e pode **pedir a palavra** ou **pedir para mostrar a tela**. A opção "qualquer um pode mostrar a tela" é escolhida ao criar a sala |
| Várias telas | Várias telas ao vivo ao mesmo tempo; cada pessoa escolhe qual assistir e só recebe essa |
| Convites de sala | Convite padrão: ilimitado, sem senha e sem validade. Opções: **limite de pessoas** (o navegador guarda um "ingresso" e volta sem gastar vaga), **validade**, **senha** opcional, **vários convites nomeados e revogáveis** (revogar tira da sala quem entrou por ele) e **sala de espera** (o anfitrião aprova cada entrada) |
| Qualidade | Padrão **720p**. Qualidade maior mostra o aviso de banda. O admin configura o padrão e a qualidade máxima do servidor |
| Tamanho | Um servidor só, com limite de pessoas configurável e sem teto fixo baixo (aviso de banda acima de algumas centenas) |
| Recursos de empresa | Moderação, gravação, 2FA, chat, tradução e E2EE continuam em destaque. **SSO e TURN na 443** viram opções avançadas recolhidas no `/admin`, sem novos investimentos por enquanto |
| Assinatura das imagens | Mantida (recomendação; confirmar com o usuário) |
| Homelab | Funciona; o limite é o upload de casa (~26 pessoas em 720p com 100 Mbps de upload), o CGNAT e o IP de casa exposto a quem assiste. Para lives abertas ao público, recomendar VPS |
| Rede local de empresa | Benefício a oferecer: servidor no hardware da empresa, só na rede interna. Já funciona com `TLS=local`; faltam o certificado da empresa (`TLS=custom`), o modo rede local no instalador e o guia de instalação sem internet |

### Webcam, celular e navegação (15/11/2026)

| Tema | Decisão |
|---|---|
| Webcam | Quem apresenta pode ligar a câmera, em qualquer sala (na "Live", quem tem a vez; na "Jogando juntos", quem mostra a tela). Quem só assiste ou conversa não usa câmera |
| Picture-in-picture | Tela e câmera vão como **duas transmissões**; o player de quem assiste desenha a câmera sobre a tela, sem recodificar e sem pesar no PC de quem joga. Juntar no PC de quem transmite foi descartado: a aba em segundo plano trava o desenho durante o jogo |
| Posição da câmera | Escolhida ao vivo por quem transmite: 4 cantos, 3 tamanhos e o formato (retângulo arredondado ou círculo). Quem assiste pode esconder a câmera ou inverter (câmera grande, tela pequena). Sem tela, a câmera vira o vídeo principal |
| Câmera e permissões | A política do site passa a liberar a câmera para o próprio site (`camera=(self)`); o token de quem apresenta inclui a fonte câmera |
| Gravação com câmera | Tela (com o áudio da sala) e câmera em **arquivos separados**, sincronizados |
| Celular | **Um webapp PWA** para PC e celular, **sem apps de Android ou iOS**. Assistir bem no celular (tela cheia no iPhone, paisagem, teste em aparelhos reais), instalação pela tela inicial e live só com câmera pelo celular. Os navegadores móveis não compartilham a tela: guia para transmitir jogos de celular pelo PC (`scrcpy` no Android, AirPlay no iPhone) |
| Navegação e criar sala | Inspiração: Discord (barra lateral com salas, configurações com menu lateral), Google Meet (criar em 1 clique, antessala com prévia), StreamYard (ajustes com prévia), Twitch (botão de ao vivo e status claros), Whereby/Jitsi (espectador entra só com o nome). Configuração inicial em 3 passos com progresso e Voltar sem perder dados; página inicial com barra lateral e "Criar sala"; criar sala numa janela com dois cartões (Jogando juntos / Live), padrões prontos e "Mais opções" recolhidas; antessala com prévia de câmera e microfone; `/admin` com menu lateral |
| Critérios de usabilidade (testados no navegador) | Criar e compartilhar uma sala em até 2 cliques a partir da página inicial; Voltar do navegador funciona em toda tela de configuração sem perder dados; tudo funciona pelo teclado; nada some no celular. Sem protótipo: implementar direto e ajustar no app real |

### Progresso do novo foco
- **Item 1 feito (15/11/2026):**
  - Salas "Jogando juntos" (todos falam, telas livres ou sob pedido) e "Live" (pedir a palavra, pedir a tela). Tipo padrão da API: Live.
  - Várias telas ao mesmo tempo com assinatura manual: quem assiste só recebe a tela escolhida (comprovado pelas estatísticas do WebRTC no teste).
  - Webcam com picture-in-picture (posição, tamanho, formato) e modo só câmera; gravação com tela e câmera em arquivos separados.
  - Pedidos e posição da câmera passam por rotas que conferem o token do LiveKit da própria pessoa (`/api/rooms/request`, `/api/rooms/layout`). O anfitrião libera e tira por `/api/rooms/permissions`, que substituiu o antigo "passar a vez".

- **Item 2 feito (16/11/2026):**
  - Convites de sala: o padrão é ilimitado; o anfitrião cria convites nomeados com limite de pessoas, validade (até 30 dias) e senha opcional (com limite de tentativas), e revoga (o link morre, os ingressos também, e quem entrou por ele sai da sala).
  - Ingresso no navegador (só o hash fica no servidor): voltar não gasta o convite, não pede senha nem sala de espera, e funciona mesmo depois de o link mudar.
  - Sala de espera: quem chega espera; o anfitrião deixa entrar ou recusa (os metadados mostram só um id público, não o segredo de quem espera). Quem foi aprovado entra com o nome aprovado.
  - Remover alguém troca só o link do convite usado por essa pessoa.
  - Limitação: convites e ingressos ficam na memória e somem com a sala (salas fixas, no item 3, vão precisar persistir).

- **Item 3 feito (16/11/2026):**
  - Modo de cadastro de transmissores: só convite, com aprovação (padrão) ou livre, em `/cadastro`. Limite de 5 cadastros por IP por hora e no máximo 50 contas esperando aprovação. Conta pendente não ganha sessão, e o login avisa da pendência só com a senha certa.
  - Salas fixas do admin: configuração, convites (com usos e senhas em hash) e ingressos (em hash) persistem no `state.json`; a sala volta ao ar sozinha quando alguém entra, com o estado do ar zerado. A chave E2EE fica só no navegador do admin (`localStorage`); em outro navegador ele precisa do link ou de uma chave nova.
  - Corrigido: a página da sala apagava o nome digitado antes de o script carregar.
  - Atenção: servidores já instalados passam a aceitar pedidos de cadastro (modo padrão "com aprovação"); quem quiser o comportamento antigo escolhe "Só por convite" em `/admin`.
  - Pendente para o item 5: recolher SSO e TURN em "opções avançadas" no admin.

### Ordem de implementação (novo foco)
1. **Tipos de sala, várias telas e webcam:** "Jogando juntos" (voz para todos, várias telas, escolher qual assistir) e "Live" (pedir a palavra e pedir para mostrar a tela), com webcam e picture-in-picture para quem apresenta e gravação em arquivos separados.
2. **Convites de sala:** limite com ingresso, validade, senha, convites nomeados e revogáveis, sala de espera.
3. **Salas fixas e cadastro de transmissores** com fila de aprovação.
4. **Padrões de qualidade:** 720p, aviso de banda, padrão e qualidade máxima no admin, limite de pessoas sem teto baixo.
5. **Interface e navegação:** barra lateral, configuração inicial em passos, criar sala numa janela com cartões, antessala, `/admin` com menu lateral (SSO e TURN em "Avançado") e os critérios de usabilidade. Junto, o PWA e o celular (tela cheia no iPhone, paisagem, guia de jogos mobile pelo PC).
6. **Rede local e homelab:** certificado próprio (`TLS=custom`), modo rede local no instalador, guia de instalação sem internet e o aviso sobre o IP de casa exposto.
7. **Instalador de um comando** e botão da Hostinger.
8. **Validação numa VPS real** antes de divulgar (TURN, SSO com provedor real, certificado no IP).

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Público | Instância própria para os amigos, mas qualquer pessoa instala a sua sem ajuda |
| Nome | **Overshoulder**. "Owncord" já existe como clone open source do Discord |
| Ícone | Novo, sobre "olhar por cima do ombro", nas cores atuais (`#5b8cff` sobre `#0f1115`) |
| Base | **Docker Compose único** para todos os caminhos de instalação |
| Caminhos | (1) instalador de um comando, (2) botão "Deploy on Hostinger", (3) compose manual |
| Imagem | Pronta no **GHCR** (amd64 + arm64), gerada pelo GitHub Actions |
| Repositório | GitHub pessoal do usuário (falta saber o nome de usuário) |
| Licença | **AGPL-3.0** |
| Proxy | Caddy embutido por padrão. Modo "já tenho proxy" se 80/443 estiverem ocupadas |
| Domínio | Opcional. Sem domínio, usa **certificado Let's Encrypt no IP** (perfil `shortlived`), com **nip.io** de reserva |
| Primeira vez | Segredos gerados sozinhos num volume. Página **"Configurar"** liberada por **código de uso único mostrado nos logs**, onde se define a senha e, opcionalmente, o domínio |
| Domínio depois | Campo na página de configuração: confere o DNS e troca o certificado na hora |
| Atualização | Comando `overshoulder update` e aviso de nova versão para quem tem a senha. Nada se atualiza sozinho |
| Portas | 80/443 TCP, 7881 TCP e **uma porta UDP só (7882)** |
| TURN | Não, por enquanto |
| Firewall | Instalador abre ufw/firewalld, lista o que liberar no painel do provedor e testa as portas. A sala mostra se a conexão está em UDP ou TCP |
| Uso de banda | Painel para quem tem a senha: dados enviados no mês, salas e espectadores. Franquia opcional, com aviso em 80% |
| Sistemas | Ubuntu e Debian (amd64 e arm64) no instalador. Outros sistemas pelo compose manual |
| LAN/localhost | Saem do instalador. Fica só o uso pela internet |

## Decisões de 14/11/2026: uso por empresas (lives e treinamentos)

Estas decisões têm prioridade sobre as da tabela acima quando conflitarem.

| Tema | Decisão |
|---|---|
| Plateia | Até ~150 pessoas por sala, **limite configurável** por quem administra (hoje fixo em 16). Um servidor só; o gargalo é a banda (~7 Mbps por espectador em 1080p60) |
| Acesso | Senha + link continuam o padrão. **SSO opcional via OIDC** (Google Workspace, Microsoft Entra, Keycloak etc.), podendo exigir login também para assistir, com o nome real no chat |
| Gravação | **No navegador de quem transmite** (MediaRecorder → arquivo .webm). Mantém o E2EE; sem gravação no servidor |
| Redes corporativas | **TURN/TLS opcional na 443**, num subdomínio (ex.: `turn.empresa.com`), compartilhando a porta com o site. Substitui o "sem TURN" anterior |
| Empacotamento | **Imagem Docker única** (LiveKit + app + Caddy, com supervisor leve): instalar = um `docker run` com volume e portas. O compose vira só exemplo. Substitui "três containers no compose" |
| Configuração | **Tela de onboarding** para tudo o que for configurável: senha de admin, domínio, TURN, SSO, limite de plateia. Nada de editar arquivos. Guardada num arquivo no volume de dados (sem banco: só há configuração, nada de histórico) |
| Histórico | **Nada guardado**: sem relatório de presença, sem chat salvo. Salas efêmeras |
| Moderação | Anfitrião pode **remover alguém** (sem voltar com o mesmo link), **desligar o chat** e **trocar o link** da sala (o antigo deixa de valer) |
| Apresentadores | **Um por vez**; o anfitrião pode **passar a vez** (tela e microfone) e pegar de volta |
| Cadeia de publicação | No GitHub Actions: **varredura de vulnerabilidades** de dependências e da imagem (bloqueia falha grave), **SBOM** e **imagem assinada** (cosign/Sigstore). Gitleaks já roda nos testes |
| Operação | **`/healthz`** com healthcheck do Docker, **logs em JSON** sem dados pessoais e o painel de uso já decidido |
| Idioma | **pt-BR e inglês**: interface traduzível (pelo idioma do navegador) e README em inglês com versão em português |

### Contas, 2FA e transmissores (decidido em 14/11/2026)

| Tema | Decisão |
|---|---|
| Contas | **Admin** (criado no onboarding) e **transmissores** (convidados pelo admin). Espectadores continuam sem conta: link, ou SSO se ligado. A senha única do servidor (`CREATE_PASSWORD`) deixa de existir |
| Permissões | Transmissor cria salas e transmite, mas não mexe na configuração. Admin faz tudo |
| 2FA | **TOTP opcional**, com o sistema recomendando ativar. O admin pode ligar **"Exigir 2FA"**: quem não tem precisa configurar no próximo login |
| Códigos de recuperação | 10 códigos de uso único gerados ao ativar o 2FA. **Só o admin gera um conjunto novo** (para si e para transmissores) |
| Admin perdeu tudo | Comando no servidor: `docker exec overshoulder overshoulder reset-admin` gera um link de redefinição de uso único, válido por 15 min |
| Cadastro de transmissor | **Convite de uso único** (vale 48 h). A pessoa cria o próprio usuário e senha; o admin nunca vê a senha |
| Revogação | **Imediata**: desativa a conta, encerra as sessões dela e as salas que ela estiver transmitindo |
| Senhas | Padrão NIST: no mínimo 12 caracteres, sem regras de símbolo, bloqueando as senhas mais vazadas (lista embutida). Hash com scrypt |
| Sessões | 12 h no máximo, expiram após 2 h sem uso. Trocar a senha encerra as outras sessões. Limite de tentativas por conta e por IP |
| Logs de segurança | Login, falha de 2FA, convite, revogação e mudança de configuração registram **usuário e ação** (sem IP, senhas, códigos ou tokens). Espectadores ficam fora. Documentar no README (interesse legítimo, LGPD) |
| Onboarding | Liberado por um código de uso único que aparece em `docker logs`. Cria o admin e define o domínio e o limite de plateia |
| Armazenamento | Arquivo JSON no volume `/data`, com escrita atômica (sem banco de dados) |

### Ordem sugerida para implementar
1. Imagem única + `/healthz` + logs JSON (a base de tudo o que vem depois).
2. Onboarding: segredos automáticos, senha de admin, domínio e limite de plateia; o resto das opções entra conforme cada recurso.
3. Moderação (remover, silenciar chat, trocar link) e passar a vez de apresentador.
4. Gravação no navegador.
5. TURN/TLS opcional.
6. SSO via OIDC.
7. Tradução pt-BR/en.
8. Publicação: GitHub Actions com varredura, SBOM e assinatura.

## Etapas

Cada etapa termina com algo funcionando e testado, na ordem abaixo. As regras de trabalho (git, commits descritivos, testes) estão no `CLAUDE.md`.

### 0. Git e testes básicos (antes de qualquer mudança)
- `git init` local com `.gitignore` (inclui `.env` e `node_modules/`) e commit inicial do estado atual.
- Escolher o runner de testes. Sugestão: `node:test`, já embutido no Node, sem dependência nova.
- Testes básicos:
  - O servidor sobe e serve `/`, `/r/<id>`, `/static/*` (inclusive os ícones) e `/vendor/*`, com os cabeçalhos de segurança.
  - API: senha errada é recusada, com limite de tentativas; criar sala, gerar token de anfitrião e de convidado, e encerrar sala. Usar o LiveKit real num container ou um falso.
  - Smoke test no navegador headless: as páginas carregam sem erro no console.
- Comando único para rodar tudo (por exemplo, `npm test`) e commit com a suíte verde.

### 1. Nome e ícone
- Trocar Owncord por Overshoulder em páginas, README, `package.json`, `setup.sh` e logs.
- Desenhar o novo `icon.svg` e gerar o `icon-180.png` com `rsvg-convert`, conferindo em 16, 32 e 256 px.
- Testar uma transmissão real no navegador: sala, vídeo, áudio, E2EE e chat.

### 2. Repositório e publicação
- LICENSE (AGPL-3.0). Criar o repositório no GitHub pessoal e enviar o histórico local.
- Rodar os testes no GitHub Actions a cada push. A imagem só é publicada se os testes passarem.
- Workflow do GitHub Actions: a cada tag `vX.Y.Z`, publicar `ghcr.io/<usuário>/overshoulder:X.Y.Z` e `:latest` (multi-arch, com buildx).
- Usar versionamento semântico. A tag é a fonte da versão que o app mostra.

### 3. Compose independente do `.env`
- `docker-compose.yml` sem `build:`, usando a imagem do GHCR com versão fixa e valores padrão para tudo. O botão da Hostinger não leva `.env`.
- Container de inicialização (ou o próprio app na primeira subida) que gera as chaves do LiveKit e o segredo do anfitrião num volume `data`.
  - A verificar: o LiveKit lê as chaves de arquivo (`key_file`)? Senão, como entregar a ele as chaves geradas sem `.env`.
- Mover senha e domínio do ambiente para o volume. A senha passa a ser guardada como hash (scrypt), não em texto puro.

### 4. Rede do LiveKit
- Trocar a faixa 50000–60000 por uma porta UDP só (7882, `rtc.udp_port`) e manter 7881/TCP.
  - A verificar: confirmar na documentação do LiveKit que a porta única não perde desempenho em salas de até 16 pessoas.
- Juntar `livekit.yaml` e `livekit.dev.yaml` num só (sem modo LAN). O IP público continua vindo por STUN.

### 5. Página "Configurar" (primeira vez)
- Enquanto não houver senha, o site mostra "Configurar Overshoulder" e pede o código de uso único que o app imprime nos logs (`docker compose logs app`).
- O formulário define a senha e, opcionalmente, o domínio. Depois disso o código deixa de valer.
- Área de quem tem a senha: trocar senha, trocar domínio, painel de uso (etapa 8) e aviso de versão (etapa 9).

### 6. HTTPS e domínio
- Sem domínio: o Caddy emite certificado para o IP com `issuer acme { profile shortlived }`. Isso exige a porta 80 acessível de fora.
  - Testar numa VPS de verdade, inclusive IPv6. Há relatos de funcionar com Caddy 2.11.x.
  - Se falhar, usar `<ip-com-hífens>.nip.io`. Não está na Public Suffix List: a cota de certificados é dividida entre todos os usuários.
- Com domínio: o app confere se o DNS aponta para o IP do servidor e reconfigura o Caddy na hora.
  - Decidir o mecanismo: API admin do Caddy (`localhost:2019`) ou Caddyfile gerado num volume + reload.
- Modo "já tenho proxy": o Caddy não sobe, e o README traz configurações prontas para Nginx, Traefik e Caddy existentes. Atenção à rota `/rtc` (WebSocket do LiveKit).

### 7. Instalador de um comando
- `curl -fsSL https://…/install.sh | bash` em Ubuntu e Debian:
  1. Verifica o sistema e a arquitetura.
  2. Instala o Docker se faltar.
  3. Verifica as portas 80/443; se estiverem ocupadas, oferece o modo proxy.
  4. Abre ufw/firewalld.
  5. Baixa o compose para `/opt/overshoulder` e sobe.
  6. Mostra o endereço, o código de configuração e as portas a liberar no painel do provedor.
- Comando `overshoulder` com `update`, `status`, `logs`, `config-code` (mostra o código de novo) e `uninstall`.
- Teste das portas: rodar pelo navegador de quem administra (teste WebRTC na página de configuração), sem serviço de terceiros.
- A sala mostra se a conexão está por UDP, por TCP ou se falhou.

### 8. Painel de uso
- Bytes enviados no mês, salas ativas e espectadores, com franquia opcional e aviso em 80%. Guardar o contador mensal no volume.
  - A verificar a fonte dos números: métricas Prometheus do LiveKit (`prometheus_port`), webhooks ou estatísticas da API.

### 9. Aviso de nova versão
- O servidor consulta as releases do GitHub (uma vez por dia) e avisa na área de quem tem a senha.
- Documentar essa consulta e permitir desligá-la, por privacidade.

### 10. Hostinger e documentação
- Botão: `https://www.hostinger.com/docker-hosting?compose_url=<URL raw do compose>`. Não precisa de aprovação.
  - A verificar na prática: se o Docker Manager aceita `network_mode: host` e as portas UDP, e como fica o firewall do hPanel.
- Catálogo oficial da Hostinger: não há processo público, só contato direto. Outros marketplaces ficam para depois: DigitalOcean exige parceria e snapshot via Packer; Coolify exige mais de 1.000 estrelas.
- README com os três caminhos, portas, cálculo de banda, modo proxy, atualização e backup (é só o volume `data`).

### 11. Teste numa VPS real
- Uma VPS de teste com Ubuntu, por exemplo a Hostinger KVM 2 (2 vCPU, 8 GB, 8 TB/mês; depois da franquia cai para 10 Mbps).
- Testar os três caminhos de instalação, com e sem domínio.
- `speedtest` na VPS, sessão real com amigos em outras redes e carga com `lk perf load-test`, simulando 15 espectadores.

## Perguntas em aberto

- **Idioma:** o nome é em inglês e o projeto é aberto, mas a interface e o README estão em português. Ficam em português, em inglês ou com tradução (pt-BR e en)?
- **Nome de usuário no GitHub:** necessário para os endereços da imagem e do instalador, difíceis de mudar depois.
- **Diferencial frente ao Piik** (github.com/TNTcraftHIM/Piik, MIT, ~4.150★, ativo): projeto parecido de compartilhamento de tela com amigos. Vale olhar antes de divulgar.
- **Domínio do projeto** (site e endereço do instalador): verificar no registro se `overshoulder.*` está livre.
- **Marca:** verificar se "Overshoulder" não tem registro de marca que atrapalhe.

## Fontes da pesquisa

- Let's Encrypt, limites: https://letsencrypt.org/docs/rate-limits/
- Let's Encrypt, certificados de IP e de 6 dias: https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability
- Caddy e certificado de IP: https://github.com/caddyserver/caddy/issues/7399
- Lista de sufixos públicos: https://publicsuffix.org/list/public_suffix_list.dat
- nip.io / sslip.io: https://nip.io/ e https://github.com/cunnie/sslip.io
- Hostinger, Docker Manager: https://www.hostinger.com/support/12040815-how-to-deploy-your-first-container-with-hostinger-docker-manager/
- Hostinger, botão de deploy: https://www.hostinger.com/support/deploy-on-hostinger-button
- Hostinger, limite de banda da VPS: https://www.hostinger.com/support/8789965-what-happens-if-your-vps-bandwidth-resource-limits-are-exceeded/
- LiveKit, portas: https://docs.livekit.io/transport/self-hosting/ports-firewall.md
- LiveKit, teste de carga: https://docs.livekit.io/reference/developer-tools/livekit-cli/perf/
- Owncast, exemplo de instalação por marketplace: https://owncast.online/dev-docs/1-click-installs-on-hosting-marketplaces
