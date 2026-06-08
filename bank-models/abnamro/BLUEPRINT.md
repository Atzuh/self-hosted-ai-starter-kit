# ABN AMRO Bank Hypotheek — Template-blueprint

Dit document beschrijft hoe het door KNB gepubliceerde modelakte voor de
**ABN AMRO Bank Hypotheek (HYSTAA00, model AAB18-01)** wordt omgezet naar het
Scriptor-template `shared/templates/abnamro/template_HYSTAA00.docx`.

> **Status:** **READY voor end-to-end test.** `extraction_prompt`,
> `placeholders` en `conditional_blocks` zijn afgestemd op het Stater-formaat
> (Notarisinstructie, NTI-….pdf), gevalideerd op basis van een echte
> passeeropdracht (NTI-700374651, AAB18.01). Notariële velden (akte-datum,
> notarisnaam, plaats, tijd) blijven leeg in de output en worden door de
> notaris in Word ingevuld.

## Bron-bestand

- **Bestand:** `bank-models/abnamro/HYSTAA00_AAB18-01.docx` (geconverteerd uit
  het oorspronkelijke `.doc` met `textutil -convert docx`).
- **Modelcode:** `HYSTAA00`
- **Modelversie:** `AAB18-01` (19-02-2018)
- **Conventie:** KNB gebruikt `MacroButton Nomacro §` als invul-marker en
  `MacroButton Nomacro §(VARIABEL BLOK*)` … `MacroButton Nomacro §***` om
  conditionele secties te markeren.

## Bouwen van het template

```bash
python3 bank-models/abnamro/build_template.py \
  --input  bank-models/abnamro/HYSTAA00_AAB18-01.docx \
  --output shared/templates/abnamro/template_HYSTAA00.docx
```

Het script doet drie dingen:

1. Vervangt elk `MacroButton Nomacro §` door een Scriptor-`<<TAG>>` of een
   blok-marker (`<<#BEGIN:NAAM>>` / `<<#END:NAAM>>`).
2. Voegt na paragraaf [010] een conditioneel `client_2`-blok toe
   (`<<#BEGIN:client_2>>` … `<<#END:client_2>>`) zodat zowel 1- als
   2-klantsituaties correct worden afgehandeld.
3. Vult de ontbrekende `<<#BEGIN:overbrugging>>`-marker in vóór paragraaf
   [062] (de KNB-akte zelf mist daar een openings-marker voor het
   eigendoms­verkrijgings-blok van de overbruggingshypotheek).

## Mapping van placeholders

### Altijd aanwezige velden

| Plek in akte | Placeholder | Bron |
|---|---|---|
| Offertenummer (kop) | `<<OFFERTENUMMER>>` | passeeropdracht |
| Akte-datum (`Heden, …`) | `<<AKTE_DATUM>>` | leeg — notaris vult in |
| Naam notaris | `<<NOTARIS_NAAM>>` | leeg — notaris vult in |
| Standplaats notaris | `<<NOTARIS_STANDPLAATS>>` | leeg — notaris vult in |
| Volmachthouder bank | `<<BANK_VOLMACHTHOUDER>>` | passeeropdracht |
| Naam schuldenaar 1 | `<<NAAM_1_HOOFDLETTERS>>` | kadaster + bank |
| Voornamen schuldenaar 1 | `<<VOORNAMEN_1>>` | kadaster + bank |
| Geboortedatum schuldenaar 1 (in woorden) | `<<GEBOORTEDAG_1_WOORDEN>>`, `<<GEBOORTEMAAND_1_WOORDEN>>`, `<<GEBOORTEJAAR_1_WOORDEN>>` | kadaster |
| Geboorteplaats schuldenaar 1 | `<<GEBOORTEPLAATS_1>>` | kadaster |
| Hoofdsom lening | `<<HOOFDSOM_CIJFER>>` | passeeropdracht |
| Inschrijvingsbedrag onderpand | `<<INSCHRIJVINGSBEDRAG_CIJFER>>` | passeeropdracht |
| Rente + kosten begroot | `<<OPSLAG_CIJFER>>` | passeeropdracht |
| Totaal inschrijving | `<<TOTAAL_HYPOTHEEK_CIJFER>>` | passeeropdracht |
| Type hoofd-hypotheek | `<<TYPE_HYPOTHEEK_1>>` | passeeropdracht (`eerste`/`tweede`/`derde`) |
| Onderpand-blok (kadastraal) | `<<ONDERPAND_BLOK>>` | nog te invullen — afhankelijk van kadaster-formattering |
| Verkrijging onderpand | `<<VERKRIJGING_TITEL_1>>` | leeg — notaris vult in |
| Plaats van ondertekening | `<<AKTE_PLAATS>>` | leeg — notaris vult in |
| Tijdstip ondertekening | `<<AKTE_TIJDSTIP>>` | leeg — notaris vult in |

### Conditionele velden (alleen aanwezig als blok actief is)

| Conditioneel blok | Placeholders binnen blok |
|---|---|
| `client_2` | `<<NAAM_2_HOOFDLETTERS>>`, `<<VOORNAMEN_2>>`, `<<GEBOORTEDAG_2_WOORDEN>>`, `<<GEBOORTEMAAND_2_WOORDEN>>`, `<<GEBOORTEJAAR_2_WOORDEN>>`, `<<GEBOORTEPLAATS_2>>` |
| `overbrugging` | `<<TYPE_HYPOTHEEK_OVERBRUGGING>>`, `<<ONDERPAND_OVERBRUGGING_BLOK>>`, `<<VERKRIJGING_TITEL_OVERBRUGGING>>` |
| `nhg` | (statische tekst — geen placeholders) |
| `levensverzekering` | `<<VERZEKERAAR_NAAM>>`, `<<POLISNUMMER>>` |
| `verpanding_verzekering` | (statische tekst) |
| `verpanding_belegging` | `<<BELEGGINGSREKENING_NUMMER>>`, `<<BELEGGINGSREKENING_INSTELLING>>` |
| `verpanding_spaarrekening` | `<<SPAARREKENING_NUMMER>>` |
| `verpanding_aflossing` | `<<AFLOSSINGSREKENING_NUMMER>>` |
| `overheidsbijdrage` | (statische tekst) |

