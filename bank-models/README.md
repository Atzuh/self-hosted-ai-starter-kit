# Bank-modellen — referentiemap

Deze map bevat de **originele, ongewijzigde modelakten** zoals door de KNB (Koninklijke Notariële Beroepsorganisatie) of de bank gepubliceerd worden. Ze dienen als referentie voor het ontwikkelen van de Scriptor-templates en zijn geen onderdeel van de runtime pipeline.

## Verschil met `shared/templates/`

| Map | Inhoud | Wie wijzigt | Wie leest |
|---|---|---|---|
| `bank-models/<bank-id>/` | Officieel KNB-model, ongewijzigd | Notaris / ontwikkelaar — handmatig vervangen wanneer de KNB een nieuwe versie publiceert | Ontwikkelaar (referentie bij maken van Scriptor-template) |
| `shared/templates/<bank-id>/` | Scriptor-template met `<<PLACEHOLDER>>`-tags | Eindgebruiker via Scriptor UI (upload) | n8n-pipeline bij genereren akte |

## Werkwijze: nieuwe bank toevoegen

Wanneer KNB een nieuw bank-model publiceert (of een bestaand model bijwerkt):

1. **Plaats het origineel** in `bank-models/<bank-id>/`. Naamgeving naar eigen keuze, maar handig om de versie / publicatiedatum in de bestandsnaam op te nemen, bijv. `HYABN00_2024-Q3.docx`.
2. **Analyse** — de ontwikkelaar bepaalt:
   - welke velden variabel zijn (klantnamen, kadasterdata, leningbedrag, etc.);
   - welke `<<TAG>>`-namen we daarvoor gebruiken (volg bestaande conventies waar mogelijk);
   - welke LLM-extractie-prompt nodig is om die velden uit de bank-passeeropdracht te halen.
3. **Maak Scriptor-template** — kopieer het origineel, vervang in elk variabel veld de tekst door de bijbehorende `<<TAG>>`. Sla op als `shared/templates/<bank-id>/template_<MODELCODE>.docx`.
4. **Voeg preset toe** aan `shared/templates/registry.json` met:
   - `display_name`, `keywords` (voor auto-detectie van de bank uit de passeeropdracht);
   - `extraction_prompt` (LLM-prompt waarin `{{markdown}}` wordt vervangen);
   - `placeholders` (mapping van `<<TAG>>` → padlijst in de geëxtraheerde JSON).
5. **Test end-to-end** — laad een echte passeeropdracht door Scriptor en controleer of alle velden correct ingevuld worden.

## Versie bijwerken

Wanneer KNB een bestaande modelakte vervangt door een nieuwe versie:

1. Plaats het nieuwe origineel in `bank-models/<bank-id>/` (oude versie laten staan voor historische referentie).
2. Vergelijk met de vorige versie (Word "Compare" of `git diff` op de geëxtraheerde markdown):
   - Zijn de **placeholders** ongewijzigd → alleen de eindgebruiker hoeft via Scriptor de nieuwe `.docx` te uploaden, geen code-wijziging.
   - Zijn er **nieuwe velden** of **andere veldnamen** → ontwikkelaar moet `extraction_prompt` en `placeholders` in `registry.json` aanpassen, en de nieuwe Scriptor-template `.docx` maken.

## Niet versiebeheerd

De originele `.docx`-bestanden zijn **niet in git** opgenomen — KNB-modellen zijn auteursrechtelijk beschermd. Ze worden lokaal door notarissen onderhouden vanuit de officiële KNB-distributie. Alleen de structuur (`.gitkeep`-files) en deze documentatie zijn versiebeheerd.

## Beschikbare banken

| Bank | Map | Status registry | Status template |
|---|---|---|---|
| Rabobank | `rabobank/` | ✅ in `registry.json` | ✅ `template_HYRABO00.docx` actief |
| ABN AMRO | `abnamro/` | ⏳ nog toevoegen | ⏳ nog maken |
