#!/usr/bin/env python3
"""
Fill hypotheekakte Word template placeholders with JSON input.

Usage (preferred, geen shell-interpolatie van payload-data):
  python3 /data/shared/vul_template_in.py --args-file /tmp/n8n_args_akte_XYZ.json
  # JSON-bestand bevat: {"template": "...", "placeholders": {...}, "zaaknummer": "..."}
  # Het bestand wordt na inlezen verwijderd (zelfopruimend).

Flag-based:
  python3 /data/shared/vul_template_in.py \
    --template /data/shared/templates/rabobank/template_HYRABO00.docx \
    --placeholders '{"<<NAAM_1>>":"Jan Jansen"}' \
    --zaaknummer 5238033

Backwards-compatible legacy form (positional, defaults to Rabobank template):
  python3 /data/shared/vul_template_in.py '{"<<NAAM_1>>":"Jan Jansen"}' '5238033'
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml.ns import qn

OUTPUT_DIR = Path("/data/shared/output")
LEGACY_TEMPLATE_PATH = Path("/data/shared/templates/rabobank/template_HYRABO00.docx")

BEGIN_MARKER_RE = re.compile(r"<<#BEGIN:([\w-]+)>>")
END_MARKER_RE = re.compile(r"<<#END:([\w-]+)>>")
FLAG_KEY_RE = re.compile(r"^<<#FLAG:([\w-]+)>>$")
TRUTHY = {"true", "1", "yes", "ja", "y", "t"}

# Placeholders waarvan de ingevulde waarde geel gearceerd wordt: velden die de
# behandelaar nog moet controleren of invullen (bv. de passeerdatum wijkt af van
# de uiterlijke offertedatum; de gevolmachtigde van de bank wisselt per akte).
HIGHLIGHT_TAGS = ("<<AKTE_DATUM>>", "<<BANK_VOLMACHTHOUDER>>")

# Placeholders die de akte niet mag missen. Blijven ze leeg, dan verdwijnt de
# waarde niet stilzwijgend (wat 'kadastraal bekend gemeente , sectie , nummer ,'
# opleverde) maar komt er een gearceerd LEEG_MARKER in de tekst. Zijn ze wél
# gevuld, dan blijven ze onopgemaakt: alleen het gat valt op.
VERPLICHTE_TAGS = (
    "<<NAAM_1_HOOFDLETTERS>>", "<<GEBOORTEPLAATS_1>>",
    "<<GEBOORTEDAG_1_WOORDEN>>", "<<GEBOORTEMAAND_1_WOORDEN>>", "<<GEBOORTEJAAR_1_WOORDEN>>",
    "<<ONDERPAND_STRAAT>>", "<<ONDERPAND_HUISNUMMER>>",
    "<<ONDERPAND_POSTCODE>>", "<<ONDERPAND_WOONPLAATS>>",
    "<<KAD_GEMEENTE>>", "<<KAD_SECTIE>>", "<<KAD_NUMMER>>", "<<KAD_GROOTTE_WOORDEN>>",
    "<<INSCHRIJVINGSBEDRAG_CIJFER>>", "<<INSCHRIJVINGSBEDRAG_WOORDEN>>",
    "<<TOTAAL_HYPOTHEEK_CIJFER>>", "<<TOTAAL_HYPOTHEEK_WOORDEN>>",
    "<<VOORBELASTING_OMSCHRIJVING>>",
    "<<NOTARIS_NAAM>>", "<<NOTARIS_STANDPLAATS>>",
    "<<OFFERTENUMMER>>", "<<DOSSIERNUMMER>>",
    # ABN AMRO-model
    "<<TYPE_HYPOTHEEK_1>>", "<<HOOFDSOM_CIJFER>>",
)

# Wat in de plaats komt van een leeg verplicht veld.
LEEG_MARKER = "……"

# Literele invul-markers die overal in de definitieve tekst geel gearceerd
# worden: elk [...]-blanco (huwelijksregime, onbekende notaris, titel van
# verkrijging) en het ondertekentijdstip-blanco (rij van 4+ punten). Deze zitten
# niet in een eigen placeholder maar midden in een zin. Het template zelf
# gebruikt nergens blokhaken, dus [...] is een eenduidige markeringsconventie.
HIGHLIGHT_LITERAL_RE = re.compile(r"(\[[^\[\]]{2,140}\]|\.{4,})")


# ---------------------------------------------------------------------------
# Deterministische bedrag-normalisatie (cijfers → Nederlandse woorden)
# ---------------------------------------------------------------------------
# De passeeropdracht bevat bedragen alleen als cijfers (€ 150.000,00); de
# WOORDEN moet het LLM genereren — en een klein model (qwen2.5:7b) doet dat
# onbetrouwbaar ("vijftigduizend" i.p.v. "honderdvijftigduizend"). De cijfers
# zélf worden wél betrouwbaar geëxtraheerd. Daarom rekenen we hier de woorden
# (en de canonieke cijferopmaak) deterministisch uit het cijfer-placeholder.

_EENHEDEN = [
    "nul", "een", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht", "negen",
    "tien", "elf", "twaalf", "dertien", "veertien", "vijftien", "zestien",
    "zeventien", "achttien", "negentien",
]
_TIENTALLEN = {
    2: "twintig", 3: "dertig", 4: "veertig", 5: "vijftig",
    6: "zestig", 7: "zeventig", 8: "tachtig", 9: "negentig",
}

# (cijfer-placeholder, woorden-placeholder) — paren die we deterministisch vullen.
BEDRAG_PAREN = [
    ("<<HOOFDSOM_CIJFER>>", "<<HOOFDSOM_WOORDEN>>"),
    ("<<INSCHRIJVINGSBEDRAG_CIJFER>>", "<<INSCHRIJVINGSBEDRAG_WOORDEN>>"),
    ("<<OPSLAG_CIJFER>>", "<<OPSLAG_WOORDEN>>"),
    ("<<TOTAAL_HYPOTHEEK_CIJFER>>", "<<TOTAAL_HYPOTHEEK_WOORDEN>>"),
]


def _onder_honderd(n: int) -> str:
    if n < 20:
        return _EENHEDEN[n]
    tien, eenheid = divmod(n, 10)
    if eenheid == 0:
        return _TIENTALLEN[tien]
    samen = _EENHEDEN[eenheid] + "en" + _TIENTALLEN[tien]
    # Trema bij klinkerbotsing: twee+en -> tweeën, drie+en -> drieën.
    return samen.replace("tweeen", "tweeën").replace("drieen", "drieën")


def _onder_duizend(n: int) -> str:
    honderd, rest = divmod(n, 100)
    deel = ""
    if honderd:
        deel += "honderd" if honderd == 1 else _EENHEDEN[honderd] + "honderd"
    if rest:
        deel += _onder_honderd(rest)
    return deel


def getal_naar_woorden(n: int) -> str:
    """Heel getal (0..999.999.999) naar Nederlandse woorden, notariële stijl
    (duizendtal aaneen: 'honderdvijftigduizend', rest met spatie)."""
    if n < 0:
        return "min " + getal_naar_woorden(-n)
    if n == 0:
        return "nul"
    miljoen, rest = divmod(n, 1_000_000)
    duizend, rest = divmod(rest, 1_000)
    delen = []
    if miljoen:
        delen.append("een miljoen" if miljoen == 1 else _onder_duizend(miljoen) + " miljoen")
    if duizend:
        delen.append("duizend" if duizend == 1 else _onder_duizend(duizend) + "duizend")
    if rest:
        delen.append(_onder_duizend(rest))
    return " ".join(delen)


def _parse_bedrag(s: str):
    """Parseer een bedrag-string (€ 150.000,00 / 150000 / € 52.500) naar
    (euros, eurocenten). Geeft None als er geen bedrag in zit."""
    m = re.search(r"(\d[\d.  ]*)(?:,(\d{1,2}))?", str(s or ""))
    if not m:
        return None
    euros = int(re.sub(r"[. \s]", "", m.group(1)))
    cents = int((m.group(2) or "0").ljust(2, "0")[:2])
    return euros, cents


def _format_euro(euros: int, cents: int) -> str:
    # Geen euroteken: het template levert zelf de '(€ ...'-prefix vóór de
    # cijfer-placeholder. Alleen het bedrag met duizend-puntjes + centen.
    duizendtal = f"{euros:,}".replace(",", ".")
    return f"{duizendtal},{cents:02d}"


def _bedrag_naar_woorden(euros: int, cents: int) -> str:
    woorden = getal_naar_woorden(euros) + " euro"
    if cents:
        woorden += " en " + getal_naar_woorden(cents) + " eurocent"
    return woorden


def normaliseer_bedragen(raw_map: dict[str, str]) -> dict[str, str]:
    """Herbereken cijferopmaak + woorden voor de bedrag-placeholders uit het
    cijfer. Laat een placeholder ongemoeid als het cijfer ontbreekt/onparseerbaar
    is (dan blijft de LLM-waarde als fallback staan)."""
    for cijfer_tag, woorden_tag in BEDRAG_PAREN:
        if cijfer_tag not in raw_map:
            continue
        parsed = _parse_bedrag(raw_map[cijfer_tag])
        if not parsed:
            continue
        euros, cents = parsed
        raw_map[cijfer_tag] = _format_euro(euros, cents)
        raw_map[woorden_tag] = _bedrag_naar_woorden(euros, cents)
    return raw_map


# ---------------------------------------------------------------------------
# Deterministische geboortedatum-normalisatie (rauwe datum → dag/maand/jaar
# in Nederlandse woorden, notariële stijl: "negentien februari
# negentienhonderdeenennegentig"). Zelfde reden als bij bedragen: de rauwe
# datum (19-02-1991) staat betrouwbaar in kadaster/BRP, maar qwen faalt op de
# woord-omzetting. De LLM levert alleen de rauwe datum; wij rekenen de woorden.
# ---------------------------------------------------------------------------

_MAANDEN = {
    1: "januari", 2: "februari", 3: "maart", 4: "april", 5: "mei", 6: "juni",
    7: "juli", 8: "augustus", 9: "september", 10: "oktober", 11: "november",
    12: "december",
}

# (rauwe-datum-placeholder, dag-, maand-, jaar-placeholder) per klant.
GEBOORTE_PAREN = [
    ("<<GEBOORTEDATUM_1_RAW>>", "<<GEBOORTEDAG_1_WOORDEN>>",
     "<<GEBOORTEMAAND_1_WOORDEN>>", "<<GEBOORTEJAAR_1_WOORDEN>>"),
    ("<<GEBOORTEDATUM_2_RAW>>", "<<GEBOORTEDAG_2_WOORDEN>>",
     "<<GEBOORTEMAAND_2_WOORDEN>>", "<<GEBOORTEJAAR_2_WOORDEN>>"),
]


def jaar_naar_woorden(j: int) -> str:
    """Jaartal notarieel: 1991 -> negentienhonderdeenennegentig,
    2021 -> tweeduizendeenentwintig."""
    if 2000 <= j <= 2099:
        rest = j - 2000
        return "tweeduizend" + (_onder_honderd(rest) if rest else "")
    eeuw, rest = divmod(j, 100)
    woord = getal_naar_woorden(eeuw) + "honderd"
    if rest:
        woord += _onder_honderd(rest)
    return woord


def datum_naar_woorden(raw: str):
    """Parseer DD-MM-JJJJ of JJJJ-MM-DD en geef (dag_woorden, maand, jaar_woorden).
    Geeft None als er geen geldige datum in zit."""
    s = str(raw or "")
    m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", s)
    if m:
        dag, maand, jaar = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", s)
        if not m:
            return None
        jaar, maand, dag = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= maand <= 12 and 1 <= dag <= 31):
        return None
    return getal_naar_woorden(dag), _MAANDEN[maand], jaar_naar_woorden(jaar)


def normaliseer_opslagpercentage(raw_map: dict[str, str]) -> dict[str, str]:
    """<<OPSLAG_PERCENTAGE>> volgt uit de twee bedragen: de opslag voor rente,
    boeten en kosten gedeeld door het bedrag waarop het hypotheekrecht rust
    (200.000 op 500.000 -> 'veertig procent (40%)'). Het model schrijft dat
    percentage voluit, dus rekenen we het uit in plaats van het te laten gokken."""
    if "<<OPSLAG_PERCENTAGE>>" not in raw_map:
        return raw_map
    basis = _parse_bedrag(raw_map.get("<<INSCHRIJVINGSBEDRAG_CIJFER>>"))
    opslag = _parse_bedrag(raw_map.get("<<OPSLAG_CIJFER>>"))
    if not basis or not opslag or basis[0] <= 0:
        return raw_map
    procent = round(opslag[0] * 100 / basis[0])
    raw_map["<<OPSLAG_PERCENTAGE>>"] = f"{getal_naar_woorden(procent)} procent ({procent}%)"
    return raw_map


def normaliseer_geboortedata(raw_map: dict[str, str]) -> dict[str, str]:
    """Vul dag/maand/jaar-in-woorden-placeholders uit een rauwe-datum-helper
    (<<GEBOORTEDATUM_N_RAW>>). De helper zelf hoort niet in het template en
    wordt verwijderd. Ontbreekt/onparseerbaar de datum, dan blijven de
    bestaande (LLM-)woordwaarden staan."""
    for raw_tag, dag_tag, maand_tag, jaar_tag in GEBOORTE_PAREN:
        raw = raw_map.get(raw_tag)
        if raw:
            parsed = datum_naar_woorden(raw)
            if parsed:
                dag_w, maand_w, jaar_w = parsed
                raw_map[dag_tag] = dag_w
                raw_map[maand_tag] = maand_w
                raw_map[jaar_tag] = jaar_w
        raw_map.pop(raw_tag, None)
    return raw_map


def _akte_jaar_woorden(j: int) -> str:
    """Jaartal in de aktedatum: notarieel mét spatie na 'tweeduizend'
    (2022 -> 'tweeduizend tweeentwintig'), anders dan het geboortejaar dat
    aaneengeschreven is. Bevestigd tegen de echte Rabobank-aktes."""
    if 2000 <= j <= 2099:
        rest = j - 2000
        return "tweeduizend" + (" " + _onder_honderd(rest) if rest else "")
    return jaar_naar_woorden(j)


def normaliseer_aktedatum(raw_map: dict[str, str]) -> dict[str, str]:
    """Zet de rauwe uiterlijke passeerdatum (<<AKTE_DATUM_RAW>>) om naar de
    voluit geschreven aktedatum (<<AKTE_DATUM>>), bijv. '07-04-2022' ->
    'zeven april tweeduizend tweeentwintig'. De helper zelf hoort niet in het
    template en wordt verwijderd. Ontbreekt/onparseerbaar de datum, dan blijft
    <<AKTE_DATUM>> leeg (handmatig in te vullen)."""
    raw = raw_map.get("<<AKTE_DATUM_RAW>>")
    if raw:
        parsed = datum_naar_woorden(raw)
        jaar_match = re.search(r"\b(\d{4})\b", str(raw))
        if parsed and jaar_match:
            dag_w, maand_w, _ = parsed
            raw_map["<<AKTE_DATUM>>"] = (
                f"{dag_w} {maand_w} {_akte_jaar_woorden(int(jaar_match.group(1)))}"
            )
    raw_map.pop("<<AKTE_DATUM_RAW>>", None)
    return raw_map


# ---------------------------------------------------------------------------
# Deterministische kadastergegevens -> akte-zinnen
# ---------------------------------------------------------------------------
# n8n levert de ruwe feiten uit de Kadaster-uitdraaien als JSON: één record per
# perceel (<<PERCELEN_RAW>>) met de kadastrale aanduiding, de grootte, de
# verkrijgingsketen en de bestaande inschrijvingen, plus de oppervlakte van het
# eerste perceel apart (<<KAD_GROOTTE_M2>>, voor templates met één perceel).
# Het omzetten naar notarieel Nederlands gebeurt hier, waar de getal- en
# datum-naar-woorden-helpers al staan. Wat niet uit de
# stukken blijkt (aard van de titel, een onbekende notaris) wordt een
# [...]-invulmarker; die wordt verderop geel gearceerd.

_ORDINALEN = {
    1: "eerste", 2: "tweede", 3: "derde", 4: "vierde", 5: "vijfde",
    6: "zesde", 7: "zevende", 8: "achtste", 9: "negende", 10: "tiende",
}

NOTARIS_BLANCO = "[notaris — invullen]"
DATUM_BLANCO = "[datum — invullen]"
TITEL_BLANCO = "[titel van verkrijging — controleren]"


def _ordinaal(n: int) -> str:
    return _ORDINALEN.get(n, f"{n}e")


def grootte_naar_woorden(m2: int) -> str:
    """Oppervlakte in m2 naar notariele schrijfwijze:
    116 -> 'een are en zestien centiare (1 a 16 ca)'."""
    hectare, rest = divmod(int(m2), 10_000)
    are, centiare = divmod(rest, 100)
    woorden, cijfers = [], []
    for waarde, naam, afkorting in (
        (hectare, "hectare", "ha"), (are, "are", "a"), (centiare, "centiare", "ca")
    ):
        if not waarde:
            continue
        woorden.append(f"{getal_naar_woorden(waarde)} {naam}")
        cijfers.append(f"{waarde} {afkorting}")
    if not woorden:
        return ""
    tekst = woorden[0] if len(woorden) == 1 else ", ".join(woorden[:-1]) + " en " + woorden[-1]
    return f"{tekst} ({' '.join(cijfers)})"


def normaliseer_kadastrale_grootte(raw_map: dict[str, str]) -> dict[str, str]:
    """<<KAD_GROOTTE_M2>> (helper, hoort niet in het template) -> woorden."""
    m2 = str(raw_map.pop("<<KAD_GROOTTE_M2>>", "")).strip()
    if m2.isdigit() and int(m2) > 0:
        raw_map["<<KAD_GROOTTE_WOORDEN>>"] = grootte_naar_woorden(int(m2))
    return raw_map


def _akte_datum_woorden(raw: str) -> str:
    """'26-08-2021' -> 'zesentwintig augustus tweeduizend eenentwintig'."""
    parsed = datum_naar_woorden(raw)
    jaar = re.search(r"\b(\d{4})\b", str(raw or ""))
    if not parsed or not jaar:
        return ""
    dag_w, maand_w, _ = parsed
    return f"{dag_w} {maand_w} {_akte_jaar_woorden(int(jaar.group(1)))}"


def _register_naam(register: str) -> str:
    r = str(register or "").strip()
    return f"Onroerende Zaken Hypotheken {r}" if r else "Onroerende Zaken"


def _register_kort(register: str) -> str:
    """'Hypotheken 4' — de korte aanduiding die het Rabobank-model gebruikt
    ('in het Register Hypotheken 4, deel ... nummer ...')."""
    r = str(register or "").strip()
    return f"Hypotheken {r}" if r else "Hypotheken"


def _laad_raw_lijst(raw_map: dict[str, str], tag: str) -> list[dict]:
    """Lees een JSON-lijst uit een RAW-helperplaceholder en verwijder de helper."""
    ruw = raw_map.pop(tag, "")
    if not str(ruw).strip():
        return []
    try:
        data = json.loads(ruw)
    except (TypeError, ValueError):
        return []
    return [d for d in data if isinstance(d, dict)] if isinstance(data, list) else []


def _letter(i: int) -> str:
    """0 -> 'a', 1 -> 'b', ... voor de perceel-aanduiding in de akte."""
    return chr(ord("a") + i) if i < 26 else str(i + 1)


def _perceel_adres(p: dict) -> str:
    """'2907 NG Capelle aan den IJssel, Mauritshuis 39'"""
    plaats = " ".join(x for x in (p.get("postcode"), p.get("woonplaats")) if x)
    straat = " ".join(x for x in (p.get("straat"), p.get("huisnummer")) if x)
    return ", ".join(x for x in (plaats, straat) if x)


def _recht_verbatim(ruw: str) -> str:
    """De aanduiding zoals het Kadaster hem registreert, zonder de nummering en
    zonder de omvang-toevoeging. Casing blijft: 'Belemmeringenwet Privaatrecht'
    is een wetsnaam, die hoort niet in kleine letters."""
    naam = str(ruw or "").strip()
    naam = re.sub(r"^\d+(\.\d+)?\s+", "", naam)
    naam = re.sub(r"\s+op gedeelte van perceel.*$", "", naam, flags=re.I)
    return naam.strip(" ,;")


def _recht_naam(ruw: str) -> str:
    """'Opstalrecht Nutsvoorzieningen op gedeelte van perceel' -> 'opstal
    nutsvoorzieningen'. Het Kadaster schrijft het recht met zijn volledige
    omvang erbij; in de akte volstaat de soortnaam ('recht van opstal ...')."""
    naam = _recht_verbatim(ruw)
    # Alleen het eerste woord naar kleine letters: de aanduiding komt midden in
    # een zin te staan, maar 'Belemmeringenwet Privaatrecht' is een wetsnaam en
    # die mag niet plat.
    if naam:
        naam = naam[0].lower() + naam[1:]
    naam = re.sub(r"\b(opstal|erfpacht|vruchtgebruik)recht\b", r"\1", naam, flags=re.I)
    return naam.strip(" ,;")


def _perceel_object(p: dict) -> str:
    """Omschrijving van het object zelf, afgeleid uit het Kadaster-veld
    'Omschrijving' en het al dan niet hebben van een eigen BAG-locatie."""
    omschrijving = str(p.get("omschrijving") or "").lower()
    adres = _perceel_adres(p) or "[adres — invullen]"
    if not p.get("eigen_locatie"):
        # Een los perceel zonder eigen adres wordt gesitueerd bij het hoofdperceel.
        return f"een perceel grond gelegen nabij {adres}"
    if "wonen" in omschrijving or "woonhuis" in omschrijving:
        return (
            "het woonhuis met ondergrond, erf, tuin, met al datgene wat volgens "
            f"verkeersopvatting daartoe behoort, staande en gelegen te {adres}"
        )
    if "perceel grond" in omschrijving:
        return f"een perceel grond gelegen te {adres}"
    return f"[objectomschrijving — controleren], staande en gelegen te {adres}"


def bouw_onderpand(percelen: list[dict]) -> list[str]:
    """Onderpandomschrijving: één regel per perceel, geletterd zodra het er
    meer dan één zijn — zo verwijzen de verkrijging en de voorbelasting er
    verderop naar."""
    if not percelen:
        return ["[onderpand — invullen]"]
    meervoud = len(percelen) > 1
    regels = []
    for i, p in enumerate(percelen):
        belast = ""
        rechten = [_belast_zin(r) for r in (p.get("beperkte_rechten") or [])]
        rechten = [r for r in rechten if r]
        if rechten:
            belast = ", belast met het nader te omschrijven " + " en ".join(rechten) + ","
        # Docling laat de rij 'Kadastrale grootte' bij sommige uitdraaien weg.
        # De oppervlakte dan stilzwijgend overslaan zou een afgeronde zin
        # opleveren met een gat erin, dus komt er een invulmarker.
        grootte = (grootte_naar_woorden(int(p["grootte_m2"]))
                   if str(p.get("grootte_m2") or "").isdigit() else "[grootte — invullen]")
        regel = (
            f"het recht van eigendom{belast} met betrekking tot {_perceel_object(p)}, "
            f"kadastraal bekend gemeente {p.get('gemeente') or LEEG_MARKER}, "
            f"sectie {p.get('sectie') or LEEG_MARKER}, "
            f"nummer {p.get('nummer') or LEEG_MARKER} "
            f"ter grootte van {grootte};"
        )
        regels.append(f"{_letter(i)}. {regel}" if meervoud else regel)
    return regels


def _titel_omschrijving(v: dict) -> str:
    """De aard van de titel, zoals de akte hem aanhaalt: 'akte van levering,
    houdende kwijting voor de betaling van de koopprijs en het ontbreken van de
    ontbindende voorwaarden die de verkrijging ongedaan zouden kunnen maken'.

    De kadastrale uitdraai noemt de aard niet; die komt uit het brondocument
    (n8n leest daar de kop en de operatieve zin uit). Zit dat stuk niet in het
    dossier, dan blijft de aard een invulmarker — raden is hier precies de fout
    die de akte niet mag maken. Het KNB-model schrijft de vermelding van de
    kwijting met zoveel woorden voor; die volgt daarom uit het stuk zelf en niet
    uit een vaste zin."""
    aard = str(v.get("titel_aard") or "").strip()
    if not aard:
        return f"akte van {TITEL_BLANCO}"
    houdende = []
    if v.get("titel_kwijting"):
        houdende.append("kwijting voor de betaling van de koopprijs")
    if v.get("titel_ontbindende_voorwaarden"):
        houdende.append(
            "het ontbreken van de ontbindende voorwaarden die de verkrijging "
            "ongedaan zouden kunnen maken"
        )
    tekst = f"akte van {aard}"
    if houdende:
        tekst += ", houdende " + " en ".join(houdende)
    return tekst


def _aandeel_toevoeging(v: dict) -> str:
    """'ieder voor de onverdeelde helft' — het aandeel waarvoor bij dit stuk is
    verkregen. 'ieder' alleen als de uitdraai meer gerechtigden aan hetzelfde
    stuk verbindt; bij één gerechtigde voor het geheel voegt de zinsnede niets
    toe en blijft ze weg."""
    aandeel = _aandeel_woorden(v.get("aandeel") or "")
    if not aandeel or aandeel == "het geheel":
        return ""
    return ("ieder voor " if int(v.get("gerechtigden") or 1) > 1 else "voor ") + aandeel


def _inschrijvingszin(v: dict) -> str:
    """De inschrijving en het stuk waarvan zij een afschrift is — het deel van
    de verkrijgingszin dat na 'verkregen' komt."""
    datum = v.get("datum_woorden") or _akte_datum_woorden(
        v.get("ondertekend_op") or v.get("ingeschreven_op")
    ) or DATUM_BLANCO
    return (
        "door de inschrijving ten kantore van de Dienst voor het Kadaster en de "
        "Openbare Registers, op "
        f"{_akte_datum_woorden(v.get('ingeschreven_op')) or DATUM_BLANCO} in het "
        f"Register {_register_kort(v.get('register'))}, deel {v.get('deel', '')} "
        f"nummer {v.get('nummer', '')}, van een afschrift van een "
        f"{_titel_omschrijving(v)}, op {datum} verleden voor "
        f"{v.get('notaris') or NOTARIS_BLANCO}"
    )


def bouw_verkrijging(percelen: list[dict]) -> list[str]:
    """Verkrijging in de bewoordingen van het Rabobank-model: 'De hypotheekgever
    heeft het onderpand verkregen door de inschrijving ... van een afschrift van
    een akte van levering, ... verleden voor ...'.

    Eén perceel met één titel wordt één doorlopende zin, zoals het model hem
    voordrukt. Zodra er meer percelen zijn of de titelketen uit meer stukken
    bestaat, wordt het een opsomming onder de aanhef 'De hypotheekgever heeft
    het onderpand:' — precies zoals de notaris de akte zelf schrijft."""
    if not percelen:
        return ["[verkrijging onderpand — invullen]"]
    meervoud_perceel = len(percelen) > 1
    posten = []
    for i, p in enumerate(percelen):
        aanduiding = f"onder {_letter(i)}. " if meervoud_perceel else ""
        verkrijgingen = p.get("verkrijgingen") or []
        if not verkrijgingen:
            posten.append(f"{aanduiding}[verkrijging — invullen]")
            continue
        for v in verkrijgingen:
            # 'deels' zodra het onderpand uit meerdere verkrijgingen is
            # opgebouwd: elke inschrijving dekt dan maar een stuk van de titel.
            deels = "deels " if len(verkrijgingen) > 1 else ""
            aandeel = _aandeel_toevoeging(v)
            kern = f"{aanduiding}{deels}verkregen"
            if aandeel:
                kern += f", {aandeel},"
            posten.append(f"{kern} {_inschrijvingszin(v)}")
    if len(posten) == 1:
        return [f"De hypotheekgever heeft het onderpand {posten[0]}."]
    return ["De hypotheekgever heeft het onderpand:"] + [
        f"- {post};" if n < len(posten) - 1 else f"- {post}."
        for n, post in enumerate(posten)
    ]


