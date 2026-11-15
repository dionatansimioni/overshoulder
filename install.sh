#!/usr/bin/env bash
# Instalador do Overshoulder para Ubuntu e Debian (amd64 e arm64):
#   curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh | sudo bash
#
# Pergunta como o servidor vai ser acessado, instala o Docker se faltar, abre o firewall,
# sobe o container com Docker Compose em /opt/overshoulder e instala o comando "overshoulder".
#
# Sem perguntas (ex.: automação), passe as respostas pelo ambiente:
#   MODE=domain|ip|lan|proxy DOMAIN=... [NODE_IP=...] [PROXY_PORT=8080] OVERSHOULDER_YES=1
# Outras variáveis: OVERSHOULDER_VERSION (padrão latest), HTTP_PORT, HTTPS_PORT, RTC_TCP_PORT,
# RTC_UDP_PORT, OVERSHOULDER_SKIP_FIREWALL=1. As de nome OVERSHOULDER_DIR, _BIN, _NAME e _IMAGE
# servem para testes.
set -euo pipefail

IMAGE=${OVERSHOULDER_IMAGE:-ghcr.io/dionatansimioni/overshoulder}
VERSION=${OVERSHOULDER_VERSION:-latest}
DIR=${OVERSHOULDER_DIR:-/opt/overshoulder}
BIN=${OVERSHOULDER_BIN:-/usr/local/bin/overshoulder}
NAME=${OVERSHOULDER_NAME:-overshoulder}
DOCS=https://github.com/dionatansimioni/overshoulder/blob/main/docs

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say() { printf '%s\n' "$*"; }
warn() { printf '\033[33mAtenção:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

# Com "curl | bash", a entrada padrão é o próprio script: as respostas vêm do terminal
interactive() { [ -z "${OVERSHOULDER_YES:-}" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; }
# ask "pergunta" "padrão" → resposta (ou o padrão, sem terminal)
ask() {
  local answer=''
  if interactive; then
    printf '%s%s: ' "$1" "${2:+ [$2]}" >/dev/tty
    read -r answer </dev/tty || true
  fi
  printf '%s' "${answer:-$2}"
}
confirm() { [[ "$(ask "$1 [s/N]" "${2:-n}")" =~ ^[sS] ]]; }

HOST_RE='^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$'
IP_RE='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
private_ip() { [[ "$1" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.) ]]; }
port_busy() { ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }

# --- sistema --------------------------------------------------------------

bold "Overshoulder: instalação"
[ "$(id -u)" = 0 ] || die "rode como root: curl -fsSL … | sudo bash"
case "$(uname -m)" in
  x86_64 | amd64) ;;
  aarch64 | arm64) ;;
  *) die "arquitetura $(uname -m) não suportada: a imagem existe para amd64 e arm64." ;;
esac
os_id=$( . /etc/os-release 2>/dev/null && echo "${ID:-} ${ID_LIKE:-}" || true)
if [[ ! "$os_id" =~ (ubuntu|debian) ]]; then
  warn "o instalador foi feito para Ubuntu e Debian. Em outros sistemas, prefira o Docker Compose manual: $DOCS/instalacao.md"
  confirm "Continuar mesmo assim?" || exit 1
fi

if [ -f "$DIR/.env" ]; then
  say "O Overshoulder já está instalado em $DIR."
  say "Para atualizar: overshoulder update. Para reinstalar do zero: overshoulder uninstall e rode este instalador de novo."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  say "O Docker não está instalado. Ele será instalado pelo script oficial (get.docker.com)."
  confirm "Instalar o Docker agora?" s || die "o Overshoulder precisa do Docker."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "falta o Docker Compose (plugin \"docker compose\"). Instale o pacote docker-compose-plugin."
docker info >/dev/null 2>&1 || die "o Docker está instalado, mas não respondeu. Confira com: systemctl status docker"

# --- como o servidor vai ser acessado ------------------------------------------

HTTP_PORT=${HTTP_PORT:-80}
HTTPS_PORT=${HTTPS_PORT:-443}
RTC_TCP_PORT=${RTC_TCP_PORT:-7881}
RTC_UDP_PORT=${RTC_UDP_PORT:-7882}
local_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' || true)

busy=''
port_busy "$HTTP_PORT" && busy="$HTTP_PORT"
port_busy "$HTTPS_PORT" && busy="${busy:+$busy e }$HTTPS_PORT"
if [ -n "$busy" ]; then
  warn "a porta $busy já está em uso neste servidor."
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'coolify-proxy'; then
    say "Este servidor usa o Coolify. Instale o Overshoulder pelo próprio Coolify, como um recurso Docker Compose:"
    say "  $DOCS/proxy.md#coolify"
    confirm "Instalar mesmo assim, atrás de outro proxy (opção 4)?" || exit 0
  fi
fi

