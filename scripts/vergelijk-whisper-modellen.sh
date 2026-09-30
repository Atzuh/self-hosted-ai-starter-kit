#!/usr/bin/env bash
#
# Draait één geluidsbestand door meerdere Whisper-modellen en zet de transcripten
# naast elkaar, met de tijd die elk model nodig had.
#
# Gebruik:
#   ./scripts/vergelijk-whisper-modellen.sh opname.wav [uitvoermap]
#
# Waarom via whisper-cli en niet via de server: dan hoeft er geen server per
# model gestart en gestopt te worden, en draait elk model op precies dezelfde
# audio met dezelfde instellingen.
#
# Let op: dit gebruikt de rekenkracht van de Mac. Draait er tegelijk een
# bespreking via de webapp, dan worden beide traag.

set -euo pipefail

AUDIO="${1:?Geef een geluidsbestand op: ./scripts/vergelijk-whisper-modellen.sh opname.wav}"
UIT="${2:-/tmp/whisper-vergelijking}"
MODELLEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shared/whisper/models"

if [[ ! -f "$AUDIO" ]]; then
  echo "Bestand niet gevonden: $AUDIO" >&2
  exit 1
fi

mkdir -p "$UIT"

# Dezelfde initial prompt als de workflow gebruikt, zodat de vergelijking
# representatief is voor wat er in de praktijk gebeurt.
PROMPT="Notariële bespreking. Termen: hypotheekakte, leveringsakte, passeerdatum, uittreksel kadaster, erfdienstbaarheid, gemeenschap van goederen, huwelijkse voorwaarden, volmacht, legitieme portie, executeur, afwikkelingsbewind, vruchtgebruik, uitsluitingsclausule, plaatsvervulling, tweetrapsmaking, levenstestament, codicil, voogdij, bewindvoerder."

echo "audio: $AUDIO"
echo "uitvoer: $UIT"
echo

for MODEL in "$MODELLEN_DIR"/*.bin; do
  [[ -e "$MODEL" ]] || { echo "Geen modellen in $MODELLEN_DIR" >&2; exit 1; }
  NAAM="$(basename "$MODEL" .bin)"
  DOEL="$UIT/$NAAM.txt"

  printf '%-32s ' "$NAAM"
  START=$(date +%s)
  whisper-cli \
    --model "$MODEL" \
    --file "$AUDIO" \
    --language nl \
    --threads 4 \
    --beam-size 5 \
    --no-timestamps \
    --prompt "$PROMPT" \
    --output-txt --output-file "$UIT/$NAAM" \
    >/dev/null 2>&1
  DUUR=$(( $(date +%s) - START ))
  TEKENS=$(wc -c <"$DOEL" 2>/dev/null | tr -d ' ' || echo 0)
  printf '%4ss  %6s tekens\n' "$DUUR" "$TEKENS"
done

echo
echo "Transcripten staan in $UIT. Vergelijk ze bijvoorbeeld met:"
echo "  diff -y --width=200 $UIT/ggml-large-v3-turbo-q5_0.txt $UIT/ggml-large-v3.txt | less"
