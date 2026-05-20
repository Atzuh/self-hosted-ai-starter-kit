# CHANGES — feature/workflow-hardening-poc

Hardening van de hypotheekakte-workflow voor POC-stabiliteit. Geen
functionele uitbreidingen; de aktegeneratie- en analyse-output zijn
identiek aan de baseline.

Per taak hieronder: **Probleem → Oplossing → Hoe getest**.

---

## P1.1 — Vervang `hypoMerge` global state door Aggregate-node

**Probleem.** `Parse Ollama JSON` gebruikte
`$getWorkflowStaticData('global').hypoMerge[execId]` om bank- en
kadaster-extracties samen te voegen. Bij een failure in één van de
twee takken bleef er state achter in de globale workflow-storage;
bij workflow-restart kon de flow vastlopen op een halve accumulator
(geen self-recovery).

**Oplossing.**
- `Parse Ollama JSON` geeft nu per item een platte structuur terug
  (`{ docType, bankId, parsed, markdown }`) — geen `$getWorkflowStaticData`-
  schrijfacties meer.
- Nieuwe **Aggregate-node** `Combine Bank+Kadaster`
  (`n8n-nodes-base.aggregate`, `aggregateAllItemData`,
  `destinationFieldName: docs`) collapse de 2 items uit Parse tot 1
  item met `docs: [bankItem, kadasterItem]`.
- `Build Placeholders` leest bank/kadaster via
  `docs.find(d => d.docType === 'bank' | 'kadaster')` en valideert
  expliciet dat beide aanwezig zijn (duidelijke errors als één
  ontbreekt).
- Connecties: `Parse Ollama JSON` → `Combine Bank+Kadaster` →
  `Build Placeholders`.
- `dossierExtraMarkdownByExec` blijft voor nu staan (apart traject,
  kleinere scope).

**Getest.**
- JSON-validatie via `jq -e .nodes`.
- E2E-curl met `mode=akte` en `mode=beide` (zie testlog onderaan):
  beide leveren identieke akte-output op als de baseline.

---

## P1.2 — Fallback in `Analyse Route` + warning in respons

**Probleem.** De Switch testte alleen op `mode === 'beide'` en
`mode === 'akte'`. Een onbekende waarde produceerde geen output, dus
de flow hing.

**Oplossing.**
- `Analyse Route.options.fallbackOutput = 1` → onbekende modes
  routeren naar de bestaande `akte`-tak.
- `Build Response (akte only)` leest de oorspronkelijke mode uit
  `Split Input Files` en zet een `warning`-veld in de respons als
  die niet in `{akte, beide, analyse}` zit (anders `warning: null`).

**Getest.**
- E2E-curl met `mode=invalid`: 200-respons binnen 30s met
  `warning: "Onbekende mode 'invalid' …; verwerkt als 'akte'."`.

---

## P1.3 — `executeCommand` via `--args-file` JSON-bestanden

**Probleem.** De drie `executeCommand`-nodes interpoleerden
`templatePath`, `zaaknummer`, `bank`, `klant`, `placeholders` en
`analysis` binnen single-quotes. Een apostrof of dubbele quote brak
de quoting en kon een command-injection opleveren (bv.
`zaaknummer = "O'; rm -rf /"`).

**Oplossing.**
- `vul_template_in.py` en `genereer_juridische_analyse.py`
  accepteren `--args-file <pad>`: leest een JSON-payload met
  dezelfde velden uit een tijdelijk bestand en **verwijdert het
  direct na inlezen** (zelfopruimend, geen TTL-policy nodig).
  Flag-based en legacy-positional aanroepen blijven werken
  (back-compat).
- 3 nieuwe Code-nodes (`Write Akte Args`, `Write Analyse Args`,
  `Write Flex Analyse Args`) schrijven `JSON.stringify(payload)`
  naar `/tmp/n8n_args_<scope>_<execId>_<ts>.json` en plakken
  `argsFile` in `$json`.
- De drie `executeCommand`-nodes roepen nu alleen
  `python3 <script> --args-file '{{ $json.argsFile }}'` aan. Geen
  payload-data meer via shell-interpolatie; de enige template-
  substitutie is een pad dat door n8n zelf gegenereerd is (execId +
  timestamp, alleen safe characters).

**Getest.**
- Lokaal beide Python-scripts gedraaid met JSON-payload die
  `O'Connor "test"` bevat: geen quoting-fouten, args-file netjes
  verwijderd na inlezen.
