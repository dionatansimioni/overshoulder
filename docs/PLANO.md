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
- **Requisito do usuário (15/11/2026): funcionar em plataformas como o Coolify** (e Dokploy, EasyPanel, Portainer com Traefik), que já ocupam 80/443 com o próprio proxy. Vale para tudo daqui em diante: nada pode depender de o Overshoulder ser dono das portas 80/443.
  - **Feito em 15/11/2026: `TLS=proxy`** (o modo "já tenho proxy"). O Caddy serve só HTTP na `HTTP_PORT`, o proxy de fora cuida do HTTPS e o endereço público é `https://<DOMAIN>`. IP e protocolo de quem acessa só são aceitos de `TRUSTED_PROXIES` (padrão `private_ranges`), lendo o `X-Forwarded-For` da direita para a esquerda (`trusted_proxies_strict`); o app recebe um IP só. Recusa `TURN_DOMAIN`. Guia em `docs/proxy.md` (Coolify, Dokploy, EasyPanel, Nginx, Caddy, Traefik); testes em `scripts/test-image.sh`.
  - A validar num Coolify de verdade: o domínio com `:80`, a publicação das portas 7881/7882 e o IP de quem acessa vindo do Traefik.
  - Ainda por pensar: o instalador detectar o Coolify e similares, e uma variável para porta pública diferente de 443 atrás do proxy, se alguém pedir.
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
  - Feito no item 5 (parte 4): SSO e TURN em "Avançado" no admin.

- **Item 4 feito (15/11/2026):**
  - Qualidade padrão **720p30** e máxima **1440p60** (sem restrição) em servidores novos e nos já instalados. O admin escolhe as duas em `/admin`; a padrão não pode passar da máxima.
  - O token da sala leva `quality: { default, max }`: a sala só oferece qualidades até a máxima e começa na padrão. É um limite da interface: um cliente modificado ainda poderia enviar mais, porque o LiveKit não limita o bitrate por token.
  - Acima de 720p, os ajustes da transmissão mostram quanto cada pessoa recebe e, com gente na sala, quanto o servidor envia (Mbps e GB por hora).
  - Limite de pessoas por sala de 2 a **5000** (antes 500). O painel mostra a banda da sala cheia na qualidade padrão e destaca a estimativa a partir de 200 pessoas.
  - Bitrates e nomes das qualidades ficam em `public/quality.js`, usado pela sala e pelo painel (a lista `QUALITIES` do `server.js` precisa seguir a mesma ordem).
  - Testes em `app/test/quality.test.js`.

