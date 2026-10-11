"""The manual's pages: plain-English lessons the coach writes after failures, recalled by similarity.

Recall uses embeddings (Qwen3-Embedding-8B on Nebius) with cosine similarity today; on Atlas it moves
to $vectorSearch over the manual_pages collection. Pages are linked to the run that produced them.
"""
from __future__ import annotations

import math

from . import llm


def _cos(a, b):
    num = sum(x * y for x, y in zip(a, b))
    den = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return num / den if den else 0.0


class Manual:
    def __init__(self, pages: list | None = None):
        self.pages = list(pages or [])          # {id, title, text, born_from_run, generation, harness_id}
        self._vecs: dict = {}

    def add(self, page: dict):
        self.pages.append(page)

    def _vec(self, page):
        if page["id"] not in self._vecs:
            self._vecs[page["id"]] = llm.embed([f"{page['title']}. {page['text']}"])[0]
        return self._vecs[page["id"]]

    def recall(self, query: str, k: int) -> list:
        if k <= 0 or not self.pages:
            return []
        try:
            q = llm.embed([query])[0]
            scored = sorted(self.pages, key=lambda p: -_cos(q, self._vec(p)))
        except Exception:  # embeddings unavailable: fall back to word overlap
            qw = set(query.lower().split())
            scored = sorted(self.pages, key=lambda p: -len(qw & set((p["title"] + " " + p["text"]).lower().split())))
        return scored[:k]
