#!/usr/bin/env bash
# Instalador do Overshoulder para Ubuntu e Debian (amd64 e arm64):
#   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh)"
#
# Não use "curl … | sudo bash": no Ubuntu 25.10 (sudo-rs 0.2.8), o script lido pelo cano não
# recebe o que se digita no terminal, nem o CTRL+C.
#
# Pergunta como o servidor vai ser acessado, instala o Docker se faltar, abre o firewall,
# sobe o container com Docker Compose em /opt/overshoulder e instala o comando "overshoulder".
#
# Sem perguntas (ex.: automação), passe as respostas pelo ambiente:
#   MODE=domain|ip|lan|proxy DOMAIN=... [NODE_IP=...] [PROXY_PORT=8080] OVERSHOULDER_YES=1
# Outras variáveis: OVERSHOULDER_VERSION (padrão latest), HTTP_PORT, HTTPS_PORT, RTC_TCP_PORT,
# RTC_UDP_PORT, OVERSHOULDER_SKIP_FIREWALL=1. As de nome OVERSHOULDER_DIR, _BIN, _NAME e _IMAGE
# servem para testes. Idioma: OVERSHOULDER_LANG=pt ou en; sem ela, vale o LANG do sistema (pt* → português,
# o resto → inglês).
set -euo pipefail

IMAGE=${OVERSHOULDER_IMAGE:-ghcr.io/dionatansimioni/overshoulder}
VERSION=${OVERSHOULDER_VERSION:-latest}
DIR=${OVERSHOULDER_DIR:-/opt/overshoulder}
BIN=${OVERSHOULDER_BIN:-/usr/local/bin/overshoulder}
NAME=${OVERSHOULDER_NAME:-overshoulder}
DOCS=https://github.com/dionatansimioni/overshoulder/blob/main/docs

# m "português" "english": cada mensagem leva as duas versões, lado a lado
case "${OVERSHOULDER_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in pt* | PT*) PT=1 ;; *) PT='' ;; esac
m() { if [ -n "$PT" ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say() { printf '%s\n' "$*"; }
warn() { printf '\033[33m%s\033[0m %s\n' "$(m 'Atenção:' 'Warning:')" "$*" >&2; }
die() { printf '\033[31m%s\033[0m %s\n' "$(m 'Erro:' 'Error:')" "$*" >&2; exit 1; }

INSTALL_CMD='sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/dionatansimioni/overshoulder/main/install.sh)"'
# As respostas vêm do terminal (/dev/tty), não da entrada padrão. Sem terminal (automação), valem os padrões.
interactive() { [ -z "${OVERSHOULDER_YES:-}" ] && { : </dev/tty; } 2>/dev/null; }
# ask "pergunta" "padrão" → resposta (ou o padrão, sem terminal)
ask() {
  local answer=''
  if interactive; then
    printf '%s%s: ' "$1" "${2:+ [$2]}" >/dev/tty
    if ! read -r answer </dev/tty; then
      # Terminal que abre mas não entrega o que se digita (curl | sudo-rs) ou CTRL+D: para tudo, sem
      # seguir com respostas vazias. Roda numa subshell ($(ask …)): o kill encerra o instalador.
      printf '\n\033[31m%s\033[0m %s\n  %s\n' "$(m 'Erro:' 'Error:')" \
        "$(m 'não recebi sua resposta pelo terminal. Rode o instalador assim:' "your answer didn't reach the installer through the terminal. Run it like this:")" \
        "$INSTALL_CMD" >&2
      kill -TERM $$
      exit 1
    fi
  fi
  printf '%s' "${answer:-$2}"
}
# confirm "pergunta" [y]: sim ou não; com "y", Enter vale sim. Aceita s ou y em qualquer idioma.
confirm() {
  local def=${2:-n} hint answer
  if [ "$def" = y ]; then hint=$(m '[S/n]' '[Y/n]'); else hint=$(m '[s/N]' '[y/N]'); fi
  answer=$(ask "$1 $hint" '')
  [[ "${answer:-$def}" =~ ^[sSyY] ]]
}

HOST_RE='^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$'
IP_RE='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
private_ip() { [[ "$1" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.) ]]; }
port_busy() { ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }

# --- sistema --------------------------------------------------------------

bold "$(m 'Overshoulder: instalação' 'Overshoulder: installation')"
[ "$(id -u)" = 0 ] || die "$(m 'rode como root:' 'run it as root:') $INSTALL_CMD"
case "$(uname -m)" in
  x86_64 | amd64) ;;
  aarch64 | arm64) ;;
  *) die "$(m "arquitetura $(uname -m) não suportada: a imagem existe para amd64 e arm64." "architecture $(uname -m) is not supported: the image is built for amd64 and arm64.")" ;;