def _belast_zin(recht: dict) -> str:
    """'recht van opstal nutsvoorzieningen', maar 'zakelijk recht als bedoeld
    in ...' krijgt geen 'recht van' ervoor — dat leest anders dubbelop."""
    naam = _recht_naam(recht.get("soort"))
    if not naam:
        return ""
    return naam if re.match(r"^(zakelijk\s+)?recht\b", naam) else f"recht van {naam}"


def bouw_beperkte_rechten(percelen: list[dict]) -> list[str]:
    """De onderpandregel kondigt een 'nader te omschrijven' recht aan; hier
    staat die omschrijving. Zonder deze regels belooft de akte iets wat er niet
    in staat."""
    meervoud = len(percelen) > 1
    regels = []
    for i, p in enumerate(percelen):
        for recht in p.get("beperkte_rechten") or []:
            naam = _recht_verbatim(recht.get("soort"))
            if not naam:
                continue
            # 'op gedeelte van perceel' in de kadastrale omschrijving betekent
            # dat maar een deel van het perceel bezwaard is.
            gedeeltelijk = "gedeelte" in str(recht.get("soort") or "").lower()
            houder = recht.get("houder") or "[rechthebbende — invullen]"
            zetel = recht.get("zetel")
            regels.append(
                f"Het onderpand{f' onder {_letter(i)}.' if meervoud else ''} is "
                f"{'gedeeltelijk ' if gedeeltelijk else ''}belast met een {naam}, "
                f"ten behoeve van {houder}"
                + (f", statutair gevestigd te {zetel}" if zetel else "")
                + "."
            )
    return regels


