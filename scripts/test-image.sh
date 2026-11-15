#!/usr/bin/env bash
# Testa a imagem única de verdade: sobe o container e confere saúde, rotas pelo Caddy,
# usuário sem root, reinício de serviço que cai ou trava, segredos persistentes e logs.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=overshoulder:test
NAME=overshoulder-test-image
VOLUME=overshoulder-test-image-data
HTTPS=18443
BASE="https://127.0.0.1:$HTTPS"
ADMIN_PASSWORD='frase comprida para testar a imagem'
JAR=$(mktemp)

cleanup() {
  rm -f "$JAR"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  docker rm -f overshoulder-test-proxy overshoulder-test-custom overshoulder-test-ip >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

ok() { echo "  ✔ $*"; }
die() {
  echo "  ✖ $*" >&2
  docker logs --tail 30 "$NAME" >&2 2>&1 || true
  exit 1
}
api() { curl -sk --max-time 10 "$@"; }

# Espera até a condição (um comando) dar certo, por no máximo $1 segundos
wait_for() {
  local secs=$1; shift
  for _ in $(seq "$secs"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ]; }
health_ok() { [ "$(api -o /dev/null -w '%{http_code}' "$BASE/healthz")" = 200 ]; }
pid_of() { docker exec "$NAME" pgrep -f "$1" | head -1; }

echo "== imagem única"
docker build -q -t "$IMAGE" . >/dev/null
docker run -d --name "$NAME" \
  -p "127.0.0.1:$HTTPS:$HTTPS" \
  -e DOMAIN=127.0.0.1 -e TLS=local -e HTTP_PORT=18080 -e HTTPS_PORT=$HTTPS -e NODE_IP=127.0.0.1 \
  -e WATCHDOG_INTERVAL_MS=1000 \
  --health-interval=2s --health-start-period=60s \
  -v "$VOLUME:/data" "$IMAGE" >/dev/null

wait_for 90 healthy || die "container não ficou saudável"
ok "container saudável pelo HEALTHCHECK do Docker"

[ "$(api "$BASE/healthz")" = '{"status":"ok"}' ] || die "/healthz pelo Caddy"
# Resposta numa variável: com pipefail, "curl | grep -q" falha à toa quando o grep fecha o cano antes
home=$(api "$BASE/")
grep -q '<title>Overshoulder' <<<"$home" || die "página inicial pelo Caddy"
ok "site e /healthz respondem por HTTPS pelo Caddy"

code=$(docker logs "$NAME" 2>&1 | sed -n 's/.*"setupCode":"\([A-Z0-9-]*\)".*/\1/p' | tail -1)
[ -n "$code" ] || die "código de configuração não apareceu nos logs"
setup=$(api -c "$JAR" -X POST "$BASE/api/setup" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$code\",\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$setup" | grep -q '"role":"admin"' || die "configuração inicial: $setup"
grep -q 'overshoulder_session.*' "$JAR" || die "configuração não abriu sessão"
ok "configuração inicial pelo código dos logs cria o admin"

room=$(api -b "$JAR" -X POST "$BASE/api/rooms" -H 'Content-Type: application/json' -d '{}')
room_id=$(echo "$room" | sed -n 's/.*"roomId":"\([^"]*\)".*/\1/p')
host_key=$(echo "$room" | sed -n 's/.*"hostKey":"\([^"]*\)".*/\1/p')
[ -n "$room_id" ] || die "criar sala: $room"
token_json=$(api -X POST "$BASE/api/token" -H 'Content-Type: application/json' -d "{\"roomId\":\"$room_id\",\"hostKey\":\"$host_key\"}")
echo "$token_json" | grep -q '"url":"wss://127.0.0.1:18443"' || die "URL pública do LiveKit: $token_json"
token=$(echo "$token_json" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ "$(api -o /dev/null -w '%{http_code}' "$BASE/rtc/validate?access_token=$token")" = 200 ] || die "LiveKit pelo Caddy"
ok "API cria sala e o LiveKit valida o token pelo Caddy"

[ "$(docker exec "$NAME" id -u)" != 0 ] || die "container roda como root"
procs=$(docker exec "$NAME" ps -o user,args)
for proc in livekit-server supervisor.js server.js caddy; do
  echo "$procs" | grep "$proc" | grep -qv '^root' || die "$proc não está rodando"
  ! echo "$procs" | grep "$proc" | grep -q '^root' || die "$proc roda como root"
done
ok "nenhum processo roda como root"

[ "$(docker exec "$NAME" stat -c %a /data/secrets.json)" = 600 ] || die "permissão do secrets.json"
ok "segredos em /data/secrets.json com permissão 600"

old=$(pid_of livekit-server)
docker exec "$NAME" kill "$old"
wait_for 30 sh -c "[ -n \"\$(docker exec $NAME pgrep -f livekit-server)\" ] && [ \"\$(docker exec $NAME pgrep -f livekit-server | head -1)\" != $old ]" \
  || die "LiveKit não voltou depois de cair"
wait_for 30 health_ok || die "serviço não voltou a responder depois do LiveKit cair"
ok "LiveKit que cai é reiniciado"

stuck=$(pid_of livekit-server)
docker exec "$NAME" kill -STOP "$stuck"
wait_for 40 sh -c "! docker exec $NAME kill -0 $stuck" || die "vigia não reiniciou o LiveKit travado"
wait_for 30 health_ok || die "serviço não voltou depois do LiveKit travar"
ok "LiveKit travado é detectado pelo vigia e reiniciado"

before=$(docker exec "$NAME" sha256sum /data/secrets.json)
docker restart "$NAME" >/dev/null
wait_for 90 healthy || die "container não voltou saudável depois de reiniciar"
[ "$(docker exec "$NAME" sha256sum /data/secrets.json)" = "$before" ] || die "segredos mudaram ao reiniciar"
[ "$(api "$BASE/api/state" | grep -o '"setupDone":true')" = '"setupDone":true' ] || die "configuração perdida no reinício"
[ "$(api -o /dev/null -w '%{http_code}' -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")" = 200 ] || die "login do admin depois do reinício"
ok "segredos e contas sobrevivem ao reinício do container"

reset_out=$(docker exec "$NAME" overshoulder reset-admin)
reset_token=$(echo "$reset_out" | sed -n 's|^https://127.0.0.1:18443/redefinir#\([A-Za-z0-9_-]*\)$|\1|p')
[ -n "$reset_token" ] || die "reset-admin não gerou o link: $reset_out"
NEW_PASSWORD='outra frase longa para a dona'
[ "$(api -o /dev/null -w '%{http_code}' -X POST "$BASE/api/admin-reset" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$reset_token\",\"password\":\"$NEW_PASSWORD\"}")" = 200 ] || die "redefinição do admin pelo link"
[ "$(api -o /dev/null -w '%{http_code}' -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$NEW_PASSWORD\"}")" = 200 ] || die "login com a senha redefinida"
ok "docker exec … overshoulder reset-admin gera um link que redefine o admin"

logs=$(docker logs "$NAME" 2>&1)
if echo "$logs" | grep -qF -e "$ADMIN_PASSWORD" -e "$NEW_PASSWORD" -e "$reset_token"; then die "senha ou link de redefinição apareceu nos logs"; fi
bad=$(echo "$logs" | python3 -c '
import json, sys
for line in sys.stdin:
    try:
        assert isinstance(json.loads(line), dict)
    except Exception:
        print(line.strip())
' | head -3)
[ -z "$bad" ] || die "linhas de log que não são JSON: $bad"
ok "todos os logs são JSON e a senha não aparece"

# --- TURN/TLS na 443 (opcional) ----------------------------------------------
TURN_NAME=overshoulder-test-turn
docker rm -f "$TURN_NAME" >/dev/null 2>&1 || true
docker run -d --name "$TURN_NAME" -p 127.0.0.1:18451:443 \
  -e DOMAIN=localhost -e TURN_DOMAIN=turn.localhost -e TLS=local -e NODE_IP=127.0.0.1 "$IMAGE" >/dev/null
turn_ready() { python3 -I scripts/stun-tls.py 127.0.0.1 18451 turn.localhost; }
if ! wait_for 60 turn_ready; then docker logs --tail 20 "$TURN_NAME" >&2; docker rm -f "$TURN_NAME" >/dev/null; die "TURN não respondeu pela 443"; fi
[ "$(curl -sk --resolve localhost:18451:127.0.0.1 https://localhost:18451/healthz)" = '{"status":"ok"}' ] \
  || { docker rm -f "$TURN_NAME" >/dev/null; die "site parou de responder com o TURN ligado"; }
docker rm -f "$TURN_NAME" >/dev/null
ok "com TURN_DOMAIN, a 443 leva turn.<domínio> ao TURN (STUN por TLS responde) e o resto ao site"

[ "$(docker run --rm -e DOMAIN=localhost -e TURN_DOMAIN=turn.localhost -e HTTPS_PORT=8443 "$IMAGE" 2>&1 | grep -c 'exige HTTPS_PORT=443')" = 1 ] \
  || die "TURN com porta diferente de 443 deveria ser recusado"
ok "TURN_DOMAIN com HTTPS_PORT diferente de 443 é recusado com explicação"

# --- TLS=custom: certificado próprio (ex.: o da empresa) ----------------------
CUSTOM_NAME=overshoulder-test-custom
CERT_DIR=$(mktemp -d)
chmod 755 "$CERT_DIR"
custom_cleanup() { docker rm -f "$CUSTOM_NAME" >/dev/null 2>&1 || true; rm -rf "$CERT_DIR"; }
custom_die() { docker logs --tail 20 "$CUSTOM_NAME" >&2 2>&1; custom_cleanup; die "$@"; }
# Certificado autoassinado para $1 em $CERT_DIR (legível pelo usuário do container)
make_cert() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$1" -addext "subjectAltName=DNS:$1" \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" 2>/dev/null
  chmod 644 "$CERT_DIR"/*.pem
}
local_fp() { openssl x509 -noout -fingerprint -sha256 -in "$CERT_DIR/cert.pem"; }
served_fp() {
  openssl s_client -connect 127.0.0.1:18452 -servername live.example.test </dev/null 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null
}
custom_run() {
  docker run "$@" -v "$CERT_DIR:/data/certs:ro" -e DOMAIN=live.example.test -e TLS=custom -e NODE_IP=127.0.0.1 "$IMAGE" 2>&1
}

make_cert outro.example.test
out=$(custom_run --rm || true)
grep -q 'não vale para live.example.test' <<<"$out" || { custom_cleanup; die "certificado de outro domínio deveria ser recusado"; }
cp "$CERT_DIR/key.pem" "$CERT_DIR/old-key.pem"
make_cert live.example.test
mv "$CERT_DIR/old-key.pem" "$CERT_DIR/key.pem"
out=$(custom_run --rm || true)
grep -q 'TLS_KEY não corresponde' <<<"$out" || { custom_cleanup; die "chave de outro certificado deveria ser recusada"; }
[ "$(docker run --rm -e DOMAIN=live.example.test -e TLS=custom "$IMAGE" 2>&1 | grep -c 'não foi possível ler /data/certs/cert.pem')" = 1 ] \
  || { custom_cleanup; die "certificado ausente deveria ser recusado com explicação"; }
ok "TLS=custom recusa certificado ausente, de outro domínio ou com a chave errada, com explicação"

make_cert live.example.test
first=$(local_fp)
custom_run -d --name "$CUSTOM_NAME" -p 127.0.0.1:18452:443 -e CERT_CHECK_INTERVAL_MS=1000 >/dev/null
wait_for 60 sh -c "[ \"\$(curl -sk --resolve live.example.test:18452:127.0.0.1 https://live.example.test:18452/healthz)\" = '{\"status\":\"ok\"}' ]" \
  || custom_die "site não respondeu com TLS=custom"
[ "$(served_fp)" = "$first" ] || custom_die "o Caddy não serve o certificado informado"
ok "com TLS=custom, o site responde com o certificado informado"

make_cert live.example.test
second=$(local_fp)
wait_for 20 sh -c "[ \"\$(openssl s_client -connect 127.0.0.1:18452 -servername live.example.test </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null)\" = '$second' ]" \
  || custom_die "certificado renovado no disco não foi carregado"
make_cert outro.example.test
wait_for 20 sh -c "docker logs $CUSTOM_NAME 2>&1 | grep -q 'certificado novo recusado'" || custom_die "certificado inválido no disco não foi recusado"
[ "$(served_fp)" = "$second" ] || custom_die "certificado inválido substituiu o que valia"
custom_cleanup
ok "certificado trocado no disco é carregado sozinho; um inválido é recusado e o anterior continua"

# --- Sem domínio: certificado do Let's Encrypt no IP ---------------------------
# Sem rede, para não pedir certificado de verdade: só confere a configuração gerada
IP_NAME=overshoulder-test-ip
docker rm -f "$IP_NAME" >/dev/null 2>&1 || true
docker run -d --name "$IP_NAME" --network none -e DOMAIN=203.0.113.5 -e NODE_IP=127.0.0.1 "$IMAGE" >/dev/null
wait_for 30 docker exec "$IP_NAME" test -f /tmp/overshoulder/Caddyfile || { docker rm -f "$IP_NAME" >/dev/null; die "Caddyfile não foi gerado"; }
ip_conf=$(docker exec "$IP_NAME" caddy adapt --config /tmp/overshoulder/Caddyfile --adapter caddyfile 2>/dev/null || true)
docker rm -f "$IP_NAME" >/dev/null
grep -q '"profile":"shortlived"' <<<"$ip_conf" || die "DOMAIN com IP deveria pedir o perfil shortlived ao Let's Encrypt"
grep -q '"203.0.113.5"' <<<"$ip_conf" || die "o site deveria responder pelo IP"
ok "com DOMAIN sendo um IP, o certificado é pedido ao Let's Encrypt pelo perfil shortlived"

# --- TLS=proxy: atrás de outro proxy (Coolify, Traefik, Nginx…) -------------
PROXY_NAME=overshoulder-test-proxy
PBASE=http://127.0.0.1:18082
proxy_cleanup() { docker rm -f "$PROXY_NAME" >/dev/null 2>&1 || true; }
proxy_die() { docker logs --tail 20 "$PROXY_NAME" >&2 2>&1; proxy_cleanup; die "$@"; }
# Sobe o modo proxy e faz a configuração inicial; $1 = TRUSTED_PROXIES (vazio = padrão)
proxy_up() {
  proxy_cleanup
  docker run -d --name "$PROXY_NAME" -p 127.0.0.1:18082:18082 \
    -e DOMAIN=live.example.test -e TLS=proxy -e HTTP_PORT=18082 -e NODE_IP=127.0.0.1 \
    ${1:+-e TRUSTED_PROXIES="$1"} "$IMAGE" >/dev/null
  wait_for 60 sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $PBASE/healthz)\" = 200 ]" || proxy_die "modo proxy não respondeu em HTTP"
  local pcode
  pcode=$(docker logs "$PROXY_NAME" 2>&1 | sed -n 's/.*"setupCode":"\([A-Z0-9-]*\)".*/\1/p' | tail -1)
  setup_headers=$(curl -s -D - -o /dev/null -X POST "$PBASE/api/setup" -H 'Content-Type: application/json' \
    -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 203.0.113.7' \
    -d "{\"code\":\"$pcode\",\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")
  grep -qi '^set-cookie: overshoulder_session' <<<"$setup_headers" || proxy_die "configuração inicial no modo proxy"
}
# Cadastro de transmissor com o X-Forwarded-For informado; devolve o código HTTP
signup_as() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$PBASE/api/signup" -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: $1" -d "{\"username\":\"$2\",\"password\":\"frase comprida para o cadastro\"}"
}

proxy_up ''
grep -qi '^set-cookie:.*; Secure' <<<"$setup_headers" || proxy_die "cookie sem Secure com X-Forwarded-Proto: https do proxy"
room=$(curl -s -X POST "$PBASE/api/rooms" -H 'Content-Type: application/json' \
  -H "Cookie: $(sed -n 's/^[Ss]et-[Cc]ookie: \(overshoulder_session=[^;]*\).*/\1/p' <<<"$setup_headers")" -d '{}')
room_id=$(echo "$room" | sed -n 's/.*"roomId":"\([^"]*\)".*/\1/p')
host_key=$(echo "$room" | sed -n 's/.*"hostKey":"\([^"]*\)".*/\1/p')
[ -n "$room_id" ] || proxy_die "criar sala no modo proxy: $room"
token_json=$(curl -s -X POST "$PBASE/api/token" -H 'Content-Type: application/json' -d "{\"roomId\":\"$room_id\",\"hostKey\":\"$host_key\"}")
grep -q '"url":"wss://live.example.test"' <<<"$token_json" || proxy_die "URL pública no modo proxy: $token_json"
ptoken=$(echo "$token_json" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PBASE/rtc/validate?access_token=$ptoken")" = 200 ] || proxy_die "LiveKit pelo modo proxy"
docker exec "$PROXY_NAME" overshoulder reset-admin | grep -q '^https://live.example.test/redefinir#' || proxy_die "link do reset-admin no modo proxy"
ok "com TLS=proxy, site e LiveKit respondem em HTTP, e os links públicos são https://<domínio>"

for i in 1 2 3 4 5; do [ "$(signup_as 203.0.113.1 "um$i")" = 201 ] || proxy_die "cadastro $i do mesmo IP"; done
[ "$(signup_as 203.0.113.1 um6)" = 429 ] || proxy_die "limite por IP não valeu para o IP informado pelo proxy"
[ "$(signup_as 203.0.113.2 dois1)" = 201 ] || proxy_die "outro IP atrás do mesmo proxy foi bloqueado"
[ "$(signup_as '203.0.113.1, 198.51.100.50' tres1)" = 201 ] || proxy_die "IP forjado à esquerda do X-Forwarded-For foi usado"
[ "$(signup_as '198.51.100.60, 203.0.113.1' tres2)" = 429 ] || proxy_die "IP forjado à esquerda driblou o limite"
ok "o limite por IP usa o IP de quem acessa informado pelo proxy, e o que vem à esquerda dele não é aceito"

proxy_up 192.0.2.1/32
! grep -qi '^set-cookie:.*; Secure' <<<"$setup_headers" || proxy_die "X-Forwarded-Proto aceito de fora de TRUSTED_PROXIES"
for i in 1 2 3 4 5; do [ "$(signup_as "203.0.113.1$i" "qu$i")" = 201 ] || proxy_die "cadastro $i sem proxy confiável"; done
[ "$(signup_as 203.0.113.20 qu6)" = 429 ] || proxy_die "X-Forwarded-For aceito de fora de TRUSTED_PROXIES"
proxy_cleanup
ok "fora de TRUSTED_PROXIES, X-Forwarded-For e X-Forwarded-Proto são ignorados"

[ "$(docker run --rm -e DOMAIN=localhost -e TLS=proxy -e TURN_DOMAIN=turn.localhost "$IMAGE" 2>&1 | grep -c 'TURN_DOMAIN não funciona com TLS=proxy')" = 1 ] \
  || die "TURN com TLS=proxy deveria ser recusado"
[ "$(docker run --rm -e DOMAIN=localhost -e TLS=proxy -e 'TRUSTED_PROXIES=10.0.0.0/8 }' "$IMAGE" 2>&1 | grep -c 'TRUSTED_PROXIES inválido')" = 1 ] \
  || die "TRUSTED_PROXIES malformado deveria ser recusado"
ok "TLS=proxy recusa TURN_DOMAIN e TRUSTED_PROXIES malformado, com explicação"

docker stop "$NAME" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = 0 ] || die "desligamento não foi limpo"
ok "desliga limpo com docker stop"
