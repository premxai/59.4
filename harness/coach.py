"""L1 night coach (Claude Opus 5.5): reads why the grid failed and proposes small, testable manual edits.

It never changes the AI model. Its proposals are data (validated by the DSL) and are kept only if they
pass the test-before-accept gate (harness.evolve). Two tracks:
  A  in-storm only: the before-winter build is fixed; the coach may change gauges, habits, hard limits,
     alarms, the briefing/memory and the AI's authority, but not the build.
  B  everything, including the before-winter build.
"""
from __future__ import annotations

import json

from . import dsl, llm
from .schema import Harness

_OPS = ["add_sensor", "add_rule", "modify_rule", "remove_rule", "add_guardrail", "set_alert", "set_context",
        "set_build", "set_authority", "set_memory_policy"]
ORGANS = ["habit", "hard_limit", "gauge_alarm", "briefing_memory", "authority", "build"]
OP_ORGAN = {"add_sensor": "gauge_alarm", "set_alert": "gauge_alarm", "add_rule": "habit", "modify_rule": "habit",
            "remove_rule": "habit", "add_guardrail": "hard_limit", "set_context": "briefing_memory",
            "set_memory_policy": "briefing_memory", "set_authority": "authority", "set_build": "build"}


def ops_for(track: str) -> list:
    return [o for o in _OPS if not (track == "A" and o == "set_build")]


def organs_for(track: str) -> list:
    return [o for o in ORGANS if not (track == "A" and o == "build")]


def decode_ops(ops: list) -> list:
    out = []
    for o in ops:
        args = o.get("args") or "{}"
        d = json.loads(args) if isinstance(args, str) else dict(args)
        if not isinstance(d, dict):
            raise ValueError(f"args for {o.get('op')} must be a JSON object")
        d.pop("op", None)
        out.append({"op": o["op"], **d})
    return out


def schema_for(track: str) -> dict:
    # Each edit is {op, args} with args a JSON object encoded as a string (keeps the schema small enough for
    # constrained decoding); args are parsed and validated by Harness.apply_ops.
    op_schema = {"type": "object",
                 "properties": {"op": {"type": "string", "enum": ops_for(track)}, "args": {"type": "string"}},
                 "required": ["op", "args"], "additionalProperties": False}
    return {
        "type": "object",
        "properties": {
            "diagnosis": {"type": "string"},
            "proposals": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "organ": {"type": "string", "enum": organs_for(track)},
                    "lesson_title": {"type": "string"},
                    "lesson_text": {"type": "string"},
                    "predicted_effect": {"type": "string"},
                    "predicted_extra_storms_passed": {"type": "number"},
                    "predicted_change_pct": {"type": "number"},
                    "ops": {"type": "array", "items": op_schema},
                },
                "required": ["title", "organ", "lesson_title", "lesson_text", "predicted_effect",
                             "predicted_extra_storms_passed", "predicted_change_pct", "ops"],
                "additionalProperties": False,
            }},
        },
        "required": ["diagnosis", "proposals"],
        "additionalProperties": False,
    }


SCHEMA = schema_for("B")


def system(track: str = "B", fixed_build: dict | None = None) -> str:
    build_line = (
        "  set_build {winterize_plants?, winterize_wells?, firm_fuel?, battery_mw?, battery_mwh?, dr_mw?,\n"
        "              critical_load_map?, extra_reserve_mw?}      before-winter investments (season budget ~$1B; over-budget\n"
        "                                                          plans are scaled down)\n"
        if track != "A" else "")
    track_txt = ("TRACK A: the before-winter build is FIXED and you cannot change it: "
                 f"{json.dumps(fixed_build or {})}. Improve only how the operator reads, decides and acts DURING the "
                 "storm.\n" if track == "A" else "")
    return f"""You are the night coach for an AI that operates an electric power grid through winter storms.
The AI model is frozen: you can NEVER change it. You improve its OPERATING MANUAL (the harness): the gauges it
can read, the habits it follows every hour, the hard limits it must respect, what its briefing shows, what it
remembers, how much it decides itself{", and what it builds before winter" if track != "A" else ""}.
{track_txt}
After a failed storm you get: the simulator's cause chain (computed by physics, trustworthy), key events, the AI's
decisions with its own reasons, and flags where it said "all clear" while power was running out.
Propose SMALL, independent, testable edits that fix the root cause, each from a DIFFERENT organ of the manual:
  habit (rules), hard_limit (guardrails), gauge_alarm (gauges and wake-up alarms), briefing_memory (what the AI
  is shown: readings, the forecast via show_forecast, its own manual pages via memory_top_k, recent hours),
  authority (which decisions the AI makes itself, how often it is asked){", build (before-winter investments)" if track != "A" else ""}.
Skills that often matter in winter storms: reading the forecast before the cold arrives (fc_min_* variables,
precommit, imports, conservation), trend gauges (slope/delta of supply or reserve), anticipating a falling
supply (shed_to_reserve(MW, anticipate_h)), letting the control room cut load fast (rt_shed()), keeping gas
facilities powered while shedding (protect_gas()), restoring homes gradually but promptly, and showing the AI its
own lessons at decision time (memory_top_k).
Each edit is tested on several past winters before it is kept: it must improve the failed storms WITHOUT making any
other storm worse, and calm days are tested too, so needless outages are punished (keeping homes dark to look
safe is caught and rejected). Prefer edits that generalize (other storms, other regions, other models). NEVER use
the variable `day` (that memorizes storm timing; edits using it are rejected). Each proposal predicts two numbers:
predicted_extra_storms_passed, and predicted_change_pct = the % change in homes x hours dark on tonight's failed
storms (negative = fewer homes dark). Your predictions are scored against the measured result, so be calibrated.
Each proposal also writes one manual page: a plain-English lesson a non-expert would understand (title under 8
words, text under 35 words).

The manual's mini-language:
{dsl.__doc__}
Each edit is {{"op": <name>, "args": <a JSON object as a string>}}, e.g.
  {{"op": "add_sensor", "args": "{{\\"name\\": \\"freeze_risk\\", \\"expr\\": \\"clip(cum_below(temp.C, -4, 48) / 300, 0, 1)\\", \\"description\\": \\"how close gas wells are to freezing\\"}}"}}
Edit ops (fields used by each):
  add_sensor {{name, expr, description}}                 new gauge; later expressions can use it by name
  add_rule {{if, then:[actions], priority, description}}  a habit applied every hour when `if` is true
  modify_rule {{id, if?, then?, priority?, description?}}; remove_rule {{id}}
  add_guardrail {{when, enforce:[actions], description}}  hard limit enforced after the AI decides
  set_alert {{when, description}}                         when to wake the AI for a decision
  set_context {{show?, show_forecast?, memory_top_k?, recent_hours?}}   what the AI's briefing contains
{build_line}  set_authority {{llm_decides?, call_every_h?}}           which hourly fields the AI may set; how often to ask it
Build facts: winterize_plants {{fuel: share 0-1}} shrinks plants that freeze; winterize_wells cuts gas freeze-offs;
firm_fuel gives gas plants backup fuel; critical_load_map lets shedding protect gas facilities (protect_gas()).
Shedding gas facilities cuts the gas supply further (a feedback loop). Restoring homes too late is also a failure.
Use only the variables, functions and actions listed. Do not reference real places, dates or years."""


