#!/usr/bin/env bash
# Roda dentro do container: PipeWire + WirePlumber + pipewire-pulse sem placa de som, com dois sinks nulos
# (caixas e fones). Aplica o comando do app e confere que o som do "jogo" chega na fonte Overshoulder-jogo,
# antes e depois de trocar a saída padrão.
set -u
export XDG_RUNTIME_DIR=/tmp/xdg; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

# O comando do app, sem o último passo (systemctl não existe aqui: os daemons sobem logo abaixo)
APP_COMMAND=$(sed 's/ && systemctl --user restart .*$//' /command.txt)
bash -c "$APP_COMMAND" || { echo "FALHOU: o comando do app deu erro"; exit 1; }

pipewire >/tmp/pw.log 2>&1 &
sleep 1
wireplumber >/tmp/wp.log 2>&1 &
pipewire-pulse >/tmp/pp.log 2>&1 &
sleep 3
pactl load-module module-null-sink sink_name=caixas media.class=Audio/Sink >/dev/null
pactl load-module module-null-sink sink_name=fones media.class=Audio/Sink >/dev/null
pactl set-default-sink caixas
sleep 1

python3 - <<'PY'
import wave, struct, math
w = wave.open('/tmp/tom.wav', 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)
for i in range(48000 * 2):
    v = int(12000 * math.sin(2 * math.pi * 440 * i / 48000)); w.writeframesraw(struct.pack('<hh', v, v))
w.close()
PY

peak() { python3 - "$1" <<'PY'
import wave, sys, struct
w = wave.open(sys.argv[1]); d = w.readframes(w.getnframes())
s = struct.unpack('<%dh' % (len(d) // 2), d); print(max(map(abs, s)) if s else 0)
PY
}

fail=0
pactl list short sources | grep -q '^[0-9]*.overshoulder_jogo\b' || { echo "FALHOU: a fonte overshoulder_jogo não existe"; exit 1; }
pactl list sources | grep -q 'Overshoulder-jogo' || { echo "FALHOU: a descrição Overshoulder-jogo não aparece"; fail=1; }
pactl list sources | grep -A12 'Name: overshoulder_jogo$' | grep -q 'Monitor of Sink: n/a' || { echo "FALHOU: a fonte aparece como monitor (o Chrome a esconderia)"; fail=1; }

check() { # $1 = saída onde o "jogo" toca
  rm -f /tmp/r.wav
  timeout 5 parec -d overshoulder_jogo --file-format=wav /tmp/r.wav & rp=$!
  sleep 1; paplay -d "$1" /tmp/tom.wav; kill $rp 2>/dev/null; wait $rp 2>/dev/null
  local p; p=$(peak /tmp/r.wav)
  if [ "$p" -gt 1000 ]; then echo "ok: saída padrão=$(pactl get-default-sink), som em $1, pico=$p"
  else echo "FALHOU: saída padrão=$(pactl get-default-sink), som em $1, pico=$p (silêncio)"; fail=1; fi
}
check caixas
pactl set-default-sink fones; sleep 1.5
check fones
pactl set-default-sink caixas; sleep 1.5
check caixas
exit $fail