esac
os_id=$( . /etc/os-release 2>/dev/null && echo "${ID:-} ${ID_LIKE:-}" || true)
if [[ ! "$os_id" =~ (ubuntu|debian) ]]; then
  warn "$(m "o instalador foi feito para Ubuntu e Debian. Em outros sistemas, prefira o Docker Compose manual: $DOCS/pt-BR/install.md" \
    "the installer was made for Ubuntu and Debian. On other systems, prefer a manual Docker Compose setup: $DOCS/install.md")"
  confirm "$(m 'Continuar mesmo assim?' 'Continue anyway?')" || exit 1
fi

if [ -f "$DIR/.env" ]; then
  say "$(m "O Overshoulder já está instalado em $DIR." "Overshoulder is already installed in $DIR.")"
  say "$(m 'Para atualizar: overshoulder update. Para reinstalar do zero: overshoulder uninstall e rode este instalador de novo.' \
    'To update: overshoulder update. To start over: overshoulder uninstall, then run this installer again.')"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  say "$(m 'O Docker não está instalado. Ele será instalado pelo script oficial (get.docker.com).' \
    'Docker is not installed. It will be installed with the official script (get.docker.com).')"
  confirm "$(m 'Instalar o Docker agora?' 'Install Docker now?')" y || die "$(m 'o Overshoulder precisa do Docker.' 'Overshoulder needs Docker.')"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "$(m 'falta o Docker Compose (plugin "docker compose"). Instale o pacote docker-compose-plugin.' \
  'Docker Compose is missing (the "docker compose" plugin). Install the docker-compose-plugin package.')"
docker info >/dev/null 2>&1 || die "$(m 'o Docker está instalado, mas não respondeu. Confira com: systemctl status docker' \
  "Docker is installed but didn't respond. Check it with: systemctl status docker")"

# --- como o servidor vai ser acessado ------------------------------------------

HTTP_PORT=${HTTP_PORT:-80}
HTTPS_PORT=${HTTPS_PORT:-443}
RTC_TCP_PORT=${RTC_TCP_PORT:-7881}
RTC_UDP_PORT=${RTC_UDP_PORT:-7882}
local_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' || true)

busy=''
port_busy "$HTTP_PORT" && busy="$HTTP_PORT"
port_busy "$HTTPS_PORT" && busy="${busy:+$busy $(m e and) }$HTTPS_PORT"
if [ -n "$busy" ]; then
  warn "$(m "a porta $busy já está em uso neste servidor." "port $busy is already in use on this server.")"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'coolify-proxy'; then
    say "$(m 'Este servidor usa o Coolify. Instale o Overshoulder pelo próprio Coolify, como um recurso Docker Compose:' \
      'This server runs Coolify. Install Overshoulder through Coolify itself, as a Docker Compose resource:')"
    say "  $DOCS/$(m pt-BR/proxy.md#coolify proxy.md#coolify)"
    confirm "$(m 'Instalar mesmo assim, atrás de outro proxy (opção 4)?' 'Install anyway, behind another proxy (option 4)?')" || exit 0
  fi
fi

