#!/usr/bin/env bash
# Prova, num PipeWire de verdade (container sem placa de som), que o comando que o app mostra no Linux cria uma
# fonte que o Chrome enxerga e que continua passando o som quando a saída padrão muda (caixas -> fones).
# Uso: ./scripts/test-pipewire.sh
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE=overshoulder-pipewire-test

# O comando vem do próprio room.js: o teste e o app nunca divergem
COMMAND_FILE=$(mktemp)
trap 'rm -f "$COMMAND_FILE"' EXIT
node -e '
  const src = require("fs").readFileSync("app/public/room.js", "utf8");
  const m = src.match(/const LINUX_MONITOR_COMMAND =\s*`([^`]*)`/);
  if (!m) { console.error("LINUX_MONITOR_COMMAND não encontrado em room.js"); process.exit(1); }
  process.stdout.write(m[1] + "\n");
' > "$COMMAND_FILE"

echo "== PipeWire: a fonte Overshoulder-jogo acompanha a saída padrão"
docker build -q -t "$IMAGE" scripts/pipewire >/dev/null
docker run --rm -v "$COMMAND_FILE:/command.txt:ro" "$IMAGE"
