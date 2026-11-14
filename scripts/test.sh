#!/usr/bin/env bash
# Roda a suíte inteira: sobe um LiveKit de teste e executa os testes num container do Playwright.
# Uso: ./scripts/test.sh [arquivos de teste...]
set -euo pipefail
cd "$(dirname "$0")/.."

LIVEKIT_IMAGE=livekit/livekit-server:v1.13.10
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.0-noble
export TEST_API_KEY=testkey
export TEST_API_SECRET=test-secret-only-for-automated-tests-0123456789

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
  sh -c 'npm ci --no-audit --no-fund --loglevel=error && node --test --test-concurrency=1 "$@"' sh "${@:-test/}"
