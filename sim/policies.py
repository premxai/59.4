"""Scripted reference policies (no LLM): naive, status quo (pre-2021 ERCOT procedure), good scripted.

Policy protocol (frozen):
    build(season_info) -> BuildPlan | dict      pre-season investments
    act(obs) -> dict                            hourly actions (see sim.levers)
    reset()                                     optional, called before each run
"""
from __future__ import annotations

from .levers import BuildPlan


class Policy:
    name = "base"

    def build(self, season_info: dict):
        return BuildPlan()

    def act(self, obs: dict) -> dict:
        raise NotImplementedError

    def reset(self):
        pass


class NaivePolicy(Policy):
    """v1-like: no investments; sheds only to cover the deficit it sees right now (v0 behaviour)."""
    name = "naive"

    def act(self, obs):
        deficit = obs["demand_now"] - obs["supply_now"]
        return {"shed_mw": max(0.0, deficit), "imports_mw": obs["imports_max"] if deficit > 0 else 0.0}


class StatusQuoPolicy(Policy):
    """Pre-2021 ERCOT emergency procedure, scripted from public rules (CALIBRATION-SAFE: FERC-2011 p.75,
    POB754 2016, EEA one-pager 2019). No extra winterization, no critical-load map, no forecast use.
      EEA1  reserves < 2,300 MW: conservation appeal, DC-tie imports, start uncommitted units
      EEA2  reserves < 1,750 MW: deploy Load Resources and EILS/ERS
      EEA3  reserves < 1,000 MW: rotating outages to restore 1,000 MW of reserves
    Shedding is re-decided every hour from the current reserve (restored as soon as it is not needed)."""
    name = "status_quo"

    def act(self, obs):
        res = obs["supply_now"] - obs["demand_now"]          # reserve if nothing were shed
        eea1, eea2 = res < 2300, res < 1750
        a = {"conservation": 0.01 if eea1 else 0.0,
             "imports_mw": obs["imports_max"] if eea1 else 0.0,
             "precommit": 1.0 if eea1 else 0.0,
             "dr_mw": obs["dr_available_mw"] if eea2 else 0.0,
             "rotation_min": 30.0, "rt_shed": True}
        help_mw = a["imports_mw"] + a["dr_mw"] + a["conservation"] * obs["demand_now"]
        a["shed_mw"] = max(0.0, 1000.0 - (res + help_mw))
        a["emergency_level"] = 3 if a["shed_mw"] > 0 else (2 if eea2 else (1 if eea1 else 0))
        return a


class GoodScriptedPolicy(Policy):
    """'A good operator who read the 2011 report': winterize, map critical gas load, anticipate with
    the forecast (precommit, conservation, imports, DR, batteries), shed early and protect gas."""
    name = "good_scripted"

    def __init__(self, margin_mw: float = 2800.0):
        self.margin = margin_mw
        self.prev_shed = 0.0

    def reset(self):
        self.prev_shed = 0.0

    def build(self, info):
        return BuildPlan(winterize_plants={"gas": 0.7, "coal": 0.7, "nuclear": 0.5, "other": 0.5, "wind": 0.2},
                         winterize_wells=0.4, firm_fuel=0.1, critical_load_map=True, dr_mw=1000.0)

    def act(self, obs):
        fmin = obs["forecast_min_temp_72h"]
        reg_min = min(obs["forecast_min_temp_by_region_72h"].values())
        cold = fmin < -3.0 or reg_min < -8.0
        margin = self.margin + (1500.0 if cold else 0.0)
        projected = obs["supply_now"] + 1.5 * min(0.0, obs["supply_trend_1h"])
        dem = obs["demand_now"]
        cons = 0.03 if (cold and projected - dem < margin + 3000) else 0.0
        imports = obs["imports_max"] if (cold or projected - dem < margin) else 0.0
        gap = dem * (1 - cons) + margin - projected - imports
        dr = min(obs["dr_available_mw"], max(0.0, gap)) if gap > 0 else 0.0
        batt = 0.0
        if obs["battery_mw_max"] > 0:
            if gap - dr > 0:
                batt = min(obs["battery_mw_max"], gap - dr)
            elif projected - dem > margin + 4000:
                batt = -obs["battery_mw_max"]
        shed = max(0.0, gap - dr - max(batt, 0.0))
        if cold and shed < self.prev_shed:  # restore cautiously while it is still cold
            shed = max(shed, self.prev_shed - 1500.0)
        self.prev_shed = shed
        return {"conservation": cons, "imports_mw": imports, "dr_mw": dr, "battery_mw": batt,
                "precommit": 1.0 if cold else 0.0, "shed_mw": shed, "protect_gas": True, "rotation_min": 30.0,
                "rt_shed": True,
                "emergency_level": 3 if shed > 0 else (1 if cold else 0)}


POLICIES = {"naive": NaivePolicy, "status_quo": StatusQuoPolicy, "good_scripted": GoodScriptedPolicy}