- **Item 5 em andamento (15/11/2026)**, em cinco partes: (1) página inicial com barra lateral e criar sala numa janela; (2) configuração inicial em 3 passos; (3) antessala com prévia de câmera e microfone; (4) `/admin` com menu lateral e SSO/TURN em "Avançado"; (5) celular e PWA.
  - **Parte 1 feita:** a página inicial tem barra lateral com **as salas deste navegador** (decisão do usuário: a chave E2EE fica só no link, então a lista é local; em outro aparelho começa vazia) e, para o admin, as salas fixas com a chave guardada neste navegador. Cada sala mostra se está no ar e quantas pessoas há; salas encerradas somem, e dá para esquecer uma sala.
  - A lista fica no `localStorage` (`public/rooms-local.js`), com o link completo; o de quem é anfitrião inclui a chave de anfitrião (antes ficava só na aba). `POST /api/rooms/status` (só com conta, até 50 códigos) diz quais seguem no ar sem trazer de volta uma sala fixa vazia. O token passou a informar o tipo e o nome da sala fixa.
  - "Criar sala" abre uma janela com dois cartões (Jogando juntos / Live): um clique no cartão cria com os padrões; "Mais opções" fica recolhido. A tela de entrada do anfitrião já mostra o link de convite com "Copiar": em 2 cliques a sala existe e o link está na tela (copiar é o 3º).
  - Testes em `app/test/home.test.js` (inclui teclado, Voltar do navegador e celular).
  - **Parte 2 feita:** configuração inicial em 3 passos (código, administrador, servidor), com barra de progresso, Voltar sem perder dados e cada passo no histórico (`#passo-2`), então o Voltar do navegador também funciona. O código é conferido já no passo 1 por `POST /api/setup/check`, que gasta o mesmo limite de tentativas da configuração. Um erro do servidor leva ao passo do campo que precisa mudar. Testes em `app/test/setup.test.js`.
  - **Parte 3 feita:** antessala na tela de entrada da sala, com prévia da câmera, barra de volume do microfone e escolha dos dispositivos (`public/preview.js`). Nada é pedido ao navegador sem clique. O que estiver ligado na prévia entra ligado na sala, se a pessoa puder falar ou aparecer; senão, ela é avisada no chat. A prévia é desligada ao entrar, e os dispositivos escolhidos passam para os ajustes da sala. No celular, o nome e o botão de entrar vêm antes da prévia. Testes em `app/test/lobby.test.js`.
  - **Parte 4 feita:** `/admin` com menu lateral (Geral, Salas fixas, Transmissores, Convites, Avançado), uma seção por vez, cada uma com endereço próprio (`/admin#salas`), então o Voltar do navegador volta à seção anterior. SSO e TURN ficam em **Avançado**; o TURN mostra se está ligado (o supervisor passa `TURN_DOMAIN` ao app, que só o mostra ao admin). No celular, o menu fica em cima. Testes em `app/test/admin-nav.test.js`; o teste de tradução confere cada seção.
  - **Parte 5 feita:** app instalável (PWA): `manifest.webmanifest` e `sw.js` na raiz, ícones 192/512 e um "maskable" para o Android, cor do app e metas do iPhone em todas as páginas. O service worker só guarda a página "sem conexão" (com o visual do app); páginas, API e mídia sempre vêm do servidor. Na sala: tela cheia no iPhone pelo próprio vídeo (`webkitEnterFullscreen`), giro para paisagem no Android ao entrar em tela cheia e layout de celular deitado (vídeo na altura toda, chat ao lado). Sem compartilhamento de tela no navegador, o botão fica desligado e o chat aponta o guia em `/celular` (instalar, assistir, live só com câmera, scrcpy e AirPlay). Corrigido: com vídeo tocando, o tamanho natural dele esticava a coluna da sala e empurrava os botões para fora da tela (`.stage` sem `min-height: 0`). Testes em `app/test/pwa.test.js`.
  - **Item 5 concluído.** Falta testar em aparelhos reais (Android e iPhone): instalar na tela inicial, tela cheia e paisagem. O navegador dos testes só simula o celular.

- **Item 6 feito (15/11/2026), menos o modo rede local do instalador (vai com o item 7):**
  - `TLS=custom`: certificado próprio em `/data/certs/cert.pem` e `key.pem` (ou `TLS_CERT`/`TLS_KEY`). Ao subir, o supervisor confere leitura, formato, se a chave é do certificado, se vale para `DOMAIN` e `TURN_DOMAIN` e se não venceu, com mensagem clara. Troca no disco é carregada em até 1 min (`caddy reload`); um certificado novo com problema é recusado e o anterior continua.
  - Etapa 6 (sem domínio): com `DOMAIN` sendo um IP e `TLS=acme`, o Caddy pede o certificado do IP pelo perfil `shortlived`. Testado só a configuração gerada; **falta confirmar a emissão numa VPS real**. nip.io documentado como reserva.
  - Guias em `docs/instalacao.md`: sem domínio, certificado da empresa, sem internet (`docker save`/`load`, `NODE_IP` obrigatório) e homelab (upload, CGNAT, IP de casa exposto).

