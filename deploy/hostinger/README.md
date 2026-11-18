# Overshoulder on Hostinger

Material for the "Deploy on Hostinger" button and for a listing in Hostinger's application catalog.

## Button

```markdown
[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/docker-hosting?compose_url=https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/deploy/hostinger/compose.yml)
```

Hostinger's docs also accept `&REFERRALCODE=<code>` at the end of the link (discount for the buyer, cashback for whoever owns the code).

## Listing details

| Field | Value |
|---|---|
| Name | Overshoulder |
| Category | Communication / Streaming / Gaming |
| Short description (en) | Self-hosted screen sharing for playing with friends: up to 1440p60, game audio, voice and chat, end-to-end encrypted. |
| Short description (pt-BR) | Compartilhamento de tela self-hosted para jogar com os amigos: até 1440p60, áudio do jogo, voz e chat, com criptografia de ponta a ponta. |
| License | AGPL-3.0 (free and open source) |
| Image | `ghcr.io/dionatansimioni/overshoulder:latest` (amd64 and arm64, signed with cosign, with SBOM) |
| Compose | [compose.yml](compose.yml) |
| Website and docs | https://dionatansimioni.github.io/overshoulder/ |
| Source | https://github.com/dionatansimioni/overshoulder |
| Logo | [app/public/icon.svg](../../app/public/icon.svg) (512×512 PNG: [icon-512.png](../../app/public/icon-512.png)) |
| Screenshots | Run `./scripts/screenshots.sh` (files in `app/.screenshots/`) |

### Long description (en)

Overshoulder is screen sharing that runs in the browser and on a server you control. Share a game with your friends at up to 1440p and 60 fps, with game audio, voice and chat. The room key is created in the browser and lives only in the link, so the server relays video it cannot open. Two kinds of rooms: "Playing together", where everyone talks and shares, and "Live", where the audience watches and asks to speak. Friends join from a link, with no account and no download. Includes accounts for broadcasters, invitations, 2FA, a waiting room, moderation, browser recording and Discord announcements.

### Descrição longa (pt-BR)

O Overshoulder é um compartilhamento de tela que roda no navegador e num servidor seu. Mostre o jogo aos amigos em até 1440p a 60 fps, com áudio do jogo, voz e chat. A chave da sala é criada no navegador e fica só no link, então o servidor repassa um vídeo que não consegue abrir. Dois tipos de sala: "Jogando juntos", em que todos falam e mostram a tela, e "Live", em que o público assiste e pede a palavra. Os amigos entram por um link, sem conta e sem download. Inclui contas para quem transmite, convites, 2FA, sala de espera, moderação, gravação no navegador e anúncio no Discord.

## Requirements

- Any Hostinger VPS plan (KVM 1 or larger). Bandwidth is what limits the audience: ~3 Mbps per viewer at 720p, ~7 Mbps at 1080p60.
- Ports: 80/TCP and 443/TCP (site and certificate), 7881/TCP and 7882/UDP (video).

## Environment variables

None is required.

| Variable | Default | Meaning |
|---|---|---|
| `DOMAIN` | empty | Domain pointing to the VPS. Empty: the server finds its public IP and gets an HTTPS certificate for it |
| `INSTALL_METHOD` | `hostinger` | Makes the new-version notice show how to update in Docker Manager |

The other options are in [docs/configuration.md](../../docs/configuration.md).

## After deploying

1. Open `https://<VPS IP or domain>/setup`.
2. Get the setup code from the project's logs in Docker Manager (line with `setupCode`).
3. Create the administrator account. Done: create a room and share the link.

## Still to confirm on a real Hostinger VPS

- That Docker Manager imports this Compose file and starts it with `DOMAIN` empty.
- That port 7882/UDP is published.
- That the logs show the `setupCode` line.
