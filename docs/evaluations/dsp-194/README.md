# DSP-194 · Essentials' selection, on one locked plan, with Copilot

Material for [DSP-194](../../../backlog/tasks/dsp-194%20-%20Essentials-selects-its-own-main-picture-a-locked-plan-comparison-and-a-fix-where-the-over-detail-arises-also-when-switching-profile-on-a-walk.md), the follow-up of DSP-192. **Provider Copilot through DSpatch's Copilot adapter with the existing sign-in, model `copilot-default`**; nothing simulated, nothing written by hand. Not the Claude `opus` run of DSP-192.

| Path | What it is |
| --- | --- |
| `JUDGMENT.md` | What drives the detail (the ablation), the fix, the comparison at version 9, what it shows and what it cannot. |
| `baseline/instructions-v8.md` | The presentation instructions at version 8, before this change. |
| `baseline/claude-present-essens-W1.1-v8.prompt.md` | The exact profile-switch prompt of the DSP-192 Claude run (Essentials, W1.1), where the paths were first traced. |
| `locked/plan.json` | The locked plan: the planner's answer of the DSP-192 real Standard run. |
| `locked/side-by-side.md` | Every text of the locked comparison, first part and Show more apart, by step, profile, path and version, with the ablation's variations. |
| `locked/ablation-v8/` | Version 8: Standard and Essentials by the writer, Essentials without the briefs, Essentials after Standard as built, without the answer format's content rules, and without the walk's text. Prompts, answers, manifest. |
| `locked/v8-teacher/` | Version 8 Teacher, writer and profile switch: the version 9 prompts with this change turned back exactly. |
| `locked/final-v9/` | Version 9: Essentials, Standard and Teacher by the writer, Essentials and Teacher after this run's Standard. |
| `product-path/` | The profile switch through DSpatch's real windows with Copilot at version 9 (`profile-real-trial.mjs --switch-only`): its own Standard loop, then Essentials and Teacher on two steps; texts, records, explanations store, trial results. |

How it was made: `node --import ./scripts/ts-resolve.mjs scripts/profile-locked-compare.mjs --phase ablation|v8-teacher|final --provider copilot --out <dir>` from `app/` (the harness's header says exactly what it runs and what it does not), and `scripts/profile-real-trial.mjs --provider copilot --model copilot-default --switch-only`. Absolute paths of temporary folders are written as `<home>…`.
