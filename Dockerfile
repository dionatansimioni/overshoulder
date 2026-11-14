# Imagem única do Overshoulder: LiveKit + app + Caddy, coordenados por app/supervisor.js
# LiveKit compilado do código-fonte: o binário pronto traz dependências com falhas conhecidas,
# atualizadas aqui (a varredura da publicação bloqueia falhas altas que já têm correção)
FROM golang:1.27.4-alpine AS livekit
ARG LIVEKIT_VERSION=v1.13.11
RUN apk add --no-cache git \
 && git clone --depth 1 --branch "$LIVEKIT_VERSION" https://github.com/livekit/livekit.git /src
WORKDIR /src
RUN go get golang.org/x/net@v0.62.0 \
 && go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /livekit-server ./cmd/server
# Caddy com o módulo layer4: divide a porta 443 entre o site e o TURN (turn.<domínio>)
FROM caddy:2.11-builder AS caddy
RUN xcaddy build --with github.com/mholt/caddy-l4@v0.1.2 --replace golang.org/x/net=golang.org/x/net@v0.62.0 --output /usr/bin/caddy

FROM node:24-alpine AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
# npm, npx e yarn não são usados em produção (e trazem dependências com falhas): saem da imagem
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack \
 && apk add --no-cache tini libcap \
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