mode=${MODE:-}
if [ -z "$mode" ]; then
  default=1
  [ -n "$busy" ] && default=4
  say ""
  say "$(m 'Como as pessoas vão chegar ao servidor?' 'How will people reach this server?')"
  say "  1) $(m 'Pela internet, com um domínio (ex.: live.seudominio.com). O recomendado.' 'Over the internet, with a domain (e.g. live.yourdomain.com). Recommended.')"
  say "  2) $(m 'Pela internet, sem domínio: certificado no IP público' 'Over the internet, without a domain: certificate on the public IP')"
  say "  3) $(m 'Só pela rede local (casa ou empresa), pelo IP' 'Only on the local network (home or office), by IP')"
  say "  4) $(m 'Atrás de um proxy que já existe aqui (Nginx, Caddy, Traefik), que cuida do HTTPS' 'Behind a proxy already running here (Nginx, Caddy, Traefik) that handles HTTPS')"
  case "$(ask "$(m Escolha Choose)" "$default")" in
    1) mode=domain ;; 2) mode=ip ;; 3) mode=lan ;; 4) mode=proxy ;;
    *) die "$(m 'opção inválida.' 'invalid option.')" ;;
  esac
fi

tls=acme node_ip=${NODE_IP:-} domain=${DOMAIN:-} proxy_port=${PROXY_PORT:-8080}
case "$mode" in
  domain | proxy)
    [ -n "$domain" ] || domain=$(ask "$(m 'Domínio (ex.: live.seudominio.com)' 'Domain (e.g. live.yourdomain.com)')" "")
    [[ "$domain" =~ $HOST_RE ]] && [[ ! "$domain" =~ $IP_RE ]] || die "$(m 'domínio inválido:' 'invalid domain:') \"$domain\"."
    resolved=$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR == 1 {print $1}' || true)
    if [ "$mode" = domain ]; then
      if [ -z "$resolved" ]; then
        warn "$(m "$domain ainda não aponta para nenhum IP. Crie no seu provedor de DNS um registro A para o IP deste servidor; o certificado só sai depois disso." \
          "$domain doesn't point to any IP yet. Create an A record for this server's IP at your DNS provider; the certificate is only issued after that.")"
      elif [ -n "$local_ip" ] && ! private_ip "$local_ip" && [ "$resolved" != "$local_ip" ]; then
        warn "$(m "$domain aponta para $resolved, mas este servidor parece ser $local_ip. Confira o registro A no DNS." \
          "$domain points to $resolved, but this server seems to be $local_ip. Check the A record in your DNS.")"
      fi
    fi
    if [ "$mode" = proxy ]; then
      tls=proxy
      proxy_port=$(ask "$(m 'Porta local para o seu proxy repassar o site' 'Local port for your proxy to forward the site to')" "$proxy_port")
      [[ "$proxy_port" =~ ^[0-9]+$ ]] || die "$(m 'porta inválida.' 'invalid port.')"
    fi
    ;;
  ip)
    [ -n "$domain" ] || domain=$(ask "$(m 'IP público deste servidor' "This server's public IP")" "$local_ip")
    [[ "$domain" =~ $IP_RE ]] || die "$(m 'IP inválido:' 'invalid IP:') \"$domain\"."
    private_ip "$domain" && die "$(m "$domain é um IP de rede privada: o Let's Encrypt não emite certificado para ele. Use a opção 3 (rede local)." \
      "$domain is a private network IP: Let's Encrypt doesn't issue certificates for it. Use option 3 (local network).")"
    ;;
  lan)
    [ -n "$domain" ] || domain=$(ask "$(m 'IP deste servidor na rede' "This server's IP on the network")" "$local_ip")
    [[ "$domain" =~ $IP_RE ]] || die "$(m 'IP inválido:' 'invalid IP:') \"$domain\"."
    tls=local
    node_ip=${node_ip:-$domain}
    ;;
  *) die "$(m 'MODE inválido: use domain, ip, lan ou proxy.' 'invalid MODE: use domain, ip, lan or proxy.')" ;;
esac
[ -z "$node_ip" ] || [[ "$node_ip" =~ $IP_RE ]] || die "$(m 'NODE_IP inválido:' 'invalid NODE_IP:') \"$node_ip\"."

# --- firewall -------------------------------------------------------------

