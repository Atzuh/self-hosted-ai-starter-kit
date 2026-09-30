#!/usr/bin/env bash
#
# Start de whisper.cpp-server native op de host (Metal/GPU).
#
# Waarom native en niet in Docker: Docker Desktop op macOS geeft containers geen
# Metal-toegang, dus een whisper-container zou CPU-only draaien. Zelfde reden
# waarom Ollama al native draait (zie docker-compose.yml, service ollama-cpu).
# n8n bereikt deze server via http://host.docker.internal:8910/inference.
#
# Gebruik:
#   ./shared/whisper/start-whisper-server.sh          # draait op de voorgrond
#   WHISPER_PORT=9000 ./shared/whisper/start-whisper-server.sh
#
# Let op: de server bindt op 0.0.0.0 zodat Docker-containers hem kunnen bereiken;
# daarmee staat hij ook open op het lokale netwerk. Op een kantoornetwerk hoort
# hier een firewall-regel omheen die alleen de Docker-bridge toelaat.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Turbo (f16). Gemeten op een echte bespreking van 55 minuten leverde het
# volledige large-v3 evenveel gevulde kopjes op in het eindverslag, maar kostte
# het drie keer zoveel tijd (13 tegen 4,5 minuten). Het gekwantiseerde q5-model
# is juist slechter: 19% minder woorden.
#
# Nauwkeuriger nodig? WHISPER_MODEL=.../ggml-large-v3.bin
MODEL="${WHISPER_MODEL:-$SCRIPT_DIR/models/ggml-large-v3-turbo.bin}"
# Spraakdetectie: stukken zonder spraak worden overgeslagen. Dat is geen detail —
# op diezelfde opname ging het van 3.702 naar 6.545 woorden én van 4,5 naar 2,8
# minuten. Zonder VAD loopt het model aan het eind vast in een hallucinatielus
# ("in de krant" × 225) en verliest het daardoor échte spraak. Bijvangst: vakjargon
# komt er beter uit, "langslevende" 17 keer goed tegen 0 keer zonder VAD.
VAD_MODEL="${WHISPER_VAD_MODEL:-$SCRIPT_DIR/models/ggml-silero-v5.1.2.bin}"
PORT="${WHISPER_PORT:-8910}"
LANG_CODE="${WHISPER_LANG:-nl}"
THREADS="${WHISPER_THREADS:-$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 4)}"

if ! command -v whisper-server >/dev/null 2>&1; then
  echo "whisper-server niet gevonden. Installeer met: brew install whisper-cpp" >&2
  exit 1
fi

if [[ ! -f "$MODEL" ]]; then
  echo "Model niet gevonden: $MODEL" >&2
  echo "Download met:" >&2
  echo "  curl -L -o '$MODEL' \\" >&2
  echo "    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin" >&2
  exit 1
fi

echo "whisper.cpp server → http://0.0.0.0:${PORT}/inference"
echo "  model:   $(basename "$MODEL")"
echo "  taal:    ${LANG_CODE}"
echo "  threads: ${THREADS}"

# --no-timestamps: de LLM-samenvatting heeft niets aan tijdcodes en ze kosten
#   alleen prompt-budget. Voor een transcript mét tijdcodes: vlag weghalen.
# -bs 5: beam search geeft merkbaar minder verhaspelde namen dan greedy — de
#   extra rekentijd valt bij turbo op Metal weg tegen de kwaliteitswinst.
# Geen --prompt meer: een lijst met vaktermen kostte gemeten 900 woorden inhoud
#   en verdubbelde de hallucinatielussen. De workflow stuurt per verzoek wel een
#   korte prompt mee met het onderwerp en de deelnemers; dat is het enige dat
#   aantoonbaar helpt (namen worden dan goed gespeld).
VAD_ARGS=()
if [[ -f "$VAD_MODEL" ]]; then
  VAD_ARGS=(--vad --vad-model "$VAD_MODEL")
else
  echo "Let op: VAD-model niet gevonden op $VAD_MODEL — transcriberen gaat door zonder spraakdetectie." >&2
fi

exec whisper-server \
  --model "$MODEL" \
  "${VAD_ARGS[@]}" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --language "$LANG_CODE" \
  --threads "$THREADS" \
  --beam-size 5 \
  --no-timestamps \
  --print-progress \