- **Item 7 feito (15/11/2026), sem o botão da Hostinger (decisão do usuário: fica para depois):**
  - `install.sh` na raiz (`sudo bash -c "$(curl …)"`; o `curl … | sudo bash` não recebe o teclado no Ubuntu 25.10, com sudo-rs 0.2.8): confere sistema e arquitetura, instala o Docker pelo get.docker.com se faltar, pergunta o modo (domínio, IP sem domínio, rede local, atrás de proxy; sugere o proxy se 80/443 estiverem ocupadas e aponta o guia se achar o `coolify-proxy`), confere o DNS do domínio, abre ufw/firewalld, gera `/opt/overshoulder/compose.yml` e `.env` (644, sem segredos; precisa ser legível para `overshoulder status` sem sudo) com a imagem do GHCR, sobe e mostra endereço, código e portas do painel do provedor. Sem perguntas com `MODE`/`DOMAIN`/`OVERSHOULDER_YES=1`.
  - Comando `overshoulder` do servidor: `update`, `status`, `logs`, `config-code`, `reset-admin`, `backup`, `uninstall [--purge]`.
  - A imagem informa a versão (`APP_VERSION`, da tag; local = `dev`) e o `INSTALL_METHOD` de cada caminho (installer, compose-build, coolify).
  - Teste em `scripts/test-installer.sh`: instala de verdade a partir de um registro local, atualiza para uma imagem nova e desinstala.
  - **O endereço do instalador e a imagem só funcionam com o repositório e o pacote do GHCR públicos.** Até lá, testar com `OVERSHOULDER_IMAGE` apontando para uma imagem acessível.
  - Teste das portas pelo navegador do admin (teste WebRTC na configuração) ainda não feito.

- **Tipo de conexão na sala (15/11/2026):** os ajustes mostram se o vídeo passa por UDP, TCP ou TURN (estatísticas do WebRTC do par de candidatos escolhido, `public/connection-type.js`), e o chat avisa uma vez quando não é UDP. Serve de teste das portas para quem administra. Lê `room.engine.pcManager` (interno do livekit-client): conferir ao atualizar a biblioteca.

- **Etapa 8 feita (15/11/2026): painel de uso.** `/admin` → Uso: GB enviados no mês (UTC), salas no ar e pessoas conectadas, franquia opcional com aviso a partir de 80% (painel, página inicial do admin e logs) e histórico de 12 meses no `state.json`. Fonte: `livekit_packet_bytes{direction="outgoing"}` do Prometheus do LiveKit (porta 6789, só em 127.0.0.1 por causa de `bind_addresses`), lido a cada minuto; o app soma as diferenças e trata o reinício do contador. Testes em `app/test/usage.test.js` (LiveKit falso) e na imagem.
  - O mês é o do calendário (UTC). Se alguém pedir, dá para escolher o dia em que o ciclo do plano vira.

- **Etapa 9 feita (15/11/2026): aviso de nova versão.** `app/update-check.js` consulta `releases/latest` do GitHub uma vez por dia (1 min depois de subir), aceita só versão semântica publicada e link das releases do próprio projeto. `/admin` → Geral mostra a versão, o aviso, as notas e os passos da forma de instalação (`INSTALL_METHOD`), com as outras recolhidas; a página inicial do admin mostra o aviso. Desliga no admin (`updateCheck`) ou com `UPDATE_CHECK=off`; versão `dev` não consulta. Testes em `app/test/update.test.js`.
  - Com o repositório privado, a consulta recebe 404 e o painel mostra "não foi possível consultar". Funciona quando o repositório abrir.

- **Sala privada (15/11/2026, pedido do usuário):** opção em "Mais opções" ao criar sala. A sala privada não fica guardada no navegador (a chave de anfitrião fica só na aba) e acaba quando o anfitrião sai por mais de 30 s (`PRIVATE_GRACE_MS`), tolerância para recarregar a página ou a rede cair. Ao fechar a aba, o anfitrião avisa o servidor (`POST /api/rooms/host-left`, com a chave de anfitrião), porque o LiveKit leva ~22 s para notar a queda. Antes de o anfitrião entrar pela primeira vez, a sala não acaba. Na página inicial, "Ao sair, esquecer as salas deste navegador". Testes em `app/test/home.test.js`.