web_ports="$HTTP_PORT $HTTPS_PORT"
[ "$mode" = proxy ] && web_ports=''
open_ports() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    for p in $web_ports "$RTC_TCP_PORT"; do ufw allow "$p/tcp" >/dev/null; done
    ufw allow "$RTC_UDP_PORT/udp" >/dev/null
    say "$(m 'Firewall (ufw): portas liberadas.' 'Firewall (ufw): ports opened.')"
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    for p in $web_ports "$RTC_TCP_PORT"; do firewall-cmd --permanent --add-port="$p/tcp" >/dev/null; done
    firewall-cmd --permanent --add-port="$RTC_UDP_PORT/udp" >/dev/null
    firewall-cmd --reload >/dev/null
    say "$(m 'Firewall (firewalld): portas liberadas.' 'Firewall (firewalld): ports opened.')"
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

# Sem segredos aqui (eles ficam no volume, em /data): legível para quem usa o comando sem sudo,
# como "overshoulder status", que precisa do .env para o Compose
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
chmod 644 "$DIR/.env"

# Comando "overshoulder" do servidor: guarda onde está a instalação
mkdir -p "$(dirname "$BIN")"
cat >"$BIN" <<'EOF'
#!/usr/bin/env bash
# Comando do Overshoulder, instalado pelo instalador. Uso: overshoulder <comando>
# Idioma: OVERSHOULDER_LANG=pt ou en; sem ela, o LANG do sistema (pt* → português, o resto → inglês).
set -euo pipefail
DIR=__DIR__
NAME=__NAME__
case "${OVERSHOULDER_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in pt* | PT*) PT=1 ;; *) PT='' ;; esac
m() { if [ -n "$PT" ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
compose() { docker compose --project-directory "$DIR" -f "$DIR/compose.yml" "$@"; }
need_root() { [ "$(id -u)" = 0 ] || { echo "$(m 'Rode com sudo:' 'Run it with sudo:') sudo overshoulder $1" >&2; exit 1; }; }
health() { docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || m ausente missing; }
wait_healthy() {
  for _ in $(seq 120); do [ "$(health)" = healthy ] && return 0; sleep 1; done
  return 1
}
version() { docker exec "$NAME" overshoulder version 2>/dev/null || m desconhecida unknown; }

case "${1:-help}" in
  update)
    need_root update
    m 'Baixando a versão nova…' 'Downloading the new version…'; echo
    compose pull
    compose up -d
    if wait_healthy; then
      echo "$(m 'Atualizado. Versão:' 'Updated. Version:') $(version)"
    else
      echo "$(m "O container não ficou saudável. Veja: overshoulder logs" "The container didn't become healthy. See: overshoulder logs")" >&2
      exit 1
    fi
    ;;
  status)
    compose ps
    echo "$(m Saúde Health): $(health) · $(m Versão Version): $(version)"
    ;;
  logs) compose logs -f --tail 100 ;;
  config-code)
    code=$(docker logs "$NAME" 2>&1 | sed -n 's/.*"setupCode":"\([A-Z0-9-]*\)".*/\1/p' | tail -1)
    if docker logs "$NAME" 2>&1 | grep -q '"servidor configurado"'; then
      m 'O servidor já foi configurado. Perdeu a senha do admin? Use: overshoulder reset-admin' \
        'The server is already set up. Lost the admin password? Use: overshoulder reset-admin'; echo
    elif [ -n "$code" ]; then
      echo "$(m 'Código de configuração:' 'Setup code:') $code"
    else
      echo "$(m 'O código ainda não apareceu. Espere o container subir e tente de novo (overshoulder status).' \
        "The code hasn't shown up yet. Wait for the container to start and try again (overshoulder status).")" >&2
      exit 1
    fi
    ;;
  reset-admin) docker exec -e "OVERSHOULDER_LANG=$(m pt en)" "$NAME" overshoulder reset-admin ;;
  backup)
    file="overshoulder-backup-$(date +%Y%m%d-%H%M%S).tgz"
    docker run --rm -v "$NAME-data:/data:ro" -v "$PWD:/backup" alpine tar czf "/backup/$file" -C /data .
    echo "$(m "Backup salvo em $PWD/$file. Guarde em lugar seguro: ele contém as chaves do servidor." \
      "Backup saved to $PWD/$file. Keep it somewhere safe: it holds the server keys.")"
    ;;
  uninstall)
    need_root uninstall
    purge=${2:-}
    compose down
    if [ "$purge" = --purge ]; then
      docker volume rm "$NAME-data" >/dev/null && m 'Dados apagados.' 'Data deleted.' && echo
    else
      echo "$(m "Os dados continuam no volume $NAME-data (para apagar: docker volume rm $NAME-data)." \
        "The data stays in the $NAME-data volume (to delete it: docker volume rm $NAME-data).")"
    fi
    rm -rf "$DIR"
    rm -f "$0"
    m 'Overshoulder removido.' 'Overshoulder removed.'; echo
    ;;
  *)
    if [ -n "$PT" ]; then
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
    else
      cat <<HELP
