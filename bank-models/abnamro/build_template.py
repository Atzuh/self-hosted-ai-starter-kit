#!/usr/bin/env python3
"""Bouw het Scriptor-template voor de ABN AMRO Bank Hypotheek (HYSTAA00).

Vertrekpunt is het door KNB gepubliceerde modelakte (Word .doc/.docx). Dit
script:

  1. Vervangt elk ``MacroButton Nomacro §`` door een Scriptor-placeholder
     (``<<TAG>>``) of een conditioneel-blok-marker (``<<#BEGIN:NAAM>>`` /
     ``<<#END:NAAM>>``).
  2. Voegt een tweede comparant-blok toe (conditioneel op ``client_2``).
  3. Voegt een ontbrekende ``<<#BEGIN:overbrugging>>`` in vóór de
     eigendoms­verkrijging-sectie van de overbruggingshypotheek (de KNB-akte
     mist daar zelf de openings-marker).

Run:

    python3 bank-models/abnamro/build_template.py \\
        --input  bank-models/abnamro/HYSTAA00_AAB18-01.docx \\
        --output shared/templates/abnamro/template_HYSTAA00.docx
"""

from __future__ import annotations

import argparse
import sys
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

MACRO = "MacroButton Nomacro §"


# ---- helpers ----------------------------------------------------------------


XML_SPACE_PRESERVE = "{http://www.w3.org/XML/1998/namespace}space"


def _gather_paragraph_text(p) -> str:
    """Reconstrueer de paragraaf-tekst incl. tabs (`<w:tab/>` → ``\\t``).

    De volgorde van text-elementen volgt de XML-volgorde (depth-first), zodat
    de gereconstrueerde string overeenkomt met wat Word toont.
    """
    chunks: list[str] = []
    for el in p._p.iter():
        tag = el.tag
        if tag == qn("w:t"):
            chunks.append(el.text or "")
        elif tag == qn("w:tab"):
            chunks.append("\t")
        elif tag == qn("w:br"):
            chunks.append("\n")
    return "".join(chunks)


def _rebuild_paragraph(p, new_text: str) -> None:
    """Vervang alle inhoud van de paragraaf door één run met ``new_text``.

    Behoudt de paragraaf-eigenschappen (``w:pPr``) en geeft de run een eenvoudige
    standaard-styling mee zodat de tekst in dezelfde basis-stijl weergegeven
    wordt. Tab-tekens (``\\t``) worden omgezet naar ``<w:tab/>`` elementen.
    """
    p_el = p._p
    for child in list(p_el):
        if child.tag != qn("w:pPr"):
            p_el.remove(child)

    r = etree.SubElement(p_el, qn("w:r"))

    # Splits op tab-tekens; tussen segmenten een <w:tab/> invoegen.
    segments = new_text.split("\t")
    for i, segment in enumerate(segments):
        if i > 0:
            etree.SubElement(r, qn("w:tab"))
        if segment:
            t = etree.SubElement(r, qn("w:t"))
            t.set(XML_SPACE_PRESERVE, "preserve")
            t.text = segment


def _set_paragraph_text(p, new_text: str) -> None:
    _rebuild_paragraph(p, new_text)


def _replace_macros_in_order(p, replacements: list[str]) -> None:
    """Vervang ``MacroButton Nomacro §`` voorkomens in volgorde, één per één.

    Behoudt tabs in de bron-paragraaf door eerst de volledige tekst (inclusief
    ``\\t`` voor ``<w:tab/>``) op te bouwen, daarna de placeholders in te vullen
    en als slotstuk de paragraaf op te bouwen uit één schone run.
    """
    text = _gather_paragraph_text(p)
    if MACRO not in text:
        return
    parts = text.split(MACRO)
    new_text = parts[0]
    for i, suffix in enumerate(parts[1:]):
        repl = replacements[i] if i < len(replacements) else ""
        new_text += repl + suffix
    _rebuild_paragraph(p, new_text)