mode=${MODE:-}
if [ -z "$mode" ]; then
  default=1
  [ -n "$busy" ] && default=4
  say ""
  say "Como as pessoas vão chegar ao servidor?"
  say "  1) Pela internet, com um domínio (ex.: live.seudominio.com). O recomendado."
  say "  2) Pela internet, sem domínio: certificado no IP público"
  say "  3) Só pela rede local (casa ou empresa), pelo IP"
  say "  4) Atrás de um proxy que já existe aqui (Nginx, Caddy, Traefik), que cuida do HTTPS"
  case "$(ask "Escolha" "$default")" in
    1) mode=domain ;; 2) mode=ip ;; 3) mode=lan ;; 4) mode=proxy ;;
    *) die "opção inválida." ;;
  esac
fi

tls=acme node_ip=${NODE_IP:-} domain=${DOMAIN:-} proxy_port=${PROXY_PORT:-8080}
case "$mode" in
  domain | proxy)
    [ -n "$domain" ] || domain=$(ask "Domínio (ex.: live.seudominio.com)" "")
    [[ "$domain" =~ $HOST_RE ]] && [[ ! "$domain" =~ $IP_RE ]] || die "domínio inválido: \"$domain\"."
    resolved=$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR == 1 {print $1}' || true)
    if [ "$mode" = domain ]; then
      if [ -z "$resolved" ]; then
        warn "$domain ainda não aponta para nenhum IP. Crie no seu provedor de DNS um registro A para o IP deste servidor; o certificado só sai depois disso."
      elif [ -n "$local_ip" ] && ! private_ip "$local_ip" && [ "$resolved" != "$local_ip" ]; then
        warn "$domain aponta para $resolved, mas este servidor parece ser $local_ip. Confira o registro A no DNS."
      fi
    fi
    if [ "$mode" = proxy ]; then
      tls=proxy
      proxy_port=$(ask "Porta local para o seu proxy repassar o site" "$proxy_port")
      [[ "$proxy_port" =~ ^[0-9]+$ ]] || die "porta inválida."
    fi
    ;;
  ip)
    [ -n "$domain" ] || domain=$(ask "IP público deste servidor" "$local_ip")
    [[ "$domain" =~ $IP_RE ]] || die "IP inválido: \"$domain\"."
    private_ip "$domain" && die "$domain é um IP de rede privada: o Let's Encrypt não emite certificado para ele. Use a opção 3 (rede local)."
    ;;
  lan)
    [ -n "$domain" ] || domain=$(ask "IP deste servidor na rede" "$local_ip")
    [[ "$domain" =~ $IP_RE ]] || die "IP inválido: \"$domain\"."
    tls=local
    node_ip=${node_ip:-$domain}
    ;;
  *) die "MODE inválido: use domain, ip, lan ou proxy." ;;
esac
[ -z "$node_ip" ] || [[ "$node_ip" =~ $IP_RE ]] || die "NODE_IP inválido: \"$node_ip\"."

# --- firewall -------------------------------------------------------------

web_ports="$HTTP_PORT $HTTPS_PORT"
[ "$mode" = proxy ] && web_ports=''
open_ports() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    for p in $web_ports "$RTC_TCP_PORT"; do ufw allow "$p/tcp" >/dev/null; done
    ufw allow "$RTC_UDP_PORT/udp" >/dev/null
    say "Firewall (ufw): portas liberadas."
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    for p in $web_ports "$RTC_TCP_PORT"; do firewall-cmd --permanent --add-port="$p/tcp" >/dev/null; done
    firewall-cmd --permanent --add-port="$RTC_UDP_PORT/udp" >/dev/null
    firewall-cmd --reload >/dev/null
    say "Firewall (firewalld): portas liberadas."
  fi
}
[ -n "${OVERSHOULDER_SKIP_FIREWALL:-}" ] || open_ports

# --- arquivos e container ------------------------------------------------------

mkdir -p "$DIR"
if [ "$mode" = proxy ]; then
  # O site fica só para este servidor: o acesso de fora passa pelo proxy
  web="      - \"127.0.0.1:$proxy_port:$HTTP_PORT\""
else
  web="      - \"$HTTP_PORT:$HTTP_PORT\"
      - \"$HTTPS_PORT:$HTTPS_PORT\""
fi
cat >"$DIR/compose.yml" <<EOF
# Gerado pelo instalador do Overshoulder. A configuração fica no .env ao lado.
# Atualizar: overshoulder update. Dados: volume $NAME-data (faça backup com overshoulder backup).
name: $NAME
services:
  overshoulder:
    image: $IMAGE:\${OVERSHOULDER_VERSION:-latest}
    container_name: $NAME
    restart: unless-stopped
    env_file: .env
    ports:
$web
      - "$RTC_TCP_PORT:$RTC_TCP_PORT"
      - "$RTC_UDP_PORT:$RTC_UDP_PORT/udp"
    volumes:
      - data:/data

volumes:
  data:
    name: $NAME-data
EOF

umask 077
cat >"$DIR/.env" <<EOF
OVERSHOULDER_VERSION=$VERSION
DOMAIN=$domain
TLS=$tls
NODE_IP=$node_ip
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT
RTC_TCP_PORT=$RTC_TCP_PORT
RTC_UDP_PORT=$RTC_UDP_PORT
INSTALL_METHOD=installer
EOF
umask 022