### Design, site e inglês por padrão (18/11/2026)
- Decisões do usuário: o app mantém JS puro e adota o visual no estilo shadcn (referências em memória: shadcn, Radix, Sonner, Vaul, cmdk, Magic UI…); o site usa Astro + Starlight; **inglês é o padrão** no site, no GitHub e nas rotas, com português opcional detectado pelo navegador.
- ✅ Rotas em inglês (`/setup`, `/account`, `/invite`, `/signup`, `/reset`, `/new-password`, `/mobile`); as antigas respondem 301.
- ✅ Guias em inglês em `docs/`, português em `docs/pt-BR/` (mesmos nomes de arquivo).
- ✅ Logo novo (opção "E": pessoa de costas com headset olhando a tela).
- ✅ Site em https://dionatansimioni.github.io/overshoulder/ (`site/`, fluxo `site.yml`). Exige o repositório público (GitHub Pages em repositório privado depende de plano pago).
- ✅ Fim da sala: anfitrião e quem tem conta voltam ao início; quem assiste vê "A live acabou".
- ✅ Modo proxy redireciona `http://` para `https://` (o Coolify atende os dois).
- ✅ Redesign do app no estilo shadcn (JS puro); `scripts/screenshots.sh` tira capturas das telas.
- ✅ Anunciar no Discord (opção A, decidida pelo usuário): webhook do canal em `/admin`, botão na sala, envio direto do navegador (o servidor não vê o link). Bot com `/live` (opção B) ficou para depois: o servidor passaria a conhecer a chave das salas criadas pelo bot.
- ✅ Corrigido: `/api/admin/settings` devolvia o segredo do cliente do SSO.
- ✅ Preparação para a Hostinger: `deploy/hostinger/compose.yml` sem variáveis obrigatórias (DOMAIN vazio → IP público por STUN, certificado no IP), botão "Deploy on Hostinger" no README e no site, material de cadastro em `deploy/hostinger/README.md`. **Falta testar numa VPS da Hostinger** e o usuário fazer o cadastro no catálogo.
- Pendente: gravação com estalos (mistura do AudioContext) e vídeo travado; aguarda o `ffprobe` do usuário. Nota: esta máquina é uma VM sem AVX2: o compilador do Astro 7 e o Pagefind não rodam nativos aqui (`site/build.sh` contorna).

