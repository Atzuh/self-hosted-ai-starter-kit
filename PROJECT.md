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
Dossier-upload (webapp, hele map/meerdere PDFs + .docx)
    → client-side classificatie (pdf-classify.ts: bank/kadaster/brp op keyword-match)
    → n8n Code node: server-side classificatie + base64
    → Docling (PDF → Markdown)
    → Ollama qwen2.5:7b (Markdown → JSON, per bank uit registry.json)
    → n8n Code nodes (JSON samenvoegen + specialist-analyses)
    → python-docx (Word template invullen, per bank build_template.py)
    → .docx downloaden
```

De n8n workflow (`hypotheekakte-workflow.json`) accepteert een `mode`-veld (multipart-form):

| mode | Wat gebeurt er | Verwachte inputs |
|---|---|---|
| `akte` | Alleen hypotheekakte (geen juridische analyse) | hele dossier (PDF/.docx, willekeurig aantal bestanden) |
| `analyse` | Alleen juridische analyse (geen akte); draait de vier specialisten | 1..N PDFs van willekeurig type (`document_0`, `document_1`, …) |

> **Vervallen: `mode=beide`.** Er zijn nog maar twee modes — het is óf een
> akte maken, óf een analyse. De webapp stuurt alleen `akte` of `analyse`
> (`GenerationMode = "akte" | "analyse"` in
> [AkteGenerator.tsx](webapp/src/components/AkteGenerator.tsx)). De
> `beide`-dead-code is uit de n8n-workflow verwijderd (juli 2026): de
> `beide`-takken uit de vier `Build * Prompt`-nodes, de vestigiale switches
> `Analyse Route` en `Specialist Route`, en de `Sticky: beide-tail` zijn
> weg; `Split Input Files` default nu op `akte`. Waar hieronder in de
> "Workflow-hardening (mei 2026)"-changelog nog `beide` genoemd wordt, is
> dat historische context.

**Belangrijk verschil met de oude opzet:** de webapp vraagt niet langer om
losse "passeeropdracht"- en "eigendomsinfo"-slots. Bij `akte` sleep je
het **hele dossier** in één keer in de generator (veldnamen `dossier_0`,
`dossier_1`, …); welk bestand de bank-passeeropdracht is en welk de
kadaster-eigendomsinformatie wordt herkend op inhoud:
- **Client-side** in [webapp/src/lib/pdf-classify.ts](webapp/src/lib/pdf-classify.ts)
  (keyword-match op de eerste pagina, categorieën `bank` / `kadaster` / `brp`)
  t.b.v. live feedback in [SmartDropZone.tsx](webapp/src/components/SmartDropZone.tsx).
- **Server-side** nogmaals in de eerste Code-node van de n8n-workflow (leidend;
  bepaalt precies één primaire bank-passeeropdracht + 1..N kadaster-stukken,
  de rest gaat als dossier-context mee naar de juridische analyse).

De webapp zelf heeft geen aparte mode-toggle meer bovenaan de pagina; navigatie
gaat via 3 pagina's in de header (zie "Webapp herbouwd als React-app" onder
"Wat al gebouwd is"), en de akte/analyse-keuze zit binnen de Genereren-pagina.

---

## Technische omgeving

| Component | Detail |
|---|---|
| Machine | Apple M4 (non-Pro), 16 GB unified memory |
| IDE | Claude Code (VSCode-extensie) |
| Docker stack | dit repo (`~/Documents/GitHub/DocGen/scriptor`) — was ooit `~/Desktop/self-hosted-ai-starter-kit`, map is verplaatst |
| Starten | `docker compose --profile cpu up` |
| Git remotes | `origin` = `Atzuh/self-hosted-ai-starter-kit` (fork), `upstream` = `theaiautomators/self-hosted-ai-starter-kit` |

### Draaiende services
| Service | URL |
|---|---|
| n8n | http://localhost:5678 |
| Docling UI | http://localhost:5001/ui |
| Docling API | http://localhost:5001/docs |
| Qdrant | http://localhost:6333/dashboard |
| Webapp (React, via nginx) | http://localhost:8080 |
| Gegenereerde aktes (nginx alias) | http://localhost:8080/output/\<bestand\>.docx |
| Banktemplates (nginx alias) | http://localhost:8080/templates/\<bank\>/\<bestand\>.docx |

Ollama draait **niet** in Docker op deze machine: native op de host
(Apple Silicon Metal/GPU), bereikbaar voor containers via
`host.docker.internal:11434` (`OLLAMA_HOST` in `.env`). Model: `qwen2.5:7b`
(zie `llm-model-keuze-hardware` memory voor de afweging tegen qwen3 op deze
16 GB M4).

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
scriptor/
├── docker-compose.yml
├── .env
├── webapp/                            ← React + Vite + TS + Tailwind + shadcn/ui
│   ├── Dockerfile                     ← Multi-stage: node build → nginx
│   ├── nginx.conf                     ← Serveert build + /output + /templates alias
│   └── src/
│       ├── App.tsx                    ← 3 pagina's: controle / generator / templates
│       └── components/
│           ├── AkteGenerator.tsx      ← Genereren (akte/analyse, dossier-upload)
│           ├── AkteControle.tsx       ← Akte vs. bronnen controleren
│           ├── TemplatesManager.tsx   ← Banktemplates uploaden/bekijken
│           ├── SmartDropZone.tsx      ← Client-side bank/kadaster/brp-classificatie
│           └── ui/                    ← shadcn primitives
├── bank-models/                       ← Bron-templates per bank + build_template.py
│   ├── rabobank/   (HYRABO00, H1-2018)
│   └── abnamro/    (HYSTAA00, AAB18-01)
├── shared/
│   ├── templates/
│   │   ├── registry.json             ← Centrale bank-config: prompts, placeholders, context_limits
│   │   ├── rabobank/template_HYRABO00.docx
│   │   └── abnamro/template_HYSTAA00.docx
│   ├── vul_template_in.py            ← Python script (Word invullen)
│   ├── genereer_juridische_analyse.py
│   ├── controleer_spelling.py
│   └── output/                       ← Gegenereerde aktes/analyses komen hier
├── testdossiers/                      ← Anonieme testdossiers per zaak
├── n8n/
│   └── demo-data/
│       └── workflows/                 ← hypotheekakte, aktecontrole, templates-management
└── scripts/
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

### ✅ Webapp herbouwd als React-app (vervangt oude `akte-generator.html`)
De statische HTML-pagina is vervangen door een volwaardige app in
[webapp/](webapp/) (React + Vite + TypeScript + Tailwind + shadcn/ui),
gebouwd en geserveerd via een eigen `webapp`-service in
`docker-compose.yml` (multi-stage Dockerfile: node build → nginx).

Drie pagina's, genavigeerd via de header ([AppHeader.tsx](webapp/src/components/AppHeader.tsx)):

| Pagina | Component | Doel |
|---|---|---|
| **Genereren** | `AkteGenerator.tsx` | Dossier uploaden → akte en/of juridische analyse genereren |
| **Controle** | `AkteControle.tsx` | Bestaande akte tegen brondocumenten controleren |
| **Templates** | `TemplatesManager.tsx` | Banktemplates per bank uploaden/bekijken/vervangen |

Kenmerken van de Genereren-pagina:
- Eén dossier-dropzone (niet meer 2 losse bank/kadaster-slots) — classificatie
  gebeurt automatisch (zie pipeline hierboven)
- Akte/analyse mode-toggle, live statuslog, stepper, downloadknop
- "Recente aktes"-lijst (`RecentAktes.tsx`) op basis van `shared/output/`
- Bestand-persistentie in de browser tussen page-reloads (`use-persisted-files.ts`, `session-file-store.ts`)

### ✅ Multi-bank ondersteuning (Rabobank + ABN AMRO)
Niet langer één hardcoded template: `shared/templates/registry.json` is de
centrale bron voor alle bank-specifieke config (extractieprompt,
placeholder-mapping, context-limits) per bank. Bron-templates + hun
`build_template.py` (opmaak-normalisatie) staan in `bank-models/<bank>/`.
Op dit moment `READY` in de registry: **Rabobank** (`HYRABO00`) en
**ABN AMRO** (`HYSTAA00`). Nieuwe banken toevoegen = nieuwe entry in
`registry.json` + template in `shared/templates/<bank>/` (zie Stap 10).

### ✅ n8n Workflows (3 stuks, geïmporteerd via `n8n-import`)
| Workflow | Bestand | Webhook |
|---|---|---|
| Hypotheekakte E2E | `hypotheekakte-workflow.json` | `/webhook/hypotheekakte` |
| Aktecontrole | `aktecontrole-workflow.json` | `/webhook/akte-controle` |
| Templates-beheer | `templates-management-workflow.json` | `/webhook/templates`, `/webhook/upload-template` |

Zie "Workflow-hardening (mei 2026)" verderop voor de architectuur van de
hypotheekakte-workflow (specialist-analyses, fan-out/merge, error-handling).

### ✅ Python scripts gemaakt (`vul_template_in.py`, `genereer_juridische_analyse.py`)
- Vervangen alle `<<PLACEHOLDER>>` tags in het Word template
- Behouden opmaak via run-niveau vervanging
- Output naar `/data/shared/output/hypotheekakte_{zaaknummer}.docx` resp.
  `juridische_analyse_{zaaknummer}.docx`
- Accepteren `--args-file`, flag-based, of (legacy) positional aanroep
  (zie "Argumenten naar Python-scripts" verderop)

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
- Overweeg de prompt te verfijnen; model is inmiddels `qwen2.5:7b` (niet meer `llama3.2`) — zie `llm-model-keuze-hardware` memory voor waarom niet qwen3 op deze 16 GB M4

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

De registry-aanpak is inmiddels gebouwd en actief (zie "Multi-bank
ondersteuning" hierboven) — dit is dus niet langer toekomstwerk voor
Rabobank/ABN AMRO, maar de blauwdruk voor élke volgende bank:

| Bank | Modelakte | Status |
|---|---|---|
| Rabobank | HYRABO00 | ✅ `READY` in registry, end-to-end getest |
| ABN AMRO | HYSTAA00 (AAB18-01) | ✅ Template + registry-entry aanwezig (`bank-models/abnamro/`) |
| ING | HYINGO00 | Nog niet gestart — nieuwe template + registry-entry nodig |
| Stater | Variabel | Nog niet gestart — passeeropdracht heeft ander formaat |

**Uitbreidingsaanpak (gevalideerd patroon, zie `bank-models/README.md` en
`shared/templates/README.md`):**
1. Bron-modelakte (.doc/.docx) in `bank-models/<bank>/` zetten
2. `build_template.py` voor die bank schrijven/aanpassen (opmaak-normalisatie,
   zie "Akte-opmaak" verderop) → output naar `shared/templates/<bank>/`
3. Nieuwe entry in `shared/templates/registry.json`: `display_name`,
   `keywords` (voor bank-detectie), `extraction_prompt`, `placeholders`-mapping
4. Bank wordt automatisch herkend uit de passeeropdracht (keyword-match,
   geen aparte code-wijziging in de n8n-workflow nodig) en is meteen
   beschikbaar in de Templates-pagina van de webapp

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
| `webapp/` | project-root | React-webapp (genereren / controle / templates), gebouwd via eigen Dockerfile |
| `registry.json` | `shared/templates/` | Centrale bank-config: prompts, placeholders, context_limits |
| `hypotheekakte-workflow.json` | `n8n/demo-data/workflows/`, import in n8n | Akte + juridische analyse pipeline |
| `aktecontrole-workflow.json` | `n8n/demo-data/workflows/`, import in n8n | Akte-vs-bronnen controle |
| `templates-management-workflow.json` | `n8n/demo-data/workflows/`, import in n8n | Templates uploaden/opvragen t.b.v. Templates-pagina |
| `vul_template_in.py` | `shared/` | Word template invullen via python-docx |
| `genereer_juridische_analyse.py` | `shared/` | Juridische analyse-document genereren |
| `build_template.py` | `bank-models/<bank>/` | Bron-modelakte normaliseren naar akte-huisstijl (per bank) |
| `template_HYRABO00.docx` / `template_HYSTAA00.docx` | `shared/templates/<bank>/` | Word template met `<<PLACEHOLDERS>>` per bank |
| `shared/output/` | `shared/output/` | Gegenereerde aktes en analyses |

---

## Ollama Extractieprompts

> **Let op:** dit is de oorspronkelijke Rabobank-only prompt-set, bewaard als
> referentie voor het schema. De **actuele, actief gebruikte** prompts
> (per bank, incl. ABN AMRO) staan in `shared/templates/registry.json`
> onder `extraction_prompt` / `kadaster_extraction_prompt` /
> `legal_specialist_prompts` / `brp_extraction_prompt` e.d., en draaien op
> `qwen2.5:7b` (niet meer `llama3.2`).

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

Sinds branch `feature/workflow-hardening-poc` (zie `CHANGES.md` voor detail per taak).
Onderstaande tabel beschrijft de huidige, geharde architectuur. De toenmalige
`beide`-mode (akte + analyse in één run) is intussen **vervallen** — zie de
mode-tabel bovenaan dit document; alleen `akte` en `analyse` zijn nog live.

### Nodes vervangen / vervangen door

| Oud (verwijderd of gewijzigd) | Nieuw |
|---|---|
| `Parse Ollama JSON` schreef in `$getWorkflowStaticData('global').hypoMerge` | `Parse Ollama JSON` geeft platte items terug; nieuwe Aggregate-node **`Combine Bank+Kadaster`** voegt de 2 items samen tot `{ docs: [bank, kadaster] }`. |
| `Analyse Route` Switch had geen fallback | `Analyse Route.options.fallbackOutput = 1` → onbekende modes naar de akte-tak met een `warning`-veld in de respons. |
| `Generate DOCX` / `Generate Analysis DOCX` / `Generate Flex Analysis DOCX` interpoleerden payload-data in shell-single-quotes | 3 nieuwe **`Write * Args`** Code-nodes schrijven een JSON-payload naar `/tmp/n8n_args_<scope>_<execId>_<ts>.json`; de executeCommand roept alleen `python3 <script> --args-file '{{ $json.argsFile }}'` aan. |
| Specialist-LLM-calls werden altijd gedaan (ook bij `signal_count = 0`) | Eén IF-node **`* Has Signals?`** per specialist (nu vier: Vererving / Lasten / Burgerlijke / Object&partijen) routeert bij geen signalen direct naar de Parse-node en slaat de LLM-call over. |
| Specialist-failure blokkeerde hele analyse | Alle specialist `* LLM Chain` nodes hebben nu `onError: "continueRegularOutput"`. |
| Magic-number clamp-limieten (10000/14000/26000/8000) verspreid over 6 Code-nodes | Centrale `context_limits`-sectie in `registry.json`; Code-nodes lezen `Number(registry.context_limits.<key>) \|\| <fallback>`. |
| `dossierExtraMarkdownByExec` global state in Collapse Dossier Markdowns → Build Placeholders | `dossier_markdown` lift mee als veld op de bank+kadaster-items via Build Extraction Prompt en Parse Ollama JSON, en wordt in Build Placeholders uit `bankDoc.dossier_markdown` gelezen. |
| Generate DOCX retourneerde `REPLACED_BLOCKS: N` op stdout zonder dat de workflow er iets mee deed | `Build Response (akte only)` parset het getal; bij 0 een `template_warning`-veld in de respons + `replaced_blocks` voor debugging. |
| Analyse-flow had alleen een Burgerlijke specialist | Vier specialisten in de analyse-flow: Vererving, Lasten, Burgerlijke staat en Object&partijen (elk 5 nodes, zelfde patroon en regex-pre-filter). Fan-out vanuit `Aggregate Markdowns` naar alle vier `Build * Prompt` nodes; `Parse Flex Analysis JSON` merget alle vier specialist-bevindingen met de mega-prompt. |
| Specialist-logica was gedupliceerd over twee input-shapes | Eén `Build * Prompt` per specialist, leest uit `Aggregate Markdowns`.docs[] (mode=analyse). De oude tweede `beide`-tak die uit `Build Placeholders` las, is bij de juli-2026-cleanup uit alle vier de nodes verwijderd. |
| Canvas was na alle hardening visueel onleesbaar | Alle nodes herpositioneerd in y-banen met sticky notes als labels. Puur cosmetisch, geen execution-impact. |
| Specialisten sequentieel; geen expliciete "wat heeft elke agent gevonden"-reporting | Parallelle fan-out: `Aggregate Markdowns` (analyse) connect met alle vier `Build * Prompt` nodes tegelijk. `Specialist Merge` (v3, combineByPosition, **4 inputs**) wacht op alle vier. `Collect Specialists` bouwt een `{ specialists: {vererving, lasten, burgerlijke, partijen}, summary: {...} }` payload. **Let op**: n8n's executionOrder v1 is single-threaded, dus geen wall-clock speedup — winst is architectureel + reporting. |

### Argumenten naar Python-scripts

De Python-scripts (`vul_template_in.py` en `genereer_juridische_analyse.py`) accepteren drie aanroepvormen, in volgorde van voorkeur:

1. **`--args-file <pad>`** (gebruikt door n8n). Het bestand is een JSON-object met dezelfde velden als de flag-based vorm (`template`, `placeholders`, `zaaknummer`, of `analysis`, `zaaknummer`, `bank`, `klant`). Wordt **na inlezen direct verwijderd** (zelfopruimend; geen TTL nodig).
2. **Flag-based** (`--template … --placeholders '<json>' --zaaknummer …`). Handig voor handmatige tests in de container.
3. **Legacy positional** (`'<json>' '<zaaknummer>'`, alleen `vul_template_in.py`). Defaults op de Rabobank-template. Blijft werken voor oudere n8n-imports.

### N8n-instellingen die deze workflow nodig heeft

- `Analyse Route.options.fallbackOutput = 1` (P1.2; staat in de export).
- `onError: "continueRegularOutput"` op de 5 specialist LLM Chains (P2.2; staat in de export).
- `executionOrder: v1` (ongewijzigd).
- Geen aanpassingen aan credentials of webhook-settings.

### Re-importeren in n8n

1. Open n8n → **Workflows** → bestaande "Hypotheekakte E2E" verwijderen.
2. **Import from file** → `n8n/demo-data/workflows/hypotheekakte-workflow.json`.
3. Activate toggle aan.

De webhook-URL blijft `http://localhost:5678/webhook/hypotheekakte`.