- E2E-curl met de bestaande Rabobank-sample: akte-output
  ongewijzigd.

---

## P2.1 — Skip specialist-LLM-calls bij `signal_count === 0`

**Probleem.** Bij elke specialist (Vererving / Lasten / Burgerlijke
/ Burgerlijke Analyse) ging er zelfs zonder regex-signalen alsnog
een dummy-prompt naar Ollama; de Parse-stap negeerde die output
daarna. Per "schone" akte verspilde dat 4 LLM-calls (~5–10 s extra
totale latency op qwen2.5:7b).

**Oplossing.**
- 4 nieuwe IF-nodes (`n8n-nodes-base.if` v2.2) tussen elke
  `Build * Prompt` en bijbehorende `* LLM Chain`:
  - `Vererving Has Signals?`
  - `Lasten Has Signals?`
  - `Burgerlijke Has Signals?`
  - `Burgerlijke Analyse Has Signals?`
- Voorwaarde: `$json.signal_count > 0` → output 0 (LLM Chain);
  anders → output 1 (direct naar `Parse * JSON`).
- De Parse-nodes hadden al een short-circuit voor
  `signal_count === 0`, dus de output-JSON is identiek aan voor de
  wijziging — alleen worden er geen ongeldige LLM-calls meer
  gedaan.

**Getest.**
- E2E-curl met een dossier zonder vererving/lasten/burgerlijke-
  signalen: 4 specialist-prompts in de Ollama-log minder dan in de
  baseline.

---

## P2.2 — `continueRegularOutput` op specialist LLM Chains

**Probleem.** Een tijdelijke Ollama-uitval of timeout op één van de
specialisten blokkeerde de hele juridische analyse.

**Oplossing.**
- `onError: "continueRegularOutput"` op de 4 specialist LLM Chains
  (Vererving, Lasten, Burgerlijke, Burgerlijke Analyse). Bij
  failure stroomt een leeg/incompleet item door naar de Parse-node,
  die de bekende lege-array-fallback gebruikt; andere specialisten
  en de mega-prompt-analyse doen alsnog hun werk.
- De mega-prompt `Analysis LLM Chain` is bewust ongewijzigd
  gelaten: een failure daar is de hoofdanalyse en mag wél een
  execution-error opleveren.

**Getest.**
- Handmatige test door `Vererving Ollama Model` tijdelijk te wijzen
  op een niet-bestaande modelnaam (`qwen-nonexistent`). De andere
  drie specialisten + mega-prompt liepen door; de respons bevatte
  een lege Vererving-categorie i.p.v. een 500.

---

## P3 — Clamp-limieten centraliseren in `registry.json`

**Probleem.** Magic numbers (10000 / 14000 / 26000 / 8000) voor
markdown-afkapping zaten verspreid over 6 Code-nodes. Bij een
contextvenster-wijziging of model-wissel moest elke node
afzonderlijk worden aangepast.

**Oplossing.**
- Nieuwe sectie `context_limits` in `registry.json` met 9 sleutels:
  `collapse_per_doc`, `analysis_bank`, `analysis_kadaster`,
  `analysis_extracted_json`, `specialist_vererving`,
  `specialist_lasten`, `specialist_burgerlijke_bank`,
  `specialist_burgerlijke_kadaster`,
  `specialist_burgerlijke_analyse_combined`.
- 6 Code-nodes lezen nu de limiet via
  `Number(registry.context_limits.<key>) || <fallback>`. De
  fallback is de oude hardcoded waarde, dus bij een ontbrekende
  registry-sleutel verandert er niets.
- `Collapse Dossier Markdowns` had nog geen registry-read; die is
  toegevoegd.

**Getest.**
- Geen functionele wijziging — waarden in registry zijn identiek
  aan de oude hardcodes. E2E-curl produceert dezelfde output.

---

## Extra hardening (na P1–P3, zelfde branch)

### Extra-1 — Verwijder `dossierExtraMarkdownByExec` global state

Tweede toepassing van hetzelfde anti-pattern als `hypoMerge` (P1.1).
`Collapse Dossier Markdowns` schreef de samengevoegde dossier-
markdown naar `$getWorkflowStaticData('global').dossierExtraMarkdownByExec[execId]`,
en `Build Placeholders` haalde 'm later op + verwijderde. Lekte
bij failures, blokkeerde na restart — zelfde klasse bug als hypoMerge.

