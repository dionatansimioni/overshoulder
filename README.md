# Overshoulder

**English** · [Português](README.pt-BR.md)

Self-hosted screen sharing, right in the browser: for playing games with friends, live streams and training sessions. Presenters and viewers only need to open a link.

- **Low latency:** WebRTC through [LiveKit](https://livekit.io) (self-hosted SFU).
- **End-to-end encryption:** the room key is created in the browser and lives only in the link's `#` fragment, so it never reaches the server. The server forwards encrypted video it cannot open itself.
- **Rooms of up to 16 people by default** (configurable up to 5000): the presenter uploads a single copy and the server distributes it. With simulcast, each viewer gets the quality their connection can handle.
- **Two room types:** **"Playing together"**, where everyone talks (like a call) and several people can share their screens at once; and **"Live"**, where only presenters talk and the audience uses the chat, able to **ask to speak** or **ask to share their screen**. With several screens live, each person picks which one to watch and only receives that one.
- **Webcam over the screen:** presenters turn their camera on and it shows over the screen (picture-in-picture) in the corner, size and shape they pick. Viewers can hide the camera or swap it with the screen. Camera-only broadcasts work too.
- **Room invitations:** the default link has no limit. In *People › Invitations and entry*, the host creates named invitations (e.g. "clan Discord") with a people limit, expiry and optional password, and can revoke one (the link stops working and everyone who joined through it leaves). Whoever joins keeps a **ticket** in the browser: reloading or a dropped connection does not use the invitation again, even after the link changes. The optional **waiting room** makes each person wait until the host lets them in.
- **Moderation:** in the *People* tab, the host approves requests, grants or removes each person's voice and screen, and removes someone from the room. The host can also turn the chat off for viewers and create a new room link.
- **Recording in the host's browser:** records the video on screen (including whoever holds the presenter role) and all of the room's audio. The server never sees the content. In Chrome and Edge, the file goes to a chosen folder; in other browsers, it is downloaded when recording stops. The format is the one that opens in the most programs: MP4 with AAC audio when the browser can (Chrome on Windows and Mac), MP4 with Opus audio in Chromium (VLC, mpv, Kdenlive and Shotcut open it) and WebM in Firefox, with the duration written into the file. For an editor that does not accept Opus, convert the audio: `ffmpeg -i recording.mp4 -c:v copy -c:a aac recording-aac.mp4`. Screen (with audio) and camera are saved as separate files, so editors can compose them as they like. Each stretch of video becomes a separate part, and everyone in the room sees a **● Recording** notice.
- **On your phone:** install Overshoulder on the home screen (a PWA, no app store), watch sideways in full screen and do camera-only lives. Phone browsers cannot share the screen: the guide at `/celular` explains how to broadcast a phone game from a computer (scrcpy on Android, AirPlay on iPhone).
- **Text chat with emojis** in the room. It goes through the server over TLS and is *not* end-to-end encrypted.
- **Accounts with 2FA, invited broadcasters and company sign-in (SSO)**, described below.
- **Interface in English and Portuguese**, picked from the browser's language (switchable at the bottom of the page).

**Full documentation** (in Portuguese for now: install, configuration, accounts, rooms, broadcasting and troubleshooting): [docs/](docs/README.md).

## How it works

```
Browser (presenter) ──1 encrypted copy──▶ server: LiveKit ──▶ viewers' browsers
                                             ▲
                      app (Node): accounts, rooms, tokens
                      Caddy: automatic HTTPS
```

Everything runs in a **single Docker image**. Inside it, a supervisor starts LiveKit, the app and Caddy, restarts whatever crashes or hangs, and keeps internal secrets in the `/data` volume.

- **Creating a room** requires signing in (administrator or broadcaster), so outsiders cannot use your server.
- **Host link:** `/r/<room>#k=<key>&h=<host-key>`. Only the host moderates, ends the room and grants voice and screen.
- **Viewer link:** `/r/<room>#k=<key>`. Watch and chat.
- A room disappears 5 minutes after it becomes empty, or right away with "End room".
- **Removing someone** also changes the link of the invitation they used and cancels their ticket: people already watching stay, and anyone still joining through that invitation needs the new link. If the removed person tries to come back with their old connection, the server removes them again within 2 seconds.

## Running on a server

The easiest way, on Ubuntu or Debian:

```bash
curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh | sudo bash
```

The installer asks whether you have a domain, opens the firewall, starts the container and installs the `overshoulder` command (`update`, `status`, `logs`, `backup`…). Details (in Portuguese) in [docs/instalacao.md](docs/instalacao.md). For Coolify, Dokploy, EasyPanel or an existing proxy, see [docs/proxy.md](docs/proxy.md).

Without the installer, with Docker and a domain (or subdomain) pointing at the server's IP:

```bash
docker build -t overshoulder .
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.yourdomain.com \
  overshoulder
```

Then open `https://live.yourdomain.com/configurar` to create the administrator account. The page asks for the **setup code**, shown in the logs (`docker logs overshoulder | grep setupCode`) while the server has no administrator. That way only someone with access to the server can set it up.

Or with Compose: `./setup.sh` writes the `.env` and `docker compose up -d --build` starts it.

| Variable | Default | Purpose |
|---|---|---|
| `DOMAIN` | (required) | The server's domain or IP |
| `TLS` | `acme` | `acme` = Let's Encrypt; `local` = self-signed certificate (local network); `custom` = your own certificate (`TLS_CERT`, `TLS_KEY`); `proxy` = behind another proxy, such as Coolify's ([guide, in Portuguese](docs/proxy.md)) |
| `NODE_IP` | auto-detected | IP that WebRTC announces to browsers (use it on a local network) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Site ports; map the same ones with `-p`. With `TLS=proxy`, only `HTTP_PORT` is used |
| `TRUSTED_PROXIES` | `private_ranges` | `TLS=proxy` only: where the visitor's IP and protocol are accepted from |
| `TURN_DOMAIN` | off | **Experimental.** Subdomain for TURN (e.g. `turn.live.yourdomain.com`), for networks that only allow port 443. Requires `HTTPS_PORT=443` and the subdomain pointing at the server |
| `MAX_PARTICIPANTS` | `16` | Initial people per room limit, suggested during setup (2 to 5000) |

### Accounts

- **Administrator:** created at `/configurar`. Changes settings at `/admin` and invites broadcasters.
- **Broadcasters:** people allowed to create rooms and broadcast even when you are not around. At `/admin`, the admin picks the **sign-up mode**: *invitation only* (single-use link valid for 48 h), *with approval* (default: anyone asks at `/cadastro` and the admin approves) or *open* (anyone creates an account and broadcasts right away). Sign-ups without an invitation are limited per IP, with a cap on accounts waiting for approval. **Revoking** disables the account and immediately ends its sessions and live rooms.
- **Permanent rooms:** in `/admin`, the admin creates rooms that do not go away, with a fixed link and invitations (even after a server restart). The room goes live when someone joins; "End" removes everyone but keeps the room. The encryption key is created and kept in the admin's browser and the server never sees it; on another browser, the admin needs the link or a new key.
- **Viewers:** have no account. They only need the room link (or a company sign-in, if the room requires it).
- **2FA (TOTP):** optional and recommended; each person turns it on at `/conta` with an authenticator app. The admin can **require 2FA** for everyone. The 10 recovery codes work once each, and only the admin can generate a new set (or remove 2FA for someone who lost their phone).
- **Company sign-in (SSO):** optional, through OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…), configured at `/admin`. Only people with an email from the allowed domains can sign in. People in the broadcasters group (or on the email list) become broadcasters on their first sign-in. Each room can require a company sign-in to watch, and then the chat shows the provider's real name. The admin can make that the default or mandatory. The administrator always signs in with username and password, so they are never locked out if the provider goes down.
- **Passwords:** at least 12 characters, not containing the username and not among the ~30 thousand most common leaked passwords.
- **Admin lost the password or 2FA:** on the server, run `docker exec overshoulder overshoulder reset-admin`. It prints a single-use link, valid for 15 minutes, that changes the password and removes the admin's 2FA.

