# Notariële Akte Automatisering
## Projectdocument voor Claude Code

---

## Projectoverzicht

Automatiseren van hypotheekaktes voor **De Rivieren Notarissen** te Dussen/Werkendam. Drie databronnen komen samen tot één ingevulde Word-akte zonder handmatig overtypen.

### Databronnen
| Bron | Formaat | Inhoud |
|---|---|---|
| Rabobank passeeropdracht | PDF (via ECH) | Financiële gegevens, klantgegevens (initialen), onderpand, modelakte |
| Kadaster eigendomsinformatie | PDF (via NotarisDossier) | Volledige namen, geboorteplaatsen, kadastrale gegevens |
| Bankmodel Word template | .docx (HYRABO00) | Akte met placeholders `<<NAAM_1_HOOFDLETTERS>>` etc. |

### Pipeline samengevat
```
PDF upload (webapp)
    → Docling (PDF → Markdown)
    → Ollama llama3.2 (Markdown → JSON)
    → n8n Code nodes (JSON samenvoegen)
    → python-docx (Word template invullen)
    → .docx downloaden
```

De n8n workflow accepteert sinds 2026-05-12 een `mode`-veld (multipart-form):

| mode | Wat gebeurt er | Verwachte inputs |
|---|---|---|
| `akte` | Alleen hypotheekakte (geen juridische analyse) | passeeropdracht + eigendomsinfo |
| `beide` (default) | Akte **plus** juridische analyse | passeeropdracht + eigendomsinfo |
| `analyse` | Alleen juridische analyse (geen akte) | 1..N PDFs van willekeurig type (`document_0`, `document_1`, …) |

De webapp heeft een mode-toggle bovenaan; bij `analyse` verschijnt een multi-file dropzone in plaats van de bank/kadaster-slots.

---

## Technische omgeving

| Component | Detail |
|---|---|
| Machine | MacBook Air, Apple Silicon |
| IDE | Cursor |
| Docker stack | `~/Desktop/self-hosted-ai-starter-kit` |
| Starten | `docker compose --profile cpu up` |

### Draaiende services
| Service | URL |
|---|---|
| n8n | http://localhost:5678 |
| Docling UI | http://localhost:5001/ui |
| Docling API | http://localhost:5001/docs |
| Qdrant | http://localhost:6333/dashboard |
| Nginx (bestanden) | http://localhost:8080 |

### .env configuratie
```
POSTGRES_USER=notaris
POSTGRES_PASSWORD=KiesEenSterkWachtwoord123
POSTGRES_DB=n8n
N8N_ENCRYPTION_KEY=Xk9mP2qL7vRnWjYc4hBtDsZuAeGiOoCf
N8N_USER_MANAGEMENT_JWT_SECRET=Tz5wQa8nKpMxVbHrJdElFyUgSiNcOoLv
```

### Mappenstructuur
```
self-hosted-ai-starter-kit/
├── docker-compose.yml
├── .env
├── shared/
│   ├── template_HYRABO00.docx        ← Word template met placeholders
│   ├── vul_template_in.py            ← Python script (Word invullen)
│   ├── output/                       ← Gegenereerde aktes komen hier
│   └── extracted-images/
│       └── akte-generator.html       ← Upload webapp (via nginx)
└── n8n/
    └── demo-data/
```

---

## Variabelen mapping

