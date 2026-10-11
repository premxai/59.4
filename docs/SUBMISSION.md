# Submission text (copy into the form)

**Title:** 59.4: a frozen AI learns to keep Texas lit by rewriting its own operating manual

**One line:** Same model, never retrained. Only its harness evolves, and every change is tested before it is kept.

**Description:**
In February 2021 the Texas grid stayed below 59.4 Hz for over four minutes. Nine minutes means total blackout.
59.4 is a self-improving harness for a frozen operator AI (Qwen3-30B) that runs a locked, calibrated Texas winter-grid
simulator. Every night a coach (Claude Opus 5.5) reads why the grid failed, proposes small edits to the operator's
notebook (rules, guardrails, context policy, tool access), and a test gate keeps an edit only if failed storms improve
and calm days stay calm; cheats are rejected. Every two nights the coach grades its own coaching, and that rewrite is
A/B-tested too.

Results: on 8 storms it never saw (3 runs each) Track B went 0/8 to 8/8 at its best, 6/8 for the final frozen notebook,
with 93% fewer home-hours in the dark. On the real 2021 storm, run once from a MongoDB vault the AI cannot read, nobody
passes, but the learned notebook never collapses the grid and cuts darkness 89%; it transfers to Gemma too.

MongoDB Atlas holds every notebook version, idea, test, lesson and coach review, with role-based access separating the
learner from the exam. Raindrop traces every AI decision; in one night the coach's evidence was read back out of
Raindrop's flags (its two fixes were tested and rejected: the gate holds the same bar).

Screens: Stage (break the grid live), Live lab (any storm, any two notebook versions, side by side), Evidence site
(every version, night, trace and record).

**Links:** site: https://59-4.vercel.app · repo: https://github.com/premxai/59.4 · video: <video URL>