### Interface da sala e da conta (18/11/2026, pedidos do usuário)
- ✅ Olho para mostrar a senha em todo campo de senha (um `span role="button"`, não `<button>`, para não virar o primeiro botão do formulário) e "Salvar a senha neste navegador" no login (guarda só o usuário no navegador; a senha vai para o gerenciador de senhas via `PasswordCredential`, quando existe).
- ✅ Sala no celular no estilo YouTube/Twitch: em pé, vídeo no topo, controles logo abaixo e chat no resto, sem a página rolar; deitado, chat ao lado que pode ser escondido (botão também no computador); Ajustes como folha que sobe de baixo.
- ✅ Quem só assiste não vê os selos "fulano está apresentando" e "microfone ligado" sobre o vídeo.
- ✅ Ícone do volume silencia e devolve o som (guarda o volume escolhido).
- ✅ Cadastro "Só por convite": a página inicial mostra "Servidor privado" e o link do site, sem login; quem tem conta entra por `/login`.
- ✅ Na Live, "pedir a palavra" e "pedir a tela" só aparecem se o anfitrião ligar (Pessoas › Pedidos do público; `POST /api/rooms/allow-requests`; o servidor recusa pedido desligado com 403).
- ✅ Convite em botões com ícone (Copiar convite, Novo link, Discord); o link não aparece, o botão copia e um aviso (estilo Sonner) diz onde colar.
- ✅ X de esquecer sala fica vermelho no hover; botões de navegação com ícones.
- ✅ Aba "Sobre" no painel: versão, créditos (Dionatan Simioni), licença AGPL v3, LiveKit e Caddy.
- ✅ Aba "Registro" para o anfitrião (entrou, saiu, pedidos, sala de espera…); o chat fica só com conversas. Quem assiste não tem a aba.
- ✅ Pessoas na sala: olho com o número (o texto completo fica no `title`).
- ✅ (19/11) Na Live, o anfitrião destaca na tela a pergunta de alguém do chat (estrela na mensagem; cartão sobre o vídeo para todos, inclusive quem entra depois). Vai pelo LiveKit como o chat (tópico `highlight`), só vale vindo de identidade `h-`; o servidor não guarda.
- ✅ (19/11) Volume: barra recolhida que abre ao passar o mouse, número de 0 a 100% ao arrastar, mudo leva a barra a zero (vermelha) e devolve o volume anterior.
- ✅ (19/11) Botão Voltar em Administração e Minha conta (volta à seção ou página anterior; numa aba aberta pela sala, fecha a aba).
- ✅ (19/11) Configurar sem sair da live: Administração e Minha conta da gaveta da sala abrem em outra aba. Limite de pessoas por sala ajustável com ela no ar (`POST /api/rooms/limit`, conferido na entrada pelo servidor; o LiveKit fica só com o teto de 5000) e o do servidor vale na hora para as salas no ar.
- ✅ (19/11) Jogando juntos: "Qualquer um pode mostrar a tela" ligável com a sala no ar (`POST /api/rooms/open-screens`).
- ✅ (19/11) Administração: Voltar, Página inicial e Minha conta no topo, separador e seções com ícones. Na página inicial, Minha conta e Administração num menu "Configurações".
- ✅ (19/11) Suas salas: ícone do tipo (controle, antena) com o ponto de ao vivo; dois cliques no nome dão um apelido (só neste navegador).
- ✅ (19/11) Logo novo (opção 4 "Cor" de quatro mostradas): fundo em gradiente da marca, tela translúcida e a pessoa em uma linha só, com a cabeça como O e os ombros como um S deitado. `icon.svg` gera os PNGs com `rsvg-convert`: 192 e 512 com cantos, 180 (iPhone) sem cantos e o maskable do Android com o desenho dentro do círculo seguro. O site usa os mesmos arquivos.
- ✅ (19/11) Link velho (sala encerrada ou link trocado): `POST /api/rooms/check` responde antes da tela de entrada e, se a sala não existe, aparece "Essa sala não existe mais" com o botão da página inicial, a dica de falar com o anfitrião e, para quem não tem sessão, o atalho para `/login`. A verificação não traz sala fixa de volta ao ar.

### Playtests de 19/11/2026 (v0.2.7)
- ✅ Cursor sumindo no Valorant: a captura passa a pedir `video: { cursor: 'always' }` ao `getDisplayMedia`. **Falta confirmar no Windows com o jogo.** Se continuar, o jogo desenha o próprio cursor e a captura de janela não o vê (compartilhar a tela inteira resolve).
- Decisão do usuário: os avisos do sistema **continuam no chat** (a ideia de mandá-los para o Registro foi testada e desfeita).
- ✅ **Gravação virou recurso experimental, desligada por padrão.** Liga em Administração › Geral (padrão do servidor, `settings.recording`, informado no token) ou nos ajustes da sala (`localStorage.recording`, vale mais que o padrão). Os dois mostram o aviso de que gravar enquanto transmite pesa no computador.
- ✅ **MP4 que abre em qualquer player:** `public/mp4.js` reescreve o MP4 fragmentado do MediaRecorder como MP4 comum (ftyp + moov com tabelas + mdat, sem recodificar; o mdat é montado com fatias do Blob). Vale no download e no arquivo da pasta (reescrito ao parar; se falhar, fica o original). Comparado com o ffmpeg: mesmos pacotes e duração, com B-frames. Testes em `mp4.test.js` (fixture `fixtures/fragmented.mp4`) e `recording.test.js`.
- **Não resolvido:** janela de jogo em tela cheia exclusiva grava um quadro só (o Chrome só entrega quadros quando a janela muda). Documentado; sem correção limpa no navegador. Uma gravação em taxa fixa por `canvas.captureStream` pesaria no PC de quem joga e não resolve se nenhum quadro chegar.
- A suspeita de estalos no áudio (mistura do `AudioContext`) segue aberta.