### Uit de Passeeropdracht (Rabobank)
| Variabele | Voorbeeld | Placeholder in akte |
|---|---|---|
| ech_zaaknummer | 5238033 | `<<ECH_ZAAKNUMMER>>` |
| leningbedrag_cijfer | € 555.998,00 | `<<LENINGBEDRAG_CIJFER>>` |
| leningbedrag_woorden | vijfhonderdvijfenvijftigduizend negenennegentig euro en achtennegentig eurocent | `<<LENINGBEDRAG_WOORDEN>>` |
| inschrijvingsbedrag_cijfer | € 556.000,00 | `<<INSCHRIJVINGSBEDRAG_CIJFER>>` |
| inschrijvingsbedrag_woorden | vijfhonderdzesenvijftigduizend euro | `<<INSCHRIJVINGSBEDRAG_WOORDEN>>` |
| opslag_cijfer | € 194.600,00 | `<<OPSLAG_CIJFER>>` |
| opslag_woorden | honderdvierennegentigduizend zeshonderd euro | `<<OPSLAG_WOORDEN>>` |
| totaal_hypotheek_cijfer | € 750.600,00 | `<<TOTAAL_HYPOTHEEK_CIJFER>>` |
| totaal_hypotheek_woorden | zevenhonderdvijftigduizend zeshonderd euro | `<<TOTAAL_HYPOTHEEK_WOORDEN>>` |
| onderpand_straat | Richter | `<<ONDERPAND_STRAAT>>` |
| onderpand_huisnummer | 56 | `<<ONDERPAND_HUISNUMMER>>` |
| onderpand_postcode | 4251DB | `<<ONDERPAND_POSTCODE>>` |
| onderpand_woonplaats | Werkendam | `<<ONDERPAND_WOONPLAATS>>` |
| onderpand_type | Woonhuis; Twee onder een kap | `<<ONDERPAND_TYPE>>` |
| rangorde | 1 | `<<RANGORDE>>` |
| modelakte_code | HYRABO00 | `<<MODELAKTE_CODE>>` |
| modelakte_versie | H1-2018 | `<<MODELAKTE_VERSIE>>` |
| passeerdatum_uiterlijk | 26 mei 2027 | `<<PASSEERDATUM_UITERLIJK>>` |

### Klantgegevens (per klant, uit Passeeropdracht)
| Variabele | Klant 1 voorbeeld | Placeholder |
|---|---|---|
| initialen_naam | E.C. van Maastricht | — (intern gebruik) |
| geboortedatum_dag | 22 | — |
| geboortedatum_maand | december | — |
| geboortedatum_jaar | 1986 | — |
| nationaliteit | Nederland | `<<NATIONALITEIT_1>>` |
| straat | Paddemoes | `<<STRAAT_1>>` |
| huisnummer | 8 | `<<HUISNUMMER_1>>` |
| postcode | 4201BV | `<<POSTCODE_1>>` |
| woonplaats | Gorinchem | `<<WOONPLAATS_1>>` |
| rol | schuldenaar | — |

### Uit de Eigendomsinformatie (Kadaster)
| Variabele | Voorbeeld | Placeholder |
|---|---|---|
| kadastrale_gemeente | Werkendam | `<<KAD_GEMEENTE>>` |
| kadastrale_sectie | R | `<<KAD_SECTIE>>` |
| kadastrale_nummer | 2627 | `<<KAD_NUMMER>>` |
| kadastrale_grootte_m2 | 247 | — |
| kadastrale_grootte_woorden | twee aren zevenveertig centiaren | `<<KAD_GROOTTE_WOORDEN>>` |

### Klantgegevens (per klant, uit Kadaster)
| Variabele | Klant 1 | Klant 2 | Placeholder |
|---|---|---|---|
| volledige_naam | Engel Cornelis van Maastricht | Caroline Diane Vermeulen | `<<NAAM_1>>` / `<<NAAM_2>>` |
| naam_hoofdletters | ENGEL CORNELIS VAN MAASTRICHT | CAROLINE DIANE VERMEULEN | `<<NAAM_1_HOOFDLETTERS>>` |
| voornamen | Engel Cornelis | Caroline Diane | `<<VOORNAMEN_1>>` |
| tussenvoegsel | van | — | — |
| achternaam | Maastricht | Vermeulen | — |
| geboortedatum_dag_woorden | tweeëntwintig | negen | `<<GEBOORTEDAG_1_WOORDEN>>` |
| geboortedatum_maand_woorden | december | oktober | `<<GEBOORTEMAAND_1_WOORDEN>>` |
| geboortedatum_jaar_woorden | negentienhonderdzesentachtig | negentienhonderdtweeëntachtig | `<<GEBOORTEJAAR_1_WOORDEN>>` |
| geboorteplaats | Dordrecht | Windhoek | `<<GEBOORTEPLAATS_1>>` / `<<GEBOORTEPLAATS_2>>` |
| geboorteland | Nederland | (leeg/Zuid-Afrika) | `<<GEBOORTELAND_1>>` |

