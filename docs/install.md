# Installation

[← Documentation](README.md) · English · [Português](pt-BR/install.md)

## Requirements

- A Linux server with **Docker**.
- Ideally, a **domain or subdomain** pointing to the server's IP (for example, `live.yourdomain.com`). It also works without one: see [Without a domain](#without-a-domain). HTTPS is mandatory: browsers only share the screen and use encryption on HTTPS sites.
- **Upload bandwidth:** the server sends one copy of the video to each person. At 720p that is ~3 Mbps per viewer; at 1080p60, ~7 Mbps. With 10 people at 1080p60, ~70 Mbps and almost 30 GB per hour. Check your plan's data allowance.

## One-command installer

On Ubuntu or Debian (amd64 or arm64), with the domain already pointing to the server:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh)"
```

The installer:

1. checks the system and installs Docker if it is missing;
2. asks how people will reach the server: with a domain, without a domain (certificate on the IP), only on the local network, or behind a proxy that already exists (if ports 80 and 443 are taken, it suggests that option; on Coolify, it points to the [Coolify guide](proxy.md#coolify));
3. opens the ports in ufw or firewalld;
4. starts the container with Docker Compose in `/opt/overshoulder` (the settings live in that folder's `.env`);
5. shows the address, the first-setup code and the ports to open in your provider's panel.

Afterwards, the `overshoulder` command handles day-to-day tasks:

| Command | What it does |
|---|---|
| `sudo overshoulder update` | Downloads the new version and restarts, keeping the data |
| `overshoulder status` | Shows whether it is running, its health and version |
| `overshoulder logs` | Follows the logs |
| `overshoulder config-code` | Shows the first-setup code |
| `overshoulder reset-admin` | Creates a link to reset the admin password |
| `overshoulder backup` | Saves the data to a file in the current folder |
| `sudo overshoulder uninstall` | Removes Overshoulder; with `--purge`, also deletes the data |

To install without questions (automation), pass the answers through the environment: `MODE=domain DOMAIN=live.yourdomain.com OVERSHOULDER_YES=1`. The modes are `domain`, `ip`, `lan` and `proxy` (with `PROXY_PORT`, default 8080).

The installer and the `overshoulder` command speak Portuguese when the system language (`LANG`) is Portuguese, and English otherwise. To choose, use `OVERSHOULDER_LANG=en` or `OVERSHOULDER_LANG=pt`.

Don't use `curl … | sudo bash`: on some systems, such as Ubuntu 25.10, an installer read through the pipe doesn't receive what you type, nor CTRL+C.

## Hostinger (one click)

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/docker-hosting?compose_url=https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/deploy/hostinger/compose.yml)

The button opens Hostinger's checkout with Overshoulder's Compose file ([deploy/hostinger/compose.yml](../deploy/hostinger/compose.yml)). After the purchase, the VPS's Docker Manager opens with it, ready to deploy.

- **No domain needed to start:** with `DOMAIN` empty, the server finds its own public IP and gets an HTTPS certificate for it. Open `https://<VPS IP>/setup`.
- **Setup code:** in the project's logs in Docker Manager, on the line with `setupCode`.
- **With a domain:** point it to the VPS, fill in `DOMAIN` in the project's environment variables and redeploy.
- **Firewall:** the Hostinger panel firewall only applies if you assign a rule group to the VPS. If you do, open 80/TCP, 443/TCP, 7881/TCP and 7882/UDP.
- **Updating:** in Docker Manager, update (redeploy) the project; the data stays in the volume.

## Running with Docker

Without the installer: it is a single image, with LiveKit (video), the app and Caddy (automatic HTTPS) in the same container.

```bash
docker run -d --name overshoulder --restart unless-stopped \
  -p 80:80 -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.yourdomain.com \
  ghcr.io/dionatansimioni/overshoulder:latest
```

To build from source instead: `git clone https://github.com/dionatansimioni/overshoulder.git`, then `docker build -t overshoulder .` in the folder. With Docker Compose: `./setup.sh` asks for the domain and writes the `.env`; then `docker compose up -d --build`.

