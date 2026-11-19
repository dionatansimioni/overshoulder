# Troubleshooting

[← Documentation](README.md) · English · [Português](pt-BR/troubleshooting.md)

## The site doesn't open or the certificate fails

- The domain must point to the server's IP **before** starting the container: Let's Encrypt checks this through port 80.
- Ports 80 and 443 must be free on the server and open in the firewall (the system's and the provider panel's).
- See the reason in the logs: `docker logs overshoulder | grep -i -e error -e tls`.
- On a local network, the certificate warning is expected with `TLS=local` (see [Installation](install.md#local-network)).

## The page opens, but the video doesn't arrive

- Open **7882/UDP** and **7881/TCP** in the system firewall and in your provider's panel.
- On a local network, set `NODE_IP` to the machine's IP on the network.
- Company or university networks that only allow port 443 block the video. `TURN_DOMAIN` (experimental) solves this; see [Configuration](configuration.md#server-variables).

## "Incomplete link: the room key is missing"

The link lost the part after the `#` (some apps cut it off). Ask for the link again, copied with the "Copy" button.

## Viewers can't hear the game (Linux)

Pick the computer's sound source under Settings › Game audio and check that the settings show "Sending audio from: …". In Chrome and browsers based on it, "Monitor of …" devices are hidden on purpose: run the command the room chat shows and pick "Overshoulder-jogo". In Firefox, if "Monitor of" doesn't show up, click "List" again after allowing the microphone. See [Broadcasting](broadcasting.md#game-audio).

## My internet can't keep up

Follow the network warning and lower the quality, or pick 720p in Settings. At home, the limit is usually the upload: each viewer at 720p uses ~3 Mbps.

## The recording doesn't open in my program

- MP4 with Opus audio (Chromium) doesn't open in some players and editors. Convert the audio: `ffmpeg -i recording.mp4 -c:v copy -c:a aac recording-aac.mp4`.
- VLC, mpv, Kdenlive and Shotcut open every format Overshoulder records.
- The video freezes on one frame, or the picture is stuck while the audio plays: the game is probably in exclusive fullscreen. Use windowed or borderless mode, or share the whole screen. See [Recording](rooms.md#recording-experimental).
- Recording is experimental and off by default: turn it on in the room settings (gear) or in Administration › General.

## I forgot the password

- **Admin:** run `reset-admin` on the server; it gives you a single-use link, valid for 15 minutes. The right command for each kind of installation (Coolify included) is in [Accounts › Recovering access](accounts.md#the-admin-lost-the-password-or-2fa).
- **Broadcaster:** the admin creates a **New password link** at `/admin` › Broadcasters. See [Accounts › Recovering access](accounts.md#broadcasters-and-your-own-password).

## I can't find the first-setup code

It is in the logs, on the line with `setupCode`, and changes every time the container restarts. See where to look for each kind of installation in [Installation › First access](install.md#first-access).
