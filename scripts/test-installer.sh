#!/usr/bin/env bash
# Testa o instalador (install.sh) de verdade: instala a imagem de teste a partir de um registro
# local, confere o comando "overshoulder" (status, config-code, reset-admin, update, backup e
# uninstall) e os modos proxy e de validação. Usa portas altas e pastas temporárias.
# Precisa da imagem overshoulder:test (gerada por scripts/test-image.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY_IMAGE=registry:2.8.3
REGISTRY=overshoulder-test-registry
REG=127.0.0.1:15000
NAME=overshoulder-test-install
TMP=$(mktemp -d)
chmod 755 "$TMP"
SUDO=''
[ "$(id -u)" = 0 ] || SUDO='sudo -E'

cleanup() {
  docker rm -f "$NAME" "$REGISTRY" >/dev/null 2>&1 || true
  docker volume rm -f "$NAME-data" >/dev/null 2>&1 || true
  $SUDO rm -rf "$TMP"
}
trap cleanup EXIT
cleanup
mkdir -p "$TMP"

ok() { echo "  ✔ $*"; }
die() {
  echo "  ✖ $*" >&2
  docker logs --tail 20 "$NAME" >&2 2>&1 || true
  exit 1
}

echo "== instalador"
docker image inspect overshoulder:test >/dev/null 2>&1 || docker build -q -t overshoulder:test . >/dev/null
docker run -d --name "$REGISTRY" -p "$REG:5000" "$REGISTRY_IMAGE" >/dev/null
for _ in $(seq 30); do curl -sf "http://$REG/v2/" >/dev/null && break; sleep 1; done
docker tag overshoulder:test "$REG/overshoulder:test"
docker push -q "$REG/overshoulder:test" >/dev/null

export OVERSHOULDER_IMAGE="$REG/overshoulder" OVERSHOULDER_VERSION=test OVERSHOULDER_NAME="$NAME" \
  OVERSHOULDER_DIR="$TMP/opt" OVERSHOULDER_BIN="$TMP/bin/overshoulder" OVERSHOULDER_YES=1 OVERSHOULDER_SKIP_FIREWALL=1 \
  HTTP_PORT=18090 HTTPS_PORT=18493 RTC_TCP_PORT=17891 RTC_UDP_PORT=17892
BIN="$TMP/bin/overshoulder"
BASE=https://127.0.0.1:18493
install_with() { env "$@" $SUDO bash install.sh </dev/null 2>&1; }

# --- validação das respostas --------------------------------------------------
out=$(install_with MODE=ip DOMAIN=192.168.1.5 || true)
grep -q 'IP de rede privada' <<<"$out" || die "IP privado no modo sem domínio deveria ser recusado: $out"
out=$(install_with MODE=domain DOMAIN='live_errado' || true)
grep -q 'domínio inválido' <<<"$out" || die "domínio inválido deveria ser recusado: $out"
out=$(install_with MODE=nenhum DOMAIN=x.example.test || true)
grep -q 'MODE inválido' <<<"$out" || die "MODE inválido deveria ser recusado: $out"
[ ! -e "$TMP/opt/.env" ] || die "instalação recusada deixou arquivos para trás"
ok "respostas inválidas (IP privado sem domínio, domínio malformado, modo) são recusadas sem instalar nada"

# --- terminal que não entrega o que se digita ---------------------------------------
# No Ubuntu 25.10, "curl | sudo bash" abre o /dev/tty, mas a leitura falha. Aqui o terminal é um pty
# de verdade e a resposta é um CTRL+D: o instalador tem de parar e mostrar o comando certo, sem
# seguir com respostas vazias.
out=$(env -u OVERSHOULDER_YES python3 -I - "$SUDO" <<'PY' 2>&1 || true
import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp('sh', ['sh', '-c', f'{sys.argv[1]} bash install.sh'])
out, sent, t0 = b'', False, time.time()
while time.time() - t0 < 60:
    if select.select([fd], [], [], 0.2)[0]:
        try:
            chunk = os.read(fd, 1024)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if not sent and b'Escolha' in out:
        time.sleep(0.3)
        os.write(fd, b'\x04')
        sent = True
os.waitpid(pid, 0)
print(out.decode(errors='replace'))
PY
)
grep -q 'não recebi sua resposta pelo terminal' <<<"$out" && grep -qF 'sudo bash -c "$(curl -fsSL' <<<"$out" \
  || die "sem resposta no terminal, o instalador deveria parar e mostrar o comando certo: $out"
! grep -q 'Domínio\|Pronto!' <<<"$out" || die "o instalador seguiu adiante sem resposta: $out"
[ ! -e "$TMP/opt/.env" ] || die "instalação sem resposta deixou arquivos para trás"
ok "sem resposta pelo terminal, o instalador para e mostra o comando certo"

