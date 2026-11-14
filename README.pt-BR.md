# Overshoulder

[English](README.md) · **Português**

Compartilhamento de tela self-hosted, direto no navegador: para jogar com os amigos, fazer lives e dar treinamentos. Quem transmite e quem assiste só precisam abrir um link.

- **Baixa latência:** WebRTC via [LiveKit](https://livekit.io) (SFU self-hosted).
- **Criptografia de ponta a ponta:** a chave da sala é gerada no navegador e fica só no `#` do link, então nunca chega ao servidor. O servidor repassa vídeo cifrado que ele mesmo não consegue abrir.
- **Salas de até 16 pessoas por padrão** (configurável até 500): quem transmite envia uma única cópia e o servidor distribui. Com simulcast, cada espectador recebe a qualidade que a conexão dele aguenta.
- **Microfone de quem transmite:** a voz liga com um botão, com ou sem a tela compartilhada, e os espectadores veem o aviso “Microfone ligado”.
- **Moderação:** na aba *Pessoas*, o anfitrião remove alguém da sala ou **passa a vez de apresentar** (tela e microfone) para outra pessoa e pega de volta. Também desliga o chat de quem assiste e gera um link novo para a sala.
- **Gravação no navegador do anfitrião:** grava o vídeo que está na tela (inclusive de quem recebeu a vez de apresentar) e todo o áudio da sala. O servidor nunca vê o conteúdo. No Chrome e no Edge, o arquivo é gravado numa pasta escolhida, a cada segundo (WebM), e o que já foi gravado fica salvo mesmo se o navegador fechar. Nos outros navegadores, o arquivo (MP4 quando possível) é baixado ao parar. Cada trecho de vídeo vira uma parte, e todos na sala veem o aviso **● Gravando**.
- **Chat de texto com emojis** na sala. Ele passa pelo servidor com TLS e *não* tem E2EE.
- **Contas com 2FA, transmissores convidados e login da empresa (SSO)**, descritos abaixo.
- **Interface em português e inglês**, escolhida pelo idioma do navegador (dá para trocar no rodapé).

## Como funciona

```
Navegador (quem apresenta) ──1 cópia cifrada──▶ servidor: LiveKit ──▶ navegadores de quem assiste
                                                   ▲
                          app (Node): contas, salas, tokens
                          Caddy: HTTPS automático
```

Tudo roda numa **imagem Docker única**. Dentro dela, um supervisor sobe o LiveKit, o app e o Caddy, reinicia quem cair ou travar e guarda os segredos internos no volume `/data`.

- **Criar sala:** exige login (administrador ou transmissor), para que ninguém de fora use o seu servidor.
- **Link do anfitrião:** `/r/<sala>#k=<chave>&h=<chave-de-anfitrião>`. Só ele modera, encerra a sala e passa a vez de apresentar.
- **Link de quem assiste:** `/r/<sala>#k=<chave>`. Assiste e usa o chat.
- A sala some 5 minutos depois de ficar vazia, ou na hora, em "Encerrar sala".
- **Remover alguém** também troca o link da sala: quem já está assistindo continua, e quem ainda vai entrar precisa do link novo. Se a pessoa removida tentar voltar com a conexão antiga, o servidor a remove de novo em até 2 segundos.

## Subindo no servidor

Requisitos: Docker e um domínio (ou subdomínio) apontando para o IP do servidor.

```bash
docker build -t overshoulder .
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.seudominio.com \
  overshoulder
```

Depois abra `https://live.seudominio.com/configurar` para criar a conta de administrador. A página pede o **código de configuração**, que aparece nos logs (`docker logs overshoulder | grep setupCode`) enquanto o servidor não tiver administrador. Assim, só quem tem acesso ao servidor consegue fazer a configuração.

Ou com o Compose: `./setup.sh` gera o `.env` e `docker compose up -d --build` sobe.

| Variável | Padrão | Uso |
|---|---|---|
| `DOMAIN` | (obrigatória) | Domínio ou IP do servidor |
| `TLS` | `acme` | `acme` = Let's Encrypt; `local` = certificado próprio (rede local) |
| `NODE_IP` | descoberto sozinho | IP que o WebRTC anuncia aos navegadores (use na rede local) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Portas do site; mapeie as mesmas no `-p` |
| `TURN_DOMAIN` | desligado | **Experimental.** Subdomínio para o TURN (ex.: `turn.live.seudominio.com`), para redes que só liberam a porta 443. Exige `HTTPS_PORT=443` e o subdomínio apontando para o servidor |
| `MAX_PARTICIPANTS` | `16` | Limite inicial de pessoas por sala, sugerido na configuração (2 a 500) |

### Contas

- **Administrador:** criado em `/configurar`. Muda as configurações em `/admin` e convida transmissores.
- **Transmissores:** pessoas autorizadas a criar salas e transmitir mesmo sem você presente. O admin gera em `/admin` um **convite de uso único** (vale 48 h), e a pessoa escolhe o próprio usuário e senha. **Revogar** desativa a conta e encerra na hora as sessões e as salas ao vivo dela.
- **Espectadores:** não têm conta. Só precisam do link da sala (ou do login da empresa, se a sala exigir).
- **2FA (TOTP):** opcional e recomendado; cada um ativa em `/conta` com um app autenticador. O admin pode **exigir 2FA** de todos. Os 10 códigos de recuperação valem uma vez cada, e só o admin gera um conjunto novo (ou remove o 2FA de quem perdeu o celular).
- **Login da empresa (SSO):** opcional, por OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…), configurado em `/admin`. Só entra quem tem e-mail dos domínios permitidos. Quem está no grupo de transmissores (ou na lista de e-mails) vira transmissor no primeiro login. Cada sala pode exigir o login da empresa para assistir, e aí o nome no chat é o nome real do provedor. O admin pode tornar isso padrão ou obrigatório. O administrador sempre entra com usuário e senha, para não ficar trancado fora se o provedor cair.
- **Senhas:** no mínimo 12 caracteres, sem conter o usuário e fora das ~30 mil senhas vazadas mais comuns.
- **Admin perdeu a senha ou o 2FA:** no servidor, rode `docker exec overshoulder overshoulder reset-admin`. Ele mostra um link de uso único, válido por 15 minutos, que troca a senha e remove o 2FA do admin.

