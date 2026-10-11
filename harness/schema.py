"""The harness = the AI operator's operating manual. A versioned JSON document.

Only this changes between generations; the model never does.
"""
from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import asdict, dataclass, field

from . import dsl

BUILD_FIELDS = {"winterize_plants", "winterize_wells", "firm_fuel", "battery_mw", "battery_mwh", "dr_mw",
                "critical_load_map", "extra_reserve_mw"}
LLM_FIELDS = ["shed_mw", "restore_mw", "rotation_min", "protect_gas", "conservation", "imports_mw", "dr_mw",
              "battery_mw", "precommit", "rt_shed"]
BASE_VARS = ["demand", "supply", "reserve", "reserve_margin", "supply_trend", "freq", "shed", "temp"]


@dataclass
class Harness:
    id: str = "h_001"
    parent_id: str | None = None
    generation: int = 1
    sensors: list = field(default_factory=list)      # {name, expr, description, born_from}
    rules: list = field(default_factory=list)        # {id, if, then: [actions], priority, description, born_from, helpful, harmful}
    guardrails: list = field(default_factory=list)   # {id, when, enforce: [actions], description, born_from}
    alerts: list = field(default_factory=list)       # {when, description}
    context: dict = field(default_factory=dict)      # {show: [vars], show_forecast, memory_top_k, recent_hours}
    authority: dict = field(default_factory=dict)    # {llm_decides: [fields], call_every_h}
    build: dict = field(default_factory=dict)        # BuildPlan fields
    memory_policy: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> "Harness":
        return cls(**{k: copy.deepcopy(v) for k, v in d.items() if k in cls.__dataclass_fields__})

    def content(self) -> dict:
        d = self.to_json()
        for k in ("id", "parent_id", "generation"):
            d.pop(k)
        return d

    def hash(self) -> str:
        return "sha256:" + hashlib.sha256(json.dumps(self.content(), sort_keys=True).encode()).hexdigest()[:16]

    def counts(self) -> dict:
        return {"gauges": len(self.sensors), "habits": len(self.rules), "hard_limits": len(self.guardrails),
                "alarms": len(self.alerts), "build_items": sum(1 for v in self.build.values() if v),
                "briefing_items": len(self.context.get("show", [])), "forecast": int(bool(self.context.get("show_forecast"))),
                "memory_pages_shown": int(self.context.get("memory_top_k", 0) or 0),
                "ai_decides": len(self.authority.get("llm_decides", [])),
                "ask_ai_every_h": int(self.authority.get("call_every_h", 1) or 1)}

    def expressions(self) -> list:
        """Every DSL expression in the manual (for audits such as the storm-timing memorization check)."""
        out = [s["expr"] for s in self.sensors] + [r["if"] for r in self.rules]
        out += [g.get("when", "1") for g in self.guardrails] + [a["when"] for a in self.alerts]
        return out

    # ------------------------------------------------------------ validation + edits
    def validate(self):
        names = set()
        for s in self.sensors:
            if not s.get("name", "").isidentifier() or s["name"] in names:
                raise dsl.DSLError(f"bad or duplicate gauge name '{s.get('name')}'")
            dsl.parse(s["expr"])
            names.add(s["name"])
        for r in self.rules:
            dsl.parse(r["if"])
            for a in r["then"]:
                dsl.parse_action(a)
        for g in self.guardrails:
            dsl.parse(g.get("when", "1"))
            for a in g["enforce"]:
                dsl.parse_action(a)
        for al in self.alerts:
            dsl.parse(al["when"])
        bad = set(self.build) - BUILD_FIELDS
        if bad:
            raise dsl.DSLError(f"unknown build fields {bad}")
        return self

    def apply_ops(self, ops: list, new_id: str, born_from: str) -> "Harness":
        """Return a child harness with the coach's edits applied (validated)."""
        h = Harness.from_json(self.to_json())
        h.id, h.parent_id, h.generation = new_id, self.id, self.generation + 1
        for op in ops:
            kind = op.get("op")
            if kind == "add_sensor":
                h.sensors.append({"name": op["name"], "expr": op["expr"], "description": op.get("description", ""),
                                  "born_from": born_from})
            elif kind == "add_rule":
                rid = f"r{len(h.rules) + 1}_{h.generation}"
                h.rules.append({"id": rid, "if": op["if"], "then": list(op["then"]), "priority": int(op.get("priority", 1)),
                                "description": op.get("description", ""), "born_from": born_from, "helpful": 0, "harmful": 0})
            elif kind == "modify_rule":
                r = next((r for r in h.rules if r["id"] == op["id"]), None)
                if r is None:
                    raise dsl.DSLError(f"no rule {op['id']}")
                for k in ("if", "then", "priority", "description"):
                    if k in op:
                        r[k] = op[k]
            elif kind == "remove_rule":
                h.rules = [r for r in h.rules if r["id"] != op["id"]]
            elif kind == "add_guardrail":
                h.guardrails.append({"id": f"g{len(h.guardrails) + 1}_{h.generation}", "when": op.get("when", "1"),
                                     "enforce": list(op["enforce"]), "description": op.get("description", ""), "born_from": born_from})
            elif kind == "set_alert":
                h.alerts.append({"when": op["when"], "description": op.get("description", "")})
            elif kind == "set_context":
                for k in ("show", "show_forecast", "memory_top_k", "recent_hours"):
                    if k in op:
                        h.context[k] = op[k]
            elif kind == "set_build":
                for k, v in op.items():
                    if k == "op":
                        continue
                    if k == "winterize_plants":
                        h.build.setdefault("winterize_plants", {}).update(v)
                    else:
                        h.build[k] = v
            elif kind == "set_authority":
                for k in ("llm_decides", "call_every_h"):
                    if k in op:
                        h.authority[k] = op[k]
            elif kind == "set_memory_policy":
                h.memory_policy.update({k: v for k, v in op.items() if k != "op"})
            else:
                raise dsl.DSLError(f"unknown op '{kind}'")
        return h.validate()


def v1() -> Harness:
    """Generation 1: a frozen AI with a nearly empty manual. It is blind to gas supply and forecasts."""
    return Harness(
        id="h_001", parent_id=None, generation=1,
        sensors=[], rules=[], guardrails=[],
        alerts=[{"when": "reserve_margin < 0.06", "description": "Reserves getting thin: ask the AI"}],
        context={"show": list(BASE_VARS), "show_forecast": False, "memory_top_k": 0, "recent_hours": 6},
        authority={"llm_decides": list(LLM_FIELDS), "call_every_h": 1},
        build={},
        memory_policy={"max_active_pages": 8},
    ).validate()
