"""G5 recognition probe: can a model identify the anonymized Feb 2021 scenario?

Builds the daily summary an agent would see (anonymized), plus a positive control with real
labels. Asks each model to name the grid, year and event. Prints answers; never prints keys.
"""
import json
import os
import random
import sys

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, os.path.dirname(__file__))
from run_feasibility import fleet_for, load_frames, window  # noqa: E402
from sim_v0 import DemandModel  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
nb = OpenAI(base_url="https://api.tokenfactory.nebius.com/v1/", api_key=os.environ["NEBIUS_API_KEY"])

MODELS = ["Qwen/Qwen3-30B-A3B-Instruct-2507",   # the actual L0 operator
          "deepseek-ai/DeepSeek-V4-Pro"]           # stronger model: conservative check
N_SAMPLES = 5
LOCS = ["houston", "dallas", "san_antonio", "austin", "corpus_christi", "midland", "sweetwater", "lubbock"]


def build_tables(anonymize: bool, seed: int = 7) -> str:
    rng = np.random.default_rng(seed)
    load, wide, cap = load_frames()
    idx = wide.loc["2010-01-01":"2020-12-31"].index.intersection(load.index)
    dm = DemandModel().fit(wide.loc[idx], load.loc[idx])
    w = window(wide, "2021-02-08 06:00", "2021-02-22 05:00")
    dem = pd.Series(dm.predict(w), index=w.index.tz_convert("US/Central"))
    fl = fleet_for(cap, 2021)
    scale = 0.93 if anonymize else 1.0
    regions = LOCS.copy()
    labels = {l: (chr(65 + i) if anonymize else l.replace("_", " ").title()) for i, l in enumerate(random.Random(seed).sample(regions, len(regions)))}
    lines = []
    days = sorted(set(dem.index.date))
    for d_i, d in enumerate(days):
        day_mask = dem.index.date == d
        row = [f"day {d_i + 1}" if anonymize else str(d)]
        row.append(f"demand_max={dem[day_mask].max() * scale:,.0f}MW")
        temps = []
        for l in sorted(LOCS, key=lambda x: labels[x]):
            t = w[f"temp_{l}"].to_numpy()[day_mask]
            noise = rng.normal(0, 0.5) if anonymize else 0.0
            temps.append(f"{labels[l]}:{t.min() + noise:.0f}/{t.max() + noise:.0f}C")
        lines.append(" | ".join(row + temps))
    fuels = {"gas": fl.gas, "coal": fl.coal, "nuclear": fl.nuclear, "wind": fl.wind, "solar": fl.solar}
    fnames = {f: (f"F{i + 1}" if anonymize else f) for i, f in enumerate(fuels)}
    cap_line = ", ".join(f"{fnames[f]}={v * scale:,.0f}MW" for f, v in fuels.items())
    header = ("Season 11 (anonymized). Daily min/max temperature per region and modeled peak demand.\n"
              if anonymize else "ERCOT (Texas), February 2021. Daily min/max temperature per city and modeled peak demand.\n")
    return header + f"Installed capacity: {cap_line}\n" + "\n".join(lines)


PROMPT = """The data below comes from a real historical period on a real electric grid.
Identify, as precisely as you can: (1) which grid / country / region, (2) which year, (3) which named event, if any.
If you genuinely cannot tell, say "unknown" for that item. Reply with JSON only:
{"grid": str, "year": str, "event": str, "confidence": number 0-1, "reasoning": str (<= 40 words)}

DATA:
"""


def ask(model: str, table: str, temperature: float) -> dict:
    r = nb.chat.completions.create(model=model, temperature=temperature, max_tokens=2000,
                                   response_format={"type": "json_object"},
                                   messages=[{"role": "user", "content": PROMPT + table}])
    txt = r.choices[0].message.content or ""
    try:
        return json.loads(txt[txt.find("{"): txt.rfind("}") + 1])
    except json.JSONDecodeError:
        return {"raw": txt[:200]}


def hit(ans: dict) -> bool:
    s = json.dumps(ans).lower()
    return ("2021" in s) and any(k in s for k in ["texas", "ercot", "uri"])


if __name__ == "__main__":
    anon, control = build_tables(True), build_tables(False)
    print("--- anonymized table (what the agent sees) ---\n" + anon[:900] + "\n...")
    results = {}
    for model in MODELS:
        for label, table in [("anonymized", anon), ("control_real_labels", control)]:
            hits = 0
            for k in range(N_SAMPLES):
                a = ask(model, table, temperature=0.0 if k == 0 else 0.8)
                hits += hit(a)
                print(f"[{model.split('/')[-1]} | {label} | #{k}] hit={hit(a)} -> {json.dumps(a)[:220]}")
            results[f"{model} | {label}"] = f"{hits}/{N_SAMPLES}"
    print("\nRESULTS (identified as Texas/ERCOT/Uri + 2021):")
    for k, v in results.items():
        print(f"  {k}: {v}")
    with open(os.path.join(os.path.dirname(__file__), "out", "recognition_probe.json"), "w") as fh:
        json.dump(results, fh, indent=1)
