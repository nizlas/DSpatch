# DSP-196 · Calibration trial of the explanation profiles

Material for [DSP-196](../../../backlog/tasks/dsp-196%20-%20Calibration-trial-what-each-explanation-profile-organises-its-explanation-around-and-when-Essentials-base-explanation-is-done.md). A bounded trial, not a product change: the product's instructions are unchanged, and the variant exists only in the evaluation script. **Provider:** Claude, requested `opus`, reported `claude-opus-5-5` for every call. That is the agent and model DSpatch on this machine has chosen and that Niclas's walk preparations here used; whether his latest run on Linux used the same is not known.

| Path | What it is |
| --- | --- |
| `JUDGMENT.md` | Compatibility with the reference, the exact difference between baseline and variant, the judgment against the request's five questions, the remaining weaknesses and a proposal. |
| `texts.md` | Every text by step, profile and path, baseline and variant, before Show more and behind Show more apart, with the diagnostic without the planner's briefs. |
| `plan/` | The walk plan, locked for every call: a Standard loop by Claude on the invented case (`definition.review.json`, `record.jsonl`). |
| `trial/` | 48 answers (3 steps; Essentials, Standard, Teacher; writer and profile switch; baseline and variant; Essentials sampled twice), the manifest, `variant.json` with the baseline and variant texts, and four of the prompts. |
| `diagnostic-no-brief/` | 6 answers: the Essentials writer under the variant with the planner's briefs taken out, two samples per step. |

The example is invented: `app/tests/support/synthetic-exec-debug.ts`, a task that starts the service under debugpy in a dev container that is already running.

How it was made, from `app/`:

```
node --import ./scripts/ts-resolve.mjs scripts/walk-real-chain.mjs --case exec-debug --method loop --profile standard --provider claude --model opus --out <plan dir>
node --import ./scripts/ts-resolve.mjs scripts/profile-locked-compare.mjs --phase calibration-196 [--nobrief-only] --case exec-debug --plan-record <plan dir>/record.jsonl --steps W1.2,W1.7,W1.3 --provider claude --model opus --out <dir>
```
