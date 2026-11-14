#!/usr/bin/env bash
# Gera o .env usado pelo docker-compose.yml. Rode uma vez: ./setup.sh
# Os segredos internos (LiveKit, chave de anfitrião) não ficam aqui: a imagem os gera em /data.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  read -rp ".env já existe. Sobrescrever? [s/N] " ans
  [[ "$ans" =~ ^[sS]$ ]] || exit 0
fi

rand() { head -c "$1" /dev/urandom | base64 | tr -d '/+=\n' | head -c "$2"; }

lan_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')

echo "Onde o Overshoulder vai rodar?"
echo "  1) Servidor com domínio (acesso pela internet)"
echo "  2) Rede local, pelo IP${lan_ip:+ ($lan_ip)}"
echo "  3) Só nesta máquina (localhost, para testes)"
read -rp "Escolha [1-3]: " mode

case "$mode" in
  1)
    read -rp "Domínio (ex.: live.seudominio.com): " domain
    [[ -n "$domain" ]] || { echo "Domínio obrigatório." >&2; exit 1; }
    tls=acme node_ip=
    ;;
  2)
    read -rp "IP desta máquina na rede [$lan_ip]: " domain
    domain=${domain:-$lan_ip}
    [[ -n "$domain" ]] || { echo "IP obrigatório." >&2; exit 1; }
    # Navegadores só liberam captura de tela e E2EE em HTTPS: o Caddy usa certificado próprio
    tls=local node_ip=$domain
    ;;
  3) domain=localhost tls=local node_ip=127.0.0.1 ;;
  *) echo "Opção inválida." >&2; exit 1 ;;
esac

read -rsp "Senha para criar salas (vazio = gerar uma): " password; echo
password=${password:-$(rand 18 20)}

http_port=${HTTP_PORT:-80}
https_port=${HTTPS_PORT:-443}

{
  echo "DOMAIN=$domain"
  echo "TLS=$tls"
  echo "NODE_IP=$node_ip"
  echo "HTTP_PORT=$http_port"
  echo "HTTPS_PORT=$https_port"
  echo "MAX_PARTICIPANTS=16"
  echo "CREATE_PASSWORD=$password"
} > .env
chmod 600 .env

url="https://$domain"
[[ "$https_port" == 443 ]] || url="$url:$https_port"
echo
echo "Pronto. Suba com:  docker compose up -d --build"
echo "Acesse:            $url"
echo "Senha das salas:   $password"
if [[ "$tls" == local ]]; then
  echo
  echo "O certificado é próprio: na primeira vez, cada navegador vai mostrar um aviso."
  echo "Clique em 'Avançado' > 'Continuar'."
fi
