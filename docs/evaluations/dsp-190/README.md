# DSP-190: the run view, as the window trial saw it

Screenshots and the results of `app/scripts/walk-follow-trial.mjs` on Windows, 10 November 2026, with the **simulated provider** (`DSPATCH_PRESENTATION_USAGE=1`, `DSPATCH_PRESENTATION_REASONING=1`, `DSPATCH_REVIEW_SIM=loop-rework`, and in a second launch `DSPATCH_PRESENTATION_FAIL_TASK=write-step`). Every text, reading and finding in them is the simulation's, marked SIMULATED; nothing here is what a real model writes or reports. What the pictures establish is the product's handling: what the window shows, when, and from which events.

| File | What it shows |
| --- | --- |
| `01-follow-planner.png` | The run view opened while the planner works: the planner node running with the editor's motion, the activity panel following its visit, the tool reads and usage readings as they arrived. |
| `02-follow-writer.png` | The writer's first visit: the turn DSpatch sent (which step, how many of how many), the exposed reasoning text and the reply text expanded, the usage of the turn, the turn's end. |
| `03-follow-correction.png` | The correction round: the reviewer asked for rework, the path back to the writer drawn as taken, the writer's second visit running. |
| `04-follow-ended.png` | The run ended at *Delivered with objections*: the tick the drawing declares, every visited node done, the summary strip with the usage summed per field and per model call. |
| `05-diff-clean.png` | The diff view after the preparation: one line, *Prepared through the planner, writer and reviewer loop* with *Follow preparation*, and nothing of the run. |
| `06-follow-history.png` | The finished run reopened from its files: the same visits, the final assessment's visit shown, every prompt and answer on request. |
| `07-walk-essentials.png` | The walk read in Essentials after being prepared in Standard: the step's Essentials explanation asked for once, the walk's structure as prepared, no staleness notice. |
| `08-follow-stopped.png` | A second review of the same pair stopped from its run view. |
| `09-follow-failed.png` | A provider failure in the writer's first turn: the writer marked failed, the turn's end with the provider's own error, no resend. |
| `trial-results-windows.json` | The 67 checks of that run, each with what it measured. |

The same trial runs in `linux-verify` under Xvfb; its screenshots are in the workflow's `walk-follow-trial` artifact.