### Primeiro teste numa VPS real (17/11/2026, Hostinger, Ubuntu 26.04)
- ✅ Instalador travava no `curl … | sudo bash` (teclado e CTRL+C não chegavam). Reproduzido no Ubuntu 25.10 (sudo-rs 0.2.8); no container do 26.04 não reproduziu. Comando documentado virou `sudo bash -c "$(curl …)"`, e o instalador para com explicação se não conseguir ler o terminal.
- ✅ Instalador, comando `overshoulder` e `cli.js` em inglês e português (`LANG` ou `OVERSHOULDER_LANG`; inglês por padrão).
- ✅ Firewall: na Hostinger o do painel só vale se aplicado; no Oracle Cloud vem fechado (só SSH). Mensagem e guia ajustados.
- ✅ Áudio do jogo no Linux: o Chrome esconde os "Monitor of …" de propósito; o chat mostra o comando `module-remap-source` que cria a fonte "Overshoulder-jogo" (conferido com PipeWire e Chromium num container).
- ✅ "Convites" do painel virou "Convidar transmissor"; links abaixo de "Conectado como" viraram botões.
- **Gravação com áudio estalando e vídeo travado** (só no arquivo; Chrome, Fedora 45, 720p, própria tela). Medido em container com carga: a mistura do `AudioContext` estala (gravar a faixa direto, não); `latencyHint: 'playback'` não ajudou ali, mas o container não tem placa de som. Vídeo: suspeita do segundo codificador H.264 (6 Mbps, no processador), sem medida. Próximo passo: o usuário manda o `ffprobe` do arquivo; versão de teste com `latencyHint: 'playback'` e `sinkId: { type: 'none' }` na mistura e gravação a 30 fps com bitrate menor.
- Idioma pelo navegador já existia (a escolha salva no seletor tem prioridade); falta o usuário dizer o que viu.

### Lapidações pedidas em 15/11/2026 (testes do usuário)
Ordem de execução, um commit por item:
1. ✅ **Removido da sala:** quem é removido vai para uma tela "A live foi encerrada. Se isso foi um engano, entre em contato com o dono do servidor." (sem dizer que o anfitrião removeu).
2. ✅ **Administração com botões:** os itens clicáveis do `/admin` (menu, Voltar, Minha conta) viram botões, não links simples.
2b. ✅ **Logo novo e paleta da interface** (pedido depois): logo melhorado com **#9732F6** (roxo) e **#1DF0FC** (ciano), que passam a ser a referência de cores do app inteiro. Feito antes dos itens visuais seguintes para não refazer o visual duas vezes.
3. ✅ **Sala só de voz:** quando ninguém transmite tela ou câmera, o espaço do vídeo mostra uma imagem (quem está na sala e quem está falando), não uma tela preta.
3b. ✅ **Barra de controles reordenada** para quem transmite: à esquerda as entradas (microfone, câmera, tela ou janela); à direita volume, tela cheia, gravar, ajustes e, por último, encerrar. Resolução e taxa de bits ficam nos ajustes.
4. ✅ **Microfone funcionando:** indicador de volume visível para quem transmite.
5. ✅ **Prévia de quem transmite:** mostra a qualidade real enviada (resolução, fps e Mbps). Trocar a qualidade vale na hora, sem parar o compartilhamento nem recarregar a aba. Opção de esconder a própria tela (desfocada, sem reproduzir) e mostrar de novo. Observação: a prévia própria é local e não usa banda do servidor; esconder economiza processamento do computador de quem joga.
6. ✅ **Qualidade para quem assiste:** "Automática" ou uma das camadas que quem transmite está enviando, nunca acima; troca na hora.
7. ✅ **Avisos de rede para quem transmite:** quando a conexão não sustenta a qualidade escolhida (o navegador limita por banda), sugerir uma mais baixa com um clique; avisar perda de pacotes alta.
8. ✅ **Barra lateral recolhível na sala** (como o Discord) para quem tem conta: salas, criar sala, administração e conta, sem sair da sala por engano.
9. ✅ **Gravação gera arquivo quebrado:** (resolvido: os arquivos decodificavam no ffmpeg, mas o MP4 baixado usava áudio Opus e o WebM da pasta saía sem duração, o que muitos programas não abrem. Agora a preferência é MP4 com AAC, depois MP4 com Opus, e o WebM recebe a duração ao terminar; a pasta também grava MP4, porque o navegador só grava o arquivo final ao fechar. Trocar a qualidade no meio não divide mais a gravação. O Chromium não grava AAC; o Chrome do Windows e do Mac costuma gravar, e no Linux não foi confirmado.) Pedido original: investigar e corrigir, com teste que abre o arquivo gravado (ffprobe).
10. ✅ **Áudio do computador no Linux:** (causa: o "Áudio do jogo" só era lido ao começar a compartilhar; escolher depois não fazia nada. Agora vale na hora, os ajustes mostram de onde o áudio está saindo e, no Linux, o chat explica onde escolher o "Monitor of …". Corrigido junto: o `<audio>` de cada faixa que saía ficava na página.) Pedido original: o usuário escolheu o "Monitor of …" e o áudio não funcionou. Investigar o caminho inteiro e corrigir.
11. ✅ **Documentação em `docs/`** (decisão do usuário: pasta no repositório, não a Wiki), estilo wiki: instalar, configurar, opções do servidor, recuperar a senha, gerir usuários e salas.