### Vaste gegevens (notariskantoor — hardcoded in template of aparte config)
| Gegeven | Waarde |
|---|---|
| Notaris | mr. Maria Annika Dalmijn-Verkooijen |
| Vestigingsplaats | Altena |
| Kantooradres | Dorpsstraat 1, 4271 AA Dussen |
| Gevolmachtigde bank | Ilse Josephina Johanna Sprangers-van Delft |
| Passeerplaats | Dussen, gemeente Altena |

---

## Wat al gebouwd is

### ✅ Fase 1 — Docker stack draait lokaal
Alle services actief: n8n, Docling, Ollama, Qdrant, PostgreSQL, Nginx.

### ✅ Fase 2 — Docling PDF extractie getest
- Rabobank passeeropdracht geüpload via `http://localhost:5001/ui`
- Docling geeft correcte Markdown output terug
- Alle benodigde variabelen zijn leesbaar aanwezig in de Markdown

### ✅ Fase 3 — Variabelen mapping volledig uitgewerkt
- Alle placeholders geïdentificeerd op basis van ingevulde voorbeeldakte
- Twee databronnen gekoppeld aan correcte variabelen
- Weten welke gegevens uit passeeropdracht komen vs. kadaster

### ✅ Webapp gebouwd (`akte-generator.html`)
- Twee upload zones (drag & drop)
- Live statuslog tijdens verwerken
- Downloadknop na voltooiing
- Staat klaar voor nginx op `http://localhost:8080/akte-generator.html`

### ✅ n8n Workflow JSON gemaakt (`hypotheekakte-workflow.json`)
- Importeerbaar via n8n → Import from file
- Volledige pipeline van webhook tot Word output
- Twee parallelle Docling calls → twee Ollama calls → merge → python-docx

### ✅ Python script gemaakt (`vul_template_in.py`)
- Vervangt alle `<<PLACEHOLDER>>` tags in het Word template
- Behoudt opmaak via run-niveau vervanging
- Output naar `/data/shared/output/hypotheekakte_{zaaknummer}.docx`

---

## Stappenplan — wat nog moet gebeuren

### Stap 1 — Installeer python-docx in de n8n container
```bash
docker exec -it n8n pip install python-docx --break-system-packages
```

Controleer:
```bash
docker exec -it n8n python3 -c "from docx import Document; print('OK')"
```

---

### Stap 2 — Kopieer bestanden naar de shared map
```bash
cd ~/Desktop/self-hosted-ai-starter-kit

# Python script
cp /pad/naar/vul_template_in.py shared/vul_template_in.py

# Webapp
cp /pad/naar/akte-generator.html shared/extracted-images/akte-generator.html

# Output map aanmaken
mkdir -p shared/output
```

---

### Stap 3 — Zet de Word template klaar met placeholders

**Dit is de kritieke stap.** Open `template_HYRABO00.docx` in Word en vervang de huidige variabele teksten door placeholders.

Gebruik exact deze notatie: `<<PLACEHOLDER_NAAM>>`

Placeholders die in de template moeten komen:

**Klant 1:**
```
<<NAAM_1_HOOFDLETTERS>>
<<VOORNAMEN_1>>
<<GEBOORTEDAG_1_WOORDEN>>
<<GEBOORTEMAAND_1_WOORDEN>>
<<GEBOORTEJAAR_1_WOORDEN>>
<<GEBOORTEPLAATS_1>>
<<NATIONALITEIT_1>>
<<STRAAT_1>> <<HUISNUMMER_1>>
<<POSTCODE_1>> <<WOONPLAATS_1>>
```