def _insert_paragraphs_after(reference_p, texts: list[str]):
    """Voeg lege paragrafen met simpele tekst toe ná `reference_p`.

    Elke nieuwe paragraaf erft de basis-styling van de referentie­paragraaf
    (door een diepe kopie te maken en de inhoud te vervangen).
    """
    new_paragraphs = []
    anchor = reference_p._p
    for text in texts:
        new_p = deepcopy(reference_p._p)
        # Verwijder bestaande inhoud (runs), houd paragraaf-properties (pPr).
        for child in list(new_p):
            if child.tag != qn("w:pPr"):
                new_p.remove(child)
        r = etree.SubElement(new_p, qn("w:r"))
        t = etree.SubElement(r, qn("w:t"))
        t.text = text
        anchor.addnext(new_p)
        anchor = new_p
        new_paragraphs.append(new_p)
    return new_paragraphs


def _insert_paragraph_before(reference_p, text: str):
    new_p = deepcopy(reference_p._p)
    for child in list(new_p):
        if child.tag != qn("w:pPr"):
            new_p.remove(child)
    r = etree.SubElement(new_p, qn("w:r"))
    t = etree.SubElement(r, qn("w:t"))
    t.text = text
    reference_p._p.addprevious(new_p)
    return new_p


# ---- replacement plan -------------------------------------------------------

# Voor paragrafen die alléén een marker (of marker + ruis) bevatten en die we
# integraal willen vervangen door één Scriptor-placeholder of blok-marker.
ONDERPAND_BLOK_TEKST = (
    "de woning met ondergrond, erf, tuin en verder aanhorigheden, "
    "plaatselijk bekend <<ONDERPAND_STRAAT>> <<ONDERPAND_HUISNUMMER>>, "
    "<<ONDERPAND_POSTCODE>> <<ONDERPAND_WOONPLAATS>>, "
    "kadastraal bekend gemeente <<KAD_GEMEENTE>>, "
    "sectie <<KAD_SECTIE>>, nummer <<KAD_NUMMER>>, "
    "groot <<KAD_GROOTTE_WOORDEN>>."
)

WHOLE_PARAGRAPH = {
    37: ONDERPAND_BLOK_TEKST,
    39: "<<#BEGIN:overbrugging>>",
    42: "<<ONDERPAND_OVERBRUGGING_BLOK>>",
    43: "<<#END:overbrugging>>",
    70: "<<#END:overbrugging>>",
    75: "<<#BEGIN:verpanding_verzekering>>",
    93: "<<#END:verpanding_verzekering>>",
    94: "<<#BEGIN:verpanding_belegging>>",
    97: "<<#END:verpanding_belegging>>",
    98: "<<#BEGIN:verpanding_spaarrekening>>",
    101: "<<#END:verpanding_spaarrekening>>",
    102: "<<#BEGIN:verpanding_aflossing>>",
    105: "<<#END:verpanding_aflossing>>",
    121: "<<#BEGIN:levensverzekering>>",
    125: "<<#END:levensverzekering>>",
    126: "<<#BEGIN:nhg>>",
    130: "<<#END:nhg>>",
    131: "<<#BEGIN:overheidsbijdrage>>",
    135: "<<#END:overheidsbijdrage>>",
}

# Voor paragrafen met meerdere ``MacroButton Nomacro §``-voorkomens; de lijst is
# de in-volgorde-vervanging per voorkomen.
INLINE_REPLACEMENTS = {
    6: ["<<OFFERTENUMMER>>"],
    8: ["<<AKTE_DATUM>>", "<<NOTARIS_NAAM>>", "<<NOTARIS_STANDPLAATS>>"],
    9: ["<<BANK_VOLMACHTHOUDER>>"],
    15: ["<<HOOFDSOM_CIJFER>>"],
    18: [""],  # vrije aanvullende clausule — leeg laten in MVP
    32: ["<<INSCHRIJVINGSBEDRAG_CIJFER>>"],
    33: ["<<OPSLAG_CIJFER>>", "<<TOTAAL_HYPOTHEEK_CIJFER>>"],
    35: [""],  # specificatie meerdere onderpanden — leeg in MVP
    36: ["<<TYPE_HYPOTHEEK_1>>"],
    41: ["<<TYPE_HYPOTHEEK_OVERBRUGGING>>"],
    61: ["<<VERKRIJGING_TITEL_1>>"],
    69: ["<<VERKRIJGING_TITEL_OVERBRUGGING>>"],
    96: ["<<BELEGGINGSREKENING_NUMMER>>", "<<BELEGGINGSREKENING_INSTELLING>>"],
    100: ["<<SPAARREKENING_NUMMER>>"],
    104: ["<<AFLOSSINGSREKENING_NUMMER>>"],
    122: ["<<VERZEKERAAR_NAAM>>"],
    123: ["<<POLISNUMMER>>"],
    141: ["<<AKTE_PLAATS>>"],
    143: ["<<AKTE_TIJDSTIP>>"],
}

