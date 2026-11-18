# Behind another proxy (Coolify and similar)

[← Documentation](README.md) · English · [Português](pt-BR/proxy.md)

By default, Overshoulder uses ports 80 and 443 and handles HTTPS on its own. If the server already has a proxy on those ports, use `TLS=proxy`. That covers Coolify, Dokploy, EasyPanel, or a Traefik, Nginx or Caddy you already run. In this mode:

- your proxy handles the domain and the certificate and forwards the site over HTTP to the container's `HTTP_PORT` (default `80`);
- video doesn't go through the proxy: ports **7881/TCP** and **7882/UDP** stay open directly on the server;
- the links Overshoulder creates use `https://<DOMAIN>`, without a port;
- TURN on port 443 (`TURN_DOMAIN`) doesn't work, because 443 belongs to the other proxy.

## Coolify

1. Create a **Docker Compose** resource (for example, "Docker Compose Empty") and paste:

   ```yaml
   services:
     overshoulder:
       image: ghcr.io/dionatansimioni/overshoulder:latest
       restart: unless-stopped
       ports:
         - "7881:7881"
         - "7882:7882/udp"
       environment:
         DOMAIN: live.yourdomain.com
         TLS: proxy
         # Makes the new-version notice show how to update on Coolify
         INSTALL_METHOD: coolify
       volumes:
         - data:/data
   volumes:
     data:
   ```

2. On the `overshoulder` service, fill in the domain with the internal port: `https://live.yourdomain.com:80`. The `:80` tells Coolify the container's port. The public address still has no port.
3. Use the same domain in `DOMAIN`, without `https://`.
4. Deploy and follow the [first access](install.md#first-access): the setup code shows up in the service's *Logs* tab, on the line with `setupCode`. Lost the admin password later? Open the service's *Terminal* tab and run `overshoulder reset-admin` (see [Recovering access](accounts.md#recovering-access)).
5. Open 7881/TCP and 7882/UDP in the server's firewall and in your provider's panel.

Don't publish the container's port 80 on the server (`ports: "80:80"`): access to the site must always go through Coolify's proxy.

If someone opens the site over `http://`, Overshoulder redirects to `https://<DOMAIN>`. For that, the proxy must send the `X-Forwarded-Proto` header, as Coolify's Traefik, Caddy and the Nginx configuration in this guide do.

Dokploy and EasyPanel work the same way: the domain pointing to the container's port 80, `TLS=proxy` and the video ports published.

## Nginx, Caddy or Traefik on the same server

Start the container publishing the site only to the server itself:

```bash
docker run -d --name overshoulder --restart unless-stopped \
  -p 127.0.0.1:8080:80 -p 7881:7881 -p 7882:7882/udp \
  -v overshoulder-data:/data \
  -e DOMAIN=live.yourdomain.com -e TLS=proxy \
  ghcr.io/dionatansimioni/overshoulder:latest
```

The proxy must forward the WebSocket (the `/rtc` route), the original `Host` header and the `X-Forwarded-For` and `X-Forwarded-Proto` headers.

**Caddy** (does all of this on its own):

```
live.yourdomain.com {
	reverse_proxy 127.0.0.1:8080
}
```

**Nginx:**

```nginx
server {
    server_name live.yourdomain.com;
    listen 443 ssl;
    # ssl_certificate and ssl_certificate_key for your certificate

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
```

**Traefik** (labels on the container, with Traefik on the same Docker network; without publishing 8080):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.overshoulder.rule=Host(`live.yourdomain.com`)
  - traefik.http.routers.overshoulder.entrypoints=websecure
  - traefik.http.routers.overshoulder.tls.certresolver=letsencrypt
  - traefik.http.services.overshoulder.loadbalancer.server.port=80
```

## The visitor's IP

Attempt limits (login, sign-up, invitation passwords) count per IP. Overshoulder only accepts the IP and protocol reported by the proxy when the request comes from an address in `TRUSTED_PROXIES`. The default, `private_ranges`, accepts private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and equivalents), which is where the proxy comes from in almost every Docker setup. If your proxy is at another address, set it: `TRUSTED_PROXIES="203.0.113.10"` (IPs and ranges separated by spaces).

The visitor's IP is read right to left in `X-Forwarded-For`: whatever a visitor writes before the last trusted proxy is ignored.
