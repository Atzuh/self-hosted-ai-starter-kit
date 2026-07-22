# Roadmap — Scriptor als combinatie van NotaBot en Fidacta

> Richtingsdocument voor de webapp van **De Rivieren Notarissen**.
> Laatst bijgewerkt: juli 2026.

## Visie

Scriptor groeit uit tot een **lokaal, soeverein AI-platform** dat twee werelden
combineert:

- **Fidacta-kant** — een AI-copiloot die het *opstellen, analyseren en
  controleren* van akten en dossiers assisteert, met bronvermelding en
  menselijke eindverantwoordelijkheid.
- **NotaBot-kant** — *procesautomatisering* over de hele dossierlevenscyclus:
  dossiers, partijen, registergoederen, recherches en logging.

Onderscheidend: alles draait **on-prem** (Docling + Ollama + Qdrant + Postgres
in Docker, Ollama native op de M4). Geen cloud, geen hyperscaler — daarmee zit
Scriptor op soevereiniteit zelfs vóór op Fidacta's eigen claim.

---

## Hoe de twee referenties werken

### NotaBot (NEXTlegal)
RPA-robot, diep geïntegreerd in kantoorsoftware (o.a. NEXTassyst). Automatiseert
repeterende dossier-handelingen:
- Dossiers aanmaken vanuit de koopovereenkomst (MOVE/NVM/VBO), partijen +
  registergoederen koppelen
- (Her)recherches uitvoeren, controles draaien, mappen aanmaken
- Akten aanmaken, declaraties doorboeken, ID-scans verwerken
- Werkprocessen koppelen tussen verschillende softwarepakketten

→ Karakter: **de rug van het dossier** — procesautomatisering via integratie.

### Fidacta
Soeverein "private AI"-platform, een copilot-suite met notarieel-specifieke
agents:
- Aktevoorbereiding (akten, verklaringen, volmachten), dossieranalyse,
  kwaliteitscontrole/foutdetectie
- Concept e-mailantwoorden (Reply / DossierReply)
- Agents: DocGen, juridische sparringpartner, offerte-, clausule-, vertaal-,
  samenvat-assistent, voicenotes→verslag, VVE-agent, overdracht woning,
  boedelregister
- Kenniscollecties met **bronvermelding** (controleerbare output)
- NL/EU-hosting, AVG, géén ChatGPT/hyperscalers, audit trails

→ Karakter: **AI-copiloot + kennisbank + soevereiniteit**.

---

## Waar Scriptor al aan voldoet

| Bouwsteen | Status | Waar |
|---|---|---|
| DocGen / aktevoorbereiding | ✅ | Genereren-pagina → n8n → python-docx, multi-bank via `registry.json` |
| Dossieranalyse | ✅ | `analyse`-mode met vier specialisten (Vererving, Lasten, Burgerlijke staat, Object & partijen) |
| Kwaliteitscontrole / foutdetectie | ✅ | Controle-pagina + deterministische checks + specialist-signalering |
| Automatische documentherkenning | ✅ (deel van "recherche/controle") | `pdf-classify.ts` + server-side classificatie (bank/kadaster/brp) |
| Soevereiniteit / private AI | ✅✅ | Volledig lokaal: Docling + Ollama `qwen2.5:7b`, geen cloud |
| Templatebeheer | ✅ | Templates-pagina + registry per bank |
| Overzicht/dashboard | ✅ | Dashboard met activiteit + verdeling recent werk |
| **RAG-kennisbank met bronvermelding** | 🟡 in aanbouw (zie stap 1) | Qdrant + `shared/kennisbank/`, gewoven in de Burgerlijke staat-specialist |

De Fidacta-kern (DocGen + analyse + controle + soevereiniteit) staat dus al.

---

## Wat nog mist

### NotaBot-kant (proces & automatisering) — grootste gat

| Gap | Nu in Scriptor | Impact |
|---|---|---|
| Dossier als persistent object (status, partijen, registergoed) | Stateless: document-in → document-uit | Hoog |
| Recherches uitvoeren (Kadaster-online, KvK, insolventie-/curatele-/boedelregister) | Leest geüploade Kadaster-PDF, doet geen recherche | Hoog (botst met lokaal-only) |
| ID-verificatie / ID-scan verwerking | Afwezig | Middel |
| Integratie met kantoorsoftware (NEXTassyst e.d.) | Standalone | Middel |
| Declaraties / facturatie | Afwezig | Laag (buiten scope) |

### Fidacta-kant (copilot-suite & governance)

| Gap | Nu in Scriptor | Impact |
|---|---|---|
| Kennisbank met bronvermelding (RAG) | 🟡 in aanbouw (Qdrant nu in gebruik) | Hoog |
| Juridische sparringpartner (chat) | Geen conversationele laag | Middel-hoog |
| E-mail concept / DossierReply | Afwezig | Middel |
| Bredere agents (offerte, clausule, vertaal, samenvatting, voicenotes, VVE) | Alleen hypotheekakte + analyse | Middel |
| Human-in-the-loop bevestiging | Genereert automatisch | Hoog |
| Audit trail / logging (wie, wat, wanneer) | Geen DB-logging | Hoog |
| Authenticatie / multi-user | Webapp volledig open | Hoog voor productie |

