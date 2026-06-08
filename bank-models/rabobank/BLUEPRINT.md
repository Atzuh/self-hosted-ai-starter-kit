# Rabobank Hypotheek — Template-blueprint

Dit document beschrijft hoe het door KNB gepubliceerde modelakte voor de
**Rabobank Hypotheek (HYRABO00, model H1-2018)** wordt omgezet naar het
Scriptor-template `shared/templates/rabobank/template_HYRABO00.docx`.

> **Status:** **READY voor end-to-end test.** `extraction_prompt`,
> `placeholders` en `conditional_blocks` zijn afgestemd op het ECH-formaat
> (Rabobank passeeropdracht). Notariële velden (akte-datum, notarisnaam,
> plaats, tijd, verkrijgingstitel) blijven leeg in de output en worden door
> de notaris in Word ingevuld.

## Bron-bestand

- **Bestand:** `bank-models/rabobank/HYRABO00_H1_2018.docx` (geconverteerd
  uit het oorspronkelijke `.doc` met `textutil -convert docx`).
- **Modelcode:** `HYRABO00`
- **Modelversie:** `H1-2018` (01-09-2018)
- **Conventie:** KNB gebruikt `MacroButton Nomacro §` als invul-marker,
  `MacroButton Nomacro §(VARIABEL BLOK*)` … `§***` voor onafhankelijke
  variabele blokken, en `MacroButton Nomacro §(KEUZEBLOK*)` … `§**` voor
  blokken waar één van meerdere alternatieven moet worden opgenomen.

## Bouwen van het template

```bash
python3 bank-models/rabobank/build_template.py \
  --input  bank-models/rabobank/HYRABO00_H1_2018.docx \
  --output shared/templates/rabobank/template_HYRABO00.docx
```

Het script:

1. Vervangt elk `MacroButton Nomacro §<…>` door een Scriptor-`<<TAG>>` of
   een blok-marker (`<<#BEGIN:NAAM>>` / `<<#END:NAAM>>`).
2. Verwijdert de KNB-instructie-comments tussen `<…>`-haken.
3. Snoeit de niet-residentiële variant-blokken weg (schepen, agrarisch,
   fabriek, rangwisseling, economische eigendom, landinrichting,
   "vaste hypotheek"-alternatief, KEUZE B/C echtgenoot-toestemming).
4. Voegt rond paragraaf [007] en [009] van de bron twee `client_2`-blokken
   toe zodat zowel 1- als 2-hypotheekgever-situaties correct worden
   afgehandeld.

## Default-keuzes (typisch consumenten-hypotheek)

Het Rabobank H1-2018-model bevat een groot aantal alternatieven en
variabele blokken; voor een gewone woninghypotheek op een registergoed
(geen schip, geen bedrijfspand, geen agrarisch perceel) selecteert het
script de volgende keuzes:

| Sectie | Default in template | Wat is genegeerd |
|---|---|---|
| Hypotheekverlening (zekerheid voor) | **bankhypotheek** — "alle schulden van de debiteur aan de bank" (KNB para 023–031) | KEUZEBLOK "vaste hypotheek" voor registergoed (032–041); KEUZEBLOK "vaste hypotheek" voor binnenschip (042–049); KEUZEBLOK voor binnenschip (050–064 wrapper). |
| Hypotheekbedrag | **KEUZEBLOK A** — registergoed dat geen schip is, opslag 35 % (KNB para 070–074) | KEUZEBLOK B (binnenschip, opslag 50 %, 075–080). |
| Voorbelasting onderpand | **KEUZE 1** — geen voorbelasting (KNB para 128) | KEUZE 2 (wel voorbelasting). |
| Pandrechten — bevoegdheidsverklaring | **KEUZE 1** — "geen beperkte rechten rusten" (KNB para 155) | KEUZE 2 (wel beperkte rechten). |
| Huurbeding | Tekst zonder schip-additions ("of vervrachten" / "of vrachtpenningen") | Schip-clauses in para 161–162. |
| Toestemming echtgenoot | **Volledig weggesnoeid** | KEUZE A (bankhypotheek), B (vaste hypotheek), C (uitzondering art. 88 lid 5) — niche-geval, kan later toegevoegd. |
| Variabele blokken | **Verwijderd**: schip-onderdelen, agrarisch, fabriek/werkplaats, rangwisseling, economische eigendom, landinrichting | — |

