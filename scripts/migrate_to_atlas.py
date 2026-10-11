"""Copy the local store (data/local_store/*.jsonl) into MongoDB Atlas, idempotently, and create indexes.

  .venv/Scripts/python scripts/migrate_to_atlas.py [--dry-run] [--tags evoA,evoB] [--embed]

Uses MONGODB_URI_HARNESS (database simdb, role readWrite@simdb). Run it again after more nights: every document
gets a stable _id (sha1 of its content), so re-running only adds what is new. Never prints credentials.
--embed also stores an embedding on each manual page (Qwen3-Embedding-8B, the same vectors the operator's recall
uses) and creates the Atlas Vector Search index `pages_vec` on simdb.manual_pages (M0 allows 3 search indexes).
After migrating, set FOUR37_LOCAL_STORE=0 (or unset it) so new runs write straight to Atlas.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

LOCAL = ROOT / "data" / "local_store"
INDEXES = {
    "runs": [("tag", 1), ("scenario_id", 1), ("seed", 1)],
    "events": [("tag", 1), ("generation", 1), ("_ts", 1)],
    "mutations": [("tag", 1), ("generation", 1)],
    "harness_versions": [("tag", 1), ("id", 1)],
    "manual_pages": [("tag", 1), ("generation", 1)],
    "scoreboard": [("tag", 1), ("generation", 1)],
    "coach_metrics": [("tag", 1), ("generation", 1)],
    "evolver_strategies": [("tag", 1), ("generation", 1)],
}


def stable_id(doc: dict) -> str:
    return hashlib.sha1(json.dumps(doc, sort_keys=True, default=str).encode()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--tags", default="", help="only these loop tags (comma list); default all")
    ap.add_argument("--embed", action="store_true")
    a = ap.parse_args()
    load_dotenv(ROOT / ".env")
    uri = os.getenv("MONGODB_URI_HARNESS")
    if not uri:
        sys.exit("MONGODB_URI_HARNESS is not set in .env")
    from pymongo import MongoClient, UpdateOne
    db = MongoClient(uri, serverSelectionTimeoutMS=10000, appname="59.4-migrate")["simdb"]
    tags = {t for t in a.tags.split(",") if t}
    total = 0
    for f in sorted(LOCAL.glob("*.jsonl")):
        coll = f.stem
        docs = [json.loads(line) for line in f.read_text(encoding="utf-8").splitlines() if line.strip()]
        if tags:
            docs = [d for d in docs if d.get("tag") in tags or "tag" not in d]
        if a.embed and coll == "manual_pages":
            from harness import llm
            vecs = llm.embed([f"{d['title']}. {d['text']}" for d in docs]) if docs else []
            for d, v in zip(docs, vecs):
                d["embedding"] = v
        ops = [UpdateOne({"_id": stable_id({k: v for k, v in d.items() if k != "embedding"})},
                         {"$setOnInsert": d}, upsert=True) for d in docs]
        if a.dry_run:
            print(f"{coll:20s} {len(ops):6d} docs (dry run)")
            continue
        n_new = 0
        for i in range(0, len(ops), 500):
            r = db[coll].bulk_write(ops[i:i + 500], ordered=False)
            n_new += r.upserted_count
        if coll in INDEXES:
            db[coll].create_index(INDEXES[coll])
        total += n_new
        print(f"{coll:20s} {len(ops):6d} docs, {n_new} new")
    if a.embed and not a.dry_run:
        from pymongo.operations import SearchIndexModel
        dims = len(db.manual_pages.find_one({"embedding": {"$exists": True}}, {"embedding": 1})["embedding"])
        try:
            db.manual_pages.create_search_index(SearchIndexModel(
                name="pages_vec", type="vectorSearch",
                definition={"fields": [{"type": "vector", "path": "embedding", "numDimensions": dims, "similarity": "cosine"},
                                       {"type": "filter", "path": "tag"}]}))
            print(f"vector index pages_vec requested ({dims} dims)")
        except Exception as e:  # already exists, or the tier does not allow it
            print(f"vector index not created: {type(e).__name__}: {str(e)[:120]}")
    print(f"done: {total} new documents in simdb")


if __name__ == "__main__":
    main()
