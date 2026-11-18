# Overshoulder

[English](README.md) · **Português**

Compartilhamento de tela self-hosted, direto no navegador: para jogar com os amigos, fazer lives e dar treinamentos. Quem transmite e quem assiste só precisam abrir um link.

- **Baixa latência:** WebRTC via [LiveKit](https://livekit.io) (SFU self-hosted).
- **Criptografia de ponta a ponta:** a chave da sala é gerada no navegador e fica só no `#` do link, então nunca chega ao servidor. O servidor repassa vídeo cifrado que ele mesmo não consegue abrir.
- **Salas de até 16 pessoas por padrão** (configurável até 5000): quem transmite envia uma única cópia e o servidor distribui. Com simulcast, cada espectador recebe a qualidade que a conexão dele aguenta.
- **Dois tipos de sala:** **"Jogando juntos"**, em que todos falam (como uma call) e várias pessoas mostram a tela ao mesmo tempo; e **"Live"**, em que só quem apresenta fala e a audiência usa o chat, podendo **pedir a palavra** ou **pedir para mostrar a tela**. Com várias telas ao vivo, cada pessoa escolhe qual assistir e só recebe essa.
- **Webcam sobre a tela:** quem apresenta liga a câmera, que aparece sobre a tela (picture-in-picture) no canto, tamanho e formato escolhidos. Quem assiste pode esconder a câmera ou inverter com a tela. Também dá para transmitir só a câmera.
- **Convites de sala:** o link padrão não tem limite. Em *Pessoas › Convites e entrada*, o anfitrião cria convites com nome (ex.: "Discord do clã"), limite de pessoas, validade e senha opcional, e revoga um convite (o link para de funcionar e quem entrou por ele sai da sala). Quem entra guarda um **ingresso** no navegador: recarregar ou cair a rede não gasta o convite de novo, nem depois de o link mudar. A **sala de espera** opcional faz cada pessoa aguardar o anfitrião deixar entrar.
- **Moderação:** na aba *Pessoas*, o anfitrião aprova pedidos, libera ou tira a fala e a tela de cada pessoa e remove alguém da sala. Também desliga o chat de quem assiste e gera um link novo para a sala.
- **Gravação no navegador do anfitrião:** grava o vídeo que está na tela (inclusive de quem recebeu a vez de apresentar) e todo o áudio da sala. O servidor nunca vê o conteúdo. No Chrome e no Edge, o arquivo vai para uma pasta escolhida; nos outros navegadores, é baixado ao parar. O formato é o que abre em mais programas: MP4 com áudio AAC quando o navegador consegue (Chrome no Windows e no Mac), MP4 com áudio Opus no Chromium (VLC, mpv, Kdenlive e Shotcut abrem) e WebM no Firefox, já com a duração gravada no arquivo. Para um editor que não aceita Opus, converta o áudio: `ffmpeg -i gravacao.mp4 -c:v copy -c:a aac gravacao-aac.mp4`. Tela (com o áudio) e câmera ficam em arquivos separados, para quem edita montar como quiser. Cada trecho de vídeo vira uma parte, e todos na sala veem o aviso **● Gravando**.
- **No celular:** dá para instalar o Overshoulder na tela inicial (app PWA, sem loja), assistir deitado em tela cheia e fazer live só com a câmera. Os navegadores de celular não compartilham a tela: o guia em `/mobile` explica como transmitir um jogo de celular pelo computador (scrcpy no Android, AirPlay no iPhone).
- **Chat de texto com emojis** na sala. Ele passa pelo servidor com TLS e *não* tem E2EE.
- **Contas com 2FA, transmissores convidados e login da empresa (SSO)**, descritos abaixo.
- **Interface em português e inglês**, escolhida pelo idioma do navegador (dá para trocar no rodapé).

**Documentação completa** (instalar, configurar, contas, salas, transmitir e solução de problemas): [docs/](docs/README.md).

## Como funciona

```
Navegador (quem apresenta) ──1 cópia cifrada──▶ servidor: LiveKit ──▶ navegadores de quem assiste
                                                   ▲
                          app (Node): contas, salas, tokens
                          Caddy: HTTPS automático
```

Tudo roda numa **imagem Docker única**. Dentro dela, um supervisor sobe o LiveKit, o app e o Caddy, reinicia quem cair ou travar e guarda os segredos internos no volume `/data`.

- **Criar sala:** exige login (administrador ou transmissor), para que ninguém de fora use o seu servidor.
- **Link do anfitrião:** `/r/<sala>#k=<chave>&h=<chave-de-anfitrião>`. Só ele modera, encerra a sala e libera fala e tela.
- **Link de quem assiste:** `/r/<sala>#k=<chave>`. Assiste e usa o chat.
- A sala some 5 minutos depois de ficar vazia, ou na hora, em "Encerrar sala".
- **Remover alguém** também troca o link do convite por onde a pessoa entrou e invalida o ingresso dela: quem já está assistindo continua, e quem ainda vai entrar por aquele convite precisa do link novo. Se a pessoa removida tentar voltar com a conexão antiga, o servidor a remove de novo em até 2 segundos.

## Subindo no servidor

O jeito mais fácil, em Ubuntu ou Debian:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh)"
```

O instalador pergunta se há domínio, abre o firewall, sobe o container e instala o comando `overshoulder` (`update`, `status`, `logs`, `backup`…). Detalhes em [docs/instalacao.md](docs/instalacao.md). Para Coolify, Dokploy, EasyPanel ou outro proxy já existente, veja [docs/proxy.md](docs/proxy.md).

Sem o instalador, com Docker e um domínio (ou subdomínio) apontando para o IP do servidor:

```bash
docker build -t overshoulder .
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.seudominio.com \
  overshoulder