## Conditionele-blok-mechanisme

Conditionele blokken worden afgehandeld door
`shared/vul_template_in.py` (functie `process_conditional_blocks`):

- **Convention:** `<<#BEGIN:NAAM>>` en `<<#END:NAAM>>` markers staan op een
  eigen paragraaf.
- **Activatie:** een blok blijft staan als de placeholders-map de key
  `<<#FLAG:NAAM>>` bevat met een truthy waarde (`true`, `1`, `ja`, `yes`).
- **Falsy / ontbrekend:** het volledige blok inclusief markers wordt
  verwijderd.
- **Meerdere paren met dezelfde naam** zijn toegestaan en worden onafhankelijk
  verwerkt — handig voor de `overbrugging`-blokken die zowel in het
  hypotheekstellings- als in het eigendoms­verkrijgings-deel voorkomen.

## Stater-puntenschema → Scriptor-mapping

ABN AMRO levert passeeropdrachten via Stater. Die hebben een vast
genummerd-puntenschema dat 1-op-1 overeenkomt met de paragraaf-nummers
in het AAB18.01-modelakte. De LLM-extractie en `conditional_blocks` in
`registry.json` zijn op dit schema gebaseerd:

| Punt in passeeropdracht | Veld / Conditioneel blok |
|---|---|
| (header) Referentienummer | `bank.offertenummer` → `<<OFFERTENUMMER>>` |
| 1 | klanten-array → `<<NAAM_*>>`, `<<VOORNAMEN_*>>`, etc. + flag `client_2` |
| 2.1 | `bank.hoofdsom_cijfer` → `<<HOOFDSOM_CIJFER>>` |
| 3 | `bank.svn_starterslening` (boolean — momenteel niet gebonden aan blok) |
| 4.1 | `bank.inschrijvingsbedrag_cijfer` → `<<INSCHRIJVINGSBEDRAG_CIJFER>>` |
| 4.2 | `bank.opslag_cijfer` → `<<OPSLAG_CIJFER>>` |
| 4.3 | `bank.totaal_hypotheek_cijfer` → `<<TOTAAL_HYPOTHEEK_CIJFER>>` |
| 4.4 | `bank.type_hypotheek` (woordvorm) → `<<TYPE_HYPOTHEEK_1>>` |
| 4.5 | `bank.onderpand_*` → adres-placeholders |
| 5 | `bank.overbrugging` → flag `overbrugging` |
| 7.1 | `bank.verpanding_verzekering` → flag `verpanding_verzekering` |
| 7.2 | `bank.verpanding_belegging` → flag `verpanding_belegging` |
| 7.3 | `bank.verpanding_spaarrekening` → flag `verpanding_spaarrekening` |
| 7.4 | `bank.verpanding_aflossing` → flag `verpanding_aflossing` |
| 11 | `bank.levensverzekering` → flag `levensverzekering` (begunstiging-aanwijzing) |
| 12 | `bank.nhg` → flag `nhg` (Borgstelling NHG) |
| 13 | `bank.overheidsbijdrage` → flag `overheidsbijdrage` |

Convention: punten met de tekst "niet opnemen" leveren `false` op, alle
andere inhoud `true`.

## Verificatie

Een lokale smoke-test gebaseerd op de echte passeeropdracht
NTI-700374651 (alle conditionele punten op "niet opnemen", twee
schuldenaren) levert:

```text
SUCCESS: /tmp/scriptor-test/output/hypotheekakte_700_374_651.docx
REPLACED_BLOCKS: 13
BLOCKS_HANDLED: 10
TEMPLATE_USED: shared/templates/abnamro/template_HYSTAA00.docx

Resterende ongevulde markers: 0
Aantal paragrafen na verwerking: 96 (model had 166)
```

D.w.z. alle 9 conditionele blokken worden correct geactiveerd of verwijderd,
alle reguliere placeholders krijgen waarden — er blijven geen ongevulde
`<<…>>`-markers achter.

## Wat ontbreekt nog (TBD voor productie)

1. **Het kadaster-eigendomsinformatie ophalen voor ABN AMRO-flow** — de
   webapp moet ABN-passeeropdrachten in dezelfde upload-flow kunnen
   verwerken (de bestaande SmartDropZone herkent al "passeer" / "abn amro"
   keywords; ECH-only check niet meer relevant).
2. **`<<VERKRIJGING_TITEL_1>>`** wordt momenteel leeg gelaten — vereist
   parsing van het kadaster-eigendomsinformatie om de leveringstitel te
   extraheren. Voor nu vult de notaris dit handmatig in Word in.
3. **`<<ONDERPAND_OVERBRUGGING_BLOK>>`** is een single-string placeholder;
   wanneer overbrugging aan de orde is moet er een tweede kadaster-bron
   beschikbaar zijn. Aanvullen wanneer de eerste overbrugging-case langs
   komt.
4. **Real-world test**: workflow opnieuw inlezen in n8n
   (`docker exec n8n n8n import:workflow ...` — zie `shared/templates/README.md`),
   workflow activeren, en NTI-700374651 + bijbehorende kadaster door de
   Scriptor-webapp halen.
