# Solução de problemas

[← Documentação](README.md) · [English](../troubleshooting.md) · Português

## O site não abre ou o certificado falha

- O domínio precisa apontar para o IP do servidor **antes** de subir o container: o Let's Encrypt confere isso pela porta 80.
- As portas 80 e 443 precisam estar livres no servidor e liberadas no firewall (do sistema e do painel do provedor).
- Veja o motivo nos logs: `docker logs overshoulder | grep -i -e error -e tls`.
- Na rede local, o aviso de certificado é esperado com `TLS=local` (veja [Instalação](install.md#rede-local)).

## A página abre, mas o vídeo não chega

- Libere **7882/UDP** e **7881/TCP** no firewall do sistema e no painel do provedor.
- Na rede local, defina `NODE_IP` com o IP da máquina na rede.
- Redes de empresa ou faculdade que só liberam a 443 bloqueiam o vídeo. O `TURN_DOMAIN` (experimental) resolve isso; veja [Configuração](configuration.md#variáveis-do-servidor).

## "Link incompleto: falta a chave da sala"

O link perdeu a parte depois do `#` (alguns apps cortam). Peça o link de novo, copiando pelo botão "Copiar".

## Quem assiste não ouve o jogo (Linux)

Escolha a fonte do som do computador em Ajustes › Áudio do jogo e confira se os ajustes mostram "Enviando o áudio de: …". No Chrome e nos navegadores baseados nele, os "Monitor of …" não aparecem de propósito: rode o comando que o chat da sala mostra e escolha "Overshoulder-jogo". No Firefox, se o "Monitor of" não aparecer, clique em "Listar" de novo depois de permitir o microfone. Veja [Transmitir](broadcasting.md#áudio-do-jogo).

## A internet não dá conta

Siga o aviso de rede e baixe a qualidade, ou escolha 720p em Ajustes. Em casa, o limite costuma ser o upload: cada espectador em 720p usa ~3 Mbps.

## A gravação não abre no meu programa

- MP4 com áudio Opus (Chromium) não abre em alguns players e editores. Converta o áudio: `ffmpeg -i gravacao.mp4 -c:v copy -c:a aac gravacao-aac.mp4`.
- VLC, mpv, Kdenlive e Shotcut abrem todos os formatos que o Overshoulder grava.

## Esqueci a senha

- **Admin:** rode `reset-admin` no servidor; ele dá um link de uso único, válido por 15 minutos. O comando certo para cada tipo de instalação (inclusive Coolify) está em [Contas › Recuperar o acesso](accounts.md#o-admin-perdeu-a-senha-ou-o-2fa).
- **Transmissor:** o admin gera um **Link de nova senha** em `/admin` › Transmissores. Veja [Contas › Recuperar o acesso](accounts.md#transmissores-e-a-própria-senha).

## Não acho o código da primeira configuração

Ele fica nos logs, na linha com `setupCode`, e muda a cada reinício do container. Veja onde procurar em cada tipo de instalação em [Instalação › Primeiro acesso](install.md#primeiro-acesso).
