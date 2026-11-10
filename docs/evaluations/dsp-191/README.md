# DSP-191: the run view as a live stream, as the window trial saw it

Screenshots and the results of `app/scripts/walk-follow-trial.mjs` on Windows, 10 November 2026, with the **simulated provider** (usage and reasoning simulated, one correction round, a provider failure in a second launch). Every text in them is the simulation's, marked SIMULATED; nothing here is what a real model writes. What the pictures establish is the product's handling: the heading, the liveness line and the loop on the left; the live stream beside it with the agent's reasoning and reply text open and growing, the role dividers, the tool lines, the reviewer's findings; no token, version, graph id or prompt text anywhere in the view.

| File | What it shows |
| --- | --- |
| `01-follow-planner.png` | The run view while the planner works: the liveness line, the planner node running, no stream open yet. |
| `02-follow-stream.png` | The live stream opened from the liveness line during the writer's first step: the planner's answer open above, DSpatch's own lines, the writer's divider. |
| `03-follow-correction.png` | The correction round in the same flow. |
| `04-follow-ended.png` | The run ended: the ending on the drawing, the liveness line with the job's own sentence. |
| `05-diff-clean.png` | The diff view: one line, nothing of the run. |
| `06-follow-history.png` | The finished run reopened from its files, the whole flow readable. |
| `trial-results-windows.json` | The 68 checks of that run. |
