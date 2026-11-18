# Configuration

[← Documentation](README.md) · English · [Português](pt-BR/configuration.md)

## Server variables

Passed to the container with `-e NAME=value` (or in the Compose `.env`). Changing a variable requires recreating the container.

| Variable | Default | Used for |
|---|---|---|
| `DOMAIN` | (required) | The server's domain or IP. With a public IP and `TLS=acme`, the certificate is issued for the IP (see [Without a domain](install.md#without-a-domain)) |
| `TLS` | `acme` | `acme`: Let's Encrypt certificate; `local`: self-signed certificate (local network); `custom`: your own certificate, such as the company's (see [Company certificate](install.md#company-certificate)); `proxy`: behind another proxy, such as Coolify's, that handles HTTPS (see [Behind another proxy](proxy.md)) |
| `TLS_CERT`, `TLS_KEY` | `/data/certs/cert.pem`, `/data/certs/key.pem` | Only with `TLS=custom`: certificate (with the chain) and key without a passphrase |
| `NODE_IP` | detected automatically | IP that the video server announces to browsers (use it on a local network) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | Site ports; map the same ones in `-p`. With `TLS=proxy`, only `HTTP_PORT` is used, and the public address has no port |
| `TRUSTED_PROXIES` | `private_ranges` | Only with `TLS=proxy`: where the visitor's IP and protocol are accepted from (IPs and ranges separated by spaces) |
| `UPDATE_CHECK` | on | `off` turns off the new-version check for good (e.g. a server without internet) |
| `INSTALL_METHOD` | (empty) | How the server was installed (`installer`, `compose`, `compose-build`, `docker`, `coolify`): the new-version notice shows that method's steps first. The installer and the examples fill it in |
| `MAX_PARTICIPANTS` | `16` | Initial limit of people per room, suggested during setup (2 to 5000) |
| `TURN_DOMAIN` | off | **Experimental.** A subdomain just for TURN (e.g. `turn.live.yourdomain.com`), for networks that only allow port 443. Requires `HTTPS_PORT=443` and the subdomain pointing to the server; doesn't work with `TLS=proxy` |

## The `/admin` panel

Only the administrator can open it. The side menu has six sections; each has its own address (`/admin#salas`).

### General

- **Version:** shows the server version and tells you when a new one is out, with a link to what changed and the steps to update the way the server was installed (see [Updating](install.md#updating)). The notice also shows up on the admin's home page.
  - The check runs once a day against GitHub's releases API. No server data is sent; GitHub only sees the server's IP. Turn it off with **Check for new versions once a day** or, for good, with `UPDATE_CHECK=off`.
  - Local builds (version `dev`) don't check.
- **Require 2FA for all accounts:** anyone who doesn't have two-step verification yet (including you) must set it up before continuing.
- **Limit of people per room:** from 2 to 5000. The panel estimates the bandwidth with a full room and highlights the estimate from 200 people on.
- **Default broadcast quality:** starts at 720p · 30 fps.
- **Maximum allowed quality:** broadcasters only see options up to it. It is a limit in the page: a modified browser could still send more, because the video server doesn't limit the bitrate per connection.
- **Broadcaster sign-up:** invitation only, with approval (default) or open. See [Accounts](accounts.md#broadcasters).

### Usage

How much video and audio the server sent this month (UTC calendar), the rooms on air and the people connected. That is what counts against your hosting plan's bandwidth allowance.

- **Monthly plan allowance (GB):** with it, the panel shows the percentage used and, from 80% on, the admin's home page warns you. The logs record it once when passing 80% and 100%.
- Previous months (up to 12) are kept in `state.json`.
- The numbers come from the video server's metrics, which only answer inside the container. They count the media sent, not the site's traffic, which is small.

### Permanent rooms

Rooms that don't go away: the link and the invitations stay the same, even after restarting the server. See [Rooms](rooms.md#permanent-rooms).

### Broadcasters

The list of accounts, with the sign-up requests waiting for approval. Actions: approve, revoke, reactivate, delete, create a new-password link, create recovery codes and remove 2FA. See [Accounts](accounts.md).

### Invite a broadcaster

Single-use links, valid for 48 hours, that create broadcaster accounts. To invite someone just to watch, don't use this: send the room's invitation link, shown inside the room.

### Advanced

- **TURN on port 443:** shows whether it is on. It is set with the `TURN_DOMAIN` variable, not in the panel.
- **Company sign-in (SSO):** OpenID Connect. See [Accounts](accounts.md#company-sign-in-sso).

Most servers never need to touch "Advanced".