def bouw_verkrijging_inline(percelen: list[dict]) -> str:
    """Verkrijging als één doorlopende zin, voor templates die haar midden in
    een lopende zin opnemen ('... vermelde onderpand verkreeg door: ...').
    Het ABN AMRO-model doet dat; het Rabobank-model gebruikt losse alinea's."""
    delen = []
    for i, p in enumerate(percelen):
        stukken = []
        for v in p.get("verkrijgingen") or []:
            datum = v.get("datum_woorden") or _akte_datum_woorden(
                v.get("ondertekend_op") or v.get("ingeschreven_op")
            ) or DATUM_BLANCO
            stukken.append(
                "inschrijving in de openbare registers van de Dienst voor het kadaster, op "
                f"{_akte_datum_woorden(v.get('ingeschreven_op')) or DATUM_BLANCO} in het "
                f"Register {_register_naam(v.get('register'))}, deel {v.get('deel', '')} "
                f"nummer {v.get('nummer', '')}, van een afschrift van een "
                f"{_titel_omschrijving(v)}, op {datum} verleden voor "
                f"{v.get('notaris') or NOTARIS_BLANCO}"
            )
        if not stukken:
            continue
        samen = "; vervolgens door ".join(stukken)
        delen.append(
            f"voor wat betreft het onderpand sub {_letter(i)}: {samen}"
            if len(percelen) > 1 else samen
        )
    if not delen:
        return "[verkrijging onderpand — invullen]"
    return ("; en ".join(delen) if len(delen) > 1 else delen[0]) + "."