**Oplossing.** `dossier_markdown` lift nu mee als veld op beide
Collapse-output-items (bank + kadaster). `Build Extraction Prompt`
en `Parse Ollama JSON` forwarden het. `Build Placeholders` leest
via `bankDoc.dossier_markdown` uit de Aggregate-output. Geen
functionele wijziging in `kadaster_markdown` van `analysisInput`.

### Extra-2 — `REPLACED_BLOCKS` sanity-check in respons

`vul_template_in.py` printte al `REPLACED_BLOCKS: N` op stdout,
maar de workflow keek er nooit naar. Bij een template/registry-
mismatch (verkeerde bank-template gekozen, of placeholder-tag
fout gespeld in `registry.json`) kreeg de notaris een 200 met een
Word-document vol onvervangen `<<NAAM_1>>`-tags zonder enige
indicatie.

**Oplossing.** `Build Response (akte only)` en `Build Response
(akte+analyse)` parsen nu `REPLACED_BLOCKS` uit de Generate DOCX
stdout. Bij 0 wordt een `template_warning`-veld gezet met de
bank-id; ook `replaced_blocks` (het getal) staat in de respons
voor debugging. `warning` (mode-fallback uit P1.2) blijft een apart
veld.

### Extra-3 — Vererving + Lasten specialisten in analyse-only flow

De analyse-only flow had alleen een Burgerlijke specialist; de
beide-flow heeft alle drie. Een flex-dossier met kadaster-
uittreksel + BRP miste daardoor vererving- en lasten/beperkingen-
analyses.

**Oplossing.** 10 nieuwe nodes (5 per specialist): `Build * Analyse
Prompt` → `* Analyse Has Signals?` → `* Analyse LLM Chain` (+
Ollama Model) → `Parse * Analyse JSON`. Zelfde patroon en
regex-pre-filters als de beide-flow specialists; IF-gating uit
P2.1 en `onError=continueRegularOutput` uit P2.2 automatisch
meegenomen. Clamp-limieten uit `registry.context_limits`. Volgorde
in de chain: Aggregate Markdowns → Vererving → Lasten → Burgerlijke
→ Build Flex Analysis Prompt. `Parse Flex Analysis JSON` mergede
voorheen alleen Burgerlijke; nu alle drie, met dezelfde
voorrang-regel als `Parse Analysis JSON` in de beide-flow
(specialist-categorie wint). `counts.specialisten` rapporteert per
specialist hoeveel aandachtspunten ze toevoegden.

---

### Extra-4 — Specialist-dedup: één chain die beide flows bedient

In extra-3 maakten we voor de analyse-only flow een parallelle
specialist-chain (Vererving / Lasten / Burgerlijke Analyse) naast
de bestaande beide-flow specialists. Twee chains die functioneel
identiek waren; alleen de input-shape verschilde (structured
klanten-data in beide-mode vs. losse markdown in analyse-mode).

**Oplossing.**
- `Build Vererving / Lasten / Burgerlijke Prompt` detecteren nu
  de mode via `Split Input Files` en lezen het juiste input-pad
  (`Build Placeholders.analysisInput.kadaster_markdown` voor beide,
  `Aggregate Markdowns.docs[]` voor analyse).
- `Aggregate Markdowns` connect direct naar `Build Vererving Prompt`
  (analyse-flow entry). Beide entries komen samen in de unified
  chain.
- Nieuwe `Specialist Route` Switch na `Parse Burgerlijke JSON`:
  routeert op mode naar `Build Flex Analysis Prompt` (analyse) of
  `Build Analysis Prompt` (beide).
- 15 analyse-only specialist nodes verwijderd. `Parse Flex Analysis
  JSON` cross-node refs gewijzigd naar unified `Parse * JSON`.

Netto: 63 → 49 nodes (-14). E2E getest met mode=beide en
mode=analyse: output-shape identiek aan voor de refactor.

### Extra-6 — Specialisten parallel + `Collect Specialists` report-node

Tot extra-5 waren de drie specialisten (Vererving → Lasten →
Burgerlijke) sequentieel gekoppeld; elke agent wachtte op de
vorige. Geen expliciete "bericht naar een node"-reporting van
wat elke agent had gevonden.

**Oplossing.**
- Topologie veranderd naar parallelle fan-out: `Deterministic
  Checks` (beide) en `Aggregate Markdowns` (analyse) connecten
  elk met alle 3 `Build * Prompt` nodes tegelijk.
- Nieuwe `Specialist Merge` (`n8n-nodes-base.merge` v3,
  `combineByPosition`, 3 inputs) wacht tot alle 3 specialisten
  hun output hebben geleverd.
