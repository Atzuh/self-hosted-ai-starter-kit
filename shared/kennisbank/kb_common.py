"""
Gedeelde helpers voor de juridische kennisbank (RAG).

Praat met de lokaal draaiende Ollama (embeddings) en Qdrant (vectoropslag) via
alleen de standaardbibliotheek — geen pip-dependencies, zodat dit zowel op de
host als in de n8n-container draait.

Endpoints via env-vars (defaults = host):
  OLLAMA_URL     default http://localhost:11434   (n8n-container: http://host.docker.internal:11434)
  QDRANT_URL     default http://localhost:6333     (n8n-container: http://qdrant:6333)
  KB_EMBED_MODEL default nomic-embed-text
  KB_COLLECTION  default juridische_bronnen
"""

import json
import os
import urllib.error
import urllib.request

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333").rstrip("/")
EMBED_MODEL = os.environ.get("KB_EMBED_MODEL", "nomic-embed-text")
COLLECTION = os.environ.get("KB_COLLECTION", "juridische_bronnen")

# nomic-embed-text levert 768-dimensionale vectoren.
VECTOR_SIZE = 768
DISTANCE = "Cosine"


def _request(method, url, payload=None, timeout=120):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code} bij {method} {url}: {detail}") from None
    return json.loads(body) if body else {}


def embed(text):
    """Embed één stuk tekst tot een 768-dim vector via Ollama."""
    r = _request("POST", f"{OLLAMA_URL}/api/embeddings",
                 {"model": EMBED_MODEL, "prompt": text})
    vec = r.get("embedding")
    if not vec:
        raise RuntimeError(f"Geen embedding terug van Ollama voor: {text[:60]!r}")
    return vec


def qdrant(method, path, payload=None):
    """Roep de Qdrant REST-API aan; path begint met '/'."""
    return _request(method, f"{QDRANT_URL}{path}", payload)


def collection_exists():
    try:
        qdrant("GET", f"/collections/{COLLECTION}")
        return True
    except RuntimeError:
        return False


def ensure_collection(recreate=False):
    """Maak de collectie aan als die nog niet bestaat (of forceer met recreate)."""
    if recreate and collection_exists():
        qdrant("DELETE", f"/collections/{COLLECTION}")
    if recreate or not collection_exists():
        qdrant("PUT", f"/collections/{COLLECTION}", {
            "vectors": {"size": VECTOR_SIZE, "distance": DISTANCE},
        })
