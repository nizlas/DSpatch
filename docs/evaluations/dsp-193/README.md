# DSP-193 · The delegated-review trial: evidence

Screenshots and results of `app/scripts/delegation-trial.mjs` run on Windows on 10 November 2026 against the build of this change, with the provider SIMULATED (`DSPATCH_REVIEW_SIM=mixed`). They show the product's handling of a delegated review's result and the person's decision; they say nothing of an agent's review quality.

| File | What it shows |
| --- | --- |
| `01-diff-findings-folded.png` | The diff view after the whole change was delegated: the report folded ("awaiting your assessment"), the file at 0 % with its assessed lines drawn hollow in the agent's colour, the findings folded one line each, one opened by the person with a comment. |
| `02-diff-accepted.png` | The same view after *Accept the agent's assessment*: the assessed lines in the agent's colour, the file counting them, the findings as they were. |
| `03-step-review-section.png` | The floating Step panel with its Review section open: the step's decisions, the walk's delegated review folded, the delegation control, the agent's findings at this step folded. |
| `04-step-panel-narrow-floating.png` | The floating Step panel at 420 px: a finding's title on a line of its own, the metadata below it, one finding opened by the report's line with its discussion reachable. |
| `05-walk-docked-narrow.png` | The walk window at 980 px with the panel docked and narrow. |
| `06-step-panel-docked-narrow.png` | The docked narrow panel's Step tab. |
| `07-diff-older-record.png` | After a restart with the decision marks removed from the record, as a 0.1.17 record would be: the earlier agent approval reads as an assessment awaiting the person, not as a decision; the findings and the earlier comment are kept. |
| `trial-results.json` | Every check of the run with its reading (51 entries, all passed; the home folder written as `<home>`). |
