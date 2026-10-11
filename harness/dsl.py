"""Safe mini-language for gauges (sensors), habits (rules) and hard limits (guardrails).

Expressions are parsed with Python's `ast` and only a whitelist of node types and functions is
allowed, so manual edits written by the coach are data, never executed code.

Variables (agent view, anonymized):
  reserve, reserve_margin, demand, supply, supply_trend, freq, shed, temp, hour, day,
  battery_soc, dr_left, below_59_4_min,
  temp.A … temp.H, wind.A … wind.H, avail.F1 … avail.F6, cap.F1 …, out.F1 …,
  fc_min_24, fc_min_48, fc_min_72 (statewide forecast minimum, noisy), fc_min.A … fc_min.H (72 h),
  plus every gauge defined earlier in the manual (by name).
History functions (first argument is a variable name):
  lag(x,k) delta(x,k) slope(x,k) mean(x,k) min(x,k) max(x,k)
  cum_below(x,thr,k) cum_above(x,thr,k) hours_below(x,thr,k) hours_above(x,thr,k)
Value functions: add sub mul div neg abs clip(x,lo,hi) max2 min2 ratio(a,b) share(F1)
Operators: + - * /  < > <= >= == !=  and or not
Actions (habits / hard limits):
  shed_to_reserve(MW[, anticipate_h])  shed_frac(f)  restore(MW)  rotation(min)
  protect_gas()  rt_shed()  precommit(f)  conservation(f)  imports(MW)  dr(MW|max)
  battery(MW|discharge|charge)  call_ai()
"""
from __future__ import annotations

import ast
import math
from collections import deque

HIST_FNS = {"lag", "delta", "slope", "mean", "min", "max", "cum_below", "cum_above", "hours_below", "hours_above"}
VAL_FNS = {"add", "sub", "mul", "div", "neg", "abs", "clip", "max2", "min2", "ratio", "share"}
ACTION_VERBS = {"shed_to_reserve", "shed_frac", "restore", "rotation", "protect_gas", "rt_shed", "precommit",
                "conservation", "imports", "dr", "battery", "call_ai"}
_ALLOWED = (ast.Expression, ast.Call, ast.Name, ast.Attribute, ast.Constant, ast.BinOp, ast.UnaryOp,
            ast.Compare, ast.BoolOp, ast.Load, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd,
            ast.Not, ast.Gt, ast.Lt, ast.GtE, ast.LtE, ast.Eq, ast.NotEq, ast.And, ast.Or)


class DSLError(ValueError):
    pass


def _var_name(node) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_var_name(node.value)}.{node.attr}"
    raise DSLError("expected a variable name")


def parse(expr: str) -> ast.Expression:
    if not isinstance(expr, str) or len(expr) > 400:
        raise DSLError("expression must be a string under 400 characters")
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise DSLError(f"syntax error: {e.msg}") from e
    for n in ast.walk(tree):
        if not isinstance(n, _ALLOWED):
            raise DSLError(f"not allowed: {type(n).__name__}")
        if isinstance(n, ast.Call):
            if not isinstance(n.func, ast.Name):
                raise DSLError("only plain function calls are allowed")
            if n.func.id not in HIST_FNS | VAL_FNS:
                raise DSLError(f"unknown function '{n.func.id}'")
            if n.keywords:
                raise DSLError("keyword arguments are not allowed")
        if isinstance(n, ast.Constant) and not isinstance(n.value, (int, float, bool)):
            raise DSLError("only numeric constants are allowed")
        if isinstance(n, ast.Compare) and len(n.ops) != 1:
            raise DSLError("use one comparison at a time (combine with and/or)")
    return tree


class History:
    """Rolling window of per-hour variable snapshots (agent view)."""

    def __init__(self, maxlen: int = 240):
        self.rows: deque = deque(maxlen=maxlen)

    def push(self, row: dict):
        self.rows.append(row)

    def cur(self, name: str) -> float:
        return float(self.rows[-1].get(name, math.nan)) if self.rows else math.nan

    def series(self, name: str, k: int) -> list:
        k = max(1, int(k))
        return [float(r.get(name, math.nan)) for r in list(self.rows)[-k:]]