---

## Vierde specialist: Object & partijen (juli 2026)

Aanleiding: vergelijking van de webapp-pipeline tegen `workflows/Workflow
hypotheekakte.docx` (het kantoorproces) legde twee aandachtspunten uit dat
document bloot die geen van de drie bestaande specialisten (Vererving,
Lasten, Burgerlijke staat) expliciet dekte:

- **"2 cliënten in hypotheekopdracht, maar juist 1 persoon op kadastrale
  eigendomsinformatie"** — genoemd als aandachtspunt in het proces, niet
  gedekt door een eigen check (zie ook aandachtspunt 4 hieronder — de
  klant-volgorde-koppeling zelf blijft ongewijzigd, dit is een aanvullende
  signalering).
- **"Verkeerd object in hypotheekopdracht die niet op naam staat van
  cliënten"** — geen bestaande specialist vergelijkt cliënten/object tussen
  passeeropdracht en kadaster puur feitelijk (los van burgerlijke staat).

Nieuwe specialist **`object_partijen`** (categorie in de respons: `"Object
en partijen"`) is toegevoegd volgens exact hetzelfde patroon als de
bestaande drie (5 nodes: `Build Partijen Prompt` → `Partijen Has Signals?`
→ `Partijen LLM Chain` (+ `Partijen Ollama Model`) → `Parse Partijen JSON`),
parallel aan de andere specialisten vanuit `Aggregate Markdowns`.

