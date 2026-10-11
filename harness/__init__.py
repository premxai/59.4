"""4:37 harness: the AI operator's evolving operating manual, the frozen operator, and the night coach.

Layers:
  L0  operator.HarnessPolicy  frozen LLM (Qwen3-30B on Nebius) + the manual (gauges, habits, hard limits)
  L1  coach.propose / gate     Claude Opus 5.5 reads a failure, proposes manual edits, keeps only safe wins
  L2  meta (later)             improves how the coach works
Every step emits plain-language events for the Mission Control screen.
"""