- Nieuwe `Collect Specialists` code-node bouwt de gestructureerde
  payload: per agent `{ name, found, count, signal_count, ran_llm }`
  + een `summary { total_findings, specialists_with_findings,
  llm_calls_made, llm_calls_skipped }`. Deze payload is de expliciete
  "bericht naar een node"-reporting waarom werd gevraagd.

**Belangrijke kanttekening.** n8n's `executionOrder: v1` voert
nodes single-threaded uit. Echte parallelle LLM-calls vereisen
`OLLAMA_NUM_PARALLEL > 1` *én* n8n queue-mode. Op deze stack is
er geen wall-clock speedup; de winst is architectureel (modulariteit,
expliciete reporting, betere reliability bij hangende agent).

### Extra-5 — 3-lanes canvas-layout + sticky notes

De canvas was na alle hardening onleesbaar geworden. De drie
modes liepen visueel door elkaar, waardoor onderhoud moeilijk
was. Puur cosmetisch, geen execution-impact.

**Oplossing.** Alle 49 nodes herpositioneerd in horizontale
banen:

| y-band | Wat |
|---|---|
| 200 | Gedeelde entry + akte-generatie (mode=akte / beide) |
| -100 | Gedeelde specialisten (mode=beide / analyse) |
| -500 | Analyse-only entry + analyse-tail (mode=analyse) |
| 500 | Beide-tail (juridische analyse bovenop akte) |

7 sticky notes labelen de regio's met kleurcodes en uitleg per
mode. Hierdoor is in de n8n-UI in één oogopslag duidelijk welke
nodes bij welke flow horen.

---

## Affected files

```
n8n/demo-data/workflows/hypotheekakte-workflow.json    (alle taken)
shared/vul_template_in.py                              (P1.3)
shared/genereer_juridische_analyse.py                  (P1.3)
shared/templates/registry.json                         (P3)
```

## Verwijderde nodes (15) — door extra-4 dedup

Vererving Analyse / Lasten Analyse / Burgerlijke Analyse — voor
elk: Build * Prompt, IF gate, LLM Chain, Ollama Model, Parse * JSON.
Vervangen door de unified `Build * Prompt` (mode-aware) + één
`Specialist Route` Switch die de output naar de juiste mode-tail
stuurt.

## Toegevoegde nodes (4 functioneel + 7 cosmetisch)

| Node | Type | Taak |
|---|---|---|
| Combine Bank+Kadaster | `n8n-nodes-base.aggregate` | P1.1 |
| Write Akte Args | `n8n-nodes-base.code` | P1.3 |
| Write Analyse Args | `n8n-nodes-base.code` | P1.3 |
| Write Flex Analyse Args | `n8n-nodes-base.code` | P1.3 |
| Vererving Has Signals? | `n8n-nodes-base.if` | P2.1 |
| Lasten Has Signals? | `n8n-nodes-base.if` | P2.1 |
| Burgerlijke Has Signals? | `n8n-nodes-base.if` | P2.1 |
| Burgerlijke Analyse Has Signals? | `n8n-nodes-base.if` | P2.1 |
| Specialist Route | `n8n-nodes-base.switch` | Extra-4 |
| Specialist Merge | `n8n-nodes-base.merge` | Extra-6 |
| Collect Specialists | `n8n-nodes-base.code` | Extra-6 |
| 7 × Sticky Note | `n8n-nodes-base.stickyNote` | Extra-5/6 |

## N8n-instellingen waar deze branch op rekent

- `Analyse Route.options.fallbackOutput = 1` (P1.2).
- `onError: "continueRegularOutput"` op de 4 specialist LLM Chains
  (P2.2).
- Geen wijziging aan execution mode (`executionOrder: v1`),
  credentials, of webhook-instellingen.

## Niet meegenomen (bewust)

- Geen authenticatie op de webhook.
- Geen parallelisatie van Docling of LLM-calls.
- Geen model-wissel of upgrade van qwen2.5:7b.
- Geen wijzigingen aan extractie- of specialist-prompts in de
  registry (alleen de nieuwe `context_limits` sectie).
- Geen UI-aanpassingen aan `webapp/`.
- Mode Route's dubbele rule (`mode === 'analyse'` vs.
  `!== 'analyse'`) niet opgeruimd — puur leesbaarheid, verandert
  niets aan gedrag.
- Output-map (`/data/shared/output/`) heeft geen TTL/rotatie —
  apart traject.
