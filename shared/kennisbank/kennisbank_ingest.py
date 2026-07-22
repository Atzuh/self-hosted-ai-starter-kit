#!/usr/bin/env python3
"""
Indexeer de juridische bronnen uit shared/kennisbank/bronnen/ in Qdrant.

Elke bron is een markdown-bestand met frontmatter:

    ---
    titel: Toestemming echtgenoot (art. 1:88 BW)
    bron: Burgerlijk Wetboek Boek 1
    artikel: "1:88"
    url: https://wetten.overheid.nl/...
    ---
    <tekst van de bron>

Gebruik:
    python3 kennisbank_ingest.py                 # indexeer (collectie zo nodig aanmaken)
    python3 kennisbank_ingest.py --recreate      # collectie eerst leeggooien
    python3 kennisbank_ingest.py --dir <map>      # andere bronnenmap
"""

import argparse
import os
import sys
import uuid

import kb_common as kb

# Vaste namespace zodat een her-ingest van hetzelfde bestand+chunk dezelfde
# point-id oplevert (idempotent upsert i.p.v. duplicaten).
NAMESPACE = uuid.UUID("6f9b2c1e-1a2b-4c3d-8e4f-000000000001")

MAX_CHARS = 1200   # ~300-400 tokens per chunk
OVERLAP_PARAS = 0  # juridische artikelen zijn kort; pack per alinea


def parse_frontmatter(text):
    """Splits '---'-frontmatter (key: value) van de body. Retourneert (meta, body)."""
    meta = {}
    body = text
    if text.lstrip().startswith("---"):
        stripped = text.lstrip()
        end = stripped.find("\n---", 3)
        if end != -1:
            fm = stripped[3:end].strip()
            body = stripped[end + 4:].lstrip("\n")
            for line in fm.splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, body


def chunk_body(body):
    """Pak alinea's samen tot chunks van ~MAX_CHARS tekens."""
    paras = [p.strip() for p in body.split("\n\n") if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        if cur and len(cur) + len(p) + 2 > MAX_CHARS:
            chunks.append(cur.strip())
            cur = p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "bronnen"))
    ap.add_argument("--recreate", action="store_true")
    args = ap.parse_args()

    kb.ensure_collection(recreate=args.recreate)
    print(f"Collectie '{kb.COLLECTION}' gereed op {kb.QDRANT_URL}")

    if not os.path.isdir(args.dir):
        sys.exit(f"Bronnenmap niet gevonden: {args.dir}")

    files = sorted(f for f in os.listdir(args.dir) if f.endswith(".md"))
    if not files:
        sys.exit(f"Geen .md-bronnen in {args.dir}")

    points = []
    for fname in files:
        with open(os.path.join(args.dir, fname), encoding="utf-8") as fh:
            meta, body = parse_frontmatter(fh.read())
        chunks = chunk_body(body)
        for idx, chunk in enumerate(chunks):
            # Titel + artikel meenemen ín de embed-tekst verbetert de match.
            embed_text = f"{meta.get('titel', '')}\n{chunk}".strip()
            vector = kb.embed(embed_text)
            point_id = str(uuid.uuid5(NAMESPACE, f"{fname}#{idx}"))
            points.append({
                "id": point_id,
                "vector": vector,
                "payload": {
                    "titel": meta.get("titel", fname),
                    "bron": meta.get("bron", ""),
                    "artikel": meta.get("artikel", ""),
                    "url": meta.get("url", ""),
                    "bestand": fname,
                    "chunk": idx,
                    "tekst": chunk,
                },
            })
        print(f"  {fname}: {len(chunks)} chunk(s)")

    kb.qdrant("PUT", f"/collections/{kb.COLLECTION}/points?wait=true",
              {"points": points})
    print(f"Geïndexeerd: {len(points)} chunk(s) uit {len(files)} bron(nen).")


if __name__ == "__main__":
    main()
