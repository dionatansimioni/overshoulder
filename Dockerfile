# Imagem única do Overshoulder: LiveKit + app + Caddy, coordenados por app/supervisor.js
FROM livekit/livekit-server:v1.13.10 AS livekit
FROM caddy:2.11 AS caddy

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

ENV DATA_DIR=/data NODE_ENV=production
USER node
VOLUME /data
EXPOSE 80 443 7881 7882/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "supervisor.js"]
