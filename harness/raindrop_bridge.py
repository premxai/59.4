"""Raindrop (agent monitoring) for the live demo: every operator decision becomes a Raindrop AI event, and our
"said all clear while power was running out" detector becomes a Raindrop signal on that event.

Enabled only when RAINDROP_WRITE_KEY is set and FOUR37_RAINDROP=1 (the live server turns it on), so overnight
learning runs don't spend the event quota. Never raises: monitoring must not break a storm run.
"""
from __future__ import annotations

import json
import os
import uuid

from dotenv import load_dotenv

load_dotenv()
_rd = None
enabled = False
LOCAL = os.getenv("FOUR37_RAINDROP_LOCAL") == "1"
WORKSHOP = os.getenv("RAINDROP_LOCAL_DEBUGGER", "http://127.0.0.1:5899/v1/")
if os.getenv("FOUR37_RAINDROP_LOCAL") == "1":       # Raindrop Workshop on this laptop only: no cloud quota (learning runs)
    try:
        import raindrop.analytics as _rd  # noqa: N811
        _rd.init(None, local_workshop_url=WORKSHOP)
        enabled = True
    except Exception:
        _rd, enabled = None, False
elif os.getenv("FOUR37_RAINDROP") == "1" and os.getenv("RAINDROP_WRITE_KEY"):
    try:
        import raindrop.analytics as _rd  # noqa: N811
        _rd.init(os.environ["RAINDROP_WRITE_KEY"])   # cloud, and mirrored to a running local Workshop
        enabled = True
    except Exception:  # SDK missing or bad key: run without monitoring
        _rd, enabled = None, False


def track_decision(run_label: str, convo_id: str, model: str, briefing: str, decision: dict, props: dict) -> str | None:
    if not enabled:
        return None
    eid = uuid.uuid4().hex
    clean = {k: (v if isinstance(v, (str, int, bool, float)) else str(v)) for k, v in props.items()}
    if LOCAL:      # Workshop stores interactions (begin/finish), not one-shot events: one trace per AI decision
        try:
            it = _rd.begin(user_id=run_label, event="grid_decision", event_id=eid, input=briefing[-4000:],
                           convo_id=convo_id, model=model, properties=clean)
            it.finish(output=json.dumps(decision, default=str)[:4000])
            return eid
        except Exception:
            return None
    try:
        _rd.track_ai(user_id=run_label, event="grid_decision", event_id=eid, model=model, input=briefing[-4000:],
                     output=json.dumps(decision, default=str)[:4000], convo_id=convo_id,
                     properties={k: (v if isinstance(v, (str, int, bool, float)) else str(v)) for k, v in props.items()})
        return eid
    except Exception:
        return None


def signal_false_all_clear(event_id: str | None, reserve_margin: float, supply_trend: float):
    if not enabled or not event_id:
        return
    if LOCAL:
        return signal(event_id, "false_all_clear", f"AI said all clear while power was running out (margin "
                      f"{reserve_margin:+.1%}, supply {supply_trend:+,.0f} MW/h)")
    try:
        _rd.track_signal(event_id=event_id, name="false_all_clear", signal_type="feedback", sentiment="NEGATIVE",
                         comment=f"AI said all clear while power was running out (margin {reserve_margin:+.1%}, "
                                 f"supply {supply_trend:+,.0f} MW/h)",
                         properties={"reserve_margin": reserve_margin, "supply_trend": supply_trend})
    except Exception:
        pass


def signal(event_id: str | None, name: str, comment: str, props: dict | None = None):
    """Any detector's verdict on one AI decision, as a Raindrop signal (negative feedback). Workshop doesn't keep
    signals yet, so locally the flag becomes an 'issue' annotation on that decision's trace."""
    if not enabled or not event_id:
        return
    if LOCAL:
        try:
            import requests
            requests.post(WORKSHOP.replace("/v1/", "/api/annotations"), timeout=3,
                          json={"run_id": event_id, "kind": "issue", "source": "claude-code",
                                "note": f"[59.4 detector] {name}: {comment}"})
        except Exception:
            pass
        return
    try:
        _rd.track_signal(event_id=event_id, name=name, signal_type="feedback", sentiment="NEGATIVE", comment=comment,
                         properties=props or {})
    except Exception:
        pass


def flush():
    if enabled:
        try:
            _rd.flush()
        except Exception:
            pass