SYSTEM = system("B")


def failure_report(run: dict, max_events: int = 30, max_decisions: int = 14) -> str:
    sim_ev = [e for e in run["events"] if e["actor"] == "sim"][:max_events]
    flags = [e for e in run["events"] if e["type"] == "false_all_clear"]
    dec = run["decisions"]
    if len(dec) > max_decisions:
        step = len(dec) / max_decisions
        dec = [dec[int(k * step)] for k in range(max_decisions)]
    lines = [f"STORM {run['scenario_id']} (seed {run['seed']}): {run['verdict_plain']}",
             f"homes x hours dark: {run['homes_dark_hours'] / 1e6:.0f}M; peak outages {run['peak_shed_mw']:,.0f} MW; "
             f"needless outage homes x hours: {run['unnecessary_homes_hours'] / 1e6:.1f}M; AI calls {run['ai_calls']}",
             f"Cause chain: {run['cause_summary']}",
             "Key events: " + " | ".join(f"h{e['h']}: {e['text_plain']}" for e in sim_ev),
             f"'All clear while running out' flags: {len(flags)} (hours {[f['h'] for f in flags][:10]})",
             "AI decisions (sample): " + " | ".join(
                 f"{d['stamp']}: margin {d['reserve_margin']:+.1%}, trend {d['supply_trend']:+,.0f} MW -> {d['action']} "
                 f"(reason: {d['rationale']})" for d in dec)]
    return "\n".join(lines)


def _history_txt(history: list) -> str:
    return "\n".join(
        f"- night {m['generation']}: [{m.get('organ', '?')}] {m['title']} -> {m['status']}"
        f"{' (' + m['reason'] + ')' if m.get('reason') else ''}"
        f" | predicted {m.get('predicted_pct', '?')}% homes-dark change, measured {m.get('actual_pct', '?')}%"
        for m in history[-12:]) or "none yet"


def propose(h: Harness, reports: list[str], pages: list, history: list, strategy: str, n_max: int = 3,
            track: str = "B", fixed_build: dict | None = None, contrast: str | None = None) -> dict:
    """reports: failure_report() strings for tonight's failed storms (stored so a night can be replayed)."""
    pages_txt = "\n".join(f"- {p['title']}: {p['text']}" for p in pages) or "none yet"
    user = (f"Current manual (harness) JSON:\n{json.dumps(h.content(), indent=1)}\n\n"
            f"Manual pages so far:\n{pages_txt}\n\nPrevious edits and measured results:\n{_history_txt(history)}\n\n"
            f"Coaching strategy (from your own reviews):\n{strategy or 'none yet'}\n\n"
            f"FAILED STORMS TONIGHT:\n\n" + "\n\n".join(reports) +
            (f"\n\nFOR CONTRAST, A STORM THE MANUAL PASSED:\n\n{contrast}" if contrast else "") +
            f"\n\nPropose at most {n_max} edits, each from a different organ, each with at most 4 ops.")
    return llm.coach_json(system(track, fixed_build), user, schema_for(track))


def zero_shot(h: Harness, track: str = "B", fixed_build: dict | None = None) -> dict:
    """Night 0: Claude's best manual from general knowledge, before seeing any storm (the baseline the loop must beat)."""
    user = (f"Current manual (harness) JSON:\n{json.dumps(h.content(), indent=1)}\n\n"
            "No storm has been run yet and you have seen no failures. Write the best operating manual you can from "
            "your general knowledge of running a power grid through severe winter storms. Return exactly ONE proposal "
            "with up to 12 ops (any organs), organ = the main organ it changes, predicted_change_pct = your estimate of "
            "the % change in homes x hours dark versus the current manual on hard winter storms. Its lesson page "
            "summarizes the manual's main idea.")
    return llm.coach_json(system(track, fixed_build), user, schema_for(track))