def _nan(x):
    return x is None or (isinstance(x, float) and math.isnan(x))


class Evaluator:
    def __init__(self, hist: History):
        self.h = hist

    def value(self, tree_or_expr) -> float:
        tree = parse(tree_or_expr) if isinstance(tree_or_expr, str) else tree_or_expr
        try:
            v = self._ev(tree.body)
        except ZeroDivisionError:
            return math.nan
        return float(v) if not _nan(v) else math.nan

    def truth(self, tree_or_expr) -> bool:
        v = self.value(tree_or_expr)
        return (not _nan(v)) and v != 0.0

    def _ev(self, n):
        if isinstance(n, ast.Constant):
            return float(n.value)
        if isinstance(n, (ast.Name, ast.Attribute)):
            return self.h.cur(_var_name(n))
        if isinstance(n, ast.UnaryOp):
            x = self._ev(n.operand)
            if isinstance(n.op, ast.Not):
                return 0.0 if (not _nan(x) and x != 0) else 1.0
            return -x if isinstance(n.op, ast.USub) else x
        if isinstance(n, ast.BinOp):
            a, b = self._ev(n.left), self._ev(n.right)
            if isinstance(n.op, ast.Add):
                return a + b
            if isinstance(n.op, ast.Sub):
                return a - b
            if isinstance(n.op, ast.Mult):
                return a * b
            return a / b if b != 0 else math.nan
        if isinstance(n, ast.Compare):
            a, b = self._ev(n.left), self._ev(n.comparators[0])
            if _nan(a) or _nan(b):
                return 0.0
            op = n.ops[0]
            if isinstance(op, (ast.Eq, ast.NotEq)):
                return float((abs(a - b) < 1e-9) == isinstance(op, ast.Eq))
            return float((a > b) if isinstance(op, ast.Gt) else (a < b) if isinstance(op, ast.Lt)
                         else (a >= b) if isinstance(op, ast.GtE) else (a <= b))
        if isinstance(n, ast.BoolOp):
            vals = [self._ev(v) for v in n.values]
            t = [(not _nan(v)) and v != 0 for v in vals]
            return float(all(t) if isinstance(n.op, ast.And) else any(t))
        if isinstance(n, ast.Call):
            fn = n.func.id
            if fn in HIST_FNS:
                name = _var_name(n.args[0])
                rest = [self._ev(a) for a in n.args[1:]]
                return self._hist(fn, name, rest)
            args = [self._ev(a) for a in n.args] if fn != "share" else [_var_name(n.args[0])]
            return self._val(fn, args)
        raise DSLError(f"cannot evaluate {type(n).__name__}")

    def _hist(self, fn, name, rest):
        if fn == "lag":
            s = self.h.series(name, int(rest[0]) + 1)
            return s[0] if len(s) > int(rest[0]) else math.nan
        if fn in ("delta", "slope"):
            k = int(rest[0])
            s = self.h.series(name, k + 1)
            if len(s) <= k:
                return math.nan
            d = s[-1] - s[0]
            return d if fn == "delta" else d / k
        if fn in ("mean", "min", "max"):
            s = [x for x in self.h.series(name, int(rest[0])) if not _nan(x)]
            if not s:
                return math.nan
            return sum(s) / len(s) if fn == "mean" else (min(s) if fn == "min" else max(s))
        thr, k = rest[0], int(rest[1])
        s = [x for x in self.h.series(name, k) if not _nan(x)]
        if fn == "cum_below":
            return sum(max(0.0, thr - x) for x in s)
        if fn == "cum_above":
            return sum(max(0.0, x - thr) for x in s)
        if fn == "hours_below":
            return float(sum(x < thr for x in s))
        return float(sum(x > thr for x in s))

    def _val(self, fn, a):
        if fn == "add":
            return a[0] + a[1]
        if fn == "sub":
            return a[0] - a[1]
        if fn == "mul":
            return a[0] * a[1]
        if fn in ("div", "ratio"):
            return a[0] / a[1] if a[1] else math.nan
        if fn == "neg":
            return -a[0]
        if fn == "abs":
            return abs(a[0])
        if fn == "clip":
            return min(max(a[0], a[1]), a[2])
        if fn == "max2":
            return max(a[0], a[1])
        if fn == "min2":
            return min(a[0], a[1])
        if fn == "share":
            tot = sum(v for k, v in (self.h.rows[-1] if self.h.rows else {}).items() if k.startswith("avail.") and not _nan(v))
            return self.h.cur(f"avail.{a[0]}") / tot if tot else math.nan
        raise DSLError(fn)


