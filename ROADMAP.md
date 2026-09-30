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
| Besprekingen → verslag (voicenotes) | ✅ POC | Besprekingen-pagina → whisper.cpp (native) → n8n → python-docx |
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
| Bredere agents (offerte, clausule, vertaal, samenvatting, VVE) | Hypotheekakte + analyse + besprekingsverslag | Middel |
| Voicenotes → verslag | ✅ POC (zie stap 5) | — |
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

### Job-patroon (augustus 2026) — alle flows
Lang werk hoort niet in één open HTTP-request. De akte-, analyse- en
besprekingsflow antwoorden daarom meteen met een `job_id` en werken daarachter
door; de voortgang
staat in `shared/jobs/<job_id>.json` en is op te vragen via de aparte workflow
[job-status-workflow.json](n8n/demo-data/workflows/job-status-workflow.json)
(`GET /webhook/job-status?job=…`). De webapp gebruikt daarvoor één gedeelde
helper, [webapp/src/lib/job-status.ts](webapp/src/lib/job-status.ts), die aan het
antwoord van de start-webhook ziet of er gepollt moet worden.

Winst naast de robuustheid: alle geschatte fase-timers zijn uit de webapp
verdwenen — de voortgangsbalk toont nu overal de echte workflowstap — en een
afgebroken workflow eindigt zichtbaar in `status: fout` in plaats van in een
eindeloos wachtende webapp.

Gemeten via de browser: akte 32 s (15 polls), analyse 75 s (36 polls),
bespreking 27 s. De start-webhook antwoordt in alle gevallen binnen ~0,1 s.

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

### ✅ Stap 5 (buiten de top-4) — Besprekingen → verslag, POC (augustus 2026)
Spraakopname naar besprekingsverslag, volledig lokaal. Whisper draait — net als
Ollama — **native op de host**, omdat Docker op macOS geen Metal doorgeeft.

Keten: Besprekingen-pagina → 16 kHz mono WAV (client-side, Web Audio API) →
`/webhook/bespreking` → whisper.cpp (`large-v3-turbo-q5`, ± 8× realtime) →
`qwen2.5:7b` → `genereer_besprekingsverslag.py` → `.docx` in `shared/output/`.

Nieuwe bestanden:
- [shared/whisper/start-whisper-server.sh](shared/whisper/start-whisper-server.sh) — start whisper.cpp op poort 8910
- [shared/genereer_besprekingsverslag.py](shared/genereer_besprekingsverslag.py) — verslag-DOCX incl. transcript-bijlage
- [n8n/demo-data/workflows/bespreking-workflow.json](n8n/demo-data/workflows/bespreking-workflow.json)
- [webapp/src/components/Besprekingen.tsx](webapp/src/components/Besprekingen.tsx) + [webapp/src/lib/audio-wav.ts](webapp/src/lib/audio-wav.ts)

**Map-reduce voor lange besprekingen — ✅ gedaan.** Past het transcript in één
prompt (< 9.000 tekens, ± een kwartier spreektijd), dan gaat het rechtstreeks
naar de verslag-prompt. Is het langer, dan vat de workflow elk blok apart samen
en bouwt daarna het verslag uit die deelsamenvattingen. Een blok dat de LLM niet
aankan wordt overgeslagen en gemeld in `waarschuwingen` in plaats van de hele run
te laten sneuvelen. Gemeten op een bespreking van 13,6 minuten (2 blokken):
3 min 34 s totaal.

**Job-patroon — ✅ gedaan.** `/webhook/bespreking` schrijft een jobbestand in
`shared/jobs/`, antwoordt binnen ~0,1 s met een `job_id` en werkt daarachter
door; de webapp pollt `/webhook/bespreking-status?job=…` elke twee seconden. De
voortgangsbalk toont daarmee de echte workflowstap in plaats van een
tijdsschatting, en er blijft geen HTTP-verbinding minutenlang open. Valt whisper
uit, dan komt de job binnen enkele seconden op `status: fout` met een bruikbare
melding; blijft de status hangen, dan geeft de webapp na vijf minuten stilte op.
Dit patroon is één op één herbruikbaar voor de analyse-flow.

