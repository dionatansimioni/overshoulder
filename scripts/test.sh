#!/usr/bin/env bash
# Roda a suíte inteira: sobe um LiveKit de teste e executa os testes num container do Playwright.
# Uso: ./scripts/test.sh [arquivos de teste...]
set -euo pipefail
cd "$(dirname "$0")/.."

LIVEKIT_IMAGE=livekit/livekit-server:v1.13.10
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.0-noble
export TEST_API_KEY=testkey
export TEST_API_SECRET=test-secret-only-for-automated-tests-0123456789

# --- segredos -------------------------------------------------------------
echo "== gitleaks: histórico do git e arquivos do projeto"
# O .env guarda os segredos reais de cada instalação: precisa continuar fora do git
git check-ignore -q --no-index .env || { echo "ERRO: .env não está no .gitignore" >&2; exit 1; }
if git ls-files --error-unmatch .env >/dev/null 2>&1 || [ -n "$(git log --all --format=%H -- .env)" ]; then
  echo "ERRO: .env foi adicionado ao git" >&2; exit 1
fi
docker run --rm -v "$PWD:/repo:ro" "$GITLEAKS_IMAGE" git /repo --config /repo/.gitleaks.toml --no-banner --redact --exit-code 1
docker run --rm -v "$PWD:/repo:ro" "$GITLEAKS_IMAGE" dir /repo --config /repo/.gitleaks.toml --no-banner --redact --exit-code 1

# --- testes do servidor e do navegador --------------------------------------
docker rm -f overshoulder-test-livekit >/dev/null 2>&1 || true
docker run -d --name overshoulder-test-livekit --network host \
  -e LIVEKIT_KEYS="$TEST_API_KEY: $TEST_API_SECRET" \
  -v "$PWD/app/test/livekit.yaml:/etc/livekit.yaml:ro" \
  "$LIVEKIT_IMAGE" --config /etc/livekit.yaml >/dev/null
trap 'docker rm -f overshoulder-test-livekit >/dev/null 2>&1 || true' EXIT

docker run --rm --network host --ipc host --init \
  -e TEST_API_KEY -e TEST_API_SECRET -e npm_config_update_notifier=false \
  -v "$PWD/app:/app" -w /app \
  "$PLAYWRIGHT_IMAGE" \
  sh -c '
    # Só reinstala quando o package-lock.json mudou: evita depender da rede a cada execução
    if ! cmp -s package-lock.json node_modules/.overshoulder-lock 2>/dev/null; then
      npm ci --no-audit --no-fund --loglevel=error && cp package-lock.json node_modules/.overshoulder-lock || exit 1
    fi
    node --test --test-concurrency=1 "$@"' sh "${@:-test/}"