Usage: overshoulder <command>
  update       downloads the new version and restarts (keeps the data)
  status       shows whether it is running, its health and version
  logs         follows the logs
  config-code  shows the first-setup code
  reset-admin  creates a link to reset the admin password
  backup       saves the data to a file in this folder
  uninstall    removes Overshoulder (--purge also deletes the data)
HELP
    fi
    ;;
esac
EOF
sed -i "s|__DIR__|$(printf '%q' "$DIR")|; s|__NAME__|$NAME|" "$BIN"
chmod 755 "$BIN"

say ""
say "$(m 'Subindo o Overshoulder (a primeira vez baixa a imagem)…' 'Starting Overshoulder (the first time downloads the image)…')"
docker compose --project-directory "$DIR" -f "$DIR/compose.yml" up -d --quiet-pull
for _ in $(seq 120); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = healthy ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = healthy ] \
  || die "$(m 'o container não ficou saudável. Veja os logs: overshoulder logs' "the container didn't become healthy. See the logs: overshoulder logs")"

code=$(docker logs "$NAME" 2>&1 | sed -n 's/.*"setupCode":"\([A-Z0-9-]*\)".*/\1/p' | tail -1)
url="https://$domain"
[ "$mode" = proxy ] || [ "$HTTPS_PORT" = 443 ] || url="$url:$HTTPS_PORT"

say ""
bold "$(m Pronto! Done!)"
say "1. $(m Abra Open) $url/setup"
say "2. $(m 'Use o código de configuração:' 'Use the setup code:') ${code:-$(m '(rode: overshoulder config-code)' '(run: overshoulder config-code)')}"
say ""
say "$(m 'Se o seu provedor tem firewall no painel, libere estas portas lá também. No Oracle Cloud, AWS e Google Cloud ele vem ligado; na Hostinger, só vale se você aplicar um.' \
  "If your provider has a firewall in its panel, open these ports there too. On Oracle Cloud, AWS and Google Cloud it is on by default; on Hostinger, it only applies if you set one up.")"
[ "$mode" = proxy ] || say "  - TCP $HTTP_PORT $(m e and) $HTTPS_PORT ($(m 'site e certificado' 'site and certificate'))"
say "  - TCP $RTC_TCP_PORT $(m e and) UDP $RTC_UDP_PORT ($(m vídeo video))"
case "$mode" in
  proxy)
    say ""
    say "$(m "Configure o seu proxy para repassar $domain para http://127.0.0.1:$proxy_port (com WebSocket)." \
      "Set up your proxy to forward $domain to http://127.0.0.1:$proxy_port (with WebSocket).")"
    say "$(m 'Exemplos para Nginx, Caddy e Traefik:' 'Examples for Nginx, Caddy and Traefik:') $DOCS/$(m pt-BR/proxy.md proxy.md)"
    ;;
  lan)
    say ""
    say "$(m 'O certificado é próprio: na primeira vez, cada navegador mostra um aviso ("Avançado" > "Continuar").' \
      'The certificate is self-signed: the first time, each browser shows a warning ("Advanced" > "Proceed").')"
    ;;
  ip)
    say ""
    say "$(m "O certificado no IP precisa da porta $HTTP_PORT aberta para a internet. Se ele falhar, veja" \
      "The IP certificate needs port $HTTP_PORT open to the internet. If it fails, see") $DOCS/$(m pt-BR/install.md#sem-domínio install.md#without-a-domain)"
    ;;
esac
say ""
say "$(m Comandos Commands): overshoulder status | logs | update | backup | reset-admin | uninstall"