def bouw_verkrijging_lijst(percelen: list[dict]) -> list[str]:
    """Verkrijging als opsomming, voor modellen die haar onder een inleidende
    zin zetten ('... verkreeg:'). Het a.s.r.-model doet dat; Rabobank gebruikt
    losse alinea's en ABN AMRO één doorlopende zin.

    'deels door' wanneer het onderpand uit meerdere verkrijgingen is opgebouwd,
    anders gewoon 'door'."""
    regels: list[str] = []
    for i, p in enumerate(percelen):
        verkrijgingen = p.get("verkrijgingen") or []
        meervoud_perceel = len(percelen) > 1
        for v in verkrijgingen:
            datum = v.get("datum_woorden") or _akte_datum_woorden(
                v.get("ondertekend_op") or v.get("ingeschreven_op")
            ) or DATUM_BLANCO
            aanhef = "- deels door" if len(verkrijgingen) > 1 else "- door"
            if meervoud_perceel:
                aanhef += f" — voor het onderpand onder {_letter(i)} —"
            regels.append(
                f"{aanhef} de inschrijving ten kantore van de Dienst voor het kadaster en de "
                "openbare registers, op "
                f"{_akte_datum_woorden(v.get('ingeschreven_op')) or DATUM_BLANCO} in het "
                f"Register {_register_naam(v.get('register'))}, deel {v.get('deel', '')}, "
                f"nummer {v.get('nummer', '')}, van een afschrift van een "
                f"{_titel_omschrijving(v)}, op {datum}, opgemaakt door "
                f"{v.get('notaris') or NOTARIS_BLANCO};"
            )
    if not regels:
        return ["[verkrijging onderpand — invullen]"]
    regels[-1] = regels[-1][:-1] + "."
    return regels


