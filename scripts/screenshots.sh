#!/usr/bin/env bash
# Tira capturas das telas principais do app em app/.screenshots/ (computador e celular), com o LiveKit
# de teste e o Chromium da suíte. Serve para revisar o visual e para as imagens do site.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf app/.screenshots
./scripts/test.sh tools/screenshots.js
ls app/.screenshots
