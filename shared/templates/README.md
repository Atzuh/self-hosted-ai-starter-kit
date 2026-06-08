# Templates beheer

Scriptor ondersteunt meerdere bank-templates. Elke bank heeft één **actieve** template-`.docx`; eindgebruikers kunnen via de Templates-pagina in de webapp een nieuwe versie uploaden om de oude te vervangen.

## Architectuur

```
shared/templates/
├── registry.json                   ← bank-presets (keywords, prompts, placeholder-mapping)
├── rabobank/
│   └── template_HYRABO00.docx      ← actieve Rabobank-template
├── abnamro/                        ← (voorbeeld) wordt aangemaakt bij eerste upload
│   └── template_HYABNAMRO01.docx
└── …
```

**`registry.json`** is de centrale configuratie. Per bank bevat het:

| Veld | Beschrijving | Wie onderhoudt |
|---|---|---|
| `display_name` | Naam zoals getoond in UI ("Rabobank") | Ontwikkelaar |
| `keywords` | Zoektermen voor auto-detectie uit passeeropdracht | Ontwikkelaar |
| `template_filename` | Bestandsnaam onder `shared/templates/<bank-id>/` | **Eindgebruiker** (via upload) |
| `uploaded_at` / `uploaded_by` | Audit-info, wordt automatisch bijgewerkt | (auto) |
| `extraction_prompt` | LLM-prompt om velden uit de passeeropdracht te halen | Ontwikkelaar |
| `placeholders` | Mapping van `<<TAG>>` → padlijst in geëxtraheerde JSON | Ontwikkelaar |

## Hoe de workflow het gebruikt

1. **Webhook** ontvangt passeeropdracht + kadaster-PDF.
2. **Docling** zet beide om naar markdown.
3. **Build Extraction Prompt**-node leest `registry.json`, scant de bank-markdown op keywords en kiest de bank met de hoogste score. Bouwt vervolgens de bank-specifieke LLM-prompt.
4. **Ollama** extraheert velden naar JSON.
5. **Build Placeholders**-node leest opnieuw `registry.json`, lost de declaratieve paden op (`bank.klanten[0].naam_hoofdletters`) en vult de juiste `<<TAG>>` -map.
6. **Generate DOCX** roept `vul_template_in.py --template /data/shared/templates/<bank-id>/<filename> --placeholders … --zaaknummer …` aan.

## Een nieuwe bank toevoegen (ontwikkelaar)

1. Bekijk een passeeropdracht van de bank en bepaal de relevante velden.
2. Bekijk het notarisakte-template voor die bank en lijst de `<<TAG>>`-placeholders.
3. Voeg een nieuwe entry toe aan `shared/templates/registry.json`:
   ```json
   "abnamro": {
     "display_name": "ABN AMRO",
     "keywords": ["abn amro", "abnamro", "..."],
     "template_filename": "",
     "uploaded_at": null,
     "uploaded_by": null,
     "extraction_prompt": "Je bent een data-extractie assistent...\n\nMarkdown:\n{{markdown}}",
     "placeholders": {
       "<<TAG_1>>": ["bank.veld_1"],
       "<<NAAM_1_HOOFDLETTERS>>": ["kadaster.klanten[0].naam_hoofdletters", "bank.klanten[0].naam_hoofdletters"]
     }
   }
   ```
4. Deploy de wijziging (registry.json wordt direct gelezen — geen rebuild nodig).
5. Eindgebruiker uploadt vervolgens het `.docx`-bestand via de Templates-pagina.

## Een nieuwe versie uploaden (eindgebruiker)

1. Open Scriptor → tab **Templates**.
2. Klik op **Nieuwe versie uploaden** bij de bank.
3. Kies de nieuwe `.docx`. Deze wordt direct actief; alle nieuwe aktes gebruiken hem.

## Deploy-stappen na workflow- of registry-wijzigingen

- **`registry.json` wijzigen** (placeholders, keywords, prompts toevoegen/aanpassen): geen rebuild nodig, n8n leest het bestand bij elke uitvoering.
- **`vul_template_in.py` wijzigen**: n8n image herbouwen — `docker compose build n8n && docker compose up -d n8n`.
- **n8n-workflow JSON wijzigen** (`hypotheekakte-workflow.json` of `templates-management-workflow.json`): de workflows worden alleen geïmporteerd bij **eerste opstart** (er staat een `.imported`-marker). Voor het opnieuw importeren:
  ```bash
  docker compose down
  rm n8n/demo-data/.imported
  docker compose --profile cpu up -d --build
  ```
  Dit verwijdert ALLE workflows uit de n8n DB en herimporteert vanuit de JSON-files. **Verlies van handmatige wijzigingen in n8n UI.** Alternatief: importeer handmatig via de n8n UI ("Import from File").

- **Webapp-wijzigingen**: `docker compose up -d --build webapp`.

## Endpoints (n8n webhooks)

| Methode | Pad | Doel |
|---|---|---|
| `POST` | `/webhook/hypotheekakte` | Akte genereren (passeeropdracht + kadaster) |
| `GET`  | `/webhook/templates` | Lijst van geconfigureerde banken + actieve template |
| `POST` | `/webhook/upload-template` | Nieuwe `.docx` uploaden voor een bank (`bank_id` + `file` in form-data) |