---

## Top-4 bouwplan

Volgorde volgt de afhankelijkheden; 1 en 2 raken verschillende infra (Qdrant
vs. Postgres) en kunnen parallel.

| Stap | Doel | Afhankelijkheid | Inschatting |
|---|---|---|---|
| **1. RAG-kennisbank op Qdrant** | Analyse (en later chat) met bronvermelding | — (Qdrant staat klaar) | ~1 week (POC ✅ gedaan) |
| **2. Dossierlaag + audit logging** | Van documentconverter naar dossier-app; governance | — (Postgres staat klaar) | ~1 week |
| **3. Human-in-the-loop bevestiging** | Notaris keurt geëxtraheerde data goed vóór generatie | Profiteert van 2 | ~1 week |
| **4. Sparringpartner-chat** | Conversationele laag met bronnen | Vereist 1, idealiter 2 | ~3-4 dagen |

Dwarsligger buiten de top-4: zodra "wie deed wat" gelogd wordt, is een minimale
**gebruikersidentiteit** nodig (login of notaris-keuze). De webapp is nu open.

### Stap 1 — RAG-kennisbank op Qdrant
- Embedding-model `nomic-embed-text` (768-dim) in Ollama.
- Qdrant-collectie `juridische_bronnen`.
- Ingest-flow: bronnen (`.md` met frontmatter) → chunk → embed → upsert.
- Retrieval vóór de specialist-prompt; citaten in de bevinding.
- Bron-chips in de webapp.

### Stap 2 — Dossierlaag + audit logging
- Aparte Postgres-DB `scriptor` met `dossier`, `partij`, `registergoed`,
  `document`, `audit_log`.
- n8n-workflows persisteren de al-geëxtraheerde JSON + loggen elke run.
- Webhook `/webhook/dossiers` + Dossiers-pagina; dashboard leest uit de DB.

### Stap 3 — Human-in-the-loop bevestiging
- Workflow splitsen: `/extract` (geeft JSON terug) en `/genereer` (vult template
  met bevestigde JSON).
- Review-stap `ExtractieReview.tsx`: bewerkbaar formulier, verdachte velden
  gemarkeerd via deterministische checks + Object&partijen-signalen.
- Bevestiging → `audit_log`.

### Stap 4 — Sparringpartner-chat
- Webhook `/webhook/chat` ({dossier_id?, vraag, history}) → retrieval + optionele
  dossiercontext → `qwen2.5:7b` → antwoord + geciteerde bronnen.
- Chat-pagina met bron-chips; guardrail "antwoord alleen op basis van de bronnen".

---

## Voortgang

### ✅ Stap 1 — RAG-POC (juli 2026)
Werkende, lokaal-soevereine RAG-motor; gewoven in de Burgerlijke staat-specialist
met fail-safe degradatie.

Nieuwe bestanden in [shared/kennisbank/](shared/kennisbank/):
- [kb_common.py](shared/kennisbank/kb_common.py) — Ollama/Qdrant-helpers (alleen stdlib)
- [kennisbank_ingest.py](shared/kennisbank/kennisbank_ingest.py) — chunk → embed → upsert (idempotent)
- [kennisbank_query.py](shared/kennisbank/kennisbank_query.py) — retrieval-primitief (`--json` / `--stdin`)
- [bronnen/](shared/kennisbank/bronnen/) — seed-corpus: art. 1:88, 1:89, 1:80b BW + kantoor-praktijknoot

Gewijzigd:
- `hypotheekakte-workflow.json` — `Build Burgerlijke Prompt` (retrieval via
  `httpRequest` naar `host.docker.internal:11434` + `qdrant:6333`, blok in de
  prompt, try/catch) en `Parse Burgerlijke JSON` (citaten per aandachtspunt).
- [JuridischeAnalyse.tsx](webapp/src/components/JuridischeAnalyse.tsx) — bron-chips
  met link naar wetten.overheid.nl.

Kennisbank uitbreiden: een `.md` met frontmatter in
[bronnen/](shared/kennisbank/bronnen/) droppen en `python3 kennisbank_ingest.py`
draaien.

**Openstaand voor stap 1:**
- [ ] Workflow her-importeren in n8n + één testdossier (mode=analyse) draaien ter bevestiging.
- [ ] Retrieval fijnslijpen (`score_threshold` tegen ruis, top-k afstellen).
- [ ] Patroon uitrollen naar de andere drie specialisten (Vererving, Lasten, Object & partijen).

---

## Bronnen
- NotaBot — https://www.notabot.nl/ · NEXTlegal — https://www.nextlegal.nl/diensten/notabot/
- Fidacta — https://fidacta.ai/ · https://fidacta.ai/ai-notariaat
