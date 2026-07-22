#!/usr/bin/env python3
"""
Zoek de meest relevante bronnen bij een vraag/tekst uit de kennisbank (Qdrant).

De retrieval-primitief voor de RAG-flow: embed de vraag, zoek top-k in Qdrant,
geef de bronnen met metadata terug. Standaard leesbaar; met --json machine-
leesbaar (zodat een n8n Code-node de bronnen in de specialist-prompt kan zetten).

Gebruik:
    python3 kennisbank_query.py "moet de echtgenoot meetekenen?"
    python3 kennisbank_query.py --json --top 3 "toestemming echtgenoot hypotheek"
    echo "<lange dossiertekst>" | python3 kennisbank_query.py --stdin --json
"""

import argparse
import json
import sys

import kb_common as kb


def search(query, top_k=4, score_threshold=None):
    vector = kb.embed(query)
    payload = {"vector": vector, "limit": top_k, "with_payload": True}
    if score_threshold is not None:
        payload["score_threshold"] = score_threshold
    res = kb.qdrant("POST", f"/collections/{kb.COLLECTION}/points/search", payload)
    hits = []
    for h in res.get("result", []):
        p = h.get("payload", {})
        hits.append({
            "score": round(h.get("score", 0.0), 4),
            "titel": p.get("titel", ""),
            "bron": p.get("bron", ""),
            "artikel": p.get("artikel", ""),
            "url": p.get("url", ""),
            "tekst": p.get("tekst", ""),
        })
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?", default="")
    ap.add_argument("--top", type=int, default=4)
    ap.add_argument("--threshold", type=float, default=None,
                    help="Min. cosine-score (0-1) om ruis te filteren")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--stdin", action="store_true",
                    help="Lees de query van stdin (voor lange dossierteksten)")
    args = ap.parse_args()

    query = sys.stdin.read().strip() if args.stdin else args.query.strip()
    if not query:
        sys.exit("Geen query opgegeven.")

    hits = search(query, top_k=args.top, score_threshold=args.threshold)

    if args.json:
        print(json.dumps({"query": query, "bronnen": hits}, ensure_ascii=False))
        return

    if not hits:
        print("Geen relevante bronnen gevonden.")
        return
    for i, h in enumerate(hits, 1):
        label = f"art. {h['artikel']}" if h["artikel"] else h["titel"]
        print(f"\n[{i}] {h['titel']}  ({label}, score {h['score']})")
        print(f"    bron: {h['bron']}  {h['url']}")
        snippet = h["tekst"].replace("\n", " ")
        print(f"    {snippet[:220]}{'…' if len(snippet) > 220 else ''}")


if __name__ == "__main__":
    main()