**Gebruiksvorm — bepalend voor wat níét gebouwd wordt.** De **bespreking zelf
wordt opgenomen**, met meerdere sprekers. De opname wordt nergens bewaard: die
bestaat alleen in de browser zolang de pagina openstaat, en gaat na het
converteren naar de workflow zonder onderweg op schijf te belanden. Daarom is er
geen retentiebeleid voor opnames nodig.

**Nog open:**
- [ ] **Sprekerherkenning (diarisatie).** *Uitgesteld, niet vervallen.* Er zijn
      meerdere sprekers, maar het verslag hoeft voorlopig niet vast te leggen wie
      wat zegt. Zodra dat wel moet: pyannote/WhisperX, met een eenmalige
      HF-token voor de modeldownload (daarna volledig lokaal). Tot die tijd staat
      er één doorlopend transcript en leidt het model namen af uit wat er gezegd
      wordt — het veld **Deelnemers** helpt daarbij.

**Vervallen (augustus 2026, in overleg):**
- ~~Tweede reduce-ronde~~ — die is pas nodig boven ruwweg twee uur spreektijd, en
  zo lang duren de aantekeningen niet. De map-reduce-stap dekt alles daaronder.
- ~~Retentiebeleid voor opnames~~ — er worden geen opnames bewaard. Wat er wél
  ligt is afgedekt: jobbestanden mét transcript worden na 24 uur opgeruimd. Zodra
  de dossierlaag uit stap 2 verslagen gaat bewaren, komt dit alsnog terug.

### Vaste indeling per soort bespreking (augustus 2026)
Verslagen van testament- en levenstestamentbesprekingen komen nu in een vaste
volgorde uit, afgeleid van de bespreekformulieren van kantoor. De sjablonen staan
als JSON in [shared/templates/besprekingen/](shared/templates/besprekingen/):
volgorde en kopjes zijn daar aan te passen zonder de workflow aan te raken.

De volgorde wordt **deterministisch afgedwongen** in `Orden Secties`, niet aan het
model overgelaten: dat laat kopjes weg, hernoemt ze of wisselt de volgorde. Het
model krijgt de kopjes wel in de prompt, maar alleen om de inhoud op de juiste
plek te krijgen.

Twee dingen die de eerste versie stukmaakten en nu deterministisch worden
afgevangen:
- Het model schreef de **aanwijzing achter een kopje over als inhoud**, waardoor
  "Tweetrapsmaking" gevuld leek terwijl het onderwerp nooit ter sprake kwam.
- Gevraagd een leeg kopje leeg te laten, schreef het er "geen bespreking" in.

Kopjes zonder inhoud krijgen "Niet vastgelegd" — bewust niet "niet besproken",
want de extractie mist er soms een en dan zou het document een onwaarheid
beweren. In de levenstestament-test stonden drie kopjes als niet vastgelegd
terwijl ze wél aan bod kwamen (ondervolmacht, uitgesloten handelingen, bancaire
volmacht).


**Sjabloon óók in de map-stap (augustus 2026).** Bij een echte bespreking van 46
minuten bleven 14 van de 17 kopjes leeg en belandde "60% naar Kline Clowns" onder
*Overige* in plaats van *Legaten*. Oorzaak: het transcript ging in 3 blokken door
de map-reduce, en die blokken werden samengevat **zonder dat het sjabloon bekend
was**. De details die je nodig hebt om zoiets als een legaat te herkennen, waren
dus al weg voordat het sjabloon werd toegepast. Nu vat elk blok meteen samen
ónder de vaste kopjes, en voegt `Collect Blok Samenvattingen` de punten per kopje
deterministisch samen over de blokken.

