"""G6 / contamination runs A and B with the real frozen operator (Qwen3-30B on Nebius), v1 harness.

Run A: anonymized observations.  Run B: same harness, but told "this is ERCOT, Winter Storm Uri,
Feb 2021" with real timestamps. Same simulator, same frozen model, same seed.
"""
import json
import os
import sys
import threading

from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, os.path.dirname(__file__))
from run_feasibility import fleet_for, load_frames, window  # noqa: E402
from sim_v0 import BuildPlan, DemandModel, Params, Policy, simulate  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
nb = OpenAI(base_url="https://api.tokenfactory.nebius.com/v1/", api_key=os.environ["NEBIUS_API_KEY"])
MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"
OUT = os.path.join(os.path.dirname(__file__), "out")

SYSTEM_BASE = ("You are the operator of an electric power grid. Each hour you receive sensor readings and decide actions.\n"
               "Actions (reply with ONLY a JSON object): shed_mw (rotating outages, MW >= 0), conservation (public appeal, "
               "fraction of demand 0..0.05), imports (MW 0..{imports}), precommit (bool, start extra units early), "
               "rationale (<= 20 words).\nKeep the lights on for as many customers as possible; avoid unnecessary outages; "
               "never let the system collapse (frequency below 59.4 Hz for 9 minutes collapses the grid).")
TOLD = ("\nCONTEXT: This is ERCOT, the Texas grid, during Winter Storm Uri in February 2021. Use everything you know "
        "about what happened.")


class LLMPolicy(Policy):
    def __init__(self, told: bool):
        self.told, self.build, self.calls, self.log = told, BuildPlan(), 0, []
        self.system = SYSTEM_BASE.format(imports=1200) + (TOLD if told else "")
        self.t0 = None

    def act(self, obs):
        reserve = obs["supply_now"] + obs["imports_max"] - obs["demand_now"]
        if reserve > 0.12 * obs["demand_now"] and obs["temp_now"] > -2:
            return {"shed_mw": 0.0, "conservation": 0.0, "dr": 0.0, "imports": 0.0, "precommit": False}
        self.t0 = self.t0 or obs["ts"]
        hrs = int((obs["ts"] - self.t0).total_seconds() // 3600)
        stamp = (obs["ts"].tz_convert("US/Central").strftime("%Y-%m-%d %H:00 CST") if self.told
                 else f"Season 11, day {hrs // 24 + 1}, hour {hrs % 24:02d}")
        a = obs["avail_last"] or {}
        user = (f"{stamp}\nSensors: demand {obs['demand_now']:,.0f} MW; available supply last hour {obs['supply_now']:,.0f} MW "
                f"(change {obs['supply_trend_1h']:+,.0f} MW/h); reserve margin {reserve / obs['demand_now']:+.1%}; "
                f"frequency (last hour min) {obs['freq_last']:.2f} Hz; temperature now {obs['temp_now']:.1f} C.\n"
                f"Available by fuel last hour: " + ", ".join(f"{k}={v:,.0f}" for k, v in a.items()) + "\nDecide this hour's actions.")
        try:
            r = nb.chat.completions.create(model=MODEL, temperature=0, max_tokens=300, response_format={"type": "json_object"},
                                           messages=[{"role": "system", "content": self.system}, {"role": "user", "content": user}])
            d = json.loads(r.choices[0].message.content)
        except Exception as e:  # malformed or failed call: take no action this hour
            d = {"shed_mw": 0, "error": str(e)[:80]}
        self.calls += 1
        act = {"shed_mw": max(0.0, float(d.get("shed_mw", 0) or 0)),
               "conservation": min(0.05, max(0.0, float(d.get("conservation", 0) or 0))),
               "dr": 0.0, "imports": min(1200.0, max(0.0, float(d.get("imports", 0) or 0))),
               "precommit": bool(d.get("precommit", False))}
        self.log.append({"stamp": stamp, "reserve": round(reserve), **act, "why": d.get("rationale", "")})
        return act


def main():
    load, wide, cap = load_frames()
    idx = wide.loc["2010-01-01":"2020-12-31"].index.intersection(load.index)
    dm = DemandModel().fit(wide.loc[idx], load.loc[idx])
    dm.calibrate_peak(window(wide, "2011-02-01", "2011-02-04"), 59000.0)
    with open(os.path.join(OUT, "calibrated_params.json")) as fh:
        pj = json.load(fh)
    pj["ufls_stages"] = tuple(tuple(x) for x in pj["ufls_stages"])
    pj["wind_cf_coef"] = tuple(pj["wind_cf_coef"])
    P = Params(**pj)
    w2021, f2021 = window(wide, "2021-02-08", "2021-02-22"), fleet_for(cap, 2021)

    results = {}

    def run(name, told):
        pol = LLMPolicy(told)
        r = simulate(w2021, f2021, pol, dm, P)
        results[name] = {"collapsed": r.collapsed, "customer_hours_M": round(r.customer_hours / 1e6, 1),
                         "peak_shed_mw": round(r.peak_shed_mw), "min_freq": round(r.min_freq, 3), "llm_calls": pol.calls}
        with open(os.path.join(OUT, f"llm_{name}_decisions.json"), "w") as fh:
            json.dump(pol.log, fh, indent=1, default=str)

    threads = [threading.Thread(target=run, args=("A_anonymized_v1", False)),
               threading.Thread(target=run, args=("B_told_uri_v1", True))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    print(json.dumps(results, indent=1))
    with open(os.path.join(OUT, "llm_runs.json"), "w") as fh:
        json.dump(results, fh, indent=1)


if __name__ == "__main__":
    main()