**Klant 2:**
```
<<NAAM_2_HOOFDLETTERS>>
<<VOORNAMEN_2>>
<<GEBOORTEDAG_2_WOORDEN>>
<<GEBOORTEMAAND_2_WOORDEN>>
<<GEBOORTEJAAR_2_WOORDEN>>
<<GEBOORTEPLAATS_2>>
<<NATIONALITEIT_2>>
<<STRAAT_2>> <<HUISNUMMER_2>>
<<POSTCODE_2>> <<WOONPLAATS_2>>
```

**Hypotheek:**
```
<<INSCHRIJVINGSBEDRAG_WOORDEN>> (<<INSCHRIJVINGSBEDRAG_CIJFER>>)
<<OPSLAG_WOORDEN>> (<<OPSLAG_CIJFER>>)
<<TOTAAL_HYPOTHEEK_WOORDEN>> (<<TOTAAL_HYPOTHEEK_CIJFER>>)
```

**Onderpand:**
```
<<ONDERPAND_POSTCODE>> <<ONDERPAND_WOONPLAATS>>, <<ONDERPAND_STRAAT>> <<ONDERPAND_HUISNUMMER>>
<<KAD_GEMEENTE>>, sectie <<KAD_SECTIE>> nummer <<KAD_NUMMER>>
ter grootte van <<KAD_GROOTTE_WOORDEN>>
```

Sla op als `template_HYRABO00.docx` in `shared/`.

---

### Stap 4 — Importeer de n8n workflow

1. Ga naar `http://localhost:5678`
2. Klik linksboven op het menu (≡) → **Workflows** → **Import from file**
3. Selecteer `hypotheekakte-workflow.json`
4. De workflow verschijnt met alle nodes verbonden
5. Activeer de workflow (toggle rechtsboven op **Active**)

**Webhook URL wordt:** `http://localhost:5678/webhook/hypotheekakte`

---

### Stap 5 — Test de Docling API call handmatig

Voordat je de volledige workflow test, controleer of Docling de bestanden correct verwerkt via n8n:

Maak een tijdelijke testworkflow in n8n:
```
Manual Trigger
→ HTTP Request (POST naar http://docling:5001/api/v1/convert/source)
  Body: multipart, upload één PDF
→ Bekijk output in n8n
```

Verwachte response bevat: `document.md_content` met de Markdown tekst.

---

### Stap 6 — Test de Ollama extractie handmatig

Maak een tijdelijke testworkflow:
```
Manual Trigger
→ Set node (zet de Markdown tekst als hardcoded input)
→ HTTP Request naar http://ollama:11434/api/chat
  met de extractieprompt
→ Code node (parse JSON uit response)
→ Bekijk of alle velden correct zijn
```

Controleer specifiek:
- Zijn alle bedragen in woorden correct uitgeschreven?
- Zijn de geboortedata per klant correct?
- Is de JSON geldig (geen extra tekst van Ollama)?

Als Ollama slechte JSON teruggeeft: voeg `"format": "json"` toe aan de request body.

---

### Stap 7 — Test het Python script standalone

```bash
docker exec -it n8n python3 /data/shared/vul_template_in.py \
  '{"<<NAAM_1_HOOFDLETTERS>>": "ENGEL CORNELIS VAN MAASTRICHT", "<<GEBOORTEPLAATS_1>>": "Dordrecht"}' \
  '5238033'
```

Verwachte output:
```
SUCCESS: /data/shared/output/hypotheekakte_5238033.docx
```

Controleer het bestand:
```bash
ls -la ~/Desktop/self-hosted-ai-starter-kit/shared/output/
```

---