Wanneer een akte één van deze alternatieven nodig heeft, moet de notaris
de tekst handmatig aanvullen of moet het build-script worden uitgebreid
met aanvullende conditionele blokken.

## Mapping van placeholders

### Altijd aanwezige velden

| Plek in akte | Placeholder | Bron |
|---|---|---|
| Akte-datum (`Vandaag, …`) | `<<AKTE_DATUM>>` | leeg — notaris vult in |
| Naam notaris | `<<NOTARIS_NAAM>>` | leeg — notaris vult in |
| Standplaats notaris | `<<NOTARIS_STANDPLAATS>>` | leeg — notaris vult in |
| Volmachthouder bank | `<<BANK_VOLMACHTHOUDER>>` | passeeropdracht (n.t.b.) |
| Naam hypotheekgever 1 | `<<NAAM_1_HOOFDLETTERS>>` | kadaster + bank |
| Voornamen hypotheekgever 1 | `<<VOORNAMEN_1>>` | kadaster + bank |
| Geboortedatum hypotheekgever 1 (in woorden) | `<<GEBOORTEDAG_1_WOORDEN>>`, `<<GEBOORTEMAAND_1_WOORDEN>>`, `<<GEBOORTEJAAR_1_WOORDEN>>` | kadaster |
| Geboorteplaats hypotheekgever 1 | `<<GEBOORTEPLAATS_1>>` | kadaster |
| Hypotheekbedrag (a) | `<<INSCHRIJVINGSBEDRAG_WOORDEN>>`, `<<INSCHRIJVINGSBEDRAG_CIJFER>>` | passeeropdracht |
| Renten/kosten begroot (b) | `<<OPSLAG_WOORDEN>>`, `<<OPSLAG_CIJFER>>` | passeeropdracht |
| Totaalbedrag inschrijving | `<<TOTAAL_HYPOTHEEK_WOORDEN>>`, `<<TOTAAL_HYPOTHEEK_CIJFER>>` | passeeropdracht |
| Onderpand-blok (kadastraal) | `<<ONDERPAND_STRAAT>>`, `<<ONDERPAND_HUISNUMMER>>`, `<<ONDERPAND_POSTCODE>>`, `<<ONDERPAND_WOONPLAATS>>`, `<<KAD_GEMEENTE>>`, `<<KAD_SECTIE>>`, `<<KAD_NUMMER>>`, `<<KAD_GROOTTE_WOORDEN>>` | passeeropdracht + kadaster |
| Verkrijging onderpand | `<<VERKRIJGING_TITEL_1>>` | leeg — notaris vult in |
| Plaats van ondertekening | `<<AKTE_PLAATS>>` | leeg — notaris vult in |
| Tijdstip ondertekening | `<<AKTE_TIJDSTIP>>` | leeg — notaris vult in |

### Conditionele velden (alleen aanwezig als blok actief is)

| Conditioneel blok | Placeholders binnen blok |
|---|---|
| `client_2` | `<<NAAM_2_HOOFDLETTERS>>`, `<<VOORNAMEN_2>>`, `<<GEBOORTEDAG_2_WOORDEN>>`, `<<GEBOORTEMAAND_2_WOORDEN>>`, `<<GEBOORTEJAAR_2_WOORDEN>>`, `<<GEBOORTEPLAATS_2>>`, en de tekst "zowel samen als ieder afzonderlijk," |

## Conditionele-blok-mechanisme

Conditionele blokken worden afgehandeld door
`shared/vul_template_in.py` (functie `process_conditional_blocks`):

- **Convention:** `<<#BEGIN:NAAM>>` en `<<#END:NAAM>>` markers staan op
  een eigen paragraaf.
- **Activatie:** een blok blijft staan als de placeholders-map de key
  `<<#FLAG:NAAM>>` bevat met een truthy waarde (`true`, `1`, `ja`, `yes`).
- **Falsy / ontbrekend:** het volledige blok inclusief markers wordt
  verwijderd.
- **Meerdere paren met dezelfde naam** zijn toegestaan en worden
  onafhankelijk verwerkt — handig voor het `client_2`-blok dat zowel het
  hypotheekgever-2 lichaam als de "zowel samen als ieder afzonderlijk"-zinsnede
  bevat.

