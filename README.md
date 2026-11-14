# Overshoulder

Compartilhamento de tela para jogar com os amigos, direto no navegador. Quem transmite e quem assiste só precisam abrir um link.

- **Baixa latência:** WebRTC via [LiveKit](https://livekit.io) (SFU self-hosted).
- **Criptografia de ponta a ponta:** a chave da sala é gerada no navegador e fica só no `#` do link, então nunca chega ao servidor. O servidor repassa vídeo cifrado que ele mesmo não consegue abrir.
- **Salas de até 16 pessoas por padrão** (configurável): quem transmite envia uma única cópia e o servidor distribui. Com simulcast, cada amigo recebe a qualidade que a conexão dele aguenta.
- **Microfone de quem transmite:** o anfitrião liga a voz com um botão, com ou sem a tela compartilhada, e os espectadores veem o aviso “Microfone ligado”.
- **Chat de texto** na sala. Ele passa pelo servidor com TLS e *não* tem E2EE.

## Como funciona

```
Navegador (anfitrião) ──1 cópia cifrada──▶ servidor: LiveKit ──▶ navegadores dos amigos
                                              ▲
                     app (Node): cria salas, emite tokens
                     Caddy: HTTPS automático
```

Tudo roda numa **imagem Docker única**. Dentro dela, um supervisor sobe o LiveKit, o app e o Caddy, reinicia quem cair ou travar e guarda os segredos internos no volume `/data`.

- **Criar sala:** exige a *senha do servidor*, para que ninguém de fora use o seu servidor.
- **Link do anfitrião:** `/r/<sala>#k=<chave>&h=<chave-de-anfitrião>`. Só ele pode transmitir e encerrar a sala.
- **Link dos amigos:** `/r/<sala>#k=<chave>`. Só assistem e usam o chat.
- A sala some 5 minutos depois de ficar vazia, ou na hora, em "Encerrar sala".

## Subindo no servidor

Requisitos: Docker e um domínio (ou subdomínio) apontando para o IP do servidor.

```bash
docker build -t overshoulder .
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.seudominio.com \
  -e CREATE_PASSWORD='uma senha forte' \
  overshoulder
```

Ou com o Compose: `./setup.sh` gera o `.env` e `docker compose up -d --build` sobe.

| Variável | Padrão | Uso |
|---|---|---|
| `DOMAIN` | (obrigatória) | Domínio ou IP do servidor |
| `CREATE_PASSWORD` | (obrigatória) | Senha para criar salas |
| `TLS` | `acme` | `acme` = Let's Encrypt; `local` = certificado próprio (rede local) |
| `NODE_IP` | descoberto sozinho | IP que o WebRTC anuncia aos navegadores (use na rede local) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Portas do site; mapeie as mesmas no `-p` |
| `MAX_PARTICIPANTS` | `16` | Limite de pessoas por sala (2 a 500) |

Libere no firewall:

| Porta | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | site + HTTPS (Caddy) |
| 7881 | TCP | WebRTC por TCP (redes que bloqueiam UDP) |
| 7882 | UDP | mídia WebRTC |

**Banda:** o servidor envia aproximadamente `bitrate × espectadores`. Em 1080p60 (cerca de 7 Mbps) com 10 amigos, são uns 70 Mbps de saída, perto de 30 GB por hora. Vale conferir a franquia do seu plano.

**Saúde e logs:** `GET /healthz` responde `{"status":"ok"}` e alimenta o healthcheck do Docker. `docker logs overshoulder` mostra os logs em JSON, um por linha, sem senhas, nomes nem IDs de sala.

## Rede local (LAN)

`./setup.sh`, opção 2 (detecta o IP da máquina), e `docker compose up -d --build`.

Acesse `https://<seu-ip>`. Precisa ser HTTPS: os navegadores bloqueiam compartilhamento de tela e criptografia em `http://` fora do `localhost`. Com `TLS=local`, o Caddy gera um certificado próprio, então na primeira vez cada navegador mostra um aviso ("Avançado" > "Continuar").

Para remover o aviso de vez num aparelho, instale a CA do Caddy nele:
`docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt`

## Desenvolvimento

`./scripts/test.sh` roda todos os testes: gitleaks, servidor, segurança, navegador e a imagem Docker.

## Áudio do jogo

- **Windows (Chrome/Edge):** ao escolher "Tela inteira", marque "Compartilhar áudio do sistema".
- **Linux:** o navegador só captura áudio de *abas*. Para o áudio do jogo, abra os ajustes da transmissão na sala, clique em “Listar” e escolha em “Áudio do jogo” o dispositivo **"Monitor of …"** da sua saída de som (PipeWire/PulseAudio). Ele é enviado em estéreo, sem filtros de voz.
  Dica: para não transmitir o som do Discord ou de outros apps, crie uma saída virtual só para o jogo:
  `pactl load-module module-null-sink sink_name=jogo` e escolha "Monitor of jogo".

## Dicas de qualidade

- **H.264** costuma usar o encoder de hardware da GPU e é o mais leve enquanto você joga.
- **AV1/VP9** dão imagem melhor no mesmo bitrate, mas pesam mais na CPU se a GPU não tiver encoder para eles.