### Stap 8 — End-to-end test via de webapp

1. Open `http://localhost:8080/akte-generator.html`
2. Upload de testbestanden:
   - Passeeropdracht: `251210 1240 Cooperatieve Rabobank U.A. - Passeeropdracht.pdf`
   - Eigendomsinfo: `Eigendomsinformatie_Werkendam_R_2627_-_02-04-2026_09_01.pdf`
3. Klik **Akte genereren**
4. Controleer de statuslog in de webapp
5. Controleer n8n execution log op `http://localhost:5678`
6. Download de gegenereerde akte

**Controleer in de output:**
- Zijn namen correct in hoofdletters?
- Zijn bedragen correct in woorden?
- Klopt de kadastrale omschrijving?
- Is de opmaak van het originele template bewaard gebleven?

---

### Stap 9 — Correcties en fine-tuning

Na de eerste end-to-end test zijn er waarschijnlijk correcties nodig:

**Als Ollama verkeerde waarden geeft:**
- Verfijn de extractieprompts in de Ollama nodes
- Voeg voorbeelden toe aan de prompt (few-shot)
- Overweeg `llama3.2` te vervangen door een groter model

**Als python-docx de opmaak breekt:**
- Controleer of placeholders over meerdere runs verspreid zijn in de .docx
- Gebruik de `python-docx` inspector om runs te debuggen:
  ```python
  from docx import Document
  doc = Document('/data/shared/template_HYRABO00.docx')
  for para in doc.paragraphs:
      for run in para.runs:
          if '<<' in run.text:
              print(repr(run.text))
  ```
- Zorg dat placeholders binnen één run staan (hertype ze in Word als nodig)

**Als de Docling output onvolledig is:**
- Controleer of `ocr_enabled: true` staat in de API call
- Test via `http://localhost:5001/ui` met het bestand

---

### Stap 10 — Uitbreiden voor andere bankmodellen

Zodra HYRABO00 werkt, kan het systeem worden uitgebreid:

| Bank | Modelakte | Aanpassing nodig |
|---|---|---|
| Rabobank | HYRABO00 | ✅ Basis klaar |
| ING | HYINGO00 | Nieuwe template + eventueel andere veldnamen |
| ABN AMRO | HYABNA00 | Idem |
| Stater | Variabel | Passeeropdracht heeft ander formaat |

**Uitbreidingsaanpak:**
1. Detecteer de bank automatisch uit de passeeropdracht (`modelakte_code` veld)
2. Laad het juiste template op basis van die code
3. Één workflow, meerdere templates

---

### Stap 11 — Productie-gereed maken (later)

Wanneer de flow stabiel is:

- [ ] Validatiestap toevoegen: laat de notaris de geëxtraheerde JSON bevestigen vóór Word wordt ingevuld
- [ ] Foutafhandeling uitbreiden (wat als Docling timeout geeft?)
- [ ] Logging naar database (welke aktes zijn gegenereerd, wanneer, door wie)
- [ ] Tweede set ogen: n8n stuurt akte via mail naar notaris ter controle
- [ ] HTTPS instellen als de webapp buiten localhost moet draaien
- [ ] Authenticatie op de webapp (nu volledig open)

---

## Bestandsoverzicht

| Bestand | Locatie | Doel |
|---|---|---|
| `akte-generator.html` | `shared/extracted-images/` | Upload webapp voor gebruiker |
| `hypotheekakte-workflow.json` | Import in n8n | Volledige automatiseringspipeline |
| `vul_template_in.py` | `shared/` | Word template invullen via python-docx |
| `template_HYRABO00.docx` | `shared/` | Word template met `<<PLACEHOLDERS>>` |
| `shared/output/` | `shared/output/` | Gegenereerde aktes |

---

## Ollama Extractieprompts