Open these in the firewall:

| Port | Protocol | Purpose |
|---|---|---|
| 80, 443 | TCP | site + HTTPS (Caddy) |
| 7881 | TCP | WebRTC over TCP (networks that block UDP) |
| 7882 | UDP | WebRTC media |

**Corporate networks (TURN, experimental):** some companies only allow port 443, and then video cannot use ports 7881/7882. With `TURN_DOMAIN`, port 443 itself also serves `turn.<domain>`, without opening anything else: Caddy tells connections apart by name and hands the TURN ones to LiveKit. The tests prove the port split, the certificate and TURN authentication; full video through TURN still needs to be confirmed on a real server.

**Bandwidth:** the server uploads roughly `bitrate × viewers`. At 1080p60 (about 7 Mbps) with 10 viewers, that is around 70 Mbps of upload, close to 30 GB per hour. Check your plan's data allowance. Broadcasts start at **720p** (about 3 Mbps per viewer); in `/admin`, the administrator picks the default quality and the maximum allowed. Above 720p, the room shows the estimated bandwidth, and the panel highlights the estimate for rooms with many people.

**Health and logs:** `GET /healthz` answers `{"status":"ok"}` and feeds Docker's healthcheck. `docker logs overshoulder` shows JSON logs, one per line, without passwords or room IDs. Account security events (sign-in, failed sign-in, password change) record the username, to investigate unwanted access; viewers never appear in the logs. Logs and the `reset-admin` command are in Portuguese for now.

