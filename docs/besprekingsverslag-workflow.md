# Besprekingsverslag — workflow en prompts

Wat er gebeurt tussen "opname klaar" en "verslag in de map", en welke tekst er
precies naar Whisper en naar het taalmodel gaat.

Bron: `n8n/demo-data/workflows/bespreking-workflow.json` (workflow *Bespreking
naar Verslag*, 31 nodes plus 3 notities). De prompts hieronder staan er letterlijk in; de
`${...}`-stukken worden per bespreking ingevuld.

---

## 1. In vogelvlucht

```mermaid
flowchart TD
    W[Webhook POST /bespreking] --> P[Prepare Audio]
    P --> R[Respond Job Id]
    R --> A{audio of transcript?}
    A -->|audio| WH[Whisper Transcribe]
    A -->|transcript| TP[Transcript Passthrough]
    WH --> E[Extract Transcript]
    TP --> E
    E --> L{langer dan 9.000 tekens?}
    L -->|ja| SB[Split Blokken] --> LB[Loop Blokken] --> B[Blok LLM Chain]
    B --> LB
    LB --> C[Collect Blok Samenvattingen] --> BV[Build Verslag Prompt]
    L -->|nee| TD[Transcript Direct] --> BV
    BV --> V[Verslag LLM Chain] --> PJ[Parse Verslag JSON] --> OS[Orden Secties]
    OS --> N{kopjes voor nacontrole?}
    N -->|ja| SN[Split Nacontrole] --> LN[Loop Nacontrole] --> NC[Nacontrole LLM Chain]
    NC --> LN
    LN --> MN[Merge Nacontrole] --> CG[Controleer Getallen]
    N -->|nee| CG
    CG --> WA[Write Verslag Args] --> G[Generate Verslag DOCX] --> BR[Build Bespreking Response]
```

Er zijn **vier momenten waarop een model wordt aangeroepen**: Whisper voor de
transcriptie, en daarna qwen3.5:4b in drie rollen — per blok, voor het verslag,
en voor gerichte nacontrole. Alles daartussen is gewone code.

De verdeling van werk is een bewuste keuze: **het model levert inhoud, de code
bepaalt de vorm.** Volgorde van kopjes, filteren van lege meldingen, controle op
getallen — dat gebeurt allemaal deterministisch, omdat instructies daarover in de
prompt bij dit model herhaaldelijk niet bleken te werken.

---

## 2. Fasen, zoals de webapp ze toont

De HTTP-respons gaat direct na node 2 terug (alleen een `job_id`); de rest draait
door op de achtergrond. De webapp pollt `GET /webhook/job-status?job=…`.

| fase | status | wat er draait |
|---|---|---|
| 1 | `transcriberen` | Whisper |
| 2 | `samenvatten` | blokken (met `blok_voortgang` "3/7") en de verslagronde |
| 3 | `document` | DOCX genereren |
| — | `klaar` / `fout` | eindresultaat in het jobbestand |

Het jobbestand staat in `shared/jobs/<job_id>.json` en bevat het volledige
transcript. Die bestanden worden bij elke nieuwe bespreking opgeruimd zodra ze
ouder zijn dan 24 uur.

---

## 3. Stap voor stap

### Prepare Audio
Leest de multipart-upload uit: één WAV plus de velden `dossier`, `onderwerp`,
`behandelaar`, `deelnemers`, `datum`, `duur_seconden`, `soort` en `context`. In plaats van audio mag ook een
kant-en-klaar `transcript` mee — dan wordt Whisper overgeslagen (zo test je de
samenvatting zonder transcriptieruis).