### Prompt 1 — Passeeropdracht
```
Je bent een data-extractie assistent voor een notariskantoor.
Analyseer de tekst van een Rabobank passeeropdracht en extraheer
de gegevens als JSON. Geef ALLEEN geldige JSON terug, geen tekst
of uitleg daaromheen. Geen markdown backticks.

Schema:
{
  "ech_zaaknummer": "",
  "leningbedrag_cijfer": "",
  "leningbedrag_woorden": "",
  "inschrijvingsbedrag_cijfer": "",
  "inschrijvingsbedrag_woorden": "",
  "opslag_cijfer": "",
  "opslag_woorden": "",
  "totaal_hypotheek_cijfer": "",
  "totaal_hypotheek_woorden": "",
  "onderpand_straat": "",
  "onderpand_huisnummer": "",
  "onderpand_postcode": "",
  "onderpand_woonplaats": "",
  "onderpand_type": "",
  "rangorde": "",
  "modelakte_code": "",
  "modelakte_versie": "",
  "passeerdatum_uiterlijk": "",
  "klanten": [
    {
      "initialen_naam": "",
      "geboortedatum_dag": "",
      "geboortedatum_maand": "",
      "geboortedatum_jaar": "",
      "nationaliteit": "",
      "straat": "",
      "huisnummer": "",
      "postcode": "",
      "woonplaats": "",
      "rol": ""
    }
  ]
}

Regels:
- Bedragen in woorden schrijf je volledig uit in het Nederlands
  zoals in een notariële akte
- Maanden schrijf je voluit (bijv. "december")
- Postcodes zonder spatie (bijv. "4201BV")
```

### Prompt 2 — Eigendomsinformatie Kadaster
```
Je bent een data-extractie assistent voor een notariskantoor.
Analyseer de tekst van een kadaster eigendomsinformatie document
en extraheer de gegevens als JSON. Geef ALLEEN geldige JSON terug.
Geen markdown backticks.

Schema:
{
  "kadastrale_gemeente": "",
  "kadastrale_sectie": "",
  "kadastrale_nummer": "",
  "kadastrale_grootte_m2": "",
  "kadastrale_grootte_woorden": "",
  "klanten": [
    {
      "volledige_naam": "",
      "voornamen": "",
      "tussenvoegsel": "",
      "achternaam": "",
      "naam_hoofdletters": "",
      "geboortedatum": "",
      "geboortedatum_dag_woorden": "",
      "geboortedatum_maand_woorden": "",
      "geboortedatum_jaar_woorden": "",
      "geboorteplaats": "",
      "geboorteland": ""
    }
  ]
}

Regels:
- naam_hoofdletters: volledige naam in HOOFDLETTERS
- kadastrale_grootte_woorden: m² omrekenen naar aren en centiaren
  in woorden (247 m² = "twee aren zevenveertig centiaren")
- geboortedatum in woorden zoals in notariële akte
- Neem alleen klanten op die als "Betrokken persoon" staan
  bij een koopovereenkomst, niet de huidige eigenaren
```

---

## Testgegevens (referentie)

Gebaseerd op het testdossier ECH 5238033:

