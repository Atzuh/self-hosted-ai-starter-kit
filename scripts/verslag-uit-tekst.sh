#!/usr/bin/env bash
#
# Haalt een uitgeschreven besprekingsscript (.txt) door de verslag-workflow,
# zonder Whisper. Bedoeld om te beproeven wat het taalmodel van een bespreking
# maakt: er zit dan geen transcriptieruis tussen, dus wat je ziet is puur de
# samenvatstap.
#
# Gebruik:
#   ./scripts/verslag-uit-tekst.sh script.txt
#   ./scripts/verslag-uit-tekst.sh script.txt 2026.1044 "Bespreking testament" "mr. Van Dijk, mevrouw Jansen"
#
# Vereist: n8n draait (docker compose up) en Ollama is bereikbaar.
# De whisper-server hoeft NIET te draaien.

set -euo pipefail

BESTAND="${1:?Geef een tekstbestand op: ./scripts/verslag-uit-tekst.sh script.txt}"
DOSSIER="${2:-}"
ONDERWERP="${3:-}"
DEELNEMERS="${4:-}"

BASIS="${SCRIPTOR_N8N:-http://localhost:5678}"

if [[ ! -f "$BESTAND" ]]; then
  echo "Bestand niet gevonden: $BESTAND" >&2
  exit 1
fi

echo "→ script: $BESTAND ($(wc -c <"$BESTAND" | tr -d ' ') tekens)"

# Het transcript gaat als .txt-bijlage mee in plaats van als tekstveld: zo hoeft
# de shell geen aanhalingstekens of accenten in de tekst te ontzien.
ANTWOORD=$(curl -s -X POST "$BASIS/webhook/bespreking" \
  -F "transcript_bestand=@${BESTAND};type=text/plain" \
  -F "dossier=${DOSSIER}" \
  -F "onderwerp=${ONDERWERP}" \
  -F "deelnemers=${DEELNEMERS}")

JOB=$(printf '%s' "$ANTWOORD" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("job_id",""))' 2>/dev/null || true)

if [[ -z "$JOB" ]]; then
  echo "Geen job-id terug van de webhook. Antwoord was:" >&2
  echo "$ANTWOORD" >&2
  exit 1
fi

echo "→ job: $JOB"
printf '→ bezig'

for _ in $(seq 1 240); do
  STATUS_JSON=$(curl -s "$BASIS/webhook/job-status?job=$JOB")
  STATUS=$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")
  case "$STATUS" in
    klaar|fout) echo; break ;;
    *) printf '.'; sleep 3 ;;
  esac
done

# Via een tijdelijk bestand en niet via een pipe: bij `python3 - <<'PY'` komt het
# script zélf op stdin binnen, dus een doorgepijpt antwoord zou verloren gaan.
UITVOER=$(mktemp)
trap 'rm -f "$UITVOER"' EXIT
printf '%s' "$STATUS_JSON" >"$UITVOER"

python3 - "$UITVOER" <<'PY'
import json, sys

with open(sys.argv[1], encoding="utf-8") as f:
    job = json.load(f)

if job.get("status") == "fout" or not job.get("resultaat"):
    print(f"\nMislukt: {job.get('fout') or 'geen resultaat in de job'}")
    raise SystemExit(1)

r = job["resultaat"]
v = r.get("verslag") or {}

def blok(kop, items, opmaak=str):
    items = [i for i in (items or []) if i]
    if not items:
        return
    print(f"\n{kop}")
    for i in items:
        print(f"  • {opmaak(i)}")

def onderwerp(o):
    if isinstance(o, str):
        return o
    punten = "; ".join(str(p) for p in (o.get("punten") or []))
    # Bij een vaste indeling blijven niet-besproken kopjes staan; net als in het
    # document benoemen we dat expliciet in plaats van een lege regel te tonen.
    leeg = (
        f"— kwam ter sprake ({o['ter_sprake']}), geen uitkomst"
        if o.get("ter_sprake")
        else "— niet vastgelegd"
    )
    return f"{o.get('kop', '')}: {punten or leeg}"

print(f"\n{'=' * 70}")
print(v.get("titel") or "Besprekingsverslag")
print("=" * 70)
print(f"\nSAMENVATTING\n{v.get('samenvatting') or '(geen)'}")

blok("DEELNEMERS", v.get("deelnemers"))
blok("BESPROKEN", v.get("onderwerpen"), onderwerp)
blok("AFSPRAKEN", v.get("afspraken"))
blok("OPEN VRAGEN", v.get("open_vragen"))

for w in r.get("waarschuwingen") or []:
    print(f"\n! {w}")

gemarkeerd = r.get("getallen_gemarkeerd") or 0
if gemarkeerd:
    print(f"\n! {gemarkeerd} getal(len) staan niet in het transcript — zie de markeringen hierboven")

print(f"\nblokken verwerkt: {r.get('blok_aantal')}")
print(f"document: {r.get('download_url')}")
PY
