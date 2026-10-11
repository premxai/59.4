"""4:37 grid simulator v1 (pre-2021 calibration only).

    from sim import run, run_many, policies
    from sim.scenarios import TRAIN_IDS, HELDOUT_IDS, GATE_IDS
    r = run("heldout_flash_2014", policies.StatusQuoPolicy(), seed=0)
    r.passed; r.verdict_plain; r.events; r.cause_summary; r.frame()

Interface documentation: sim/README.md
"""
from . import policies  # noqa: F401
from .api import run, run_many  # noqa: F401
