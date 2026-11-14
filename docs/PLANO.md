# Plano: Owncord → Overshoulder, com deploy fácil

Decidido em 08/11/2026. Ponto de partida para continuar o trabalho: nada daqui foi implementado ainda.

## Onde paramos

- Nome e ícone ainda são **Owncord** (cabo saindo da tela). A troca para Overshoulder é a etapa 1.
- O projeto **não está no git**.
- A pasta do projeto foi renomeada em 14/11/2026 para `/home/diolinux/claude/overshoulder` (antes `owncord`). Em 14/11/2026 a instância de teste foi religada na pasta nova (containers `overshoulder-*`). Para subir de novo nesta máquina, o Discourse ocupa a porta 80, então use a 8443: `export CADDY_GLOBAL_OPTIONS=$'local_certs\nhttp_port 8081\nhttps_port 8443' LIVEKIT_PUBLIC_URL=wss://192.168.0.102:8443` e depois `docker compose up -d --build`.
- O `.env` local tem a senha `senha-teste`: só serve para testes.
- A transmissão real (vídeo, áudio, E2EE e chat) ainda não foi testada num navegador, nem antes nem depois da troca de nome.

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