**Actieve mode = `analyse`.** Er zijn nog maar twee modes: `akte` (alleen de
Word-akte, geen specialisten) en `analyse` (juridische analyse met alle vier
specialisten). De oude `beide`-mode is vervallen; bij de juli-2026-cleanup
zijn de `beide`-takken uit alle vier `Build * Prompt`-nodes (inclusief deze
nieuwe) verwijderd — ze lezen nu uitsluitend uit `Aggregate Markdowns`.docs[].

| Aspect | Detail |
|---|---|
| Prompt | `registry.json` → `legal_specialist_prompts.object_partijen` (LLM) + `partijen_extraction_prompt` (structured extractie) |
| Context-limits | `context_limits.specialist_partijen_bank` (10000), `specialist_partijen_kadaster` (14000), `specialist_partijen_analyse_combined` (26000) |
| Deterministische ruggengraat | Sinds juli 2026 heeft deze specialist als enige een eigen **structured-extractie-node** vóór de prompt: `Build Partijen Extractie Prompt` → `Partijen Extractie LLM Chain` (+ `Partijen Extractie Ollama Model`) → `Parse Partijen Extractie`. Die haalt uit de bank- en kadaster-markdown de minimale JSON (klanten, onderpand, kadastrale aanduiding) waarop `Build Partijen Prompt` **deterministische** checks draait (overgenomen uit `Deterministic Checks`): klantentelling-mismatch, achternaam-mismatch per klantpositie, en onderpand-woonplaats vs. kadastrale gemeente. Deze `det_findings` worden **altijd** gerapporteerd (harde feiten), los van de LLM. |
| LLM-laag (nuance) | `Build Partijen Prompt` vult de `object_partijen`-prompt nu met de geëxtraheerde klanten/onderpand-JSON + ruwe markdown, zodat de LLM nuance kan toevoegen (verkeerd object, spellingsvarianten). De LLM-call is gate'd op "bank én kadaster aanwezig". `Parse Partijen JSON` merget deterministisch + LLM en ontdubbelt per onderwerp (aantal / naam / object) met **voorrang voor de deterministische bevinding** — zo geen dubbele aandachtspunten. |
| Wiring | `Specialist Merge` `numberInputs: 4`; `Collect Specialists` en `Parse Flex Analysis JSON` bevatten het vierde specialisme (zelfde "specialist heeft voorrang op mega-prompt binnen eigen categorie"-logica). Analyse doet nu tot **5** LLM-calls: 1 partijen-extractie + max. 4 specialisten. |