# Comando "overshoulder" do servidor: guarda onde está a instalação
mkdir -p "$(dirname "$BIN")"
cat >"$BIN" <<'EOF'
#!/usr/bin/env bash
# Comando do Overshoulder, instalado pelo instalador. Uso: overshoulder <comando>
set -euo pipefail
DIR=__DIR__
NAME=__NAME__
compose() { docker compose --project-directory "$DIR" -f "$DIR/compose.yml" "$@"; }
need_root() { [ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo overshoulder $1" >&2; exit 1; }; }
health() { docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo ausente; }
wait_healthy() {
  for _ in $(seq 120); do [ "$(health)" = healthy ] && return 0; sleep 1; done
  return 1
}
version() { docker exec "$NAME" overshoulder version 2>/dev/null || echo desconhecida; }

case "${1:-help}" in
  update)
    need_root update
    echo "Baixando a versão nova…"
    compose pull
    compose up -d
    if wait_healthy; then
      echo "Atualizado. Versão: $(version)"
    else
      echo "O container não ficou saudável. Veja: overshoulder logs" >&2
      exit 1
    fi
    ;;
  status)
    compose ps
    echo "Saúde: $(health) · Versão: $(version)"
    ;;
  logs) compose logs -f --tail 100 ;;
  config-code)
    code=$(docker logs "$NAME" 2>&1 | sed -n 's/.*"setupCode":"\([A-Z0-9-]*\)".*/\1/p' | tail -1)
    if docker logs "$NAME" 2>&1 | grep -q '"servidor configurado"'; then
      echo "O servidor já foi configurado. Perdeu a senha do admin? Use: overshoulder reset-admin"
    elif [ -n "$code" ]; then
      echo "Código de configuração: $code"
    else
      echo "O código ainda não apareceu. Espere o container subir e tente de novo (overshoulder status)." >&2
      exit 1
    fi
    ;;
  reset-admin) docker exec "$NAME" overshoulder reset-admin ;;
  backup)
    file="overshoulder-backup-$(date +%Y%m%d-%H%M%S).tgz"
    docker run --rm -v "$NAME-data:/data:ro" -v "$PWD:/backup" alpine tar czf "/backup/$file" -C /data .
    echo "Backup salvo em $PWD/$file. Guarde em lugar seguro: ele contém as chaves do servidor."
    ;;
  uninstall)
    need_root uninstall
    purge=${2:-}
    compose down
    if [ "$purge" = --purge ]; then
      docker volume rm "$NAME-data" >/dev/null && echo "Dados apagados."
    else
      echo "Os dados continuam no volume $NAME-data (para apagar: docker volume rm $NAME-data)."
    fi
    rm -rf "$DIR"
    rm -f "$0"
    echo "Overshoulder removido."
    ;;
  *)
    cat <<HELP
Uso: overshoulder <comando>
  update       baixa a versão nova e reinicia (mantém os dados)
  status       mostra se está rodando, a saúde e a versão
  logs         acompanha os logs
  config-code  mostra o código da primeira configuração
  reset-admin  gera um link para redefinir a senha do admin
  backup       salva os dados num arquivo nesta pasta
  uninstall    remove o Overshoulder (--purge apaga também os dados)
HELP
    ;;
esac
EOF
sed -i "s|__DIR__|$(printf '%q' "$DIR")|; s|__NAME__|$NAME|" "$BIN"
chmod 755 "$BIN"

say ""
say "Subindo o Overshoulder (a primeira vez baixa a imagem)…"
docker compose --project-directory "$DIR" -f "$DIR/compose.yml" up -d --quiet-pull
for _ in $(seq 120); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = healthy ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = healthy ] \
  || die "o container não ficou saudável. Veja os logs: overshoulder logs"

code=$(docker logs "$NAME" 2>&1 | sed -n 's/.*"setupCode":"\([A-Z0-9-]*\)".*/\1/p' | tail -1)
url="https://$domain"
[ "$mode" = proxy ] || [ "$HTTPS_PORT" = 443 ] || url="$url:$HTTPS_PORT"

say ""
bold "Pronto!"
say "1. Abra $url/configurar"
say "2. Use o código de configuração: ${code:-(rode: overshoulder config-code)}"
say ""
say "Libere também no painel do seu provedor (o firewall de lá é separado deste servidor):"
[ "$mode" = proxy ] || say "  - TCP $HTTP_PORT e $HTTPS_PORT (site e certificado)"
say "  - TCP $RTC_TCP_PORT e UDP $RTC_UDP_PORT (vídeo)"
case "$mode" in
  proxy)
    say ""
    say "Configure o seu proxy para repassar $domain para http://127.0.0.1:$proxy_port (com WebSocket)."
    say "Exemplos para Nginx, Caddy e Traefik: $DOCS/proxy.md"
    ;;
  lan)
    say ""
    say "O certificado é próprio: na primeira vez, cada navegador mostra um aviso (\"Avançado\" > \"Continuar\")."
    ;;
  ip)
    say ""
    say "O certificado no IP precisa da porta $HTTP_PORT aberta para a internet. Se ele falhar, veja $DOCS/instalacao.md#sem-domínio"
    ;;
esac
say ""
say "Comandos: overshoulder status | logs | update | backup | reset-admin | uninstall"
