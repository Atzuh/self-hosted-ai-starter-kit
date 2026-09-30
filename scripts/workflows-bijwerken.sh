#!/usr/bin/env bash
#
# Zet gewijzigde workflow-JSON's uit n8n/demo-data/workflows in de draaiende
# n8n en activeert ze weer.
#
# Gebruik:
#   ./scripts/workflows-bijwerken.sh                    # alle workflows
#   ./scripts/workflows-bijwerken.sh hypotheekakte      # alleen wat matcht
#   ./scripts/workflows-bijwerken.sh --check            # alleen vergelijken
#   ./scripts/workflows-bijwerken.sh --force hypotheek  # ondanks UI-wijzigingen
#
# Waarom dit script bestaat: docker-compose importeert de demo-data alleen bij
# de allereerste start en zet daarna de marker n8n/demo-data/.imported. Daarna
# leest n8n zijn workflows uit Postgres en kijkt het nooit meer naar schijf.
# Bestanden die de workflow tijdens het draaien van schijf leest (het template,
# vul_template_in.py, registry.json, kantoor.json) zijn dan wél nieuw en de
# node-code níét — een combinatie die stilzwijgend halve akten oplevert.
#
# Import deactiveert een workflow ("Remember to activate later"), vandaar de
# publish-stap erna, en n8n moet herstarten om de webhooks opnieuw te
# registreren.
#
# Veiligheid: staat er in de database node-code die afwijkt van schijf, dan zijn
# er in de n8n-editor wijzigingen gemaakt die nooit geëxporteerd zijn. Het
# script stopt dan, zodat je die eerst kunt wegschrijven. Met --force ga je er
# overheen.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_DIR="$REPO/n8n/demo-data/workflows"

ALLEEN_CHECK=0
FORCE=0
FILTER=""
for arg in "$@"; do
  case "$arg" in
    --check) ALLEEN_CHECK=1 ;;
    --force) FORCE=1 ;;
    -*) echo "Onbekende optie: $arg" >&2; exit 2 ;;
    *) FILTER="$arg" ;;
  esac
done

if ! docker ps --format '{{.Names}}' | grep -qx n8n; then
  echo "FOUT: de container 'n8n' draait niet. Start eerst: docker compose up -d" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . "$REPO/.env"; set +a
PG_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 postgres)"

BESTANDEN=()
while IFS= read -r f; do
  [ -n "$FILTER" ] && [[ "$(basename "$f")" != *"$FILTER"* ]] && continue
  BESTANDEN+=("$f")
done < <(find "$WORKFLOW_DIR" -maxdepth 1 -name '*.json' | sort)

if [ ${#BESTANDEN[@]} -eq 0 ]; then
  echo "Geen workflow-bestanden gevonden${FILTER:+ voor filter '$FILTER'}." >&2
  exit 1
fi

# --- Vergelijk schijf met database -----------------------------------------
DB_DUMP="$(mktemp)"
trap 'rm -f "$DB_DUMP"' EXIT
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select coalesce(json_agg(json_build_object('id', id, 'name', name, 'nodes', nodes, 'updatedAt', \"updatedAt\")), '[]') from workflow_entity;" \
  > "$DB_DUMP"

AFWIJKEND=0
for f in "${BESTANDEN[@]}"; do
  if ! python3 - "$f" "$DB_DUMP" <<'PY'
import json, os, sys, datetime
bestand, db_pad = sys.argv[1], sys.argv[2]
schijf = json.load(open(bestand))
db = {w['id']: w for w in json.load(open(db_pad))}
wf_id, naam = schijf.get('id'), schijf.get('name', '?')
if wf_id not in db:
    print(f"  NIEUW      {naam} ({wf_id}) - staat nog niet in de database")
    sys.exit(0)

def code(nodes):
    return {n['name']: n.get('parameters', {}).get('jsCode', '') for n in nodes}

c_schijf, c_db = code(schijf['nodes']), code(db[wf_id]['nodes'])
verschil = sorted({n for n in set(c_schijf) | set(c_db) if c_schijf.get(n) != c_db.get(n)})
if not verschil:
    print(f"  gelijk     {naam}")
    sys.exit(0)

# Wie is nieuwer? Een import zet updatedAt bij, dus na een geslaagde sync is de
# inhoud gelijk en komen we hier niet eens. Is de database wel nieuwer en wijkt
# de inhoud af, dan is er na de laatste sync in de n8n-editor gewerkt.
def db_tijd(w):
    t = str(w.get('updatedAt') or '').replace('Z', '+0000')
    for vorm in ('%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%dT%H:%M:%S%z',
                 '%Y-%m-%d %H:%M:%S.%f%z', '%Y-%m-%d %H:%M:%S%z'):
        try:
            return datetime.datetime.strptime(t, vorm).timestamp()
        except ValueError:
            continue
    return 0.0

db_nieuwer = db_tijd(db[wf_id]) > os.path.getmtime(bestand)
print(f"  {'DB NIEUWER' if db_nieuwer else 'WIJZIGT   '} {naam} ({wf_id}): " + ", ".join(verschil))
sys.exit(3 if db_nieuwer else 0)
PY
  then
    AFWIJKEND=1
  fi
done

if [ "$ALLEEN_CHECK" -eq 1 ]; then
  exit 0
fi

if [ "$AFWIJKEND" -eq 1 ] && [ "$FORCE" -eq 0 ]; then
  cat >&2 <<'MSG'

GESTOPT: bij de workflows hierboven met "DB NIEUWER" is de database later
bijgewerkt dan het bestand op schijf, terwijl de inhoud verschilt. Waarschijnlijk
is er in de n8n-editor gewerkt zonder te exporteren. Exporteer die workflow eerst
(n8n -> Download naar n8n/demo-data/workflows/), of draai opnieuw met --force om
de schijfversie te laten winnen.
MSG
  exit 1
fi

# --- Importeren en publiceren ----------------------------------------------
for f in "${BESTANDEN[@]}"; do
  basis="$(basename "$f")"
  wf_id="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('id',''))" "$f")"
  [ -z "$wf_id" ] && { echo "  overgeslagen (geen id): $basis" >&2; continue; }
  actief="$(python3 -c "import json,sys;print('ja' if json.load(open(sys.argv[1])).get('active') else 'nee')" "$f")"
  echo "  importeren: $basis (actief: $actief)"
  docker exec n8n n8n import:workflow --input="/demo-data/workflows/$basis" >/dev/null 2>&1
  # Import zet een workflow op non-actief. Alleen terugzetten wat volgens het
  # bestand actief hoort te zijn — anders activeert een sync workflows die
  # bewust uitstonden.
  if [ "$actief" = "ja" ]; then
    docker exec n8n n8n publish:workflow --id="$wf_id" >/dev/null 2>&1 || true
  else
    docker exec n8n n8n unpublish:workflow --id="$wf_id" >/dev/null 2>&1 \
      || docker exec n8n n8n update:workflow --id="$wf_id" --active=false >/dev/null 2>&1 || true
  fi
done

echo "  n8n herstarten (webhooks opnieuw registreren)..."
docker restart n8n >/dev/null

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:5678/healthz 2>/dev/null; then break; fi
  sleep 2
done

echo
# Uit de database lezen, niet uit de log: log-regels vallen buiten het
# tijdvenster zodra n8n er even over doet.
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select case when active then '  actief    ' else '  inactief  ' end || name from workflow_entity order by name;"
echo "Klaar."