Het veld **`context`** is de vrije waarneming van de behandelaar: wat je niet uit
de opname kunt horen maar wel bij het dossier hoort ("mevrouw is 88 en stottert",
"de heer voerde vrijwel het hele gesprek"). Die tekst gaat drie kanten op, en
bewust niet naar Whisper — zie [§5.6](#56-waarnemingen-van-de-behandelaar).

**`behandelaar`** en **`deelnemers`** (de cliënten) komen apart binnen. Samen
vormen ze het kopje *Aanwezig*; gescheiden gaan ze de prompts in, zodat het model
weet over wie het verslag gaat — zie [§5.7](#57-rolverdeling). Ontbreekt
`behandelaar` (ouder formulier, script), dan geldt een deelnemer met "mr." of een
functie vóór de naam als behandelaar.

Bepaalt ook het **soort bespreking**. Staat `soort` niet vast, dan wordt het
onderwerp vergeleken met `herken_op` uit de sjablonen, waarbij het *langste*
passende trefwoord wint — anders belandt een levenstestament onder het
testamentsjabloon, want "testament" zit in "levenstestament".

Maakt het jobbestand aan en ruimt oude op.

### Whisper Transcribe
`POST http://host.docker.internal:8910/inference`, temperature 0, taal nl,
timeout 20 minuten. De server draait native op de Mac (Metal); zie
`shared/whisper/start-whisper-server.sh` voor model en VAD-instellingen.

De server draait met **`--max-context 0`**: elk venster wordt los getranscribeerd,
zonder de eerder geschreven tekst als context. Die context is waar
herhalingslussen uit ontstaan. Gemeten op een levenstestamentbespreking van 35
minuten:

| instelling | woorden | lussen |
|---|---|---|
| met context (oud) | 3.129 | 2, plus 15× "Ja." |
| met context, prompt zonder labels | 2.178 | 125× "Ja." |
| `--max-context 0` | 3.833 | 0 |
| idem, VAD-drempel 0,3 en ruimere padding | 3.893 | 0 |
| alleen de prompt als context (`--carry-initial-prompt`, `-mc 40`) | 3.446 | 0 |

Wat terugkwam was precies wat in het verslag ontbrak: de opsomming over de omvang
van de volmacht en de antwoorden van de cliënten. Die leken te zacht te zijn
opgenomen, maar zaten gewoon in de opname. De prijs: de initial prompt
([§5.1](#51-whisper--initial-prompt)) doet niets meer.

### Extract Transcript
Schoont het transcript eerst op, in code:

- **Sprekerlabels eruit.** Stond er "Aanwezig: …" in de initial prompt, dan nam
  Whisper dat woord over als label vóór elke beurt (101 keer in 35 minuten). Komt
  zo'n label drie keer of vaker voor, dan verdwijnt het.
- **Herhalingen samenvoegen.** Drie of meer gelijke zinnen op rij worden er één.
  Bij een inhoudelijke zin blijft `[9× herhaald]` staan en komt er een
  waarschuwing in het resultaat: daar ontbreekt gesproken tekst. Een rij
  "Ja. Ja. Ja." krimpt zonder markering.

Knipt het transcript daarna in blokken van 9.000 tekens, op zinseinde. Eén blok ≈ een
kwartier spreektijd en past ruim in de 8.192 tokens context. Is er maar één blok,
dan gaat het transcript rechtstreeks naar de verslagprompt.

### Split Blokken → Blok LLM Chain (map)
Eén LLM-aanroep per blok. Met sjabloon vat elk blok meteen samen **onder de vaste
kopjes**. Dat is bewust: eerst vatte deze stap vrij samen en moest de verslagronde
de flarden alsnog sorteren. Dat lukte niet — bij een bespreking van 46 minuten
bleven 14 van de 17 kopjes leeg, omdat de details die je nodig hebt om iets te
herkennen in de samenvatstap al waren weggevallen.

Elk blok krijgt een deterministische hint mee: welke kopjes hebben hier een
trefwoord staan? Puur op tekstvergelijking, zonder model.

`Collect Blok Samenvattingen` ruimt per deel op vóór het samenvoegen: een zin die
onder drie of meer kopjes staat is opvulling en verdwijnt, een zin onder twee
kopjes blijft alleen onder het eerste, "Er wordt gekeken naar de situatie
waarbij…" gaat weg, en er blijven hooguit zes punten per kopje over.

### Build Verslag Prompt → Verslag LLM Chain (reduce)
Bouwt het eindverslag uit óf het hele transcript, óf de deelsamenvattingen.

Bij een lange bespreking mét sjabloon vraagt deze ronde **alleen titel,
samenvatting, afspraken en open vragen**. De kopjes zijn dan al door de blokken
gevuld en Orden Secties neemt die als bron; ze nog eens laten uitschrijven was
dubbel werk en liet het antwoord tegen de uitvoerlimiet lopen. De `VASTE INDELING`
en het veld `onderwerpen` uit §5.4 gelden dus alleen voor een korte bespreking.

### Orden Secties
Het inhoudelijke hart, en volledig code. Hier gebeurt:

1. **Volgorde afdwingen** — de sjabloonvolgorde, want het model laat kopjes weg,
   hernoemt ze of wisselt ze om.
2. **Blokpunten eerst** — die zijn gemaakt met het volledige transcriptdeel in
   beeld, de verslagronde ziet alleen samengevatte flarden.
3. **Echo's weren** — het model schreef de *aanwijzing* achter een kopje over als
   inhoud, waardoor "Tweetrapsmaking" gevuld leek terwijl het nooit ter sprake kwam.
4. **Lege meldingen weren** — "Niet besproken", "Geen specifieke voogdij". Een
   woordenlijst bijhouden bleek dweilen; er staat nu een regel die generaliseert:
   begint een punt met een ontkenning en blijft er ná het wegstrepen van de
   kopwoorden niets inhoudelijks over, dan is het kopje leeg. "Geen bewind; wel een
   toelichting in het concept" houdt wél inhoud over en blijft dus staan.
   Dezelfde echo komt ook in stukjes: uit "Medisch aanspreekpunt,
   behandelverklaringen, wel of niet reanimeren" maakte het model vier losse
   punten. Een kort punt dat uit woorden van een aanwijzing bestaat die in het
   gesprek zelf niet zijn gevallen, gaat eruit — net als "Geen inboedel" wanneer
   het woord inboedel nergens in het transcript staat, een los trefwoord
   ("Kosten") en een etiket zonder inhoud ("Planning: niet genoemd").
5. **Restpost ontdubbelen** — wat al onder een ander kopje staat, hoeft niet nog
   eens onder het laatste.
6. **`ter_sprake` markeren** — een kopje dat leeg bleef terwijl zijn trefwoord wél
   in het transcript valt, krijgt een markering. Typisch als ergens van wordt
   afgezien ("de vaccinatieclausule? nee, laat maar zitten").

### Split Nacontrole → Nacontrole LLM Chain
Voor precies die gemarkeerde kopjes gaat één gerichte vraag terug naar het model,
met alleen de fragmenten rond het trefwoord (700 tekens ervoor en erna, maximaal
drie stukken). Klein en gefocust, in plaats van nog eens het hele transcript.

Een sjabloonsectie kan ook `altijd_nacontrole: true` krijgen; op dit moment
gebruikt geen enkele sectie dat.

`Merge Nacontrole` past hetzelfde echo-filter toe als Orden Secties. Hier was het
het hardst nodig: de nacontrole krijgt de aanwijzing van het kopje mee en gaf die
terug als antwoord ("…bijvoorbeeld de kinderen samen", bij cliënten zonder
kinderen).

### Controleer Getallen
Elk getal in het verslag moet terug te vinden zijn in het transcript. Lastig punt:
Whisper schrijft getallen nu eens als cijfer ("60%", "2008") en dan weer voluit
("vierhonderdvijftigduizend"). Daarom wordt van elk getal ook de Nederlandse
woordvorm gemaakt en dáárop gezocht. Wat niet terug te vinden is, wordt in het
DOCX gemarkeerd.

Dezelfde node markeert een **rolverwisseling**: een zin die iets persoonlijks aan
de notaris of behandelaar toeschrijft ("de broer van de notaris", "ziekte van
Huntington (bij de notaris)"). Niet herschrijven — wie er werkelijk bedoeld is,
weet alleen de behandelaar.

### Build Bespreking Response
Schrijft het resultaat in het jobbestand, met de waarschuwingen. Twee daarvan gaan
over het transcript zelf: het aantal herhalingslussen, en een dun transcript
(minder dan 105 woorden per minuut, waar een gesprek er 130 tot 160 haalt). Een
verslag kan er verzorgd uitzien terwijl de helft van het gesprek er niet in zit.

### Generate Verslag DOCX
`python3 /data/shared/genereer_besprekingsverslag.py --args-file …`. De argumenten
gaan via een tijdelijk JSON-bestand en niet over de commandline, omdat het
transcript cliëntgegevens bevat.

---

## 4. Modelinstellingen

De drie modelstappen draaien op **qwen3.5:4b** via Ollama, native op de Mac. Ze
roepen Ollama **rechtstreeks** aan met een HTTP Request-node
(`POST http://host.docker.internal:11434/api/chat`), niet via de Ollama-node van
n8n. De nodes heten nog "… LLM Chain", zodat alle verwijzingen blijven kloppen.

Waarom rechtstreeks: qwen3.5 denkt standaard hardop, en dat kan alleen uit met
`think: false` in de aanroep. De Ollama-node van n8n 2.14.2 laat die sleutel
vallen, ook als hij in de workflow staat; het model schrijft dan zijn denkproces
als antwoord ("Unexpected token 'T', Thinking P…"). `/no_think` in de prompt en
een eigen Modelfile-variant helpen niet.

| stap | temperature | num_predict | num_ctx | keep_alive |
|---|---|---|---|---|
| Blok | 0 | 2048 | 8192 | 5m |
| Verslag | 0.1 | 2048 | 8192 | 5m |
| Nacontrole | 0 | 512 | 8192 | 5m |

`keep_alive` is kort gehouden: akte en analyse draaien op qwen2.5:7b, en twee
modellen tegelijk in het geheugen is op 16 GB te veel.

**Alleen de bespreking gebruikt qwen3.5:4b.** Gemeten op 7-10-2026 op dossier
2026.2270: in de akte spelde het de naam van de tweede cliënt fout
("VAN WIGGEN-VEEEN") en vulde het een tekstblok minder; in de analyse zag het de
bank aan voor cliënt 1 en miste het de echte kritieke bevinding. Voor het
samenvatten van een gesprek is het wél beter dan qwen2.5:7b: het houdt uit elkaar
wie welke ziekte heeft en levert bruikbare afspraken en open vragen.

Het antwoord staat als tekst in `message.content`; de parse-nodes lezen dat.
Bijvangst van de rechtstreekse aanroep: is die tekst afgekapt (uitvoerlimiet, of
het model valt in herhaling), dan redt `Collect Blok Samenvattingen` wat er stond
en meldt het resultaat dat. Via de Ollama-node viel bij ongeldige JSON het hele
deel weg.

Alle drie met `format: json`. Twee valkuilen uit de tijd van de Ollama-node, die voor akte en analyse nog gelden:

- **`numCtx` moet in camelCase.** De n8n-node negeert een andere schrijfwijze
  stilzwijgend en valt terug op 2048, waarna lange prompts onzichtbaar worden
  afgekapt.
- **Met `format: json` staat het geparste object in `$json` zelf**, niet in
  `$json.text`. De parse-nodes vangen beide vormen af.

`numPredict` stond ooit op 512 voor de blokken; dat kapte de JSON middenin af en
kostte de hele run.

Een hogere `numPredict` helpt niet tegen de andere manier waarop een blok
sneuvelt: het model valt in herhaling en schrijft dezelfde zin tot de uitvoer vol
is. Dat gebeurde in de lijst `afspraken`, toen die een open omschrijving zonder
maximum had. Met `format: json` is een afgekapt antwoord ongeldige JSON en valt
het hele deel weg (het resultaat meldt dat). Begrens daarom elke lijst in de
prompt.

---

## 5. De prompts, letterlijk

### 5.1 Whisper — initial prompt

```
Notariële bespreking. ${onderwerp}. Gesprek tussen ${behandelaar}, ${cliënten}.
```

**Let op: sinds de server met `--max-context 0` draait, gebruikt Whisper deze
prompt niet meer.** Hij gaat nog mee voor wie de server anders start. Gewone
zinnen en geen "Label: waarde": de vorige versie eindigde op
"Aanwezig: ${deelnemers}." en Whisper zette dat woord daarna vóór elke beurt.

Kort, en bewust **zonder lijst van vaktermen**. Gemeten op een echte bespreking
van 55 minuten kostte zo'n lijst van 29 termen 900 woorden inhoud (5.620 tegen
6.545) en verdubbelde hij de hallucinatielussen; met large-v3 stortte de
transcriptie zelfs volledig in (795 woorden). De enige winst was een betere
spelling van "langslevende". Een korte prompt met namen houdt het naamvoordeel
zonder die schade.

Whisper kapt de initial prompt sowieso af rond de 224 tokens, en een lange,
lijstachtige prompt zonder natuurlijke zinsbouw lokt herhaling uit.

### 5.2 Blokprompt — mét sjabloon

Zo ziet elke blokaanroep eruit bij een testament- of levenstestamentbespreking:

```
Hieronder staat deel ${i} van ${totaal} van een automatisch transcript van een notariële bespreking (${sjabloonnaam}).

Orden wat er in DIT deel is besproken onder de vaste kopjes hieronder. Gebruik uitsluitend wat er staat; verzin niets.

ROLLEN
... (zie §5.7)

KOPJES (de tekst achter de dubbele punt is een aanwijzing voor jou — schrijf die nooit over als inhoud)
- Familiesituatie: ${aanwijzing}
- Vermogenssituatie: ${aanwijzing}
- ... (alle kopjes uit het sjabloon)

LET OP — in dit deel vallen woorden die horen bij: ${raakkopjes}. Kijk of die kopjes hier gevuld moeten worden. Het omgekeerde geldt ook: een kopje dat hier niet tussen staat, is hier waarschijnlijk niet aan de orde.

REGELS
- Schrijf wat er over het onderwerp is gezegd, met de inhoud erbij.
- In één deel komen maar een paar kopjes aan bod. Vul een kopje alleen met wat de cliënten erover vertelden of kozen; alle andere kopjes blijven een lege lijst. Verzin geen punt om een kopje te vullen.
- Schrijf de uitkomst op, niet dát erover is gesproken. Niet "Er wordt besproken dat…" of "Er wordt gekeken naar…", maar wat er is gezegd of gekozen.
- Zet hetzelfde punt nooit onder twee kopjes.
- Hooguit zes punten per kopje, één korte zin per punt.
- Noem concrete namen, bedragen en percentages als die vallen; juist die maken het punt bruikbaar.
- Staat er "[9× herhaald]" of iets dergelijks, dan liep de transcriptie daar vast en ontbreekt er tekst. Maak daar geen punt van.
- Een punt is een hele zin die zegt wat er is verteld of besloten. Een los trefwoord of een rijtje onderwerpen is geen punt.
- "afspraken": alleen wat iemand ná dit gesprek nog gaat doen. Wat de cliënten kiezen of willen hoort onder een kopje. Hooguit vijf, geen enkele twee keer; niets afgesproken is een lege lijst.
- "namen": de namen van personen die in dit deel vallen.
- Twijfel je onder welk kopje iets hoort, kies dan het meest specifieke kopje dat past. Gebruik "${laatsteKop}" alleen als het echt nergens onder valt.

Geef alleen geldige JSON terug:
{
  "secties": {
    "Familiesituatie": [],
    "Vermogenssituatie": [],
    ...
  },
  "afspraken": [],
  "namen": []
}

TRANSCRIPT-DEEL
${blok}
```

De aanwijzingen staan er **voluit** in, niet afgekort. Met korte hints zakte het
aantal gevulde kopjes van 11 naar 8 en belandden de legaten weer onder "Overige".
De prompt wordt er groot van (~12.600 tekens), maar sinds de blokken één voor één
draaien is dat geen probleem.

De lijsten `afspraken` en `namen` staan **leeg in het schema** en worden in de
regels uitgelegd. Een omschrijving ín het schema schrijft dit model terug als
inhoud; een open omschrijving zonder maximum liet het alle keuzes van de cliënten
als afspraak opsommen tot de uitvoer vol was.

`${laatsteKop}` komt uit het sjabloon en is niet hardgecodeerd — anders breekt het
zodra de restpost wordt hernoemd.

### 5.3 Blokprompt — zonder sjabloon

Bij een algemene bespreking (geen testament of levenstestament):

```
Hieronder staat deel ${i} van ${totaal} van een automatisch transcript van een notariële bespreking.

Vat dit deel samen in korte, feitelijke punten. Gebruik uitsluitend wat er staat; verzin niets. Laat een lijst alleen leeg als er echt niets over gezegd is.

Houd het compact: hooguit acht punten per lijst en één korte zin per punt. Een te lang antwoord wordt afgekapt en is dan onbruikbaar.

Geef alleen geldige JSON terug:
{
  "besproken": ["korte punten over wat er in dit deel is besproken"],
  "afspraken": ["afspraken die in dit deel zijn gemaakt"],
  "namen": ["namen of rollen die in dit deel vallen"]
}

TRANSCRIPT-DEEL
${blok}
```

### 5.4 Verslagprompt

```
Je bent notarieel secretaris. Hieronder staat het materiaal van een bespreking op een notariskantoor. Werk het uit tot een zakelijk verslag.

HARDE REGELS
- Gebruik uitsluitend wat er staat. Verzin geen namen, bedragen, data of afspraken.
- Weet je iets niet, laat het veld dan leeg (lege string of lege lijst). Vul nooit iets aan "voor de volledigheid".
- Het transcript is machinaal gemaakt en kan verhaspelingen bevatten. Neem een naam of bedrag alleen op als die duidelijk uit de tekst blijkt.
- Schrijf in zakelijk Nederlands, derde persoon, verleden tijd.
- Geef alleen geldige JSON terug, zonder toelichting eromheen.

ROLLEN
... (zie §5.7)

CONTEXT
Onderwerp volgens de behandelaar: ${onderwerp}
Dossiernummer: ${dossier}

VASTE INDELING (${sjabloonnaam})
Vul "onderwerpen" met exact deze kopjes, in deze volgorde, en gebruik de kop letterlijk zoals hier geschreven. Wat wel is besproken maar nergens onder valt, hoort onder het laatste kopje.

De tekst achter het streepje is een aanwijzing vóór jou over wat er onder dat kopje hoort. Schrijf die aanwijzing NOOIT over als inhoud.

Een kopje krijgt alleen een lege lijst als het onderwerp helemaal niet ter sprake kwam.

1. Familiesituatie — ${aanwijzing}
2. Vermogenssituatie — ${aanwijzing}
... (alle kopjes)

JSON-SCHEMA
{
  "titel": "korte titel van de bespreking",
  "samenvatting": "Begin met waaróver de bespreking ging en wat de cliënten willen regelen. Daarna 4 tot 7 zinnen met de hoofdpunten: wat is gekozen, wat staat nog open. Som geen kopjes op en noem alleen uitkomsten die in het materiaal staan.",
  "onderwerpen": [{"kop": "onderwerp", "punten": ["wat er over gezegd is"]}],
  "afspraken": ["wie na dit gesprek wat gaat doen — één actie per regel, met de inhoud erbij"],
  "open_vragen": ["vragen die in de bespreking onbeantwoord bleven"]
}

TRANSCRIPT
${transcript}
```

Bij een lange bespreking staat er in plaats van `TRANSCRIPT` het kopje
`SAMENVATTINGEN PER DEEL (de bespreking is in ${n} delen samengevat)`.

**Geen voorbeeldzinnen in het schema.** Bij de samenvatting stond er één ("het
bestaande testament is doorgenomen en blijft in stand, met één wijziging: de
voogdij") en het model schreef die over als uitkomst van een bespreking waarin
het testament niet eens op tafel lag.

De aanwijzing over volgorde staat er wel in, maar de volgorde wordt daarna
alsnog in code afgedwongen. Deze regel dient om de inhoud onder het juiste kopje
te krijgen, niet om op het model te vertrouwen voor de vorm.

### 5.5 Nacontroleprompt

Eén aanroep per gemarkeerd kopje:

```
Hieronder staan fragmenten uit een transcript van een notariële bespreking.

VRAAG
Wat is er in deze bespreking gezegd over: ${kop}?
Ter oriëntatie, wat er onder dit kopje kán vallen (dit is geen antwoord; neem er niets uit over dat niet in de fragmenten staat): ${aanwijzing}

ROLLEN
... (zie §5.7)

REGELS
- Antwoord alleen op basis van de fragmenten. Verzin niets.
- Schrijf op wat de cliënten hierover zeiden of kozen, met de inhoud erbij. Een opsomming van onderwerpen is geen antwoord.
- Gaat het onderwerp in deze fragmenten ergens anders over, geef dan een lege lijst.
- Hooguit drie korte zinnen.

Geef alleen geldige JSON terug:
{"punten": ["korte zin"]}

FRAGMENTEN
${fragment}

[...]

${fragment}
```

Een sjabloonsectie mag een eigen `vraag` meegeven; dan vervangt die de
standaardvraag en vervalt de regel "Ter oriëntatie…".

Het antwoord wordt streng gefilterd voordat het in het verslag komt: punten
korter dan 9 tekens vallen af, net als antwoorden die óver de vraag gaan in plaats
van erop ("bevindt zich niet in de gegeven fragmenten") of die alleen de kop
herhalen, en punten die een echo van een sjabloon-aanwijzing zijn. Liever een kopje dat gemarkeerd blijft als "kwam ter sprake" dan een
schijnantwoord in het verslag.

### 5.6 Waarnemingen van de behandelaar

Het contextveld uit de webapp. Het gaat naar drie plekken, en naar Whisper juist
niet — de initial prompt kort houden is gemeten belangrijker dan wat een
waarneming daar zou toevoegen.

**1. Bovenaan elke blokprompt**, zodat het model weet hoe het de tekst moet
lezen. Bij iemand die hakkelt is een herhaling ruis en geen nadruk:

```
ACHTERGROND VAN DE BEHANDELAAR (over hoe het gesprek verliep, niet over de inhoud — schrijf dit nooit over als punt)
${context}
```

**2. In het CONTEXT-blok van de verslagprompt**, op één regel samengevouwen:

```
Waarnemingen van de behandelaar over het verloop van het gesprek (niet uit het transcript; gebruik ze om het gesprek te duiden, neem ze niet over als besproken punt): ${regel} | ${regel}
```

**3. Letterlijk in het verslag**, als kopje *Waarnemingen behandelaar* vóór de
samenvatting, met de aantekening "Genoteerd door de behandelaar zelf; niet
afkomstig uit de opname." Dat gebeurt in `Parse Verslag JSON`, op precies dezelfde
manier als de deelnemers: rechtstreeks uit het invoerveld, één regel per
waarneming, zonder dat het model eraan komt. Het staat daarmee ook buiten de
getalcontrole — "88" is de leeftijd die de behandelaar noteerde en hoeft niet in
het transcript te staan.

Twee keer staat er in de prompt dat het geen besproken punt is, en toch filtert
`Orden Secties` een punt weg dat te veel op een waarnemingsregel lijkt. Dat is
hetzelfde vangnet als voor de aanwijzingen, om dezelfde reden: dit model schrijft
achtergrondtekst geregeld over als inhoud, en de waarneming staat verderop toch al
in het verslag.

### 5.7 Rolverdeling

Het transcript vermeldt geen sprekers. Zonder uitleg wist het model niet over wie
het verslag ging: bij een levenstestament schreef het de ziekte en de broer van
de cliënt aan de notaris toe. Dit blok staat daarom in de blokprompt, de
verslagprompt en de nacontroleprompt — ook als er geen namen zijn ingevuld, want
de rolverdeling zelf is het punt:

```
ROLLEN
- Behandelaar (${behandelaar}): medewerker van het notariskantoor. Stelt de vragen en legt de wet uit.
- Cliënten (${cliënten}): over hén gaat het verslag — hun familie, gezondheid, vermogen, wensen en keuzes.
- Het transcript zegt niet wie er spreekt. Wie uitlegt en vragen stelt is de behandelaar; wie over het eigen leven vertelt is een cliënt.
- Schrijf nooit iets toe aan de behandelaar of "de notaris" dat over het leven van een mens gaat (ziekte, broer, partner, testament, wensen). Dat gaat altijd over een cliënt; schrijf dan "cliënt" of "cliënten".
- Algemene uitleg van de behandelaar over de wet of over wat er mogelijk is, is geen keuze van de cliënten. Noteer wat voor déze cliënten geldt of wat zij willen.
```

Het vangnet in code staat in Controleer Getallen: gaat het toch mis, dan krijgt
de zin een markering.

---

## 6. De sjablonen

`shared/templates/besprekingen/*.json`. Elke sectie heeft:

```json
{
  "kop": "Besproken punten",
  "aanwijzing": "Punten die in dit gesprek zijn doorgenomen en die niet onder een van de andere kopjes vallen. Gaat het om een bestaand testament, dan ook welke wijzigingen de cliënten daarin willen en wat ongewijzigd blijft.",
  "trefwoorden": ["wijziging", "wijzigingen", "wijzigen", "aanpassen", "..."]
}
```

De drie velden doen elk iets anders:

- **`kop`** — bepaalt de volgorde in het verslag en de kop in het DOCX.
- **`aanwijzing`** — gaat naar het model, in de blokprompt én de verslagprompt.
- **`trefwoorden`** — worden **nooit** naar het model gestuurd als lijst. Ze
  sturen de blokhint, ze bepalen welke kopjes nacontrole krijgen, en ze markeren
  "hier is over gesproken" bij een leeg kopje.

Optioneel: `vraag` (eigen nacontrolevraag) en `altijd_nacontrole` (altijd langs de
nacontrole, ongeacht of het kopje gevuld is).

### Testament — 20 kopjes

Familiesituatie · Vermogenssituatie · Aanleiding en status · Besproken punten ·
Eerste erfstelling · Tweede erfstelling · Derde erfstelling · Plaatsvervulling en
onterving · Rechtskeuze · Soort testament · Opeisingsgronden en rente ·
Uitsluitingsclausule · Dertigdagenclausule · Tweetrapsmaking · Voogdij · Bewind ·
Executele · Legaten · Uitsluiting ouderlijk vruchtgenot · Overige aandachtspunten

Herkend op: testament, testamenten, erfenis, nalatenschap, uiterste wil.

### Levenstestament — 16 kopjes

Familiesituatie · Vermogenssituatie · Wie wordt gevolmachtigde · Opvolgend
gevolmachtigde · Ondervolmacht · Omvang van de volmacht · Beperkingen ·
Schenkingsbevoegdheid · Toezichthouder · Bancaire gevolmachtigde · Extra clausules
· Bijzondere vermogensbestanddelen · Niet-vermogensrechtelijke zaken ·
Mentorschap, curatele en bewind · Vaccinatieclausule · Overige aandachtspunten

Herkend op: levenstestament, levensvolmacht, volmacht bij leven.

Beide beginnen met Familiesituatie en Vermogenssituatie, en beide eindigen met
dezelfde restpost.

**Let op bij hernoemen:** de restpost heette even "Overige besproken punten en
aandachtspunten". Gemeten liep hij daardoor vol van 1–4 naar 22–27 punten, omdat
de naam te veel leek op "Besproken punten" en het model niet meer wist waar iets
heen moest. Een kop die op een andere kop lijkt, is duur.

---

## 7. Waar je wat aanpast

| wat je wilt veranderen | waar |
|---|---|
| kopjes, volgorde, aanwijzingen, trefwoorden | `shared/templates/besprekingen/*.json` |
| Whisper-model, VAD, beam size | `shared/whisper/start-whisper-server.sh` |
| prompts | de code-nodes in `n8n/demo-data/workflows/bespreking-workflow.json` |
| opmaak van het DOCX | `shared/genereer_besprekingsverslag.py` |
| opnemen, microfoonkeuze, waarnemingen, pollen | `webapp/src/components/Besprekingen.tsx` |

Een verslag opnieuw draaien vanaf een uitgeschreven transcript, zonder opnieuw op
te nemen:

```bash
./scripts/verslag-uit-tekst.sh transcript.txt 2026.1044 "Bespreking testament" "mr. Van Dijk, mevrouw Jansen"
```

---

## 8. Wat gemeten is

Nuttig om te weten voordat je aan de prompts gaat sleutelen: bij dit model werken
instructies over vórm structureel niet, en deterministische nabewerking wel. Dat
is inmiddels op vier punten bevestigd — volgorde van kopjes, het weglaten van
lege kopjes, het vastleggen van afgewezen keuzes, en het onderscheid tussen optie
en besluit (3 van de 46 punten kregen een label; die stap is er weer uit).

Meetmethode die hier wordt aangehouden: een écht transcript, **drie runs**, tegen
een handmatig opgestelde goudlijst. Eén run zegt niets — twee keer eerder leidde
dat tot een conclusie die bij hermeting niet klopte.

Stand na de laatste wijziging, testamentbespreking van 55 minuten, drie runs:
14 van de 20 kopjes gevuld, restpost 6–8 punten, en steeds dezelfde zes lege
kopjes (Rechtskeuze, Dertigdagenclausule, Tweetrapsmaking, Voogdij, Bewind,
Uitsluiting ouderlijk vruchtgenot) — die onderwerpen komen in dat gesprek niet voor.
