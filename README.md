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
4. Klik **Genereer** en wacht op het resultaat (~2–5 minuten)
5. Download de gegenereerde `.docx`

Gegenereerde aktes staan ook direct beschikbaar op `http://localhost:8080/output/`.

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

1. Verwijder in n8n de bestaande workflow "Hypotheekakte E2E"
2. **Import from file** → `n8n/demo-data/workflows/hypotheekakte-workflow.json`
3. Zet de **Active** toggle aan

Webhook-URL: `http://localhost:5678/webhook/hypotheekakte`

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