### Ordem de implementação (novo foco)
1. **Tipos de sala, várias telas e webcam:** "Jogando juntos" (voz para todos, várias telas, escolher qual assistir) e "Live" (pedir a palavra e pedir para mostrar a tela), com webcam e picture-in-picture para quem apresenta e gravação em arquivos separados.
2. **Convites de sala:** limite com ingresso, validade, senha, convites nomeados e revogáveis, sala de espera.
3. **Salas fixas e cadastro de transmissores** com fila de aprovação.
4. **Padrões de qualidade:** 720p, aviso de banda, padrão e qualidade máxima no admin, limite de pessoas sem teto baixo.
5. **Interface e navegação:** barra lateral, configuração inicial em passos, criar sala numa janela com cartões, antessala, `/admin` com menu lateral (SSO e TURN em "Avançado") e os critérios de usabilidade. Junto, o PWA e o celular (tela cheia no iPhone, paisagem, guia de jogos mobile pelo PC).
6. **Rede local e homelab:** certificado próprio (`TLS=custom`), modo rede local no instalador, guia de instalação sem internet e o aviso sobre o IP de casa exposto.
7. **Instalador de um comando** e botão da Hostinger.
8. **Validação numa VPS real** antes de divulgar (TURN, SSO com provedor real, certificado no IP).

### Lacunas encontradas ao documentar (15/11/2026)
- ✅ (15/11/2026) O admin gera um **link de nova senha** para o transmissor (uso único, 24 h, `/nova-senha`); o 2FA continua e a página não abre sessão. Testes em `app/test/password-reset.test.js`.
- A documentação em `docs/` está só em português; o README tem versão em inglês.

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
| Proxy | Caddy embutido por padrão. Modo "já tenho proxy" (`TLS=proxy`) se 80/443 estiverem ocupadas; precisa funcionar no Coolify e similares |
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
- Modo "já tenho proxy": feito como `TLS=proxy` (o Caddy sobe só em HTTP, para manter as rotas `/rtc` e do site); configurações prontas em `docs/proxy.md`.

### 7. Instalador de um comando
- `sudo bash -c "$(curl -fsSL https://…/install.sh)"` em Ubuntu e Debian:
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