The other variables (your own certificate, ports, TURN) are in [Configuration](configuration.md#server-variables).

If ports 80 and 443 already have an owner (Coolify, Dokploy, EasyPanel, an Nginx or Traefik), see [Behind another proxy](proxy.md).

## First access

1. Open `https://live.yourdomain.com/setup`.
2. Get the **setup code** (format `XXXX-XXXX-XXXX`). It only exists while the server has no administrator, and proves that you are the one who installed it. It is not a password: it is in the logs, on the line with `setupCode`:
   - **installer:** `overshoulder config-code`;
   - **`docker run` or Docker Compose:** `docker logs overshoulder 2>&1 | grep setupCode`;
   - **Coolify, Dokploy, EasyPanel:** in the service's *Logs* tab, search for `setupCode` (Ctrl+F); or, in the server's terminal, `docker logs $(docker ps -qf name=overshoulder) 2>&1 | grep setupCode`.

   The code changes every time the container restarts: use the one on the last `setupCode` line.
3. Follow the 3 steps: code, administrator account (username and a password of at least 12 characters) and the limit of people per room.

Done: you are signed in and can create rooms. Everything else is at `/admin` (see [Configuration](configuration.md)).

## Firewall

| Port | Protocol | Used for |
|---|---|---|
| 80, 443 | TCP | Site and HTTPS (Let's Encrypt uses port 80 to issue the certificate) |
| 7881 | TCP | Video over TCP, for networks that block UDP |
| 7882 | UDP | Video (the normal, faster path) |

If your provider has a firewall in its panel, open the ports there too, because it is separate from the system firewall. It is on by default on Oracle Cloud (the default security list only lets SSH through), AWS and Google Cloud. On Hostinger, the panel firewall only applies once you assign a rule group to the server; until then, it blocks nothing.

## Updating

First, read the new version's release notes (on the project's releases page) and make a backup. The data lives in the volume and survives replacing the container. The `/admin` panel tells you when a new version is out and shows these same steps.

| How it was installed | How to update |
|---|---|
| One-command installer | `sudo overshoulder update` |
| Docker Compose with the prebuilt image | In the `compose.yml` folder: `docker compose pull`, then `docker compose up -d` |
| Docker Compose building from source | In the project folder: `git pull`, then `docker compose up -d --build` |
| `docker run` | `docker pull ghcr.io/dionatansimioni/overshoulder:latest`, `docker rm -f overshoulder` and the same `docker run` as when installing |
| Hostinger (Docker Manager) | Update (redeploy) the project in Docker Manager |
| Coolify, Dokploy, EasyPanel | **Redeploy** the service. With the `latest` tag, the new image is downloaded; with a pinned version (e.g. `:0.2.0`), change the tag first |

To pin a version instead of following `latest`: with the installer, change `OVERSHOULDER_VERSION` in `/opt/overshoulder/.env` and run `sudo overshoulder update`.

## Backup

Everything that matters lives in the `/data` volume:

- `state.json`: accounts, settings, permanent rooms and invitations (passwords only as hashes);
- `secrets.json`: the server's internal keys (created on the first start);
- `caddy/`: HTTPS certificates.

To copy it:

```bash
docker run --rm -v overshoulder-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/overshoulder-backup.tgz -C /data .
```

To restore on a new server, extract the file into the volume before starting the container. Keep the backup somewhere safe: `secrets.json` can issue access to rooms.

## Without a domain

Put the server's public IP in `DOMAIN` (e.g. `DOMAIN=203.0.113.5`). Caddy asks Let's Encrypt for a certificate for the IP itself. These certificates last about 6 days, and Caddy renews them on its own. Port 80 must be open to the internet.

If the IP certificate fails (check the container logs), use nip.io, which turns the IP into a name: `DOMAIN=203-0-113-5.nip.io`. nip.io is a third-party service, and its Let's Encrypt certificate quota is shared by all its users. Your own domain is still the most stable option.

## Local network

To use it only at home or in the office: `./setup.sh`, option 2 (detects the IP), and `docker compose up -d --build`. With `TLS=local`, Caddy uses its own certificate and each browser shows a warning the first time ("Advanced" > "Proceed"). To remove the warning for good on a device, install Caddy's CA on it:

```bash
docker compose cp overshoulder:/data/caddy/pki/authorities/local/root.crt overshoulder-ca.crt
```

### Company certificate

If the company already has a certificate that its devices trust (from an internal CA or a purchased one), use `TLS=custom`. Mount the folder with the certificate (`cert.pem`, with the chain) and the key without a passphrase (`key.pem`) at `/data/certs`:

```bash
docker run -d --name overshoulder --restart unless-stopped \
  -p 443:443 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data -v /etc/overshoulder/certs:/data/certs:ro \
  -e DOMAIN=live.company.local -e TLS=custom -e NODE_IP=192.168.0.10 \
  ghcr.io/dionatansimioni/overshoulder:latest
```

- Other paths: `TLS_CERT` and `TLS_KEY`.
- The container runs as the user with uid 1000: it must be able to read both files.
- On start, the server checks that the certificate covers `DOMAIN` (and `TURN_DOMAIN`, if set), that the key matches it and that it hasn't expired. If anything is wrong, it doesn't start and explains why in the logs.
- To renew, replace the files: within a minute the new certificate takes effect, without a restart. If the new one has a problem, the previous one stays and the reason shows up in the logs.

### Without internet

The server works on a network without internet access. On a machine with internet, download the image and save it to a file:

```bash
docker pull ghcr.io/dionatansimioni/overshoulder:latest
docker save -o overshoulder.tar ghcr.io/dionatansimioni/overshoulder:latest
```

Take the file to the server and load it: `docker load -i overshoulder.tar`. Then start it with `TLS=local` or `TLS=custom` and **always with `NODE_IP`** (the server's IP on the network): without internet, the server can't find out its own IP. The new-version check gets no answer, which doesn't affect anything.

### At home (homelab)

It works, with three caveats:

- **Upload:** the limit is your internet upload. With 100 Mbps of upload, about 26 people fit at 720p.
- **CGNAT:** if your ISP doesn't give you a public IP of your own, people outside your home can't reach the server. Check whether the IP shown on your router is the same as on sites like `ifconfig.me`.
- **Exposed IP:** viewers connect straight to the server and learn your home IP, which reveals your city and ISP and can become a target for attacks. For lives open to the public, prefer a VPS.

## Health and logs

- `GET /healthz` answers `{"status":"ok"}` and feeds Docker's healthcheck.
- `docker logs overshoulder` shows the logs in JSON, one per line, without passwords or room IDs.
