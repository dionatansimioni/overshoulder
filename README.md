# Overshoulder

Compartilhamento de tela para jogar com os amigos, direto no navegador. Quem transmite e quem assiste só precisam abrir um link.

- **Baixa latência:** WebRTC via [LiveKit](https://livekit.io) (SFU self-hosted).
- **Criptografia de ponta a ponta:** a chave da sala é gerada no navegador e fica só no `#` do link, então nunca chega ao servidor. A VPS repassa vídeo cifrado que ela mesma não consegue abrir.
- **Até ~15 pessoas por sala:** quem transmite envia uma única cópia e a VPS distribui. Com simulcast, cada amigo recebe a qualidade que a conexão dele aguenta.
- **Microfone de quem transmite:** o anfitrião liga a voz com um botão, com ou sem a tela compartilhada, e os espectadores veem o aviso “Microfone ligado”.
- **Chat de texto** na sala. Ele passa pelo servidor com TLS e *não* tem E2EE.

## Como funciona

```
Navegador (anfitrião) ──1 cópia cifrada──▶ VPS: LiveKit ──▶ navegadores dos amigos
                                              ▲
                     app (Node): cria salas, emite tokens
                     Caddy: HTTPS automático
```

- **Criar sala:** exige a *senha do servidor*, para que ninguém de fora use a sua VPS.
- **Link do anfitrião:** `/r/<sala>#k=<chave>&h=<chave-de-anfitrião>`. Só ele pode transmitir e encerrar a sala.
- **Link dos amigos:** `/r/<sala>#k=<chave>`. Só assistem e usam o chat.
- A sala some 5 minutos depois de ficar vazia, ou na hora, em "Encerrar sala".

## Subindo na VPS

Requisitos: Docker com Compose e um domínio (ou subdomínio) apontando para o IP da VPS.

```bash
./setup.sh                    # informe o domínio e a senha; gera o .env
docker compose up -d --build
```

Libere no firewall:

| Porta | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | site + HTTPS (Caddy) |
| 7881 | TCP | WebRTC por TCP (redes que bloqueiam UDP) |
| 50000–60000 | UDP | mídia WebRTC |

**Banda:** a VPS envia aproximadamente `bitrate × espectadores`. Em 1080p60 (cerca de 7 Mbps) com 10 amigos, são uns 70 Mbps de saída, perto de 30 GB por hora. Vale conferir a franquia do seu plano.

## Rede local (LAN)

```bash
./setup.sh                    # opção 2: detecta o IP da máquina
docker compose up -d --build
```

Acesse `https://<seu-ip>`. Precisa ser HTTPS: os navegadores bloqueiam compartilhamento de tela e criptografia em `http://` fora do `localhost`. O Caddy gera um certificado próprio, então na primeira vez cada navegador mostra um aviso ("Avançado" > "Continuar").

Para remover o aviso de vez num aparelho, instale a CA do Caddy nele:
`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt`

Se a máquina tiver firewall ativo, libere 80/443 TCP, 7881 TCP e 50000–60000 UDP.

## Testando só nesta máquina

`./setup.sh`, opção 3. Abra http://localhost:3000 e o link de convite em outra janela.

## Áudio do jogo

- **Windows (Chrome/Edge):** ao escolher "Tela inteira", marque "Compartilhar áudio do sistema".
- **Linux:** o navegador só captura áudio de *abas*. Para o áudio do jogo, abra os ajustes da transmissão na sala, clique em “Listar” e escolha em “Áudio do jogo” o dispositivo **"Monitor of …"** da sua saída de som (PipeWire/PulseAudio). Ele é enviado em estéreo, sem filtros de voz.
  Dica: para não transmitir o som do Discord ou de outros apps, crie uma saída virtual só para o jogo:
  `pactl load-module module-null-sink sink_name=jogo` e escolha "Monitor of jogo".

## Dicas de qualidade

- **H.264** costuma usar o encoder de hardware da GPU e é o mais leve enquanto você joga.
- **AV1/VP9** dão imagem melhor no mesmo bitrate, mas pesam mais na CPU se a GPU não tiver encoder para eles.