Resultaat op datzelfde transcript: **van 3 naar 11 van de 17 kopjes gevuld**, met
Legaten, Executele, Bewind, Plaatsvervulling en Opeisingsgronden inhoudelijk
gevuld.

**Blokken draaien nu één voor één.** De eerste versie stuurde de 3 blokken
tegelijk naar Ollama; met de grotere sjabloon-prompts (~12.600 tekens) liet dat
deze 16 GB-machine zo hard wisselen dat twee blokken er élk ruim een uur over
deden — 72 minuten in totaal. Met een lus (`Loop Blokken`, batchgrootte 1) en een
hartslag ertussen: **162 seconden**, met zichtbare voortgang ("2/3").

Onderweg gemeten en weer teruggedraaid: de kopjes-aanwijzingen inkorten om de
prompt kleiner te maken. Dat scheelde nauwelijks tijd (201 s) maar kostte
kwaliteit — 8 in plaats van 11 gevulde kopjes, en de legaten vielen terug naar
*Overige*. De volledige aanwijzingen staan er dus weer in.


**Ordening verbeterd met trefwoorden (augustus 2026).** Gemeten tegen een
handmatig opgestelde gouden lijst voor één echte bespreking van 46 minuten
(12 van de 18 kopjes hóórden gevuld te zijn):

| | juist gevuld | vals gevuld |
|---|---|---|
| vóór | ~7 van 12 | 1 (legaten onder *Uitsluitingsclausule*) |
| ná | **8 van 12** (3 runs: 8, 8, 8) | **0** |

De eerste meting hierop gaf 10 van 12, maar dat was één run. Over drie runs komt
het stabiel op 8 uit — de winst zit vooral in het verdwijnen van de valse vulling.
Eén run is hier geen meting; het model is stochastisch.

Wat het doet: elk sjabloonkopje heeft nu een lijst `trefwoorden`. Vóór de
LLM-aanroep scant de workflow het blok deterministisch op die woorden en zet in
de prompt welke kopjes waarschijnlijk aan de orde zijn — én dat kopjes die er
niet tussen staan hier vermoedelijk niet spelen. Geen extra rekentijd.

Het duidelijkst zichtbaar bij de legaten: "60% Kline Clowns, 20% Make-A-Wish"
stond eerst onder *Uitsluitingsclausule* (een kopje dat leeg hoorde te blijven),
en staat nu onder *Legaten*. Ook *Soort testament* wordt nu gevonden. Nog gemist:
*Tweede erfstelling* en *Tweetrapsmaking* — die laatste wordt in het gesprek
inhoudelijk beschreven zonder dat de term valt.

**Nacontrole per gemarkeerd kopje (augustus 2026).** Blijft een kopje leeg
terwijl zijn trefwoord wél in het transcript valt, dan krijgt het model één
gerichte vraag: "wat is er gezegd over X?", met alleen de fragmenten rond dat
trefwoord erbij (±700 tekens, hooguit drie stukken). Dat is de smalle taak die
hier telkens wél werkt, in tegenstelling tot instructies in een grote prompt.

Gemeten tegen de gouden lijst, telkens drie runs:

| stap | juist gevuld | vals gevuld |
|---|---|---|
| uitgangspunt | ~7 van 12 | 1 |
| + trefwoordhints | 8 van 12 | 0 |
| + nacontrole | **12 van 12** | **0** |

Verwerkingstijd blijft ~160 s voor een transcript van 22.000 tekens; de
nacontrole-vragen zijn klein doordat alleen fragmenten meegaan.

**Een regressie die dit opleverde.** De instructie om afgewezen keuzes vast te
leggen werd te breed toegepast: het verslag meldde "Afwikkelingsbewind besproken;
niet opgenomen" terwijl het transcript zegt dat het er juist bíj komt. Een
onderwerp ten onrechte als afgewezen noteren is erger dan het weglaten. De regel
zegt nu expliciet: schrijf wat er is besloten, en gebruik "niet gekozen" alleen
als er duidelijk van is afgezien.