## Local network (LAN)

`./setup.sh`, option 2 (detects the machine's IP), then `docker compose up -d --build`.

Open `https://<your-ip>`. It has to be HTTPS: browsers block screen sharing and encryption on `http://` outside `localhost`. With `TLS=local`, Caddy creates its own certificate, so each browser shows a warning the first time ("Advanced" > "Proceed").

To remove the warning for good on a device, install Caddy's CA on it:
`docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt`

## Game audio

- **Windows (Chrome/Edge):** when picking "Entire screen", check "Share system audio".
- **Linux:** the browser only captures *tab* audio. For game audio, open the broadcast settings in the room, click “List” and pick your sound output's **"Monitor of …"** device under “Game audio” (PipeWire/PulseAudio). It is sent in stereo, without voice filters.
  Tip: to avoid broadcasting Discord or other apps, create a virtual output just for the game:
  `pactl load-module module-null-sink sink_name=game` and pick "Monitor of game".

## Quality tips

- **H.264** usually uses the GPU's hardware encoder and is the lightest while you play.
- **AV1/VP9** look better at the same bitrate, but are heavier on the CPU if the GPU has no encoder for them.

## Releases and supply chain

Each version (`vX.Y.Z` tag) is published by GitHub Actions as `ghcr.io/dionatansimioni/overshoulder`, for amd64 and arm64, only after the full test suite and a vulnerability scan pass (Trivy blocks high or critical issues that already have a fix). LiveKit and Caddy are compiled from source with updated dependencies. Every image is signed with Sigstore (keyless) and carries an SBOM (CycloneDX) and build provenance. To check the signature:

```bash
cosign verify ghcr.io/dionatansimioni/overshoulder:<version> \
  --certificate-identity-regexp '^https://github.com/dionatansimioni/overshoulder/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Development

`./scripts/test.sh` runs every test: gitleaks, server, security, browser, translation and the Docker image. `./scripts/scan.sh <image>` runs the same vulnerability scan as the release.

## License

[AGPL-3.0](LICENSE).
