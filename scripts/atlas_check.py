"""Atlas connectivity + honesty-lock check. Never prints credentials.

Checks:
  1. admin can connect and create the simdb / vault collections
  2. harness_rw can read/write simdb but is DENIED on vault (the locked exams)
  3. evaluator can write vault and read simdb, but is DENIED writes on simdb
  4. a change stream on simdb delivers an insert (the coach wake-up mechanism)
Usage: .venv/Scripts/python scripts/atlas_check.py
"""
import os
import sys
import threading
import time

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import OperationFailure, PyMongoError

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
URIS = {k: os.getenv(f"MONGODB_URI_{k}") for k in ("ADMIN", "HARNESS", "EVAL")}
results = []


def check(name, fn, expect_denied=False):
    try:
        fn()
        ok = not expect_denied
        detail = "allowed"
    except OperationFailure as e:
        denied = e.code in (13, 8000) or "not authorized" in str(e).lower() or "unauthorized" in str(e).lower()
        ok = expect_denied and denied
        detail = f"denied (code {e.code})" if denied else f"error {e.code}: {str(e)[:80]}"
    except PyMongoError as e:
        ok, detail = False, f"{type(e).__name__}: {str(e)[:80]}"
    results.append((("PASS" if ok else "FAIL"), name, detail))


def client(key):
    return MongoClient(URIS[key], serverSelectionTimeoutMS=8000, appname="four37-check")


def main():
    missing = [k for k, v in URIS.items() if not v]
    if missing:
        sys.exit(f"Missing in .env: {', '.join('MONGODB_URI_' + m for m in missing)}")

    admin, harness, ev = client("ADMIN"), client("HARNESS"), client("EVAL")
    check("admin: ping", lambda: admin.admin.command("ping"))
    info = admin.server_info()
    results.append(("INFO", "server version", info.get("version", "?")))

    def setup():
        for db, coll in (("simdb", "healthcheck"), ("vault", "test_runs")):
            if coll not in admin[db].list_collection_names():
                admin[db].create_collection(coll)
    check("admin: create simdb.healthcheck + vault.test_runs", setup)

    check("harness_rw: write simdb", lambda: harness.simdb.healthcheck.insert_one({"probe": "harness", "t": time.time()}))
    check("harness_rw: read simdb", lambda: harness.simdb.healthcheck.find_one())
    check("harness_rw: read vault (MUST be denied)", lambda: harness.vault.test_runs.find_one(), expect_denied=True)
    check("harness_rw: write vault (MUST be denied)", lambda: harness.vault.test_runs.insert_one({"x": 1}), expect_denied=True)

    check("evaluator: write vault", lambda: ev.vault.test_runs.insert_one({"probe": "evaluator", "t": time.time()}))
    check("evaluator: read simdb", lambda: ev.simdb.healthcheck.find_one())
    check("evaluator: write simdb (MUST be denied)", lambda: ev.simdb.healthcheck.insert_one({"x": 1}), expect_denied=True)

    def change_stream():
        got = {}
        with harness.simdb.healthcheck.watch(max_await_time_ms=2000) as stream:
            threading.Timer(1.0, lambda: admin.simdb.healthcheck.insert_one({"probe": "stream", "t": time.time()})).start()
            deadline = time.time() + 15
            while time.time() < deadline and not got:
                ev_ = stream.try_next()
                if ev_ is not None and ev_["operationType"] == "insert":
                    got["ok"] = True
        if not got:
            raise PyMongoError("no change event within 15 s")
    check("harness_rw: change stream delivers an insert", change_stream)

    # clean up probe docs (admin)
    admin.simdb.healthcheck.delete_many({"probe": {"$exists": True}})
    admin.vault.test_runs.delete_many({"probe": {"$exists": True}})

    width = max(len(n) for _, n, _ in results)
    for status, name, detail in results:
        print(f"[{status}] {name.ljust(width)}  {detail}")
    # proof for the Mission Control honesty panel (no credentials, no hostnames)
    import json
    out = os.path.join(os.path.dirname(__file__), "..", "data", "atlas_check.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                   "results": [{"status": s, "check": n, "detail": d} for s, n, d in results]}, fh, indent=1)
    sys.exit(0 if all(s in ("PASS", "INFO") for s, _, _ in results) else 1)


if __name__ == "__main__":
    main()