# --- rede local ---------------------------------------------------------------
out=$(install_with MODE=lan DOMAIN=127.0.0.1) || die "instalação na rede local falhou: $out"
grep -q 'Pronto!' <<<"$out" || die "instalador não terminou: $out"
code=$(sed -n 's/.*código de configuração: \([A-Z0-9-]*\)$/\1/p' <<<"$out")
[ -n "$code" ] || die "instalador não mostrou o código de configuração: $out"
grep -q "Abra https://127.0.0.1:18493/configurar" <<<"$out" || die "endereço errado no fim da instalação: $out"
[ "$(curl -sk "$BASE/healthz")" = '{"status":"ok"}' ] || die "site não respondeu depois da instalação"
# O .env não guarda segredos e precisa ser legível sem sudo (overshoulder status)
[ "$(stat -c %a "$TMP/opt/.env")" = 644 ] || die ".env deveria ter permissão 644"
! grep -qiE "secret|senha|password|key" "$TMP/opt/.env" || die ".env não deveria guardar segredos"
grep -qx 'TLS=local' "$TMP/opt/.env" && grep -qx 'NODE_IP=127.0.0.1' "$TMP/opt/.env" || die ".env da rede local: $(cat "$TMP/opt/.env")"
ok "modo rede local instala, sobe saudável e mostra o endereço e o código de configuração"

status=$($BIN status)
grep -q 'Saúde: healthy' <<<"$status" || die "overshoulder status: $status"
grep -q 'Versão: ' <<<"$status" && ! grep -q 'Versão: desconhecida' <<<"$status" || die "status sem versão: $status"
[ "$($BIN config-code)" = "Código de configuração: $code" ] || die "overshoulder config-code"
setup=$(curl -sk -X POST "$BASE/api/setup" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$code\",\"username\":\"admin\",\"password\":\"frase comprida do instalador\"}")
grep -q '"role":"admin"' <<<"$setup" || die "configuração inicial: $setup"
$BIN config-code | grep -q 'já foi configurado' || die "config-code depois de configurado"
$BIN reset-admin | grep -q '^https://127.0.0.1:18493/redefinir#' || die "overshoulder reset-admin"
ok "overshoulder status, config-code e reset-admin funcionam"

out=$(install_with MODE=lan DOMAIN=127.0.0.1)
grep -q 'já está instalado' <<<"$out" || die "segunda instalação deveria parar: $out"
ok "rodar o instalador de novo não mexe na instalação existente"

# Versão nova publicada no registro: o update troca a imagem e mantém os dados
old_image=$(docker inspect -f '{{.Image}}' "$NAME")
printf 'FROM %s\nLABEL overshoulder.test.update=2\n' "$REG/overshoulder:test" | docker build -q -t "$REG/overshoulder:test" - >/dev/null
docker push -q "$REG/overshoulder:test" >/dev/null
out=$($SUDO "$BIN" update 2>&1) || die "overshoulder update falhou: $out"
[ "$(docker inspect -f '{{.Image}}' "$NAME")" != "$old_image" ] || die "update não trocou a imagem"
[ "$(curl -sk "$BASE/api/state" | grep -o '"setupDone":true')" = '"setupDone":true' ] || die "update perdeu a configuração"
ok "overshoulder update baixa a versão nova, reinicia saudável e mantém os dados"

(cd "$TMP" && $SUDO "$BIN" backup >/dev/null)
backup=$(ls "$TMP"/overshoulder-backup-*.tgz)
tar tzf "$backup" | grep -q 'state.json' || die "backup sem state.json"
ok "overshoulder backup salva os dados num arquivo"

$SUDO "$BIN" uninstall --purge >/dev/null
! docker inspect "$NAME" >/dev/null 2>&1 || die "uninstall deixou o container"
! docker volume inspect "$NAME-data" >/dev/null 2>&1 || die "uninstall --purge deixou o volume"
[ ! -e "$TMP/opt" ] && [ ! -e "$BIN" ] || die "uninstall deixou arquivos"
ok "overshoulder uninstall --purge remove container, dados, pasta e comando"

# --- atrás de outro proxy --------------------------------------------------------
out=$(install_with MODE=proxy DOMAIN=live.example.test PROXY_PORT=18091) || die "instalação no modo proxy falhou: $out"
[ "$(curl -s http://127.0.0.1:18091/healthz)" = '{"status":"ok"}' ] || die "modo proxy não respondeu na porta local"
grep -q 'Abra https://live.example.test/configurar' <<<"$out" || die "endereço do modo proxy: $out"
grep -q '"127.0.0.1:18091:18090"' "$TMP/opt/compose.yml" || die "no modo proxy, o site deveria ficar só em 127.0.0.1"
! grep -q '18493' "$TMP/opt/compose.yml" || die "no modo proxy, a porta HTTPS não deveria ser publicada"
$SUDO "$BIN" uninstall --purge >/dev/null
ok "modo proxy publica o site só em 127.0.0.1 e mostra o endereço público"