# Paragrafen die we op een aangepaste manier herschrijven (geen 1-op-1 vertaling
# van MacroButtons).
SCHULDENAAR_1_TEXT = (
    "2.\t<<NAAM_1_HOOFDLETTERS>> (<<VOORNAMEN_1>>), geboren te "
    "<<GEBOORTEPLAATS_1>> op <<GEBOORTEDAG_1_WOORDEN>> "
    "<<GEBOORTEMAAND_1_WOORDEN>> <<GEBOORTEJAAR_1_WOORDEN>>,"
)
SCHULDENAAR_2_TEXT = (
    "<<NAAM_2_HOOFDLETTERS>> (<<VOORNAMEN_2>>), geboren te "
    "<<GEBOORTEPLAATS_2>> op <<GEBOORTEDAG_2_WOORDEN>> "
    "<<GEBOORTEMAAND_2_WOORDEN>> <<GEBOORTEJAAR_2_WOORDEN>>,"
)

# Schone vervanging voor de slot-paragraaf [142] (de KNB-versie zit vol met
# OPTIE-keuzemarkers die niet horen in de uiteindelijke akte).
SLOT_PARAGRAAF_142 = (
    "De comparanten zijn mij, notaris, bekend. De zakelijke inhoud van de "
    "akte is aan hen opgegeven en toegelicht. De comparanten hebben verklaard "
    "op volledige voorlezing van de akte geen prijs te stellen, tijdig voor "
    "het verlijden van de inhoud van de akte te hebben kennis genomen."
)


# ---- main -------------------------------------------------------------------


def build(input_path: Path, output_path: Path) -> None:
    if not input_path.exists():
        raise SystemExit(f"Bron-model niet gevonden: {input_path}")

    doc = Document(str(input_path))
    paragraphs = list(doc.paragraphs)

    # Sanity check: het ABN AMRO-model heeft minstens 144 paragrafen.
    if len(paragraphs) < 144:
        raise SystemExit(
            f"Verwacht ten minste 144 paragrafen in het bron-model, "
            f"maar vond er {len(paragraphs)}. Is het juiste KNB-model gebruikt?"
        )

    # 1) Inline + whole-paragraph replacements.
    for idx, repl in WHOLE_PARAGRAPH.items():
        _set_paragraph_text(paragraphs[idx], repl)

    for idx, repls in INLINE_REPLACEMENTS.items():
        _replace_macros_in_order(paragraphs[idx], repls)

    # 2) Schuldenaar-blok: paragraaf [010] herschrijven + tweede client-blok
    # invoegen daarná. Inserties moeten gebeuren ná de andere paragraaf-edits
    # zodat indices stabiel blijven.
    _set_paragraph_text(paragraphs[10], SCHULDENAAR_1_TEXT)

    # 3) Slot-paragraaf [142] schoonmaken.
    _set_paragraph_text(paragraphs[142], SLOT_PARAGRAAF_142)

    # 4) Insert <<#BEGIN:overbrugging>> vóór paragraaf [062]. De KNB-akte mist
    # de openings-marker voor de eigendoms­verkrijging-sectie van de
    # overbruggingshypotheek. We voegen er één in.
    _insert_paragraph_before(paragraphs[62], "<<#BEGIN:overbrugging>>")

    # 5) Insert client_2-blok ná paragraaf [010].
    _insert_paragraphs_after(
        paragraphs[10],
        [
            "<<#BEGIN:client_2>>",
            SCHULDENAAR_2_TEXT,
            "<<#END:client_2>>",
        ],
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(output_path))
    print(f"OK: geschreven naar {output_path}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    build(args.input, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