```

Depois abra `https://live.seudominio.com/setup` para criar a conta de administrador. A página pede o **código de configuração**, que aparece nos logs (`docker logs overshoulder | grep setupCode`) enquanto o servidor não tiver administrador. Assim, só quem tem acesso ao servidor consegue fazer a configuração.

Ou com o Compose: `./setup.sh` gera o `.env` e `docker compose up -d --build` sobe.

| Variável | Padrão | Uso |
|---|---|---|
| `DOMAIN` | (obrigatória) | Domínio ou IP do servidor |
| `TLS` | `acme` | `acme` = Let's Encrypt; `local` = certificado próprio (rede local); `custom` = certificado seu (`TLS_CERT`, `TLS_KEY`); `proxy` = atrás de outro proxy, como o do Coolify ([guia](docs/proxy.md)) |
| `NODE_IP` | descoberto sozinho | IP que o WebRTC anuncia aos navegadores (use na rede local) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Portas do site; mapeie as mesmas no `-p`. Com `TLS=proxy`, só a `HTTP_PORT` é usada |
| `TRUSTED_PROXIES` | `private_ranges` | Só com `TLS=proxy`: de onde o IP e o protocolo de quem acessa são aceitos |
| `TURN_DOMAIN` | desligado | **Experimental.** Subdomínio para o TURN (ex.: `turn.live.seudominio.com`), para redes que só liberam a porta 443. Exige `HTTPS_PORT=443` e o subdomínio apontando para o servidor |
| `MAX_PARTICIPANTS` | `16` | Limite inicial de pessoas por sala, sugerido na configuração (2 a 5000) |

### Contas

- **Administrador:** criado em `/setup`. Muda as configurações em `/admin` e convida transmissores.
- **Transmissores:** pessoas autorizadas a criar salas e transmitir mesmo sem você presente. Em `/admin`, o admin escolhe o **modo de cadastro**: *só por convite* (link de uso único que vale 48 h), *com aprovação* (padrão: qualquer um pede em `/signup` e o admin aprova) ou *livre* (qualquer um cria conta e já transmite). Os cadastros sem convite têm limite por IP e um teto de contas esperando aprovação. **Revogar** desativa a conta e encerra na hora as sessões e as salas ao vivo dela.
- **Salas fixas:** o admin cria em `/admin` salas que não somem, com link e convites fixos (inclusive depois de reiniciar o servidor). A sala vai ao ar quando alguém entra; "Encerrar" tira todos, mas a sala continua. A chave de criptografia é gerada e guardada no navegador do admin, e o servidor nunca a vê; em outro navegador, o admin precisa do link ou de uma chave nova.
- **Espectadores:** não têm conta. Só precisam do link da sala (ou do login da empresa, se a sala exigir).
- **2FA (TOTP):** opcional e recomendado; cada um ativa em `/account` com um app autenticador. O admin pode **exigir 2FA** de todos. Os 10 códigos de recuperação valem uma vez cada, e só o admin gera um conjunto novo (ou remove o 2FA de quem perdeu o celular).
- **Login da empresa (SSO):** opcional, por OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…), configurado em `/admin`. Só entra quem tem e-mail dos domínios permitidos. Quem está no grupo de transmissores (ou na lista de e-mails) vira transmissor no primeiro login. Cada sala pode exigir o login da empresa para assistir, e aí o nome no chat é o nome real do provedor. O admin pode tornar isso padrão ou obrigatório. O administrador sempre entra com usuário e senha, para não ficar trancado fora se o provedor cair.
- **Senhas:** no mínimo 12 caracteres, sem conter o usuário e fora das ~30 mil senhas vazadas mais comuns.
- **Admin perdeu a senha ou o 2FA:** no servidor, rode `docker exec overshoulder overshoulder reset-admin` (instalador: `overshoulder reset-admin`; Coolify e similares: abra o *Terminal* do serviço e rode `overshoulder reset-admin`, ou use `docker exec $(docker ps -qf name=overshoulder) overshoulder reset-admin`). Ele mostra um link de uso único, válido por 15 minutos, que troca a senha e remove o 2FA do admin.
- **Transmissor esqueceu a senha:** o admin gera um **link de nova senha** em `/admin` › Transmissores (uso único, 24 horas).

