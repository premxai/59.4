"""Action interface (FROZEN for v1): build levers (pre-season) and hourly levers, with costs.

    policy.build(season_info) -> BuildPlan | dict
    policy.act(obs)           -> dict of hourly actions (keys below; all optional)

Build levers (each has a physical effect in sim.engine):
  winterize_plants {fuel: 0..1}  fuel in gas/coal/nuclear/other/wind. Thermal: removes that share of the
                                 vulnerable (non-winterized) pool. Wind: that share immune to icing/low temp.
  winterize_wells 0..1           cuts wellhead freeze-off production loss by 80% x share
  firm_fuel 0..1                 share of gas units with dual fuel / firm supply: immune to fuel loss
  battery_mw, battery_mwh        grid batteries (start the season full; 85% round trip; auto fast
                                 frequency response below 59.8 Hz with unscheduled headroom)
  dr_mw                          extra demand-response contracts on top of the historical baseline
  critical_load_map bool         gas facilities identified: shedding can protect them (removes the
                                 electric-gas feedback) and they come off UFLS circuits
  extra_reserve_mw               winterized dual-fuel quick-start reserve units (always available,
                                 immune to cold and fuel loss)

Hourly levers:
  conservation 0..0.03           public appeal, demand x (1 - c)
  dr_mw                          MW of DR to deploy (<= baseline + contracted; energy budget per season)
  battery_mw                     + discharge / - charge
  precommit 0..1 (or bool)       bring that share of offline available gas units online now; units
                                 started while warm avoid cold fail-to-start later; costs min-load fuel
  imports_mw 0..1200             DC ties (generic 1,200 MW cap)
  shed_mw                        target firm controlled-shed level (MW). Omit to keep the current level.
  restore_mw                     alternative to shed_mw: restore this many MW of currently shed load
  rotation_min 10..240           rotating-block length; long blocks -> cold-load pickup on restore
  protect_gas bool               keep gas facilities off the shed list (needs critical_load_map)
  emergency_level 0..3           declared EEA level (logged; informational)
  rt_shed bool (default False)   authorize the real-time desk to shed within the hour (after a 5-minute lag,
                                 100 MW/min, FERC-2011 p.87) whenever supply < load; without it, only the
                                 hourly order, UFLS relays and Load Resources respond inside the hour

Costs: capital items are annualized at 10%/yr and charged per scenario hour (x hours/8760);
DR availability is charged per scenario hour. A capital budget (season_info['capital_budget_usd'])
caps the build: an over-budget plan is scaled down proportionally (reported in the result).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

THERMAL_WINTERIZE_USD_PER_UNIT = {
    # FERC-2011 p.179-180 (CALIBRATION-SAFE, 2011$): insulation + heat tracing $50k-500k per gas/CC
    # unit (mid $275k) + engineering assessment $25k-150k (mid $87.5k); coal adds cooling-tower
    # bypass / fan motors $150k-500k (mid $325k). Nuclear and wind per-unit costs are OUR assumptions.
    "gas": 362_500.0, "other": 362_500.0, "coal": 687_500.0, "nuclear": 1_000_000.0,
}
WIND_WINTERIZE_USD_PER_MW = 30_000.0      # assumption: cold-weather package + blade heating retrofit
WELLS_WINTERIZE_USD_FULL = 1.0e9          # assumption (no calibration-safe source): 100% of production
FIRM_FUEL_USD_PER_KW = 25.0               # assumption: dual-fuel retrofit + on-site oil storage
BATTERY_USD_PER_KWH = 347.0               # Lazard LCOS 5.0 (Nov 2019) 4-h wholesale $225-469/kWh, midpoint
BATTERY_USD_PER_KW_MIN = 898.0            # Lazard LCOS 5.0 low end $/kW (applies if MW-heavy)
DR_USD_PER_MW_H = 6.75                    # ERS $5.78-7.73 per MW per hour (ERCOT ERS 2016 report), midpoint
CRITICAL_MAP_USD = 20.0e6                 # assumption: feeder mapping + SCADA/relay changes
EXTRA_RESERVE_USD_PER_KW = 700.0          # assumption: winterized dual-fuel CT capex
ANNUALIZE = 0.10                          # capital recovery factor (assumption)
DEFAULT_CAPITAL_BUDGET = 1.0e9            # assumption, per season plan
IMPORT_USD_PER_MWH = 1000.0               # assumption: emergency imports (2011 cap was $3,000/MWh)
PRECOMMIT_USD_PER_MWH = 12.0              # assumption: 40% min load x $30/MWh uneconomic commitment
DR_ENERGY_HOURS = 24.0                    # each MW of DR can be deployed this many hours per scenario (ERS-like)


@dataclass
class BuildPlan:
    winterize_plants: dict = field(default_factory=dict)
    winterize_wells: float = 0.0
    firm_fuel: float = 0.0
    battery_mw: float = 0.0
    battery_mwh: float = 0.0
    dr_mw: float = 0.0
    critical_load_map: bool = False
    extra_reserve_mw: float = 0.0

    @classmethod
    def coerce(cls, b) -> "BuildPlan":
        if b is None:
            return cls()
        if isinstance(b, BuildPlan):
            return BuildPlan(**asdict(b))
        d = dict(b)
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        return cls(**known)

    def clamp(self) -> "BuildPlan":
        c = lambda x: float(min(1.0, max(0.0, x or 0.0)))  # noqa: E731
        self.winterize_plants = {k: c(v) for k, v in (self.winterize_plants or {}).items()
                                 if k in ("gas", "coal", "nuclear", "other", "wind")}
        self.winterize_wells = c(self.winterize_wells)
        self.firm_fuel = c(self.firm_fuel)
        self.battery_mw = max(0.0, float(self.battery_mw or 0))
        self.battery_mwh = max(0.0, float(self.battery_mwh or 0))
        if self.battery_mw > 0 and self.battery_mwh == 0:
            self.battery_mwh = self.battery_mw * 2.0
        self.dr_mw = max(0.0, float(self.dr_mw or 0))
        self.extra_reserve_mw = max(0.0, float(self.extra_reserve_mw or 0))
        self.critical_load_map = bool(self.critical_load_map)
        return self

    def to_dict(self) -> dict:
        return asdict(self)


def capex(plan: BuildPlan, units_by_fuel: dict, cap_by_fuel: dict) -> dict:
    """One-time capital cost of each build item (USD)."""
    items = {}
    for f, share in plan.winterize_plants.items():
        if f == "wind":
            items["winterize_wind"] = share * cap_by_fuel.get("wind", 0.0) * WIND_WINTERIZE_USD_PER_MW
        else:
            items[f"winterize_{f}"] = share * units_by_fuel.get(f, 0) * THERMAL_WINTERIZE_USD_PER_UNIT[f]
    items["winterize_wells"] = plan.winterize_wells * WELLS_WINTERIZE_USD_FULL
    items["firm_fuel"] = plan.firm_fuel * cap_by_fuel.get("gas", 0.0) * 1000.0 * FIRM_FUEL_USD_PER_KW
    items["battery"] = max(plan.battery_mwh * 1000.0 * BATTERY_USD_PER_KWH, plan.battery_mw * 1000.0 * BATTERY_USD_PER_KW_MIN) \
        if plan.battery_mw > 0 else 0.0
    items["critical_load_map"] = CRITICAL_MAP_USD if plan.critical_load_map else 0.0
    items["extra_reserve"] = plan.extra_reserve_mw * 1000.0 * EXTRA_RESERVE_USD_PER_KW
    return {k: float(v) for k, v in items.items() if v}


def fit_budget(plan: BuildPlan, units_by_fuel: dict, cap_by_fuel: dict, budget: float) -> tuple[BuildPlan, float]:
    """Scale the capital items down proportionally if the plan exceeds the budget. Returns (plan, scale)."""
    total = sum(capex(plan, units_by_fuel, cap_by_fuel).values())
    if total <= budget or total <= 0:
        return plan, 1.0
    k = budget / total
    p = BuildPlan.coerce(plan)
    p.winterize_plants = {f: v * k for f, v in p.winterize_plants.items()}
    p.winterize_wells *= k
    p.firm_fuel *= k
    p.battery_mw *= k
    p.battery_mwh *= k
    p.extra_reserve_mw *= k
    if p.critical_load_map and CRITICAL_MAP_USD > budget:
        p.critical_load_map = False
    return p, k


ACTION_KEYS = ("conservation", "dr_mw", "battery_mw", "precommit", "imports_mw", "shed_mw", "restore_mw",
               "rotation_min", "protect_gas", "emergency_level", "rt_shed")


def normalize_action(a: dict | None) -> dict:
    """Accept v0-style keys too ('dr', 'imports', 'precommit' bool)."""
    a = dict(a or {})
    if "dr" in a and "dr_mw" not in a:
        a["dr_mw"] = a.pop("dr")
    if "imports" in a and "imports_mw" not in a:
        a["imports_mw"] = a.pop("imports")
    out = {
        "conservation": min(0.03, max(0.0, float(a.get("conservation", 0.0) or 0.0))),
        "dr_mw": max(0.0, float(a.get("dr_mw", 0.0) or 0.0)),
        "battery_mw": float(a.get("battery_mw", 0.0) or 0.0),
        "precommit": min(1.0, max(0.0, float(a.get("precommit", 0.0) or 0.0))),
        "imports_mw": max(0.0, float(a.get("imports_mw", 0.0) or 0.0)),
        "shed_mw": None if a.get("shed_mw") is None else max(0.0, float(a["shed_mw"])),
        "restore_mw": max(0.0, float(a.get("restore_mw", 0.0) or 0.0)),
        "rotation_min": min(240.0, max(10.0, float(a.get("rotation_min", 30.0) or 30.0))),
        "protect_gas": bool(a.get("protect_gas", False)),
        "emergency_level": int(a.get("emergency_level", 0) or 0),
        "rt_shed": bool(a.get("rt_shed", False)),
    }
    return out
