#!/usr/bin/env bash
# Varredura de vulnerabilidades com o Trivy: falha se a imagem ou as dependências do projeto
# tiverem falhas altas ou críticas que já têm correção. Uso: ./scripts/scan.sh <imagem>
set -euo pipefail
cd "$(dirname "$0")/.."

TRIVY_IMAGE=aquasec/trivy:0.76.1
IMAGE=${1:?informe a imagem, ex.: ./scripts/scan.sh overshoulder:local}
CACHE=${TRIVY_CACHE_DIR:-$HOME/.cache/trivy}
mkdir -p "$CACHE"
# Credenciais do Docker (para imagens privadas no GHCR), se existirem
AUTH=()
[ -f "$HOME/.docker/config.json" ] && AUTH=(-v "$HOME/.docker/config.json:/root/.docker/config.json:ro")

trivy() {
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$CACHE:/root/.cache" "${AUTH[@]}" \
    -v "$PWD:/src:ro" "$TRIVY_IMAGE" "$@" --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress
}

echo "== Trivy: imagem $IMAGE"
trivy image "$IMAGE"
echo "== Trivy: dependências do projeto (package-lock.json)"
trivy fs --scanners vuln /src/app