```json
{
  "ech_zaaknummer": "5238033",
  "leningbedrag_cijfer": "€ 555.998,00",
  "inschrijvingsbedrag_cijfer": "€ 556.000,00",
  "inschrijvingsbedrag_woorden": "vijfhonderdzesenvijftigduizend euro",
  "opslag_cijfer": "€ 194.600,00",
  "opslag_woorden": "honderdvierennegentigduizend zeshonderd euro",
  "totaal_hypotheek_cijfer": "€ 750.600,00",
  "totaal_hypotheek_woorden": "zevenhonderdvijftigduizend zeshonderd euro",
  "onderpand_straat": "Richter",
  "onderpand_huisnummer": "56",
  "onderpand_postcode": "4251DB",
  "onderpand_woonplaats": "Werkendam",
  "modelakte_code": "HYRABO00",
  "kadastrale_gemeente": "Werkendam",
  "kadastrale_sectie": "R",
  "kadastrale_nummer": "2627",
  "kadastrale_grootte_woorden": "twee aren zevenveertig centiaren",
  "klanten": [
    {
      "naam_hoofdletters": "ENGEL CORNELIS VAN MAASTRICHT",
      "voornamen": "Engel Cornelis",
      "geboortedatum_dag_woorden": "tweeëntwintig",
      "geboortedatum_maand_woorden": "december",
      "geboortedatum_jaar_woorden": "negentienhonderdzesentachtig",
      "geboorteplaats": "Dordrecht",
      "nationaliteit": "Nederland"
    },
    {
      "naam_hoofdletters": "CAROLINE DIANE VERMEULEN",
      "voornamen": "Caroline Diane",
      "geboortedatum_dag_woorden": "negen",
      "geboortedatum_maand_woorden": "oktober",
      "geboortedatum_jaar_woorden": "negentienhonderdtweeëntachtig",
      "geboorteplaats": "Windhoek",
      "nationaliteit": "Zuid-Afrika"
    }
  ]
}
```

---

## Workflow-hardening (mei 2026)

Sinds branch `feature/workflow-hardening-poc` (zie `CHANGES.md` voor detail per taak):

### Nodes vervangen / vervangen door

| Oud (verwijderd of gewijzigd) | Nieuw |
|---|---|
| `Parse Ollama JSON` schreef in `$getWorkflowStaticData('global').hypoMerge` | `Parse Ollama JSON` geeft platte items terug; nieuwe Aggregate-node **`Combine Bank+Kadaster`** voegt de 2 items samen tot `{ docs: [bank, kadaster] }`. |
| `Analyse Route` Switch had geen fallback | `Analyse Route.options.fallbackOutput = 1` → onbekende modes naar de akte-tak met een `warning`-veld in de respons. |
| `Generate DOCX` / `Generate Analysis DOCX` / `Generate Flex Analysis DOCX` interpoleerden payload-data in shell-single-quotes | 3 nieuwe **`Write * Args`** Code-nodes schrijven een JSON-payload naar `/tmp/n8n_args_<scope>_<execId>_<ts>.json`; de executeCommand roept alleen `python3 <script> --args-file '{{ $json.argsFile }}'` aan. |
| Specialist-LLM-calls werden altijd gedaan (ook bij `signal_count = 0`) | 4 nieuwe IF-nodes **`Vererving / Lasten / Burgerlijke / Burgerlijke Analyse Has Signals?`** routeren bij geen signalen direct naar de Parse-node en slaan de LLM-call over. |
| Specialist-failure blokkeerde hele analyse | Alle 4 specialist `* LLM Chain` nodes hebben nu `onError: "continueRegularOutput"`. |
| Magic-number clamp-limieten (10000/14000/26000/8000) verspreid over 6 Code-nodes | Centrale `context_limits`-sectie in `registry.json`; Code-nodes lezen `Number(registry.context_limits.<key>) \|\| <fallback>`. |
| `dossierExtraMarkdownByExec` global state in Collapse Dossier Markdowns → Build Placeholders | `dossier_markdown` lift mee als veld op de bank+kadaster-items via Build Extraction Prompt en Parse Ollama JSON, en wordt in Build Placeholders uit `bankDoc.dossier_markdown` gelezen. |
| Generate DOCX retourneerde `REPLACED_BLOCKS: N` op stdout zonder dat de workflow er iets mee deed | `Build Response (akte only)` en `Build Response (akte+analyse)` parsen het getal; bij 0 een `template_warning`-veld in de respons + `replaced_blocks` voor debugging. |
| Analyse-only flow had alleen Burgerlijke specialist | Toegevoegd: Vererving + Lasten Analyse specialists (5 nodes elk, zelfde patroon en regex-pre-filter als beide-flow). Chain: Aggregate Markdowns → Vererving → Lasten → Burgerlijke → Build Flex Analysis Prompt. Parse Flex Analysis JSON merged nu alle drie. |
| Twee parallelle specialist-chains (beide-flow + analyse-flow) met functioneel identieke logica, alleen verschillende input-shape | Eén unified `Build * Prompt` per specialist detecteert mode via Split Input Files en kiest het juiste input-pad (analysisInput voor beide, Aggregate.docs[] voor analyse). Nieuwe `Specialist Route` Switch routeert na de drie specialisten naar `Build Flex Analysis Prompt` (analyse) of `Build Analysis Prompt` (beide). De 15 analyse-only specialist-nodes uit extra-3 zijn weer verwijderd; netto 63 → 49 nodes. |
| Canvas was na alle hardening visueel onleesbaar | Alle nodes herpositioneerd in 4 y-banen (entry+akte 200, specialisten -100, analyse-only -500, beide-tail 500) met 7 sticky notes als labels. Puur cosmetisch, geen execution-impact. |