**Afgewezen keuzes vastleggen.** Een onderwerp dat is besproken en waar juist
niet voor is gekozen, hoort in het verslag te staan. De prompt vraagt daar nu
expliciet om — maar dat werkt niet: op een script waarin de cliënt "nee, laat
maar zitten" zegt over de vaccinatieclausule, bleef dat kopje leeg. Zelfde
patroon als eerder: instructies over volledigheid raken dit model nauwelijks.

Wat wél werkt is deterministisch. Blijft een kopje leeg terwijl een van zijn
trefwoorden in het transcript valt, dan meldt het verslag dat: *"Kwam ter sprake
('vaccinatie'), geen uitkomst vastgelegd — controleer het transcript."* Voor een
bespreekformulier is dat bruikbaarder dan een kopje dat suggereert dat het
onderwerp nooit langskwam. Op het levenstestamentscript licht dat precies de
vier onderwerpen op waar de cliënt van afzag.

**Namen mee in de Whisper-prompt.** De deelnemers en het onderwerp uit de webapp
gaan nu als initial prompt naar whisper.cpp. Dat de sturing werkt is aantoonbaar:
met "Tessa Fink" in de prompt schrijft Whisper ook Fink. Daarom alléén namen die
de behandelaar zelf invult — een fout hier plant zich door het hele transcript
voort. Effect op de bestaande meting is niet vast te stellen: die draait op een
vast transcript, en dit verandert juist de transcriptie.

### Voortgang bij lange besprekingen (augustus 2026)
Een echte bespreking van 46 minuten liep goed door — verslag klaar in 8,7 minuut —
maar de webapp meldde toch een fout. Oorzaak: tussen de statusupdate na de
transcriptie (206 s) en het einde (524 s) werd het jobbestand **318 seconden niet
aangeraakt**, terwijl de webapp na 300 seconden stilte opgaf. Hij haakte 18
seconden vóór de finish af.

Opgelost met drie ingrepen:
- **Statusupdate na de map-ronde**, zodat ook die stap een teken van leven geeft.
  (Er zat destijds ook een hartslag per blok in de toezeggingen-lus; die tak is
  later geschrapt, zie hieronder.)
- **Stilte-drempel schaalt mee met de opnameduur** (ruim gerekend op 6× realtime),
  want Whisper werkt de status pas bij als het hele transcript klaar is. Bij twee
  uur audio zou een vaste drempel opnieuw te krap zijn.

Onderweg kwam een tweede fout boven water: het statusendpoint gaf **ongeldige
JSON** terug zodra het transcript regeleinden bevatte — die kwamen ongeëscaped in
het antwoord. Bij een Whisper-transcript (één lange regel) viel dat nooit op, bij
een aangeleverd `.txt` wel. `Read Job` serialiseert nu zelf en de Respond-node
geeft die tekst onaangeroerd door.

### Actiepunten en juridische aandachtspunten geschrapt (augustus 2026)
Beide secties zijn uit het verslag gehaald — schema, prompt, DOCX, webapp en het
testscript. Op een echte bespreking leverden ze geen bruikbare inhoud op:
actiepunten waren flarden discussie in plaats van toezeggingen, en de juridische
aandachtspunten bleven op het niveau van "huwelijksregime, volmacht" hangen.

Het verslag bestaat nu uit: titel, samenvatting, aanwezigen, de besproken punten
per sjabloonkopje, de gemaakte afspraken, open vragen en het transcript als
bijlage.

### Onderscheid optie/besluit — geprobeerd en geschrapt (augustus 2026)
Uit het nalezen van twee echte verslagen kwam steeds hetzelfde terug: het verslag
presenteerde een geboden mogelijkheid als een genomen besluit (een buitenstaander
als executeur, legaten aan goede doelen, een afgewezen bewind).

