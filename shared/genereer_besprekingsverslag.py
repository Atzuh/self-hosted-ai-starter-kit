#!/usr/bin/env python3
"""
Genereer een besprekingsverslag als .docx vanuit een JSON-payload. Wordt door de
n8n-workflow 'Bespreking naar verslag' aangeroepen nadat Whisper het transcript
heeft gemaakt en de LLM het verslag heeft gestructureerd.

Usage (preferred, geen shell-interpolatie van payload-data):
  python3 /data/shared/genereer_besprekingsverslag.py \
    --args-file /tmp/n8n_args_bespreking_XYZ.json
  # JSON-bestand bevat: {"verslag": {...}, "referentie": "...", "metadata": {...},
  #                      "transcript": "..."}
  # Het bestand wordt na inlezen verwijderd (zelfopruimend).

Output: /data/shared/output/besprekingsverslag_<referentie>.docx

Het transcript gaat als bijlage mee in het document. Dat is bewust: de notaris
moet elke samenvattingsregel kunnen terugleiden naar wat er daadwerkelijk is
gezegd — de LLM-samenvatting is hulpmiddel, niet bron.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor, Cm

OUTPUT_DIR = Path("/data/shared/output")

DEFAULT_FONT = "Calibri"
HEADING_COLOR = RGBColor(0x00, 0x00, 0x00)
INK_COLOR = RGBColor(0x4C, 0x48, 0x48)
META_COLOR = RGBColor(0x73, 0x73, 0x73)
ACCENT_COLOR = RGBColor(0x09, 0x5A, 0xA5)


def _set_run(run, *, bold=False, size=11, color=INK_COLOR, italic=False) -> None:
    run.bold = bold
    run.italic = italic
    run.font.name = DEFAULT_FONT
    run.font.size = Pt(size)
    run.font.color.rgb = color


def _add_paragraph(doc: Document, text: str, *, bold=False, size=11,
                   color=INK_COLOR, italic=False, align=None,
                   space_after=4, style=None) -> None:
    p = doc.add_paragraph(style=style)
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    run = p.add_run(text)
    _set_run(run, bold=bold, size=size, color=color, italic=italic)


def _add_heading(doc: Document, text: str, *, level: int = 1) -> None:
    sizes = {1: 18, 2: 13, 3: 11}
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10 if level > 1 else 0)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text)
    _set_run(run, bold=True, size=sizes.get(level, 11), color=HEADING_COLOR)


def _add_bullet(doc: Document, text: str, *, size=11, suffix: str = "") -> None:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(text)
    _set_run(run, size=size)
    if suffix:
        _set_run(p.add_run(suffix), size=size - 1, color=META_COLOR, italic=True)


def _sanitize(name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_-]", "_", name).strip("_")
    return cleaned or "onbekend"


def _as_list(value) -> list:
    """Normaliseer LLM-output naar een lijst strings/dicts.

    De LLM levert bij lege secties nu eens `null`, dan weer `""` of een enkele
    string in plaats van een array; dat mag het document niet laten omvallen.
    """
    if not value:
        return []
    if isinstance(value, list):
        return [v for v in value if v]
    return [value]


def _duur_label(seconden) -> str:
    try:
        total = int(float(seconden))
    except (TypeError, ValueError):
        return ""
    if total <= 0:
        return ""
    minuten, sec = divmod(total, 60)
    uren, minuten = divmod(minuten, 60)
    if uren:
        return f"{uren} u {minuten} min"
    if minuten:
        return f"{minuten} min {sec} s"
    return f"{sec} s"


def render_docx(verslag: dict, *, referentie: str, metadata: dict,
                transcript: str) -> Path:
    titel = str(verslag.get("titel") or "").strip() or "Besprekingsverslag"
    samenvatting = str(verslag.get("samenvatting") or "").strip()
    deelnemers = _as_list(verslag.get("deelnemers"))
    waarnemingen = _as_list(verslag.get("waarnemingen"))
    onderwerpen = _as_list(verslag.get("onderwerpen"))
    afspraken = _as_list(verslag.get("afspraken"))
    open_vragen = _as_list(verslag.get("open_vragen"))

    doc = Document()
    for section in doc.sections:
        section.top_margin = Cm(2.0)
        section.bottom_margin = Cm(2.0)
        section.left_margin = Cm(2.2)
        section.right_margin = Cm(2.2)

    _add_paragraph(doc, "BESPREKINGSVERSLAG", bold=True, size=9,
                   color=META_COLOR, space_after=2)
    _add_heading(doc, titel, level=1)

    meta_p = doc.add_paragraph()
    meta_p.paragraph_format.space_after = Pt(10)
    bits = [
        ("Dossier", str(metadata.get("dossier") or "—")),
        ("Datum", str(metadata.get("datum") or datetime.now().strftime("%d-%m-%Y"))),
    ]
    duur = _duur_label(metadata.get("duur_seconden"))
    if duur:
        bits.append(("Duur", duur))
    bits.append(("Gegenereerd", datetime.now().strftime("%d-%m-%Y %H:%M")))
    for i, (label, val) in enumerate(bits):
        if i:
            sep = meta_p.add_run("   ·   ")
            _set_run(sep, size=10, color=META_COLOR)
        lr = meta_p.add_run(f"{label}: ")
        _set_run(lr, bold=True, size=10, color=META_COLOR)
        vr = meta_p.add_run(val)
        _set_run(vr, size=10, color=INK_COLOR)

    if deelnemers:
        _add_heading(doc, "Aanwezig", level=2)
        for d in deelnemers:
            _add_bullet(doc, str(d))

    # Waarnemingen van de behandelaar: dingen die je niet uit de opname kunt
    # horen — dat mevrouw slecht ter been was, dat de heer vrijwel het hele
    # gesprek voerde. Ze staan hier letterlijk zoals ze zijn ingevoerd; het model
    # komt er niet aan. Bewust vóór de samenvatting: wie het verslag later leest,
    # moet weten hoe het gesprek verliep voordat hij de inhoud tot zich neemt.
    if waarnemingen:
        _add_heading(doc, "Waarnemingen behandelaar", level=2)
        _add_paragraph(
            doc,
            "Genoteerd door de behandelaar zelf; niet afkomstig uit de opname.",
            italic=True, size=9, color=META_COLOR, space_after=4,
        )
        for w in waarnemingen:
            _add_bullet(doc, str(w))

    _add_heading(doc, "Samenvatting", level=2)
    if samenvatting:
        _add_paragraph(doc, samenvatting, space_after=6)
    else:
        _add_paragraph(doc, "Geen samenvatting beschikbaar.", italic=True,
                       color=META_COLOR, space_after=6)

    if onderwerpen:
        _add_heading(doc, "Besproken", level=2)
        for onderwerp in onderwerpen:
            if isinstance(onderwerp, dict):
                kop = str(onderwerp.get("kop") or onderwerp.get("titel") or "").strip()
                punten = _as_list(onderwerp.get("punten") or onderwerp.get("inhoud"))
                # Punten die de behandelaar na de automatische verwerking zelf
                # heeft toegevoegd, omdat het onderwerp wél is besproken maar
                # niet uit het transcript kwam. Ze staan apart zodat in het
                # document zichtbaar blijft wat uit de opname komt en wat niet;
                # de behandelaar tekent voor het geheel, maar bij een
                # dossierstuk hoort die herkomst controleerbaar te zijn.
                aangevuld = _as_list(onderwerp.get("aangevuld"))
                if kop:
                    _add_heading(doc, kop, level=3)
                for punt in punten:
                    _add_bullet(doc, str(punt))
                for punt in aangevuld:
                    _add_bullet(doc, str(punt), suffix="  (aangevuld door de behandelaar)")
                # Bij een vaste indeling (testament, levenstestament) blijven
                # kopjes staan waar niets onder kwam. Dat is geen ruis maar
                # informatie: het laat zien wat nog open staat.
                #
                # Bewust "niet vastgelegd" en niet "niet besproken": de extractie
                # mist er wel eens een, en dan zou het document beweren dat een
                # onderwerp niet aan de orde kwam terwijl dat wel zo was. Dit
                # zegt alleen iets over het verslag, niet over de bespreking.
                if not punten and not aangevuld:
                    # `ter_sprake` betekent: het trefwoord van dit kopje valt wél
                    # in het transcript, maar er is geen inhoud uit gekomen.
                    # Vaak gaat het dan om een onderwerp waar juist van is
                    # afgezien. Dat expliciet melden is bruikbaarder dan het
                    # kopje laten lezen alsof het nooit langskwam.
                    woord = onderwerp.get("ter_sprake")
                    tekst = (
                        f"Kwam ter sprake (\u201c{woord}\u201d), geen uitkomst "
                        "vastgelegd — controleer het transcript."
                        if woord
                        else "Niet vastgelegd."
                    )
                    _add_paragraph(
                        doc,
                        tekst,
                        italic=True,
                        size=10,
                        color=META_COLOR,
                        space_after=2,
                    )
            else:
                _add_bullet(doc, str(onderwerp))

    if afspraken:
        _add_heading(doc, "Gemaakte afspraken", level=2)
        for a in afspraken:
            _add_bullet(doc, str(a))

    if open_vragen:
        _add_heading(doc, "Open vragen", level=2)
        for vraag in open_vragen:
            _add_bullet(doc, str(vraag))

    footer_p = doc.add_paragraph()
    footer_p.paragraph_format.space_before = Pt(16)
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = footer_p.add_run(
        "Dit verslag is automatisch samengesteld uit een spraakopname en dient "
        "ter ondersteuning. Controleer het tegen het transcript in de bijlage; "
        "de behandelaar blijft verantwoordelijk voor de vastlegging."
    )
    _set_run(fr, italic=True, size=9, color=META_COLOR)

    if transcript.strip():
        doc.add_page_break()
        _add_paragraph(doc, "BIJLAGE", bold=True, size=9, color=META_COLOR,
                       space_after=2)
        _add_heading(doc, "Transcript", level=1)
        _add_paragraph(
            doc,
            "Automatische transcriptie (Whisper large-v3-turbo, lokaal). "
            "Ongecorrigeerd — namen en bedragen kunnen afwijken.",
            italic=True, size=9, color=META_COLOR, space_after=8,
        )
        # Whisper levert één lange regel; splitsen op zinseinde houdt het
        # document leesbaar zonder de tekst inhoudelijk aan te raken.
        for alinea in re.split(r"\n{2,}", transcript.strip()):
            regel = " ".join(alinea.split())
            if regel:
                _add_paragraph(doc, regel, size=10, space_after=6)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"besprekingsverslag_{_sanitize(referentie)}.docx"
    doc.save(str(out_path))
    return out_path


def _load_args_file(path: str) -> dict:
    """Lees args-file JSON-payload en verwijder het bestand direct na inlezen.

    Zelfde patroon als genereer_juridische_analyse.py: n8n schrijft de argumenten
    naar een tijdelijk bestand zodat transcript-tekst nooit door de shell gaat.
    Voor besprekingen weegt dat extra: het transcript bevat cliëntgegevens en
    hoort niet in een proceslijst of shell-history terecht te komen.
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--args-file",
        dest="args_file",
        required=True,
        help="Pad naar JSON-bestand met {verslag, referentie, metadata, "
        "transcript}. Bestand wordt na inlezen verwijderd.",
    )
    args = parser.parse_args()

    payload = _load_args_file(args.args_file)

    verslag = payload.get("verslag")
    if isinstance(verslag, str):
        try:
            verslag = json.loads(verslag)
        except json.JSONDecodeError as exc:
            print(f"ERROR: Ongeldige JSON voor verslag: {exc}", file=sys.stderr)
            return 2
    if not isinstance(verslag, dict):
        print("ERROR: 'verslag' moet een JSON-object zijn.", file=sys.stderr)
        return 2

    referentie = str(payload.get("referentie") or datetime.now().strftime("%Y%m%d_%H%M%S"))
    metadata = payload.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    transcript = str(payload.get("transcript") or "")

    try:
        out_path = render_docx(
            verslag,
            referentie=referentie,
            metadata=metadata,
            transcript=transcript,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Kon besprekingsverslag niet genereren: {exc}", file=sys.stderr)
        return 1

    print(f"SUCCESS: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
