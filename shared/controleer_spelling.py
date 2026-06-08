#!/usr/bin/env python3
"""
Hybride spellingscontrole — stap 1 (kandidaat-detectie).

Detecteert mogelijke spelfouten in de markdown van een akte van levering met
het Nederlandse woordenboek van `pyspellchecker`. Dit script doet bewust GEEN
eindoordeel: het levert kandidaten aan die daarna door een LLM gefilterd worden
op valse positieven (juridisch jargon, eigennamen, plaatsnamen, samenstellingen).

Wordt aangeroepen door de n8n-workflow "Aktecontrole".

Usage (preferred, geen shell-interpolatie van payload-data):
  python3 /data/shared/controleer_spelling.py --args-file /tmp/n8n_args_spelling_XYZ.json
  # JSON-bestand bevat: {"akteMarkdown": "..."}
  # Het bestand wordt na inlezen verwijderd (zelfopruimend).

Flag-based (handmatig testen):
  python3 /data/shared/controleer_spelling.py --text "wat tekst met spelfouten"

Output (stdout):
  SUCCESS: [ {"woord": "...", "context": "...", "suggesties": ["...", ...]}, ... ]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

# Max aantal kandidaten dat we doorsturen naar het LLM-filter. Nederlands is sterk
# samenstellend; onbekende (maar correcte) samenstellingen kunnen de lijst opblazen.
# De cap houdt de LLM-stap snel; kandidaten mét een dichte suggestie krijgen voorrang.
MAX_CANDIDATES = 80

# Minimale woordlengte: korte tokens (af-/voorvoegsels, initialen) leveren ruis op.
MIN_WORD_LEN = 3

# Frequentiedrempel voor "sterke" samenstellingsdelen. Een onbekend woord dat
# splitst in twee delen die elk minstens zo vaak voorkomen, is vrijwel zeker een
# correcte samenstelling ('pandrechten' = pand[2580] + rechten[9399]) en geen
# typefout. Marginale delen ('hypoteek' = hypo[50] + teek[246]) halen dit niet,
# zodat zulke typo's gemeld blijven.
COMMON_PART_FREQ = 500

# Correcte vormen die het Nederlandse woordenboek niet kent maar die in
# notariële akten gewoon voorkomen: archaïsche naamvals-/datiefvormen uit vaste
# uitdrukkingen ("ten kantore van", "ten behoeve van", "te dien dage") en
# accentvormen ("één"). Deze worden nooit als kandidaat gemeld.
# Houd dit lijstje klein en alleen voor bevestigd-correcte vormen; algemeen
# notarieel jargon (comparant, voornoemde, registergoed, …) staat al in het
# woordenboek. Uitbreiden: voeg een bevestigd-correcte vorm op kleine letters toe.
NOTARIEEL_ALLOWLIST = {
    "kantore",   # ten kantore van
    "behoeve",   # ten behoeve van
    "dage",      # te dien dage / ten dage
    "één",       # nadruks-/telwoord 'één' (woordenboek mist de accentvorm)
}

# Technische ruis / bestandsextensies die als los woord in de markdown kunnen
# belanden (bijv. uit bestandsnamen). Geen Nederlandse woorden -> nooit melden.
TECH_SKIP = {"docx", "doc", "pdf", "txt", "html", "htm", "json", "xml", "csv", "xlsx"}

# Woord-token: letters (incl. Nederlandse accenttekens) met optionele koppel-/apostrof.
WORD_RE = re.compile(r"[A-Za-zÀ-ſ]+(?:[-'’][A-Za-zÀ-ſ]+)*")


def strip_markdown(text: str) -> str:
    """Verwijder de meeste markdown-ruis zodat we op lopende tekst tokeniseren."""
    t = str(text or "")
    # Code-fences en inline code volledig verwijderen (kunnen niet-NL tokens bevatten).
    t = re.sub(r"```[\s\S]*?```", " ", t)
    t = re.sub(r"`[^`]*`", " ", t)
    # Afbeeldingen weg, links -> alleen de zichtbare tekst behouden.
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    # Tabel-pipes, kop-tekens en nadruk-markers weghalen.
    t = t.replace("|", " ")
    t = re.sub(r"^[#>\s]*#+\s*", " ", t, flags=re.MULTILINE)
    t = re.sub(r"[*_~]+", " ", t)
    return t


def make_context(clean_text: str, word: str) -> str:
    """Geef een korte snippet rond het eerste voorkomen van het woord."""
    idx = clean_text.lower().find(word.lower())
    if idx < 0:
        return ""
    start = max(0, idx - 40)
    end = min(len(clean_text), idx + len(word) + 40)
    snippet = clean_text[start:end]
    snippet = re.sub(r"\s+", " ", snippet).strip()
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(clean_text) else ""
    return f"{prefix}{snippet}{suffix}"


def find_proper_nouns(clean_text: str) -> set:
    """Verzamel waarschijnlijke eigennamen op basis van hoofdlettergebruik.

    Een woord wordt als eigennaam beschouwd als het Title-Case is (Xxxxx) én
    MIDDEN in een zin voorkomt (niet direct na ., !, ?, : of een regeleinde).
    Plaats-, straat- en persoonsnamen die het woordenboek niet kent ('Altena',
    'Paddemoes') worden zo herkend en niet als spelfout gemeld.

    Bewust alleen midden-in-de-zin: aan zinsbegin krijgt elk woord een hoofdletter,
    dus daar zou een echte typefout ('Hypoteek' aan het begin) ten onrechte als
    eigennaam wegvallen. Zulke woorden blijven we dus gewoon controleren.
    """
    proper: set = set()
    sentence_boundary = set(".!?:;\n\r")
    for m in WORD_RE.finditer(clean_text):
        tok = m.group(0)
        if len(tok) < 2 or not (tok[0].isupper() and tok[1:].islower()):
            continue
        j = m.start() - 1
        while j >= 0 and clean_text[j] in " \t":
            j -= 1
        if j < 0:
            continue  # tekstbegin -> onzeker, niet markeren
        if clean_text[j] in sentence_boundary:
            continue  # zinsbegin -> onzeker, niet markeren
        proper.add(tok.lower())
    return proper


def deaccent(s: str) -> str:
    """Verwijder diakritische tekens (é -> e, ó -> o)."""
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def is_accent_variant(word: str, spell) -> bool:
    """True als het woord zonder accenten een bekend woord is.

    Correcte accentvormen ('één' -> 'een', 'vóór' -> 'voor', 'géén' -> 'geen')
    staan vaak niet los in het woordenboek. Is de vorm zónder diakrieten wél
    bekend, dan is het woord correct en melden we het niet.
    """
    da = deaccent(word)
    return da != word and bool(spell.known([da]))


def has_close_correction(word: str, spell) -> bool:
    """True als er een bekend woord op edit-distance 1 van `word` bestaat.

    Een echte typefout ligt vrijwel altijd 1 bewerking van het bedoelde woord
    ('hypoteek' -> 'hypotheek'). Dit signaal gebruiken we om typo's te beschermen
    tegen de samenstellings-heuristiek hieronder.
    """
    near = spell.known(spell.edit_distance_1(word))
    near.discard(word)
    return len(near) > 0


def is_valid_compound(word: str, spell, min_part: int = 3, min_freq: int = 0) -> bool:
    """True als het woord opsplitst in twee bekende delen (Nederlandse samenstelling).

    Het NL-woordenboek kent lang niet alle samenstellingen ('regresvorderingen',
    'pandrechten') of hun meervouden, terwijl ze correct zijn. Splitst het woord in
    twee bekende delen (met optionele tussen-s, bijv. eigendom+s+overdracht), dan
    beschouwen we het als correct. Beide delen moeten minstens `min_part` tekens zijn.

    `min_freq`: eis dat beide delen minstens deze frequentie hebben. Met een drempel
    (zie COMMON_PART_FREQ) onderscheiden we "sterke" samenstellingen van frequente
    woorden ('pandrechten') van typo's die toevallig in twee marginale woorden
    splitsen ('hypoteek' = hypo+teek). Met min_freq=0 telt elke bekende splitsing.
    """
    w = word.lower()
    n = len(w)
    if n < min_part * 2:
        return False

    def ok(part: str) -> bool:
        return bool(spell.known([part])) and spell[part] >= min_freq

    for i in range(min_part, n - min_part + 1):
        left, right = w[:i], w[i:]
        if ok(left) and ok(right):
            return True
        # Tussen-s: eigendom(s) + overdracht
        if left.endswith("s") and len(left) - 1 >= min_part and ok(left[:-1]) and ok(right):
            return True
    return False


def is_candidate_token(tok: str) -> bool:
    if len(tok) < MIN_WORD_LEN:
        return False
    if any(ch.isdigit() for ch in tok):
        return False
    # ALL-CAPS is vaak een kop, afkorting of acroniem (BW, KIK, NTI) -> overslaan.
    letters = [c for c in tok if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        return False
    return True


def detecteer(markdown: str) -> list[dict]:
    try:
        from spellchecker import SpellChecker
    except ImportError as exc:  # pragma: no cover - duidelijke foutmelding voor n8n
        raise SystemExit(
            "ERROR: pyspellchecker ontbreekt. Voeg 'pyspellchecker' toe aan de "
            f"n8n-image (n8n/Dockerfile) en herbouw. Detail: {exc}"
        )

    spell = SpellChecker(language="nl")

    clean = strip_markdown(markdown)
    tokens = WORD_RE.findall(clean)
    proper_nouns = find_proper_nouns(clean)

    # Dedupliceer op kleine letters, behoud eerste schrijfwijze + volgorde.
    seen: set[str] = set()
    ordered: list[str] = []
    for tok in tokens:
        if not is_candidate_token(tok):
            continue
        low = tok.lower()
        if low in NOTARIEEL_ALLOWLIST or low in TECH_SKIP or low in proper_nouns:
            continue
        if low in seen:
            continue
        seen.add(low)
        ordered.append(tok)

    unknown = spell.unknown([w.lower() for w in ordered])

    kandidaten: list[dict] = []
    for tok in ordered:
        low = tok.lower()
        if low not in unknown:
            continue
        # Correcte accentvorm ('vóór' -> 'voor') -> geen kandidaat.
        if is_accent_variant(low, spell):
            continue
        # Correcte, maar onbekende Nederlandse samenstelling overslaan als:
        #  - beide delen frequent zijn (sterke samenstelling, bijv. 'pandrechten'),
        #    óók als er een nabije woordenboek-buur bestaat ('landrechten'); of
        #  - er GÉÉN nabije enkel-woord-correctie is ('regresvorderingen').
        # Typo's die in twee marginale woorden splitsen ('hypoteek' = hypo+teek)
        # halen geen van beide en blijven dus gemeld.
        if is_valid_compound(low, spell, min_freq=COMMON_PART_FREQ) or (
            not has_close_correction(low, spell) and is_valid_compound(low, spell)
        ):
            continue
        cand = spell.candidates(low) or set()
        suggesties = [s for s in cand if s != tok.lower()][:3]
        kandidaten.append(
            {
                "woord": tok,
                "context": make_context(clean, tok),
                "suggesties": suggesties,
                "_heeft_suggestie": bool(suggesties),
            }
        )

    # Kandidaten mét een dichte suggestie eerst (waarschijnlijker een echte typo),
    # daarna afkappen op de cap.
    kandidaten.sort(key=lambda c: 0 if c["_heeft_suggestie"] else 1)
    kandidaten = kandidaten[:MAX_CANDIDATES]
    for c in kandidaten:
        c.pop("_heeft_suggestie", None)
    return kandidaten


def _load_args_file(path: str) -> dict:
    """Lees args-file JSON-payload en verwijder het bestand direct na inlezen."""
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
        default=None,
        help="Pad naar JSON-bestand met {akteMarkdown}. Wordt na inlezen verwijderd.",
    )
    parser.add_argument("--text", default=None, help="Tekst om direct te controleren (testen).")
    args = parser.parse_args()

    if args.args_file:
        payload = _load_args_file(args.args_file)
        markdown = str(payload.get("akteMarkdown") or payload.get("markdown") or "")
    elif args.text is not None:
        markdown = args.text
    else:
        print("ERROR: --args-file of --text is verplicht.", file=sys.stderr)
        return 1

    if not markdown.strip():
        # Geen tekst -> lege kandidatenlijst (geen fout).
        print("SUCCESS: []")
        return 0

    kandidaten = detecteer(markdown)
    print("SUCCESS: " + json.dumps(kandidaten, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
