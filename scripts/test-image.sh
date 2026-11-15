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

docker stop "$NAME" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = 0 ] || die "desligamento não foi limpo"
ok "desliga limpo com docker stop"