def bouw_voorbelasting(percelen: list[dict]) -> str:
    """Omschrijving van de bestaande inschrijvingen. Bij meerdere percelen
    wordt per perceel aangegeven waarop de inschrijving rust; percelen zonder
    inschrijving blijven ongenoemd. Geen enkele inschrijving -> lege string,
    het template kiest dan via de flags het onbezwaard-blok."""
    meervoud = len(percelen) > 1
    delen = []
    for i, p in enumerate(percelen):
        clausules = []
        for rang, v in enumerate(p.get("voorbelasting") or [], start=1):
            zin = (
                f"een {_ordinaal(rang)} ({rang}e) hypotheek en een {_ordinaal(rang)} ({rang}e) "
                f"pandrecht ten behoeve van {v.get('houder') or '[hypotheekhouder — invullen]'}"
            )
            bedrag = _parse_bedrag(v.get("bedrag"))
            if bedrag:
                euros, cents = bedrag
                zin += (
                    f", (oorspronkelijk) in hoofdsom groot {_bedrag_naar_woorden(euros, cents)} "
                    f"(€ {_format_euro(euros, cents)})"
                )
            datum = v.get("datum_woorden") or _akte_datum_woorden(
                v.get("ondertekend_op") or v.get("ingeschreven_op")
            )
            zin += ", waarvan blijkt uit een akte met hypotheekstelling"
            if datum:
                zin += f", op {datum}"
            zin += f" voor {v.get('notaris') or NOTARIS_BLANCO}, verleden"
            ingeschreven = _akte_datum_woorden(v.get("ingeschreven_op"))
            if ingeschreven:
                zin += (
                    ", van welke akte een afschrift werd ingeschreven ten kantore van de dienst "
                    f"voor het kadaster en de openbare registers op {ingeschreven}"
                )
            zin += (
                f" in het register {_register_naam(v.get('register'))}, "
                f"deel {v.get('deel', '')} nummer {v.get('nummer', '')}"
            )
            clausules.append(zin)
        if not clausules:
            continue
        samen = clausules[0] if len(clausules) == 1 else "; ".join(clausules[:-1]) + "; en " + clausules[-1]
        # De aanduiding van het perceel hoort vóór 'niet anders bezwaard dan
        # met'; die woorden staan daarom hier en niet vast in het template.
        aanhef = f"voor wat betreft het onderpand sub {_letter(i)} " if meervoud else ""
        delen.append(f"{aanhef}niet anders bezwaard dan met {samen}")
    if not delen:
        return ""
    return delen[0] if len(delen) == 1 else "; ".join(delen[:-1]) + "; en " + delen[-1]


