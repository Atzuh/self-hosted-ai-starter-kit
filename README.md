# DocGen — Notariële Akte Generator

Automatiseert het opstellen van hypotheekaktes voor **De Rivieren Notarissen** (Dussen/Werkendam). Twee PDF-bronnen worden via AI gecombineerd tot een volledig ingevulde Word-akte, zonder handmatig overtypen.

## Pipeline

```
Rabobank passeeropdracht (PDF)  ─┐
                                  ├─ Docling → Ollama (llama3.2) → n8n → python-docx → .docx
Kadaster eigendomsinformatie (PDF)─┘
```

De webapp (**Scriptor**) op `http://localhost:8080` is het startpunt voor de gebruiker.

## Vereisten

- **Docker Desktop** (met Compose V2)
- **Ollama** — draait native op de host (niet in Docker)
  - Installeer via [ollama.com](https://ollama.com)
  - Pull het model: `ollama pull llama3.2`
- **Apple Silicon / macOS** — de aanbevolen configuratie (Ollama op Metal)
- **whisper.cpp** — alleen nodig voor de Besprekingen-pagina, draait net als Ollama
  native op de host:
  ```bash
  brew install whisper-cpp
  curl -L -o shared/whisper/models/ggml-large-v3-turbo.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
  ./shared/whisper/start-whisper-server.sh   # luistert op poort 8910
  ```

> Op Linux of Windows met Nvidia GPU: zie het [GPU-profiel](#gpu-setup) onderaan.

## Installatie

```bash
git clone <repo-url>
cd self-hosted-ai-starter-kit
cp .env.example .env
```

Bewerk `.env` en zet veilige waarden:

```env
POSTGRES_USER=notaris
POSTGRES_PASSWORD=KiesEenSterkWachtwoord123
POSTGRES_DB=n8n
N8N_ENCRYPTION_KEY=<willekeurige-lange-string>
N8N_USER_MANAGEMENT_JWT_SECRET=<willekeurige-lange-string>

# Ollama draait native op de Mac, niet in Docker:
OLLAMA_HOST=host.docker.internal:11434
```

## Opstarten

```bash
# Eerste keer (bouwt de webapp-container):
docker compose --profile cpu up --build

# Daarna:
docker compose --profile cpu up
```

De n8n-workflows worden automatisch geïmporteerd en geactiveerd bij de eerste start.

## Services

| Service | URL | Functie |
|---|---|---|
| **Scriptor webapp** | http://localhost:8080 | Upload-interface voor de gebruiker |
| **n8n** | http://localhost:5678 | Workflow-editor en automatisering |
| **Docling** | http://localhost:5001/ui | PDF → Markdown OCR |
| **Docling API docs** | http://localhost:5001/docs | REST API referentie |
| **Qdrant** | http://localhost:6333/dashboard | Vector database |

## Gebruik

1. Open **http://localhost:8080**
2. Selecteer de gewenste modus:
   | Modus | Wat er gegenereerd wordt |
   |---|---|
   | **Hypotheekakte** | Passeeropdracht + eigendomsinfo → ingevulde .docx |
   | **Juridische analyse** | Willekeurige PDFs → juridische analyse .docx |
3. Upload de bestanden:
   - **Passeeropdracht** — Rabobank PDF (via ECH)
   - **Eigendomsinformatie** — Kadaster PDF (via NotarisDossier)
4. Bij de juridische analyse: kies de **zaaksoort** (Hypotheek, Levering, of
   allebei — een A-B-levering met de hypotheekakte er direct achteraan is een
   gewone passeerdag). Die context stuurt de vier specialisten en de eindanalyse
   naar de juiste transactie — bij een levering gaat het bijvoorbeeld om de
   beschikkingsbevoegdheid van de verkoper, de koopsom en de vraag wat schoon
   over moet, in plaats van om hypotheekbedrag en passeeropdracht. De teksten
   per zaaksoort staan in `shared/templates/registry.json` onder
   `zaaksoort_context`; een zaaksoort erbij is daar een sleutel bijzetten plus
   een keuze in de webapp. Een combinatie heeft een eigen sleutel — de gekozen
   soorten in vaste volgorde met een `+` ertussen, dus `hypotheek+levering` —
   omdat de losse teksten elkaar tegenspreken: de levering-tekst zegt dat
   hypotheekstukken niet hoeven, en dat klopt niet zodra er ook een hypotheek
   passeert. Ontbreekt de combinatietekst, dan worden de losse teksten
   samengevoegd met een kop die zegt dat beide transacties spelen.
5. Klik **Genereer** en wacht op het resultaat (~2–5 minuten)
6. Download de gegenereerde `.docx`

Gegenereerde aktes staan ook direct beschikbaar op `http://localhost:8080/output/`.

De **partijen** worden rol-bewust getoetst: uit de koopovereenkomst haalt de
extractie wie verkoper en wie koper is, en de code controleert dan dat elke
verkoper als rechthebbende in de kadastrale eigendomsinformatie staat (zo niet:
kritiek) en dat elke koper als cliënt in de passeeropdracht voorkomt (zo niet:
aandacht). De rechthebbenden worden daarbij op het anker `Naam gerechtigde` uit
de kadasteruitdraai zelf gelezen, niet uit de extractie. Bij een zuivere
hypotheekzaak blijft de oude vergelijking per positie gelden.

Let op: Docling zet afbeeldingen als base64 data-URI ín de markdown — 81% van een
kadasteruitdraai en 93% van een BRP-inzage bestaat daaruit. `Aggregate Markdowns`
stript ze, anders vult die ruis het contextvenster en duwt de echte tekst uit de
clamp. Zonder die strip antwoordde de partijen-extractie letterlijk dat de invoer
"een willekeurige tekencombinatie" was en leverde ze geen namen.

Ook het **object** wordt in code vergeleken: `Build Partijen Prompt` leest de
kadastrale aanduiding (gemeente, sectie, nummer) en het adres uit de ruwe
markdown van beide stukken, geankerd op de postcode, en vergelijkt ze
genormaliseerd. Verschilt de aanduiding, dan is dat kritiek; is er alleen aan één
kant een aanduiding en wijkt het adres af, dan is dat 'aandacht'. Het model mag
over het object niets meer melden — het legde twee schrijfwijzen van hetzelfde
pand naast elkaar ("Woonhuis, twee onder een kap, Oudendijk 14, 4223 NL te
Hoornaar" tegenover "Oudendijk 14 4223 NL Hoornaar") en riep kritiek. De partijen
en hun rollen beoordeelt het wel.

De categorie **Bedragen** in de analyse is volledig deterministisch — de LLM
mag er niets aan toevoegen, ook niet als de code niets te melden heeft:
`Build Flex Analysis Prompt` leest leningbedrag, inschrijvingsbedrag (basis,
opslag en totaal) en bouwdepot — of bij een levering koopsom, waarborgsom en
roerende zaken — op ankerwoorden uit het opdracht-stuk, toetst hun samenhang, en
geeft ze als vaststaand aan het model mee. Een bedrag dat in geen enkel
aangeleverd stuk voorkomt, wordt uit de analyse geweerd. Reden: het model las
structureel het verkeerde getal (het basis-inschrijvingsbedrag in plaats van het
totaal), verzon regels als "de hoofdsom moet groter zijn dan de inschrijving" en
herhaalde bevindingen van andere specialisten. Mist de deterministische kant een
geval, voeg dan een regel toe aan `controleerBedragen()` — dat is testbaar,
anders dan hopen dat het model het ziet.

### Besprekingen uitwerken

Op de **Besprekingen**-pagina neem je de bespreking op (of upload je een
geluidsbestand). De browser zet de audio om naar 16 kHz mono WAV, whisper.cpp
maakt lokaal het transcript en `qwen2.5:7b` werkt dat uit tot een verslag met
samenvatting, de besproken punten per onderwerp en de gemaakte afspraken. Het volledige
transcript gaat als bijlage mee in de `.docx`, zodat elke regel controleerbaar blijft.

> De opname zelf wordt nergens opgeslagen: die bestaat alleen in de browser
> zolang de pagina openstaat. Er zitten meerdere sprekers in de opname; het
> transcript maakt daar voorlopig geen onderscheid in.
>
> Wie er onder **Aanwezig** in het verslag komt, wordt uitsluitend bepaald door
> het veld **Deelnemers** — niet door het model. Uit het transcript afleiden wie
> aanwezig was gaf verhaspelde namen en haalde er mensen bij die alleen ter
> sprake kwamen. Laat het veld leeg om het kopje weg te laten.

Start eerst de whisper-server (`./shared/whisper/start-whisper-server.sh`) — zonder
die server komt de bespreking als mislukt terug met een verwijzing naar dit script.
Transcriptie loopt op ± 8× realtime. Besprekingen langer dan ongeveer een kwartier
worden in blokken samengevat en daarna samengevoegd, zodat het tweede deel niet
buiten het verslag valt. Gemeten: een opname van 22 seconden is in ~21 seconden
klaar, een bespreking van 13,6 minuten in ~2 minuten.

De verwerking loopt als achtergrondjob (zie het kopje over webhooks hieronder).
Jobbestanden staan in `shared/jobs/` en worden na 24 uur opgeruimd — ze bevatten
het transcript, dus ze horen daar niet te blijven staan.

### Vaste indeling per soort bespreking

Voor **testament** en **levenstestament** volgt het verslag een vaste volgorde van
kopjes, afgeleid van de bespreekformulieren in
[shared/templates/besprekingen/](shared/templates/besprekingen/):

| Bestand | Wat het bepaalt |
|---|---|
| `testament.json` | 18 kopjes, van Familiesituatie tot Uitsluiting ouderlijk vruchtgenot |
| `levenstestament.json` | 16 kopjes, beginnend bij Wie wordt gevolmachtigde |

Beide beginnen met **Familiesituatie** en **Vermogenssituatie**. Bij het
levenstestament staan de voorlichtingsblokken uit het formulier (gang naar de
rechter, voordelen van een levensvolmacht) er bewust niet in: het verslag begint
bij wat de cliënt beslist.

Op de Besprekingen-pagina kies je het soort, of laat je het op *Automatisch* — dan
leidt de workflow het af uit het onderwerp via `herken_op` in de sjabloonbestanden.
Wil je de volgorde of de kopjes wijzigen, pas dan het JSON-bestand aan; er hoeft
niets in de workflow te veranderen.

Kopjes waar niets onder kwam blijven staan met **"Niet vastgelegd"**. Dat is
bewust die formulering en niet "niet besproken": de extractie mist er soms een,
en dan zou het document beweren dat een onderwerp niet aan de orde kwam terwijl
dat wel zo was.

Elk getal in het verslag wordt teruggezocht in het transcript. Staat het er niet
in, dan komt er **[niet in transcript: …]** achter — dat is meestal een verzonnen
of verrekend bedrag. Een getal dat er wél in staat maar verkeerd is begrepen,
vangt die controle niet.

Het verslag blijft een concept: het model verhaspelt soms wetsartikelen, namen of
data. Loop het na tegen het transcript dat als bijlage in de `.docx` staat.

### Whisper-model en spraakdetectie

Standaard draait **`ggml-large-v3-turbo`** (f16, 1,5 GB) **met VAD**
(spraakdetectie, `ggml-silero-v5.1.2.bin`, 864 kB).

Gemeten op een echte bespreking van 55,6 minuten:

| variant | tijd | woorden | "langslevende" goed |
|---|---|---|---|
| `large-v3-turbo-q5_0` | 4,2 min | 3.195 | 0 |
| `large-v3-turbo` | 4,5 min | 3.702 | 0 |
| `large-v3` | 13,2 min | 5.683 | — |
| **`large-v3-turbo` + VAD** | **2,8 min** | **6.545** | **17** |

**VAD is de grootste winst, groter dan de modelkeuze.** Zonder spraakdetectie
loopt elk model aan het eind van de opname vast in een hallucinatielus ("in de
krant" × 225, "Ja." × 357) en verliest het daardoor ook échte spraak: 77% meer
woorden mét VAD, en tegelijk bijna twee keer zo snel omdat stiltes worden
overgeslagen. Bijvangst: vakjargon komt er beter uit — "langslevende" 17 keer
goed tegen 0 keer zonder VAD, wat direct meetelt voor de trefwoordherkenning in
de sjablonen.

Het volledige `large-v3` leverde in het eindverslag evenveel gevulde kopjes op
(12 van 20) als turbo, maar kostte drie keer zoveel tijd. Nauwkeuriger nodig:

```bash
WHISPER_MODEL=shared/whisper/models/ggml-large-v3.bin ./shared/whisper/start-whisper-server.sh
```

Het gekwantiseerde q5-model is in geen enkel opzicht beter: minder woorden én
iets trager, want dequantiseren kost op Metal meer dan het oplevert.

**De initial prompt: alleen namen en onderwerp.** Een lijst met vaktermen leek
een goed idee — "voogdij" in de prompt maakte van "vochtdij" weer "voogdij" — maar
op de echte opname van 55 minuten pakte het slecht uit:

| prompt | woorden | "langslevende" goed | grootste herhaallus |
|---|---|---|---|
| geen | 6.545 | 17 | 79 |
| 29 vaktermen | 5.620 | 32 | 159 |
| korte zin met 5 termen | 6.147 | 10 | 226 |
| **alleen namen + onderwerp** | **6.198** | 17 | 105 |

De termenlijst kostte 900 woorden inhoud en verdubbelde de hallucinatielussen; met
`large-v3` stortte de transcriptie zelfs volledig in (795 woorden, vastgelopen op
"Twee." × 379). Betere spelling van één term weegt daar niet tegenop. De workflow
stuurt daarom per verzoek alleen het onderwerp en de deelnemers mee, en het
startscript geeft helemaal geen prompt.

Het VAD-model downloaden:

```bash
curl -L -o shared/whisper/models/ggml-silero-v5.1.2.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
```

Ontbreekt het, dan waarschuwt het startscript en draait het door zonder VAD.

### Testen zonder microfoon

Een uitgeschreven script door de keten halen (Whisper wordt dan overgeslagen):

```bash
./scripts/verslag-uit-tekst.sh script.txt "2026.1044" "Bespreking testament" "notaris, mevrouw Jansen"
```

Handig om de samenvatting te beproeven: er zit dan geen transcriptieruis tussen,
dus wat je ziet is puur wat het model van de inhoud maakt.

## Mappenstructuur

```
self-hosted-ai-starter-kit/
├── docker-compose.yml
├── .env                          # Lokale configuratie (niet in git)
├── .env.example                  # Template voor .env
├── shared/
│   ├── templates/
│   │   └── rabobank/
│   │       └── template_HYRABO00.docx   # Word-template met <<PLACEHOLDERS>>
│   ├── vul_template_in.py        # Vult de akte-template in
│   ├── genereer_juridische_analyse.py   # Genereert juridische analyse .docx
│   ├── genereer_besprekingsverslag.py   # Genereert besprekingsverslag .docx
│   ├── whisper/
│   │   ├── start-whisper-server.sh      # Start whisper.cpp native (Metal)
│   │   └── models/               # GGML-modellen (niet in git)
│   └── output/                   # Gegenereerde aktes (via nginx beschikbaar)
├── bank-models/
│   ├── rabobank/
│   │   ├── build_template.py     # Bouwt/herbouwt de Word-template
│   │   └── HYRABO00_H1_2018.docx # Brontemplate (onbewerkt)
│   └── abnamro/
├── n8n/
│   ├── Dockerfile
│   └── demo-data/
│       ├── workflows/            # n8n workflow JSON-bestanden
│       └── credentials/          # n8n credential JSON-bestanden
├── webapp/                       # React + Vite + shadcn/ui (Scriptor)
└── testdossiers/                 # Testbestanden (niet in git)
```

## Word-template herbouwen

Na aanpassingen aan de opmaak of placeholders in de brontemplate:

```bash
python3 bank-models/rabobank/build_template.py \
  --input  bank-models/rabobank/HYRABO00_H1_2018.docx \
  --output shared/templates/rabobank/template_HYRABO00.docx
```

## n8n Workflows opnieuw importeren

Workflows worden automatisch geïmporteerd bij `docker compose up`. Handmatig opnieuw importeren (na een reset):

1. Verwijder in n8n de bestaande workflows "Hypotheekakte genereren" en "Juridische Analyse E2E" (en de oude gecombineerde "Hypotheekakte E2E", indien nog aanwezig)
2. **Import from file** → `n8n/demo-data/workflows/hypotheekakte-workflow.json` en `n8n/demo-data/workflows/juridische-analyse-workflow.json`
3. Zet bij beide workflows de **Active** toggle aan

Webhook-URLs:

- Akte genereren (start, geeft `job_id`): `http://localhost:5678/webhook/hypotheekakte`
- Juridische analyse (start, geeft `job_id`): `http://localhost:5678/webhook/juridische-analyse`
- Bespreking → verslag (start, geeft `job_id`): `http://localhost:5678/webhook/bespreking`
- Status van een lopende job: `http://localhost:5678/webhook/job-status?job=<job_id>`

Alle drie de flows draaien als achtergrondjob: de webhook antwoordt binnen een
tiende seconde met een `job_id` en de workflow werkt daarachter door, terwijl de
voortgang in `shared/jobs/<job_id>.json` staat. De webapp pollt `/job-status` en
toont daarmee de echte stap uit de workflow — een onderbroken verbinding kost het
resultaat niet meer, want het document staat gewoon in `shared/output/` en de job
weet ervan.

Statussen per flow:

| Flow | Statussen |
|---|---|
| Akte | `documenten omzetten` → `gegevens extraheren` → `akte opmaken` → `klaar` |
| Analyse | `documenten lezen` → `analyseren` → `document` → `klaar` |
| Bespreking | `transcriberen` → `samenvatten` → `document` → `klaar` |

Loopt een workflow vast, dan komt de job op `fout` te staan met een melding.
Jobbestanden worden na 24 uur opgeruimd bij de eerstvolgende run.

## Webapp lokaal ontwikkelen

```bash
cd webapp
npm install
npm run dev
# Open http://localhost:5173
```

## GPU-setup

**Nvidia GPU (Linux/Windows):**
```bash
docker compose --profile gpu-nvidia up --build
```

**AMD GPU (Linux):**
```bash
docker compose --profile gpu-amd up --build
```

Bij GPU-gebruik draait Ollama wél in Docker (geen native installatie nodig). Verwijder dan `OLLAMA_HOST` uit `.env`.

## Licentie

Apache License 2.0 — zie [LICENSE](LICENSE).