# ------------------------------------------------------------------ actions
def parse_action(s: str) -> tuple[str, list]:
    try:
        tree = ast.parse(s.strip(), mode="eval")
    except SyntaxError as e:
        raise DSLError(f"bad action syntax: {e.msg}") from e
    n = tree.body
    if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in ACTION_VERBS):
        raise DSLError(f"unknown action '{s}' (allowed: {', '.join(sorted(ACTION_VERBS))})")
    args = []
    for a in n.args:
        if isinstance(a, ast.Constant) and isinstance(a.value, (int, float)):
            args.append(float(a.value))
        elif isinstance(a, ast.UnaryOp) and isinstance(a.op, ast.USub) and isinstance(a.operand, ast.Constant):
            args.append(-float(a.operand.value))
        elif isinstance(a, ast.Name) and a.id in ("max", "discharge", "charge"):
            args.append(a.id)
        else:
            raise DSLError(f"action arguments must be numbers (or max/discharge/charge): '{s}'")
    return n.func.id, args


def apply_action(verb: str, args: list, act: dict, obs: dict, floor: bool = False):
    """Apply one action to the hourly action dict. Shedding/precommit use the more cautious value."""
    def bump(key, val):
        act[key] = max(act.get(key) or 0.0, val)

    if verb == "shed_to_reserve":
        target_res = args[0] if args else 2300.0
        ahead = args[1] if len(args) > 1 else 0.0
        trend = min(0.0, obs.get("supply_trend_1h", 0.0))
        help_mw = (act.get("imports_mw") or 0) + (act.get("dr_mw") or 0) + max(0.0, act.get("battery_mw") or 0) \
            + (act.get("conservation") or 0) * obs["demand_now"]
        projected = obs["supply_now"] + ahead * trend + help_mw
        need = max(0.0, target_res - (projected - obs["demand_now"]))
        bump("shed_mw", need)
    elif verb == "shed_frac":
        bump("shed_mw", args[0] * obs["demand_now"])
    elif verb == "restore":
        act["restore_mw"] = max(act.get("restore_mw") or 0.0, args[0])
    elif verb == "rotation":
        act["rotation_min"] = args[0]
    elif verb == "protect_gas":
        act["protect_gas"] = True
    elif verb == "rt_shed":
        act["rt_shed"] = True
    elif verb == "precommit":
        bump("precommit", min(1.0, args[0] if args else 1.0))
    elif verb == "conservation":
        bump("conservation", min(0.03, args[0]))
    elif verb == "imports":
        bump("imports_mw", obs["imports_max"] if not args or args[0] == "max" else min(args[0], obs["imports_max"]))
    elif verb == "dr":
        bump("dr_mw", obs["dr_available_mw"] if not args or args[0] == "max" else min(args[0], obs["dr_available_mw"]))
    elif verb == "battery":
        mx = obs.get("battery_mw_max", 0.0)
        if not args or args[0] == "discharge":
            act["battery_mw"] = mx
        elif args[0] == "charge":
            act["battery_mw"] = -mx
        else:
            act["battery_mw"] = max(-mx, min(mx, args[0]))
    elif verb == "call_ai":
        act["_call_ai"] = True