Libere no firewall:

| Porta | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | site + HTTPS (Caddy) |
| 7881 | TCP | WebRTC por TCP (redes que bloqueiam UDP) |
| 7882 | UDP | mídia WebRTC |

**Redes corporativas (TURN, experimental):** algumas empresas só liberam a porta 443, e aí o vídeo não passa pelas portas 7881/7882. Com `TURN_DOMAIN`, a própria porta 443 atende também `turn.<domínio>`, sem abrir nada além dela: o Caddy separa as conexões pelo nome e entrega as do TURN ao LiveKit. Os testes comprovam a divisão da porta, o certificado e a autenticação do TURN; a passagem do vídeo inteiro pelo TURN ainda precisa ser confirmada num servidor real.

**Banda:** o servidor envia aproximadamente `bitrate × espectadores`. Em 1080p60 (cerca de 7 Mbps) com 10 espectadores, são uns 70 Mbps de saída, perto de 30 GB por hora. Vale conferir a franquia do seu plano. As transmissões começam em **720p** (cerca de 3 Mbps por espectador); em `/admin`, o administrador escolhe a qualidade padrão e a máxima permitida. Acima de 720p, a sala mostra a banda estimada, e o painel destaca a estimativa de salas com muitas pessoas.

**Saúde e logs:** `GET /healthz` responde `{"status":"ok"}` e alimenta o healthcheck do Docker. `docker logs overshoulder` mostra os logs em JSON, um por linha, sem senhas nem IDs de sala. Eventos de segurança das contas (login, falha de login, senha alterada) registram o nome de usuário, para investigar acessos indevidos; espectadores nunca aparecem nos logs.

## Rede local (LAN)

`./setup.sh`, opção 2 (detecta o IP da máquina), e `docker compose up -d --build`.

Acesse `https://<seu-ip>`. Precisa ser HTTPS: os navegadores bloqueiam compartilhamento de tela e criptografia em `http://` fora do `localhost`. Com `TLS=local`, o Caddy gera um certificado próprio, então na primeira vez cada navegador mostra um aviso ("Avançado" > "Continuar").

Para remover o aviso de vez num aparelho, instale a CA do Caddy nele:
`docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt`

## Áudio do jogo

- **Windows (Chrome/Edge):** ao escolher "Tela inteira", marque "Compartilhar áudio do sistema".
- **Linux:** o navegador só captura áudio de *abas*. Para o áudio do jogo, abra os ajustes da transmissão na sala, clique em “Listar” e escolha em “Áudio do jogo” a fonte do som do computador. Ele é enviado em estéreo, sem filtros de voz.
  - **Firefox:** escolha o **"Monitor of …"** da sua saída de som (PipeWire/PulseAudio).
  - **Chrome, Chromium, Edge e Brave:** eles escondem de propósito os "Monitor of …". Rode no terminal o comando abaixo, clique em “Listar” de novo e escolha **"Overshoulder-jogo"** (o chat da sala mostra o mesmo comando, com botão de copiar):
    `pactl load-module module-remap-source master="$(pactl get-default-sink).monitor" source_name=overshoulder_jogo source_properties=device.description=Overshoulder-jogo`
  - Para transmitir só o jogo, sem o Discord ou outros apps, veja [docs/transmitir.md](docs/transmitir.md#áudio-do-jogo).

## Dicas de qualidade

- **H.264** costuma usar o encoder de hardware da GPU e é o mais leve enquanto você joga.
- **AV1/VP9** dão imagem melhor no mesmo bitrate, mas pesam mais na CPU se a GPU não tiver encoder para eles.

## Versões e cadeia de fornecimento

Cada versão (tag `vX.Y.Z`) é publicada pelo GitHub Actions como `ghcr.io/dionatansimioni/overshoulder`, para amd64 e arm64, só depois de passar a suíte completa de testes e a varredura de vulnerabilidades (o Trivy bloqueia falhas altas ou críticas que já têm correção). O LiveKit e o Caddy são compilados do código-fonte, com dependências atualizadas. Toda imagem é assinada pelo Sigstore (sem chave) e leva SBOM (CycloneDX) e proveniência da compilação. Para conferir a assinatura:

```bash
cosign verify ghcr.io/dionatansimioni/overshoulder:<versão> \
  --certificate-identity-regexp '^https://github.com/dionatansimioni/overshoulder/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Desenvolvimento

`./scripts/test.sh` roda todos os testes: gitleaks, servidor, segurança, navegador, tradução e a imagem Docker. `./scripts/scan.sh <imagem>` roda a mesma varredura de vulnerabilidades da publicação.

## Licença

[AGPL-3.0](LICENSE).