### Akte-opmaak (`build_template.py`)

De Word-akte volgt de huisstijl van de definitieve KIK-referentie
(`testdossiers/KIK - Hypotheekakte Rabobank - Definitief.docx`). Alle
opmaak-logica zit in `bank-models/rabobank/build_template.py` en wordt
toegepast bij het (her)bouwen van het template:

| Aspect | Waarde | Functie |
|---|---|---|
| Lettertype | Arial 12pt | `_apply_reference_formatting` |
| Regelafstand | 1.15 | `_apply_reference_formatting` |
| Paginaformaat | A4 (210×297mm) | `_apply_reference_formatting` |
| Marges (T/B/L/R) | 35/25/50/25 mm | `_apply_reference_formatting` |
| Witregels | geen (after/before=0 + lege paragrafen weg) | `_apply_reference_formatting` |
| Sectietitels | Heading 2 (20×) + Heading 3 (`EINDE KADASTERDEEL`), Arial 12pt bold zwart | `_style_section_headings` |
| Word-compat | kebab→camelCase OOXML + schone python-docx package | `_normalize_ooxml_kebab_case`, `_rebuild_on_clean_base` |

De welke-alinea-is-een-kop mapping staat in `HEADING2_TITLES` /
`HEADING3_TITLES` (exacte-tekst-whitelist) bovenin het script.