def _laad_raw_object(raw_map: dict[str, str], tag: str) -> dict:
    """Lees een JSON-object uit een RAW-helperplaceholder en verwijder de helper."""
    ruw = raw_map.pop(tag, "")
    if not str(ruw).strip():
        return {}
    try:
        data = json.loads(ruw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


# Gangbare onverdeelde aandelen in notariële bewoordingen; bij een ongebruikelijke
# breuk valt de tekst terug op de cijfervorm.
_AANDEEL_WOORDEN = {
    "1/1": "het geheel",
    "1/2": "de onverdeelde helft",
    "1/3": "een onverdeeld derde deel",
    "2/3": "twee onverdeelde derde delen",
    "1/4": "een onverdeeld vierde deel",
    "3/4": "drie onverdeelde vierde delen",
}


def _aandeel_woorden(aandeel: str) -> str:
    sleutel = str(aandeel or "").replace(" ", "")
    if not sleutel:
        return ""
    return _AANDEEL_WOORDEN.get(sleutel, f"een onverdeeld aandeel van {sleutel}")


def bouw_beschikkingsbevoegdheid(beoordeling: dict) -> list[str]:
    """Zet het oordeel over de beschikkingsbevoegdheid om in akte-tekst.

    Sluit de eigendom niet, dan komt er géén bewering in de akte maar een
    gearceerde invulmarker: een stellige maar ongetoetste verklaring is precies
    de fout die deze controle moet voorkomen. Het huwelijk telt hier niet mee —
    dat wordt apart als aandachtspunt gemeld.
    """
    if not beoordeling:
        return []
    status = str(beoordeling.get("status") or "")
    rechthebbenden = [r for r in beoordeling.get("rechthebbenden") or [] if isinstance(r, dict)]

    if status != "rond" or not rechthebbenden:
        redenen = [str(r) for r in (beoordeling.get("redenen") or []) if str(r).strip()]
        reden = redenen[0].lower() if redenen else "eigendom niet sluitend vast te stellen"
        return [f"[beschikkingsbevoegdheid — {reden}; handmatig vaststellen]"]

    bron = "Blijkens de kadastrale eigendomsinformatie en de daarin vermelde aankomsttitel"
    if len(rechthebbenden) == 1:
        naam = str(rechthebbenden[0].get("naam") or "").strip()
        if not naam:
            return ["[beschikkingsbevoegdheid — rechthebbende onbekend; handmatig vaststellen]"]
        return [
            f"{bron} is {naam} enig rechthebbende tot het onderpand "
            "en bevoegd daarover te beschikken."
        ]

    delen = []
    for r in rechthebbenden:
        naam = str(r.get("naam") or "").strip()
        if not naam:
            continue
        aandeel = _aandeel_woorden(r.get("aandeel", ""))
        delen.append(f"{naam} voor {aandeel}" if aandeel else naam)
    if not delen:
        return ["[beschikkingsbevoegdheid — rechthebbenden onbekend; handmatig vaststellen]"]
    samen = delen[0] if len(delen) == 1 else ", ".join(delen[:-1]) + " en " + delen[-1]
    return [
        f"{bron} zijn {samen} tezamen rechthebbende tot het onderpand "
        "en bevoegd daarover te beschikken."
    ]


def replace_text_in_runs(paragraph, replacements: dict[str, str]) -> int:
    """Replace placeholders in a paragraph while preserving run formatting."""
    if not paragraph.runs:
        return 0

    original_text = "".join(run.text for run in paragraph.runs)
    updated_text = original_text

    for placeholder, value in replacements.items():
        updated_text = updated_text.replace(placeholder, value)

    if updated_text == original_text:
        return 0

    paragraph.runs[0].text = updated_text
    for run in paragraph.runs[1:]:
        run.text = ""
    return 1


def replace_in_table(table, replacements: dict[str, str]) -> int:
    count = 0
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                count += replace_text_in_runs(paragraph, replacements)
            for nested_table in cell.tables:
                count += replace_in_table(nested_table, replacements)
    return count


def _all_paragraphs(doc: Document):
    """Alle paragrafen: body, tabellen (recursief), headers en footers."""
    def walk_tables(tables):
        for t in tables:
            for row in t.rows:
                for cell in row.cells:
                    yield from cell.paragraphs
                    yield from walk_tables(cell.tables)
    yield from doc.paragraphs
    yield from walk_tables(doc.tables)
    for section in doc.sections:
        yield from section.header.paragraphs
        yield from section.footer.paragraphs


def apply_highlights(doc: Document, replacements: dict[str, str],
                     tags: tuple[str, ...] = HIGHLIGHT_TAGS + VERPLICHTE_TAGS,
                     altijd: tuple[str, ...] = HIGHLIGHT_TAGS) -> int:
    """Vervang de opgegeven placeholders door hun waarde in een GEEL GEARCEERDE
    run, terwijl de overige placeholders in dezelfde paragraaf gewoon worden
    ingevuld. Draait vóór process_document; die laat deze paragrafen daarna met
    rust (geen placeholders meer → geen run-collapse die de arcering wist).

    Werkt met runs op basis van de opmaak (rPr) van de eerste run, zodat het
    lettertype (Arial 12pt) behouden blijft."""
    if not tags:
        return 0
    split_re = re.compile("(" + "|".join(re.escape(t) for t in tags) + ")")
    tagset = set(tags)
    handled = 0
    for p in _all_paragraphs(doc):
        if not p.runs:
            continue
        full = "".join(r.text for r in p.runs)
        if not any(t in full for t in tags):
            continue
        # Overige (niet-gearceerde) placeholders alvast in de tekst invullen.
        text = full
        for k, v in replacements.items():
            if k not in tagset and k in text:
                text = text.replace(k, str(v))
        base_rpr = p.runs[0]._element.find(qn("w:rPr"))
        # Bestaande runs verwijderen, paragraaf opnieuw opbouwen.
        for r in list(p.runs):
            r._element.getparent().remove(r._element)
        for part in split_re.split(text):
            if part == "":
                continue
            if part not in tagset:
                run = p.add_run(part)
                if base_rpr is not None:
                    run._element.insert(0, copy.deepcopy(base_rpr))
                continue
            value = str(replacements.get(part, ""))
            leeg = value.strip() == ""
            # Een leeg verplicht veld mag niet spoorloos wegvallen: dan leest
            # de akte als een afgeronde zin terwijl er een gat in zit.
            if leeg:
                value = LEEG_MARKER
            run = p.add_run(value)
            if base_rpr is not None:
                run._element.insert(0, copy.deepcopy(base_rpr))
            if leeg or part in altijd:
                run.font.highlight_color = WD_COLOR_INDEX.YELLOW
        handled += 1
    return handled


def apply_literal_highlights(doc: Document) -> int:
    """Arceer literele invul-markers (huwelijksregime '[zonder/onder]' en het
    tijdstip-blanco '......') geel, waar ze ook in de definitieve tekst staan.
    Draait NA process_document. Raakt geen paragrafen die apply_highlights al
    afhandelde: die bevatten deze markers niet."""
    handled = 0
    for p in _all_paragraphs(doc):
        if not p.runs:
            continue
        full = "".join(r.text for r in p.runs)
        if not HIGHLIGHT_LITERAL_RE.search(full):
            continue
        base_rpr = p.runs[0]._element.find(qn("w:rPr"))
        for r in list(p.runs):
            r._element.getparent().remove(r._element)
        for part in HIGHLIGHT_LITERAL_RE.split(full):
            if part == "":
                continue
            run = p.add_run(part)
            if base_rpr is not None:
                run._element.insert(0, copy.deepcopy(base_rpr))
            # De opmaak van de eerste run wordt overgenomen, en die kan al geel
            # zijn van apply_highlights. Zonder deze reset kleurt de rest van de
            # zin mee en lijkt de hele alinea nog ingevuld te moeten worden.
            if HIGHLIGHT_LITERAL_RE.fullmatch(part):
                run.font.highlight_color = WD_COLOR_INDEX.YELLOW
            else:
                run.font.highlight_color = None
        handled += 1
    return handled


PREVIEW_HTML_DOC = """<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Akte-preview</title>
<style>
:root{color-scheme:light}
html,body{margin:0;background:#f3f4f6}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#1a1a1a;padding:28px 20px}
.akte{max-width:760px;margin:0 auto;background:#fff;padding:44px 52px;
  box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.06);border-radius:2px}
p{margin:0 0 7px 0;white-space:pre-wrap;word-wrap:break-word}
p.kop{font-weight:700;margin:18px 0 7px 0}
mark{background:#fde047;color:inherit;border-radius:2px;padding:0 1px}
strong{font-weight:700}
</style></head>
<body><div class="akte">
{{BODY}}
</div></body></html>
"""


def document_to_preview_html(doc: Document) -> str:
    """Render de ingevulde akte als leesbare HTML-preview. Geel gearceerde runs
    worden <mark> (zodat de nog-in-te-vullen velden ook in de preview opvallen);
    kop-paragrafen (Heading-stijlen) worden vet. De akte bestaat uit platte
    paragrafen (geen tabellen), dus een simpele <p>-render volstaat."""
    parts = []
    for p in doc.paragraphs:
        style = (p.style.name or "") if p.style is not None else ""
        is_heading = style.startswith("Heading") or style.startswith("Kop")
        chunks = []
        for r in p.runs:
            txt = html.escape(r.text or "")
            if txt == "":
                continue
            txt = txt.replace("\t", "&emsp;")
            if r.bold:
                txt = f"<strong>{txt}</strong>"
            if r.font.highlight_color == WD_COLOR_INDEX.YELLOW:
                txt = f"<mark>{txt}</mark>"
            chunks.append(txt)
        inner = "".join(chunks)
        cls = ' class="kop"' if is_heading else ""
        parts.append(f"<p{cls}>{inner if inner else '&nbsp;'}</p>")
    return PREVIEW_HTML_DOC.replace("{{BODY}}", "\n".join(parts))


def process_document(doc: Document, replacements: dict[str, str]) -> int:
    count = 0

    for paragraph in doc.paragraphs:
        count += replace_text_in_runs(paragraph, replacements)

    for table in doc.tables:
        count += replace_in_table(table, replacements)

    for section in doc.sections:
        for paragraph in section.header.paragraphs:
            count += replace_text_in_runs(paragraph, replacements)
        for paragraph in section.footer.paragraphs:
            count += replace_text_in_runs(paragraph, replacements)

        for table in section.header.tables:
            count += replace_in_table(table, replacements)
        for table in section.footer.tables:
            count += replace_in_table(table, replacements)

    return count


def _paragraph_text(paragraph_element) -> str:
    return "".join((t.text or "") for t in paragraph_element.iter(qn("w:t")))


def _strip_marker_text(paragraph_element, marker: str) -> None:
    """Remove the marker substring from a paragraph element while keeping the
    rest of the (sparse) text intact. Concentrates remaining text in the first
    <w:t> element to avoid run fragmentation."""
    t_elements = list(paragraph_element.iter(qn("w:t")))
    if not t_elements:
        return
    full_text = "".join((t.text or "") for t in t_elements)
    if marker not in full_text:
        return
    new_text = full_text.replace(marker, "")
    t_elements[0].text = new_text
    for t in t_elements[1:]:
        t.text = ""


def _remove_paragraph(paragraph_element) -> None:
    parent = paragraph_element.getparent()
    if parent is not None:
        parent.remove(paragraph_element)


def process_block(doc: Document, marker: str, block_lines: list[str]) -> int:
    """Vervang een markerparagraaf door één paragraaf per regel.

    Gebruikt voor tekstblokken die uit meerdere alinea's kunnen bestaan en pas
    bij het vullen bekend zijn: de kantoor-specifieke slottekst
    (<<SLOT_TEKST>>, uit kantoor.json) en de verkrijgingsketen
    (<<VERKRIJGING_TEKST>>, uit de kadastrale uitdraai). Elke regel krijgt de
    opmaak van de markerparagraaf (Normal-stijl, Arial 12pt). Ontbreekt de
    marker of zijn er geen regels, dan gebeurt er niets. Werkt ook in
    tabellen/headers/footers."""
    lines = [ln for ln in (block_lines or []) if str(ln).strip()]
    roots = [doc.element.body]
    for section in doc.sections:
        roots.append(section.header._element)
        roots.append(section.footer._element)

    handled = 0
    for root in roots:
        for p in list(root.iter(qn("w:p"))):
            if marker not in _paragraph_text(p):
                continue
            parent = p.getparent()
            if parent is None:
                continue
            idx = list(parent).index(p)
            for offset, line in enumerate(lines):
                new_p = copy.deepcopy(p)
                t_elements = list(new_p.iter(qn("w:t")))
                if t_elements:
                    t_elements[0].text = line
                    # forceer spatiebehoud voor nette regels
                    t_elements[0].set(qn("xml:space"), "preserve")
                    for t in t_elements[1:]:
                        t.text = ""
                parent.insert(idx + offset, new_p)
            _remove_paragraph(p)
            handled += 1
    return handled


# Blokgroepen waarvan er altijd precies één variant in de akte hoort te staan.
# Komt er geen enkele vlag binnen — bijvoorbeeld omdat n8n nog een oudere
# workflowversie draait die ze niet meestuurt — dan haalt
# process_conditional_blocks álle varianten weg en blijft er een kop over met
# niets eronder, precies daar waar een juridische verklaring hoort. Dan valt de
# groep terug op zijn 'onbekend'-variant, die zichtbaar om invulling vraagt.
BLOKGROEP_TERUGVAL = {
    ("voorbelasting_bezwaard", "voorbelasting_onbezwaard", "voorbelasting_onbekend"):
        "voorbelasting_onbekend",
    # Terugval op meervoud: 'de comparanten ... zowel samen als ieder
    # afzonderlijk' leest bij één cliënt houterig, maar sluit niemand uit. De
    # enkelvoudsvariant zou bij twee cliënten een debiteur wégschrijven.
    ("debiteur_enkelvoud", "debiteur_meervoud"): "debiteur_meervoud",
}


def verzeker_blokgroepen(flags: dict[str, bool]) -> dict[str, bool]:
    """Zet de terugvalvariant aan als geen enkele variant uit de groep actief is."""
    for groep, terugval in BLOKGROEP_TERUGVAL.items():
        if not any(flags.get(naam) for naam in groep):
            flags[terugval] = True
            print(
                f"WARN: geen enkele vlag uit {groep} ontvangen; "
                f"terugval op '{terugval}'. Draait n8n een verouderde workflow?",
                file=sys.stderr,
            )
    return flags


def split_replacements(replacements: dict[str, str]) -> tuple[dict[str, str], dict[str, bool]]:
    """Split the replacements dict into (regular placeholders, conditional flags).

    Flags use the convention ``<<#FLAG:NAME>>`` with a truthy value (``true``/``false``/etc.).
    """
    flags: dict[str, bool] = {}
    regular: dict[str, str] = {}
    for k, v in replacements.items():
        m = FLAG_KEY_RE.match(k)
        if m:
            flags[m.group(1)] = str(v).strip().lower() in TRUTHY
        else:
            regular[k] = v
    return regular, flags


def process_conditional_blocks(doc: Document, flags: dict[str, bool]) -> int:
    """Process ``<<#BEGIN:NAME>> ... <<#END:NAME>>`` block markers.

    Markers MUST sit on their own paragraph. Behaviour per pair:
      - flag truthy  -> strip both marker paragraphs, keep content between them.
      - flag falsy/absent -> remove BEGIN..END inclusive.

    Multiple BEGIN/END pairs sharing the same name are allowed and each is
    processed independently. Returns the number of BEGIN markers handled.

    Also processes paragraphs inside tables and headers/footers.
    """
    processed = 0
    # Iterate over multiple roots: body + each section's header/footer.
    roots = [doc.element.body]
    for section in doc.sections:
        roots.append(section.header._element)
        roots.append(section.footer._element)

    for root in roots:
        # Loop with safety bound; we re-scan after each block we mutate.
        for _ in range(1000):
            paragraphs = list(root.iter(qn("w:p")))

            begin_idx = -1
            block_name = ""
            for i, p in enumerate(paragraphs):
                m = BEGIN_MARKER_RE.search(_paragraph_text(p))
                if m:
                    begin_idx = i
                    block_name = m.group(1)
                    break
            if begin_idx == -1:
                break

            end_idx = -1
            for j in range(begin_idx + 1, len(paragraphs)):
                m = END_MARKER_RE.search(_paragraph_text(paragraphs[j]))
                if m and m.group(1) == block_name:
                    end_idx = j
                    break

            if end_idx == -1:
                # Orphan BEGIN: strip the marker text and continue.
                _strip_marker_text(paragraphs[begin_idx], f"<<#BEGIN:{block_name}>>")
                processed += 1
                continue

            keep = bool(flags.get(block_name, False))
            if not keep and block_name not in flags:
                # Verschil tussen 'bewust uit' en 'nooit aangeleverd' is bij het
                # opsporen van lege clausules het halve werk.
                print(
                    f"WARN: blok '{block_name}' verwijderd omdat er geen vlag voor "
                    f"is aangeleverd (niet omdat hij op false stond).",
                    file=sys.stderr,
                )
            if keep:
                # Marker paragraphs are by convention on their own line and
                # contain only the marker; remove them entirely so the
                # surrounding content keeps its natural spacing.
                begin_text = _paragraph_text(paragraphs[begin_idx]).strip()
                end_text = _paragraph_text(paragraphs[end_idx]).strip()
                if begin_text == f"<<#BEGIN:{block_name}>>":
                    _remove_paragraph(paragraphs[begin_idx])
                else:
                    _strip_marker_text(paragraphs[begin_idx], f"<<#BEGIN:{block_name}>>")
                if end_text == f"<<#END:{block_name}>>":
                    _remove_paragraph(paragraphs[end_idx])
                else:
                    _strip_marker_text(paragraphs[end_idx], f"<<#END:{block_name}>>")
            else:
                for k in range(end_idx, begin_idx - 1, -1):
                    _remove_paragraph(paragraphs[k])
            processed += 1
    return processed


def sanitize_zaaknummer(zaaknummer: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_-]", "_", zaaknummer).strip("_")
    return cleaned or "onbekend"


def _load_args_file(path: str) -> dict:
    """Lees een args-file JSON-payload en verwijder het bestand direct na inlezen.

    Bedoeld voor de --args-file flow: n8n schrijft de Python-argumenten
    naar een tijdelijk JSON-bestand zodat we geen payload-data via de shell
    hoeven te interpoleren (geen risico op shell-injection bij apostrofs of
    quotes in zaaknummer/klant/etc.). Het bestand wordt na inlezen direct
    verwijderd; eventuele unlink-fouten zijn niet fataal (best-effort cleanup).
    """
    file_path = Path(path)
    with file_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    try:
        file_path.unlink()
    except OSError:
        pass
    if not isinstance(payload, dict):
        raise SystemExit("ERROR: --args-file payload moet een JSON-object zijn.")
    return payload


def parse_args(argv: list[str]) -> tuple[Path, str, str]:
    """Parse CLI args. Ondersteunt --args-file, flag-based en legacy positional."""
    if argv and argv[0].startswith("--"):
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument(
            "--args-file",
            dest="args_file",
            default=None,
            help="Pad naar JSON-bestand met {template, placeholders, zaaknummer}. "
            "Bestand wordt na inlezen verwijderd.",
        )
        parser.add_argument(
            "--template",
            default=None,
            help="Pad naar het .docx-template (bijv. /data/shared/templates/rabobank/template_HYRABO00.docx).",
        )
        parser.add_argument(
            "--placeholders",
            default=None,
            help="JSON-object met placeholder-tags als keys en de in te vullen waarden.",
        )
        parser.add_argument(
            "--zaaknummer",
            default=None,
            help="Zaaknummer voor in de bestandsnaam van de output.",
        )
        args = parser.parse_args(argv)

        if args.args_file:
            payload = _load_args_file(args.args_file)
            template = payload.get("template")
            placeholders = payload.get("placeholders")
            zaaknummer = payload.get("zaaknummer")
            if not template or placeholders is None or zaaknummer is None:
                raise SystemExit(
                    "ERROR: --args-file payload mist 'template', 'placeholders' of 'zaaknummer'."
                )
            placeholders_raw = (
                placeholders if isinstance(placeholders, str) else json.dumps(placeholders)
            )
            return Path(template), placeholders_raw, str(zaaknummer)

        if not (args.template and args.placeholders and args.zaaknummer):
            raise SystemExit(
                "ERROR: --args-file of (--template, --placeholders, --zaaknummer) is verplicht."
            )
        return Path(args.template), args.placeholders, args.zaaknummer

    if len(argv) < 2:
        raise SystemExit(
            "ERROR: Gebruik:\n"
            "  python3 vul_template_in.py --args-file <pad-naar-json>\n"
            "  of: python3 vul_template_in.py --template <pad> --placeholders '<json>' --zaaknummer <nr>\n"
            "  of (legacy): python3 vul_template_in.py '<json>' '<zaaknummer>'"
        )
    return LEGACY_TEMPLATE_PATH, argv[0], argv[1]


def main() -> int:
    try:
        template_path, replacements_raw, zaaknummer_raw = parse_args(sys.argv[1:])
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2

    zaaknummer = sanitize_zaaknummer(zaaknummer_raw)

    try:
        replacements_json = json.loads(replacements_raw)
    except json.JSONDecodeError as exc:
        print(f"ERROR: Ongeldige JSON voor placeholders: {exc}", file=sys.stderr)
        return 2

    if not isinstance(replacements_json, dict):
        print("ERROR: Placeholder input moet een JSON object zijn.", file=sys.stderr)
        return 2

    raw_map = {str(k): str(v) for k, v in replacements_json.items()}
    raw_map = normaliseer_bedragen(raw_map)
    raw_map = normaliseer_opslagpercentage(raw_map)
    raw_map = normaliseer_geboortedata(raw_map)
    raw_map = normaliseer_aktedatum(raw_map)
    raw_map = normaliseer_kadastrale_grootte(raw_map)
    # De percelen komen als ruwe JSON-feiten uit n8n; hier worden ze
    # notariële zinnen. Onderpand en verkrijging kunnen meerdere alinea's
    # beslaan (één per perceel) en gaan via de blok-expansie, net als de
    # slottekst.
    percelen = _laad_raw_lijst(raw_map, "<<PERCELEN_RAW>>")
    raw_map["<<VOORBELASTING_OMSCHRIJVING>>"] = bouw_voorbelasting(percelen)
    onderpand_lines = bouw_onderpand(percelen)
    verkrijging_lines = bouw_verkrijging(percelen)
    beperkte_rechten_lines = bouw_beperkte_rechten(percelen)
    verkrijging_lijst_lines = bouw_verkrijging_lijst(percelen)
    # De beschikkingsbevoegdheid is in n8n deterministisch beoordeeld op
    # kadaster, BRP en aankomsttitels; hier wordt het oordeel akte-tekst.
    beschikking = _laad_raw_object(raw_map, "<<BESCHIKKINGSBEVOEGDHEID_RAW>>")
    beschikking_lines = bouw_beschikkingsbevoegdheid(beschikking)
    # Twee vormen van dezelfde feiten: het Rabobank-model neemt de verkrijging
    # als losse alinea's op, het ABN AMRO-model midden in een lopende zin. Elk
    # template gebruikt alleen de vorm die het kent.
    raw_map["<<VERKRIJGING_TITEL_1>>"] = bouw_verkrijging_inline(percelen)
    # Slottekst apart uitnemen: die wordt niet als platte string vervangen maar
    # als losse paragrafen op de <<SLOT_TEKST>>-marker geëxpandeerd.
    slot_lines = str(raw_map.pop("<<SLOT_TEKST>>", "")).split("\n")
    volmacht_lines = str(raw_map.pop("<<VOLMACHT_TEKST>>", "")).split("\n")
    replacements, flags = split_replacements(raw_map)
    flags = verzeker_blokgroepen(flags)

    if not template_path.exists():
        print(f"ERROR: Template niet gevonden: {template_path}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"hypotheekakte_{zaaknummer}.docx"

    try:
        document = Document(str(template_path))
        blocks_handled = process_conditional_blocks(document, flags)
        process_block(document, "<<SLOT_TEKST>>", slot_lines)
        process_block(document, "<<ONDERPAND_TEKST>>", onderpand_lines)
        process_block(document, "<<VERKRIJGING_TEKST>>", verkrijging_lines)
        process_block(document, "<<BEPERKTE_RECHTEN_TEKST>>", beperkte_rechten_lines)
        process_block(document, "<<VERKRIJGING_LIJST>>", verkrijging_lijst_lines)
        process_block(document, "<<VOLMACHT_TEKST>>", volmacht_lines)
        process_block(document, "<<BESCHIKKINGSBEVOEGDHEID_TEKST>>", beschikking_lines)
        apply_highlights(document, replacements)
        replaced_count = process_document(document, replacements)
        apply_literal_highlights(document)
        document.save(str(output_path))
    except Exception as exc:  # noqa: BLE001 - surfaced to n8n
        print(f"ERROR: Kon template niet verwerken: {exc}", file=sys.stderr)
        return 1

    # HTML-preview naast de .docx wegschrijven (voor inline weergave in de
    # webapp, met arceringen). Niet-fataal: mislukt dit, dan is er nog de docx.
    html_path = output_path.with_suffix(".html")
    try:
        html_path.write_text(document_to_preview_html(document), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        print(f"WARN: preview-HTML niet geschreven: {exc}", file=sys.stderr)

    print(f"SUCCESS: {output_path}")
    print(f"REPLACED_BLOCKS: {replaced_count}")
    print(f"BLOCKS_HANDLED: {blocks_handled}")
    print(f"TEMPLATE_USED: {template_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
