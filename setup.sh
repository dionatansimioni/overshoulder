#!/usr/bin/env bash
# Gera o .env com segredos aleatórios. Rode uma vez: ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  read -rp ".env já existe. Sobrescrever? [s/N] " ans
  [[ "$ans" =~ ^[sS]$ ]] || exit 0
fi

rand() { head -c "$1" /dev/urandom | base64 | tr -d '/+=\n' | head -c "$2"; }

lan_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')

echo "Onde o Overshoulder vai rodar?"
echo "  1) VPS com domínio (amigos pela internet)"
echo "  2) Rede local, pelo IP${lan_ip:+ ($lan_ip)}"
echo "  3) Só nesta máquina (localhost, para testes)"
read -rp "Escolha [1-3]: " mode

case "$mode" in
  1)
    read -rp "Domínio (ex.: overshoulder.seudominio.com): " domain
    [[ -n "$domain" ]] || { echo "Domínio obrigatório." >&2; exit 1; }
    ;;
  2)
    read -rp "IP desta máquina na rede [$lan_ip]: " ip
    ip=${ip:-$lan_ip}
    [[ -n "$ip" ]] || { echo "IP obrigatório." >&2; exit 1; }
    ;;
  3) ;;
  *) echo "Opção inválida." >&2; exit 1 ;;
esac

read -rsp "Senha para criar salas (vazio = gerar uma): " password; echo
password=${password:-$(rand 18 20)}

case "$mode" in
  1)
    cat > .env <<EOF
COMPOSE_PROFILES=prod
DOMAIN=$domain
CADDY_GLOBAL_OPTIONS=
LIVEKIT_PUBLIC_URL=wss://$domain
LIVEKIT_CONFIG_FILE=livekit.yaml
NODE_IP=
TRUST_PROXY=1
EOF
    url="https://$domain"
    ;;
  2)
    # Navegadores só liberam captura de tela e E2EE em HTTPS, então o Caddy usa certificado próprio
    cat > .env <<EOF
COMPOSE_PROFILES=prod
DOMAIN=$ip
CADDY_GLOBAL_OPTIONS=local_certs
LIVEKIT_PUBLIC_URL=wss://$ip
LIVEKIT_CONFIG_FILE=livekit.dev.yaml
NODE_IP=$ip
TRUST_PROXY=1
EOF
    url="https://$ip"
    ;;
  3)
    cat > .env <<EOF
COMPOSE_PROFILES=
DOMAIN=
CADDY_GLOBAL_OPTIONS=
LIVEKIT_PUBLIC_URL=ws://localhost:7880
LIVEKIT_CONFIG_FILE=livekit.dev.yaml
NODE_IP=127.0.0.1
TRUST_PROXY=0
EOF
    url="http://localhost:3000"
    ;;
esac

cat >> .env <<EOF
LIVEKIT_API_KEY=API$(rand 12 12)
LIVEKIT_API_SECRET=$(rand 48 48)
HOST_KEY_SECRET=$(rand 48 48)
CREATE_PASSWORD=$password
EOF
chmod 600 .env

echo
echo "Pronto. Suba com:  docker compose up -d --build"
echo "Acesse:            $url"
echo "Senha das salas:   $password"
if [[ "$mode" == 2 ]]; then
  echo
  echo "O certificado é próprio: na primeira vez, cada navegador vai mostrar um aviso."
  echo "Clique em 'Avançado' > 'Continuar para $ip'."
fi