Template herbouwen na een wijziging:
```
python3 bank-models/rabobank/build_template.py \
  --input  bank-models/rabobank/HYRABO00_H1_2018.docx \
  --output shared/templates/rabobank/template_HYRABO00.docx
```

---

## Bekende aandachtspunten

0. **Ollama-contextvenster (`numCtx`) — KRITISCH** — De n8n `lmChatOllama`-nodes stellen `options.numCtx` in (camelCase; **default 2048 tokens**). Zonder deze optie kapt Ollama elke prompt >2048 tokens **stil** af, waardoor data die verderop in de prompt staat (bijv. BRP-huwelijksdata onderin een specialist-prompt) nooit door het model gezien wordt → lege/foute bevindingen zonder foutmelding. Alle 7 model-nodes staan nu op `numCtx: 8192` (+ `keepAlive: 30m` om herladen tussen de max. 5 sequentiële calls te voorkomen). **Let op:** de char-clamps in `context_limits` lopen tot 26000 tekens (~9000 tokens); voor zeer grote dossiers kan een prompt alsnog >8192 tokens worden. Dan óf `numCtx` verhogen (kost geheugen op de 16 GB M4) óf de clamps verlagen. Gebruik NIET de sleutel `num_ctx` (snake_case) — die wordt door de node genegeerd.