## ECH-puntenschema → Scriptor-mapping

Rabobank levert passeeropdrachten via ECH (Elektronisch Communicatie
Hypotheek). De LLM-extractie en `placeholders` in `registry.json`
verwachten de volgende top-level-velden:

| Veld in passeeropdracht | Placeholder |
|---|---|
| `ech_zaaknummer` | (geen template-placeholder; gebruikt als bestandsnaam-zaaknummer) |
| `inschrijvingsbedrag_cijfer` / `_woorden` | `<<INSCHRIJVINGSBEDRAG_CIJFER>>`, `<<INSCHRIJVINGSBEDRAG_WOORDEN>>` |
| `opslag_cijfer` / `_woorden` | `<<OPSLAG_CIJFER>>`, `<<OPSLAG_WOORDEN>>` |
| `totaal_hypotheek_cijfer` / `_woorden` | `<<TOTAAL_HYPOTHEEK_CIJFER>>`, `<<TOTAAL_HYPOTHEEK_WOORDEN>>` |
| `onderpand_*` | `<<ONDERPAND_STRAAT>>`, `<<ONDERPAND_HUISNUMMER>>`, `<<ONDERPAND_POSTCODE>>`, `<<ONDERPAND_WOONPLAATS>>` |
| `klanten[].naam_hoofdletters` | `<<NAAM_1_HOOFDLETTERS>>`, `<<NAAM_2_HOOFDLETTERS>>` |
| `klanten[].voornamen` | `<<VOORNAMEN_1>>`, `<<VOORNAMEN_2>>` |
| `klanten[1].naam_hoofdletters` | activeert ook `client_2`-blok |
| (kadaster.klanten[].geboorte*, geboorteplaats) | `<<GEBOORTE*_*>>`, `<<GEBOORTEPLAATS_*>>` |
| (kadaster.kadastrale_*) | `<<KAD_GEMEENTE>>`, `<<KAD_SECTIE>>`, `<<KAD_NUMMER>>`, `<<KAD_GROOTTE_WOORDEN>>` |

## Verificatie

Een lokale smoke-test met testdata (twee hypotheekgevers, één onderpand)
laat zien dat:

```text
BLOCKS_HANDLED: 2
Resterende ongevulde markers: 7  (alleen notariële velden — bedoeld leeg)
Final paragraphs: 121 (model had 290)
```

De 7 resterende markers zijn precies die die de notaris zelf in Word
invult: `AKTE_DATUM`, `NOTARIS_NAAM`, `NOTARIS_STANDPLAATS`,
`BANK_VOLMACHTHOUDER`, `VERKRIJGING_TITEL_1`, `AKTE_PLAATS` en
`AKTE_TIJDSTIP`. In het 1-hypotheekgever-geval blijven precies dezelfde
7 markers over en wordt het tweede comparant-blok (inclusief de "zowel
samen als ieder afzonderlijk"-tekst) automatisch verwijderd.

## Wat ontbreekt nog (TBD voor productie)

1. **`<<VERKRIJGING_TITEL_1>>`** wordt momenteel leeg gelaten — vereist
   parsing van de kadaster-eigendomsinformatie om de leveringstitel te
   extraheren. Voor nu vult de notaris dit handmatig in Word in.
2. **Conditionele variant-blokken** (vaste hypotheek, schip, agrarisch,
   fabriek, rangwisseling, economische eigendom, landinrichting,
   echtgenoot-toestemming) zijn nu hard verwijderd. Wanneer er een
   real-world casus is die er één nodig heeft, moet `build_template.py`
   uitgebreid worden met een conditionele-blok-marker rondom het
   betreffende stuk.
3. **`<<BANK_VOLMACHTHOUDER>>`** wordt nu niet door de LLM-extractie
   gevuld — de Rabobank-passeeropdracht bevat de naam van de
   gevolmachtigde wel, dus de extractie-prompt en mapping kunnen worden
   uitgebreid wanneer dat nodig is.
4. **Real-world test**: workflow opnieuw inlezen in n8n (zie
   `shared/templates/README.md`), workflow activeren, en een echte
   Rabobank-passeeropdracht + bijbehorende kadaster door de
   Scriptor-webapp halen.