Twee pogingen, allebei mislukt:
- **Instructie in de prompt** om afgewezen keuzes als zodanig te noteren. Het
  model paste dat juist te breed toe: "Afwikkelingsbewind besproken; niet
  opgenomen" terwijl het er wél bij kwam.
- **Labels per punt** ("Besluit: " / "Optie: " / "Toelichting: ") met
  deterministische normalisatie erachter. Het model zette een label bij 3 van de
  46 punten, en juist niet bij Executele en Legaten — de twee kopjes waar het om
  ging.

Op verzoek is het hele onderscheid er daarna uit gehaald: geen labels, en ook
geen promptregels meer over afgewezen keuzes. Het verslag geeft weer wát er is
besproken; of iets een besluit was beoordeelt de behandelaar bij het nalezen.

Wat wél blijft werken is de deterministische markering "Kwam ter sprake (…), geen
uitkomst vastgelegd" bij een leeg kopje waarvan het trefwoord in het transcript
valt. Dat zegt niets over de aard van wat er is besproken, alleen dat er iets was.

### Getalcontrole (augustus 2026)
Van alle fouten die dit model maakt is een verkeerd bedrag de gevaarlijkste: een
verkeerd geplaatst kopje ziet de behandelaar meteen, een plausibel ogend bedrag
niet. `Controleer Getallen` zoekt daarom elk getal uit het verslag terug in het
transcript en zet er anders een markering achter:

> Partner ontvangt 100% van het vermogen  **[niet in transcript: 100%]**

Dat is een echte vangst uit de bespreking van 46 minuten — het transcript zegt
"de helft", nergens 100%, en het stond onder *Eerste erfstelling*.

Whisper schrijft getallen nu eens als cijfer en dan weer voluit, dus van elk
getal wordt ook de Nederlandse woordvorm gemaakt ("vierhonderdvijftigduizend")
en dáárop gezocht. Deterministisch, geen LLM-tijd.

Twee valkuilen die tijdens het bouwen boven kwamen, allebei valse zekerheid:
- Zoeken als losse substring liet "100" doorgaan omdat "honderd" toevallig in
  "zeshonderd" zit, en "18" omdat het in "2018" staat. Nu op woordgrenzen.
- Een te ruime lookahead liet "2008" ten onrechte afkeuren door de punt erachter.
  Alleen een aangrenzend cíjfer telt nu als "ander getal".

**Wat het niet vangt:** een getal dat wél in het transcript staat maar verkeerd
is begrepen. "95, 96" (het bouwjaar) werd "95% van de woning", en dat glipt er
dus doorheen.

### Toezeggingen-extractie — geprobeerd en weer verwijderd (augustus 2026)
Het verslag vond in een testamentgesprek maar 3 van de 8 toezeggingen. Een aparte
extractieronde per transcript-blok (met overlap tussen de blokken) tilde dat in
metingen naar ~7 van de 8, en die tak is ook gebouwd.

**Op een echte bespreking hield dat geen stand; de tak is er weer uit.** Bij een
werkelijk gesprek van 46 minuten leverde hij 36 "actiepunten" op waarvan de meeste
geen toezegging waren: flarden discussie ("overweging van de mogelijkheid dat een
erfgenaam eerst overlijdt"), verhaspelingen ("het levensstethement"), verkeerde
eigenaren en regelrechte onzin. Onbruikbaar om na te lopen, en het kostte enkele
minuten extra per bespreking.

**De les is methodisch en geldt breder:** de meting was gedaan op een netjes
uitgeschreven testscript — korte beurten, expliciete formuleringen, geen
haperingen. Een echt transcript meandert, herhaalt en breekt zinnen af. Wie hier
opnieuw aan begint, moet meten op een écht transcript; een geschreven script
vleit het model.

De actiepunten komen nu weer uit de verslag-ronde zelf: minder, maar bruikbaar.