1. **Ollama JSON betrouwbaarheid** — `qwen2.5:7b` geeft soms tekst rondom de JSON. De parse node strip backticks maar bij hardnekkige fouten: voeg `"format": "json"` toe aan de Ollama API call body.

2. **Word opmaak** — python-docx vervangt op run-niveau. Als een placeholder verspreid is over meerdere runs in Word (kan gebeuren bij kopiëren/plakken), werkt de vervanging niet. Hertype de placeholder in Word als dit voorkomt.

3. **Docling timeout** — Zware PDFs kunnen >60s duren. De timeout staat op 120s in de workflow. Voor gescande PDFs met slechte kwaliteit: overweeg `ocr_enabled: true` expliciet mee te sturen.

4. **Klant volgorde** — De koppeling tussen passeeropdracht-klanten en kadaster-klanten gaat op basis van volgorde (klant 1 = eerste in beide documenten). Dit werkt voor standaard twee-persoons aanvragen. Bij één klant of drie klanten moet de Code node worden aangepast. De nieuwe **Object & partijen**-specialist (zie "Vierde specialist" hierboven) laat de LLM in de `analyse`-mode een aantal-/naam-mismatch tussen passeeropdracht en kadaster signaleren als aandachtspunt, maar lost de onderliggende volgorde-koppeling in `Build Placeholders` (akte-mode) niet op.

5. **Nationaliteit tweede klant** — Mevrouw Vermeulen heeft geboorteland Windhoek (Namibië/Zuid-Afrika). De passeeropdracht vermeldt "Zuid Afrika" als nationaliteit. Dit kan afwijken van de formele notatie in de akte — controleer dit bij het eerste testresultaat.

6. **`Deterministic Checks` (akte-flow) output wordt niet geconsumeerd** — De node `Deterministic Checks` in de **akte**-flow berekent `deterministic_aandachtspunten` (klantentelling-, achternaam-, gemeente-mismatch), maar sinds `beide` vervallen is stopt de akte-flow bij `Build Response (akte only)` en die leest het veld niet — dode data in die tak (de node blijft nodig als passthrough `Build Placeholders` → `Write Akte Args`). **De logica zelf is niet verloren:** dezelfde checks zijn (juli 2026) hergebruikt in de **analyse**-flow, gevoed door een structured-extractie-node, als deterministische ruggengraat onder de Object & partijen-specialist (zie "Vierde specialist" hierboven). Openstaand voor de akte-flow: `deterministic_aandachtspunten` alsnog in de akte-respons tonen, óf de node terugbrengen tot pure passthrough. Nog niet besloten.
