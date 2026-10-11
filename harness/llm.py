"""Model clients.

- Operator (frozen):  Qwen/Qwen3-30B-A3B-Instruct-2507 on Nebius Token Factory (OpenAI-compatible).
- Coach / meta-coach: claude-opus-5-5 via the Anthropic SDK, structured JSON output, refusal fallbacks.
- Embeddings:         Qwen/Qwen3-Embedding-8B on Nebius (manual-page recall before Atlas vector search).
Operator responses are cached on disk by prompt hash: same harness + storm + seed replays identically.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import threading
import time
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
CACHE = ROOT / "data" / "llm_cache"
CACHE.mkdir(parents=True, exist_ok=True)

OPERATOR_MODEL = os.getenv("OPERATOR_MODEL", "Qwen/Qwen3-30B-A3B-Instruct-2507")
COACH_MODEL = "claude-opus-5-5"
EMBED_MODEL = "Qwen/Qwen3-Embedding-8B"
NEBIUS_URL = "https://api.tokenfactory.nebius.com/v1/"

_nb = None
_an = None
_lock = threading.Lock()
STATS = {"operator_calls": 0, "operator_cache_hits": 0, "coach_calls": 0, "embed_calls": 0}


def read_json(f: Path):
    """Cached JSON or None if missing/corrupt (a corrupt cache entry is treated as a miss and rewritten)."""
    try:
        return json.loads(f.read_text())
    except (OSError, ValueError):
        return None


def write_json(f: Path, obj) -> None:
    """Atomic write: parallel runs sharing the cache can never leave a half-written file."""
    tmp = f.with_name(f"{f.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(obj, default=str))
    os.replace(tmp, f)


def nebius() -> OpenAI:
    global _nb
    if _nb is None:
        _nb = OpenAI(base_url=NEBIUS_URL, api_key=os.environ["NEBIUS_API_KEY"], max_retries=3, timeout=60)
    return _nb


def claude() -> anthropic.Anthropic:
    global _an
    if _an is None:
        _an = anthropic.Anthropic(max_retries=3)
    return _an


def _key(*parts) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:24]


def operator_json(system: str, user: str, model: str | None = None, fresh: bool = False) -> dict:
    """Ask the frozen operator for a JSON decision. Deterministic (temperature 0) and cached.
    fresh=True always calls the model (live demo); the answer still refreshes the cache."""
    model = model or OPERATOR_MODEL
    k = _key(model, system, user)
    f = CACHE / f"op_{k}.json"
    cached = None if fresh else read_json(f)
    if cached is not None:
        with _lock:
            STATS["operator_cache_hits"] += 1
        return cached
    last_err = None
    for attempt in range(6):
        try:
            r = nebius().chat.completions.create(
                model=model, temperature=0, max_tokens=500, response_format={"type": "json_object"},
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
            txt = r.choices[0].message.content or "{}"
            d = json.loads(txt[txt.find("{"): txt.rfind("}") + 1])
            d["_usage"] = {"in": r.usage.prompt_tokens, "out": r.usage.completion_tokens}
            write_json(f, d)
            with _lock:
                STATS["operator_calls"] += 1
            return d
        except Exception as e:  # malformed JSON or transient API error (429/5xx): back off with jitter, then give up
            last_err = e
            with _lock:
                STATS["operator_retries"] = STATS.get("operator_retries", 0) + 1
            time.sleep(min(30.0, 1.5 * 2 ** attempt) * (0.5 + random.random()))
    with _lock:
        STATS["operator_errors"] = STATS.get("operator_errors", 0) + 1
    return {"_error": f"{type(last_err).__name__}: {str(last_err)[:120]}"}   # never cached


def coach_json(system: str, user: str, schema: dict, effort: str = "high", max_tokens: int = 16000) -> dict:
    """Claude Opus 5.5 with a JSON schema. Uses server-side refusal fallbacks when available."""
    kw = dict(model=COACH_MODEL, max_tokens=max_tokens, system=system,
              messages=[{"role": "user", "content": user}],
              output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}})
    with _lock:
        STATS["coach_calls"] += 1
    try:
        resp = claude().beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kw)
    except anthropic.BadRequestError:
        resp = claude().messages.create(**kw)
    if resp.stop_reason == "refusal":
        raise RuntimeError("coach request was refused")
    text = next(b.text for b in resp.content if getattr(b, "type", "") == "text")
    return json.loads(text)


def embed(texts: list[str]) -> list[list[float]]:
    out, todo = [], []
    for t in texts:
        f = CACHE / f"emb_{_key(EMBED_MODEL, t)}.json"
        v = read_json(f)
        if v is not None:
            out.append(v)
        else:
            out.append(None)
            todo.append(t)
    if todo:
        r = nebius().embeddings.create(model=EMBED_MODEL, input=todo)
        with _lock:
            STATS["embed_calls"] += 1
        vecs = iter([d.embedding for d in r.data])
        for i, t in enumerate(texts):
            if out[i] is None:
                v = next(vecs)
                write_json(CACHE / f"emb_{_key(EMBED_MODEL, t)}.json", v)
                out[i] = v
    return out
