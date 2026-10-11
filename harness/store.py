"""Persistence. MongoDB Atlas when MONGODB_URI_HARNESS is set, otherwise a local JSON-lines store
with the same collection names (data/local_store/), so work continues before Atlas is connected and
can be copied into Atlas later.

Collections (simdb): runs, events, manual_pages, harness_versions, mutations, evolver_strategies,
scoreboard, llm_calls. The locked exams live in the separate `vault` database (evaluator user only).
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "data" / "local_store"


class LocalStore:
    kind = "local"

    def __init__(self, root: Path = LOCAL):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _f(self, coll):
        return self.root / f"{coll}.jsonl"

    def insert(self, coll: str, doc: dict) -> dict:
        doc = dict(doc)
        doc.setdefault("_ts", time.time())
        with self._lock, open(self._f(coll), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, default=str) + "\n")
        return doc

    def insert_many(self, coll: str, docs: list):
        if not docs:
            return
        with self._lock, open(self._f(coll), "a", encoding="utf-8") as fh:
            for d in docs:
                d = dict(d)
                d.setdefault("_ts", time.time())
                fh.write(json.dumps(d, default=str) + "\n")

    def all(self, coll: str) -> list:
        f = self._f(coll)
        if not f.exists():
            return []
        with self._lock:
            return [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]

    def find(self, coll: str, **eq) -> list:
        return [d for d in self.all(coll) if all(d.get(k) == v for k, v in eq.items())]


class MongoStore:
    kind = "mongo"

    def __init__(self, uri: str, db: str = "simdb"):
        from pymongo import MongoClient
        # reads fall back to a secondary when the primary is unreachable from this network (writes still need it)
        self.client = MongoClient(uri, serverSelectionTimeoutMS=8000, appname="four37-harness", readPreference="primaryPreferred")
        self.db = self.client[db]

    def insert(self, coll, doc):
        doc = dict(doc)
        doc.setdefault("_ts", time.time())
        self.db[coll].insert_one(doc)
        doc.pop("_id", None)
        return doc

    def insert_many(self, coll, docs):
        if docs:
            self.db[coll].insert_many([dict(d, _ts=d.get("_ts", time.time())) for d in docs])

    def all(self, coll):
        return [{k: v for k, v in d.items() if k != "_id"} for d in self.db[coll].find()]

    def find(self, coll, **eq):
        return [{k: v for k, v in d.items() if k != "_id"} for d in self.db[coll].find(eq)]


_store = None


def get_store():
    global _store
    if _store is None:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
        uri = os.getenv("MONGODB_URI_HARNESS")
        _store = MongoStore(uri) if uri and os.getenv("FOUR37_LOCAL_STORE") != "1" else LocalStore()
    return _store
