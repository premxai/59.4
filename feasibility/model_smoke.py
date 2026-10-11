"""Smoke-test candidate L0 operator models on Nebius: valid JSON actions + latency."""
import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
nb = OpenAI(base_url="https://api.tokenfactory.nebius.com/v1/", api_key=os.environ["NEBIUS_API_KEY"])

CANDIDATES = [
    "Qwen/Qwen3-30B-A3B-Instruct-2507",
    "Qwen/Qwen3.8-27B",
    "google/gemma-3-27b-it",
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    "openai/gpt-oss-120b",
]

SYSTEM = ("You operate an electric grid. Reply with ONLY a JSON object with keys: "
          "shed_mw (number >= 0), conservation (0..0.05), precommit (boolean), rationale (string, <= 25 words).")
USER = """Season 4, day 9, hour 02.
Sensors: demand 61,200 MW; available supply 60,100 MW (falling 2,300 MW in the last hour);
reserve margin -1.8%; frequency 59.86 Hz; region B temperature -12 C, forecast min next 48h -15 C.
Manual page (recalled): "Season 2: supply kept falling for 9 hours after the first trips. Shedding only the
visible deficit was too little, too late."
Decide this hour's actions."""

for model in CANDIDATES:
    t0 = time.time()
    try:
        r = nb.chat.completions.create(
            model=model, temperature=0, max_tokens=400,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}],
        )
        txt = r.choices[0].message.content or ""
        dt = time.time() - t0
        try:
            d = json.loads(txt)
            ok = isinstance(d.get("shed_mw"), (int, float)) and isinstance(d.get("precommit"), bool)
        except json.JSONDecodeError:
            d, ok = {}, False
        u = r.usage
        print(f"{model:45s} {'VALID' if ok else 'INVALID':7s} {dt:5.1f}s  in={u.prompt_tokens} out={u.completion_tokens}  "
              f"shed={d.get('shed_mw')} precommit={d.get('precommit')} | {str(d.get('rationale', txt))[:90]}")
    except Exception as e:
        print(f"{model:45s} ERROR {type(e).__name__}: {str(e)[:150]}")
