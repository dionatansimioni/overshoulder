# Imagem única do Overshoulder: LiveKit + app + Caddy, coordenados por app/supervisor.js
FROM livekit/livekit-server:v1.13.10 AS livekit
# Caddy com o módulo layer4: divide a porta 443 entre o site e o TURN (turn.<domínio>)
FROM caddy:2.11-builder AS caddy
RUN xcaddy build --with github.com/mholt/caddy-l4@v0.1.2 --output /usr/bin/caddy

FROM node:24-alpine AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
RUN apk add --no-cache tini libcap \
 && mkdir -p /data \
 && chown node:node /data
COPY --from=livekit /livekit-server /usr/local/bin/livekit-server
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
# Roda como usuário comum: só o Caddy recebe a permissão de abrir as portas 80 e 443
RUN setcap cap_net_bind_service=+ep /usr/local/bin/caddy && apk del libcap

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/package.json app/*.js ./
COPY app/data ./data
COPY app/public ./public

# Comando para quem tem acesso ao servidor: docker exec overshoulder overshoulder reset-admin
RUN printf '#!/bin/sh\nexec node /app/cli.js "$@"\n' > /usr/local/bin/overshoulder \
 && chmod 755 /usr/local/bin/overshoulder

ENV DATA_DIR=/data NODE_ENV=production
USER node
VOLUME /data
EXPOSE 80 443 7881 7882/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "supervisor.js"]
