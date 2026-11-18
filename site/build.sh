#!/usr/bin/env bash
# Compila o site num container com o Node que o Astro pede (o desta máquina pode ser mais velho).
# Uso: site/build.sh [comando npm, padrão "run build"]
# Em processadores sem AVX2 (algumas VMs), o compilador nativo do Astro para com "Illegal instruction":
# aí o script usa a versão WebAssembly dele, só nesta máquina (--no-save; o GitHub Actions usa a nativa).
set -euo pipefail
cd "$(dirname "$0")/.."
wasi=''
grep -qw avx2 /proc/cpuinfo || wasi=1
docker run --rm -v "$PWD:/repo" -w /repo/site -u "$(id -u):$(id -g)" -e HOME=/tmp -e ASTRO_TELEMETRY_DISABLED=1 \
  ${wasi:+-e NAPI_RS_FORCE_WASI=1 -e SITE_NO_SEARCH=1} node:24.11.1-bookworm-slim sh -c "
    npm install --no-audit --no-fund --loglevel=error
    if [ -n '$wasi' ]; then
      v=\$(node -p \"require('@astrojs/compiler-binding/package.json').version\")
      npm install --no-save --no-audit --no-fund --loglevel=error --force @astrojs/compiler-binding-wasm32-wasi@\$v
      # O carregador tenta o nativo primeiro, e é ao carregá-lo que o processo morre: sem ele, cai no WebAssembly
      rm -rf node_modules/@astrojs/compiler-binding-linux-x64-*
    fi
    npm ${*:-run build}"
