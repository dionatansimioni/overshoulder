# Accounts and users

[← Documentation](README.md) · English · [Português](pt-BR/accounts.md)

| Who | Has an account? | What they do |
|---|---|---|
| Administrator | Yes (one) | Configures the server at `/admin`, creates rooms, manages accounts |
| Broadcaster | Yes | Creates rooms and broadcasts, even when the admin is not around; can't change settings |
| Viewer | No | Joins through the room link, with just a name |

## Passwords

At least 12 characters, not containing the username and not among the ~30 thousand most common leaked passwords. A long sentence is easier to remember and safer. Sessions last up to 12 hours, or 2 hours without use.

## Broadcasters

The sign-up mode is at `/admin` › General:

- **Invitation only:** the admin creates an invitation at `/admin` › Invite a broadcaster and sends the link. The person picks their own username and password; the admin never sees the password. The link works once, for 48 hours. In this mode the home page shows no sign-in form: it says the server is private and points to the Overshoulder site. People with an account sign in at **`/login`**.
- **With approval (default):** anyone can request an account at `/signup`; the account stays pending until the admin approves it at `/admin` › Broadcasters. Requests are limited per IP, and there is a cap on accounts waiting.
- **Open:** anyone creates an account at `/signup` and can broadcast right away. Only use it on servers for a group you trust.

At `/admin` › Broadcasters:

- **Revoke:** deactivates the account and immediately ends its sessions and its live rooms.
- **Reactivate:** gives a revoked account its access back.
- **Delete:** removes the account.

## Two-step verification (2FA)

Each person turns it on at `/account` (on the home page, **Settings › My account**), with an authenticator app (Google Authenticator, Aegis, 1Password…). When turning it on, they get 10 recovery codes, each valid once. The admin can **require 2FA** for everyone at `/admin` › General.

## Recovering access

### The admin lost the password or 2FA

There is no "forgot password" on the login page for the admin, on purpose: only someone with access to the server can recover that account. The `reset-admin` command prints a **single-use link, valid for 15 minutes**. Open the link in the browser and choose a new password. The admin's 2FA is removed and all of their open sessions are ended. Run the command again if the link expires.

How to run the command depends on how Overshoulder was installed:

| Installation | Command |
|---|---|
| One-command installer | `overshoulder reset-admin` |
| `docker run` or Docker Compose (container `overshoulder`) | `docker exec overshoulder overshoulder reset-admin` |
| Coolify, Dokploy, EasyPanel and similar | In the panel, open the service's **Terminal** (on Coolify, the resource's *Terminal* tab, picking the `overshoulder` container) and run `overshoulder reset-admin` |
| Any of them, from the server's terminal | `docker exec $(docker ps -qf name=overshoulder) overshoulder reset-admin` |

On platforms like Coolify, the container isn't called just `overshoulder` (the name gets a suffix), which is why the last line looks the container up by name. If more than one shows up, use `docker ps` to see the names and pick the right one.

The command speaks English unless the system is in Portuguese. To choose, add `-e OVERSHOULDER_LANG=en` (or `pt`) right after `docker exec`. With the installer, use `OVERSHOULDER_LANG=en overshoulder reset-admin`.

If the server hasn't been set up yet, there is no admin to recover: see [the first-setup code](install.md#first-access).

### Broadcasters and your own password

- **A broadcaster lost the 2FA phone:** they sign in with a recovery code. Without codes, the admin, at `/admin` › Broadcasters, removes the account's 2FA or creates new codes (and hands them over through a secure channel).
- **A broadcaster forgot the password:** at `/admin` › Broadcasters, click **New password link** and send the link to the person through a secure channel. It works once, for 24 hours; creating another one invalidates the previous one. The person picks the new password at `/new-password`, their open sessions are ended and 2FA stays as it was (if they also lost the phone, use **Remove 2FA**). It doesn't work for revoked or pending accounts, nor for company sign-in accounts.
- **Change your own password:** at `/account`.

## Company sign-in (SSO)

Optional, through OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…), at `/admin` › Advanced:

1. At the provider, register a "web" application with the redirect address shown in the panel.
2. Fill in the issuer, the Client ID, the Client secret and the allowed email domains.
3. Define who broadcasts: a group (if the provider sends the list of groups) or a list of emails. Those people become broadcasters on their first sign-in.

Each room can require the company sign-in to watch, and then the name in the chat is the person's real name. The admin can make that the default or mandatory. The administrator always signs in with username and password, so they are never locked out if the provider goes down.

SSO was tested against a simulated provider; test it with your provider before relying on it.