### Argumenten naar Python-scripts

De Python-scripts (`vul_template_in.py` en `genereer_juridische_analyse.py`) accepteren drie aanroepvormen, in volgorde van voorkeur:

1. **`--args-file <pad>`** (gebruikt door n8n). Het bestand is een JSON-object met dezelfde velden als de flag-based vorm (`template`, `placeholders`, `zaaknummer`, of `analysis`, `zaaknummer`, `bank`, `klant`). Wordt **na inlezen direct verwijderd** (zelfopruimend; geen TTL nodig).
2. **Flag-based** (`--template … --placeholders '<json>' --zaaknummer …`). Handig voor handmatige tests in de container.
3. **Legacy positional** (`'<json>' '<zaaknummer>'`, alleen `vul_template_in.py`). Defaults op de Rabobank-template. Blijft werken voor oudere n8n-imports.

### N8n-instellingen die deze workflow nodig heeft

- `Analyse Route.options.fallbackOutput = 1` (P1.2; staat in de export).
- `onError: "continueRegularOutput"` op de 4 specialist LLM Chains (P2.2; staat in de export).
- `executionOrder: v1` (ongewijzigd).
- Geen aanpassingen aan credentials of webhook-settings.

### Re-importeren in n8n

1. Open n8n → **Workflows** → bestaande "Hypotheekakte E2E" verwijderen.
2. **Import from file** → `n8n/demo-data/workflows/hypotheekakte-workflow.json`.
3. Activate toggle aan.

De webhook-URL blijft `http://localhost:5678/webhook/hypotheekakte`.

---

## Bekende aandachtspunten

1. **Ollama JSON betrouwbaarheid** — llama3.2 geeft soms tekst rondom de JSON. De parse node strip backticks maar bij hardnekkige fouten: voeg `"format": "json"` toe aan de Ollama API call body.

2. **Word opmaak** — python-docx vervangt op run-niveau. Als een placeholder verspreid is over meerdere runs in Word (kan gebeuren bij kopiëren/plakken), werkt de vervanging niet. Hertype de placeholder in Word als dit voorkomt.

3. **Docling timeout** — Zware PDFs kunnen >60s duren. De timeout staat op 120s in de workflow. Voor gescande PDFs met slechte kwaliteit: overweeg `ocr_enabled: true` expliciet mee te sturen.

4. **Klant volgorde** — De koppeling tussen passeeropdracht-klanten en kadaster-klanten gaat op basis van volgorde (klant 1 = eerste in beide documenten). Dit werkt voor standaard twee-persoons aanvragen. Bij één klant of drie klanten moet de Code node worden aangepast.

5. **Nationaliteit tweede klant** — Mevrouw Vermeulen heeft geboorteland Windhoek (Namibië/Zuid-Afrika). De passeeropdracht vermeldt "Zuid Afrika" als nationaliteit. Dit kan afwijken van de formele notatie in de akte — controleer dit bij het eerste testresultaat.