Libere no firewall:

| Porta | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | site + HTTPS (Caddy) |
| 7881 | TCP | WebRTC por TCP (redes que bloqueiam UDP) |
| 7882 | UDP | mídia WebRTC |

**Redes corporativas (TURN, experimental):** algumas empresas só liberam a porta 443, e aí o vídeo não passa pelas portas 7881/7882. Com `TURN_DOMAIN`, a própria porta 443 atende também `turn.<domínio>`, sem abrir nada além dela: o Caddy separa as conexões pelo nome e entrega as do TURN ao LiveKit. Os testes comprovam a divisão da porta, o certificado e a autenticação do TURN; a passagem do vídeo inteiro pelo TURN ainda precisa ser confirmada num servidor real.

**Banda:** o servidor envia aproximadamente `bitrate × espectadores`. Em 1080p60 (cerca de 7 Mbps) com 10 espectadores, são uns 70 Mbps de saída, perto de 30 GB por hora. Vale conferir a franquia do seu plano.

**Saúde e logs:** `GET /healthz` responde `{"status":"ok"}` e alimenta o healthcheck do Docker. `docker logs overshoulder` mostra os logs em JSON, um por linha, sem senhas nem IDs de sala. Eventos de segurança das contas (login, falha de login, senha alterada) registram o nome de usuário, para investigar acessos indevidos; espectadores nunca aparecem nos logs.

## Rede local (LAN)

`./setup.sh`, opção 2 (detecta o IP da máquina), e `docker compose up -d --build`.

Acesse `https://<seu-ip>`. Precisa ser HTTPS: os navegadores bloqueiam compartilhamento de tela e criptografia em `http://` fora do `localhost`. Com `TLS=local`, o Caddy gera um certificado próprio, então na primeira vez cada navegador mostra um aviso ("Avançado" > "Continuar").

Para remover o aviso de vez num aparelho, instale a CA do Caddy nele:
`docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt`

## Áudio do jogo

- **Windows (Chrome/Edge):** ao escolher "Tela inteira", marque "Compartilhar áudio do sistema".
- **Linux:** o navegador só captura áudio de *abas*. Para o áudio do jogo, abra os ajustes da transmissão na sala, clique em “Listar” e escolha em “Áudio do jogo” o dispositivo **"Monitor of …"** da sua saída de som (PipeWire/PulseAudio). Ele é enviado em estéreo, sem filtros de voz.
  Dica: para não transmitir o som do Discord ou de outros apps, crie uma saída virtual só para o jogo:
  `pactl load-module module-null-sink sink_name=jogo` e escolha "Monitor of jogo".

## Dicas de qualidade

- **H.264** costuma usar o encoder de hardware da GPU e é o mais leve enquanto você joga.
- **AV1/VP9** dão imagem melhor no mesmo bitrate, mas pesam mais na CPU se a GPU não tiver encoder para eles.

## Desenvolvimento

`./scripts/test.sh` roda todos os testes: gitleaks, servidor, segurança, navegador, tradução e a imagem Docker.
