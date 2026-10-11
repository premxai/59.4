"""What the agent sees: regions A–H and fuels F1–F6, never real names, dates or years.

The simulator and the audience use real names; only the agent's view is anonymized.
"""
REGION_ORDER = ["dallas", "houston", "midland", "austin", "lubbock", "san_antonio", "corpus_christi", "sweetwater"]
REGION_LABEL = {r: chr(65 + i) for i, r in enumerate(REGION_ORDER)}
FUEL_LABEL = {"gas": "F1", "coal": "F2", "nuclear": "F3", "wind": "F4", "solar": "F5", "other": "F6"}
FUEL_REAL = {v: k for k, v in FUEL_LABEL.items()}
REGION_REAL = {v: k for k, v in REGION_LABEL.items()}


def region(r: str) -> str:
    return REGION_LABEL.get(r, r)


def fuel(f: str) -> str:
    return FUEL_LABEL.get(f, f)


def stamp(hour_index: int) -> str:
    """Anonymized time: 'day 3, hour 14' (no dates, no years)."""
    return f"day {hour_index // 24 + 1}, hour {hour_index % 24:02d}"
