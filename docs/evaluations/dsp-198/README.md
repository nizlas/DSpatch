# DSP-198 · One replacing writing task for Essentials, tried against today's instruction

Material for [DSP-198](../../../backlog/tasks/dsp-198%20-%20Essentials-gets-one-coherent-writing-task-that-replaces-its-current-instructions-if-a-small-comparison-shows-it-helps.md). The trial did not show a clear improvement, so the product is unchanged; nothing here is an active instruction.

| Path | What it is |
| --- | --- |
| `JUDGMENT.md` | The map of what reaches an Essentials writer outside its definition, the exact difference between A and B, the judgment, and what this suggests. |
| `texts.md` | The texts of A and B for both steps, with the step summary shown first, before Show more and behind Show more apart. |
| `baseline/` | Today's instructions for Essentials at version 11, as the product builds them for one step (W1.2) of the invented example, with no model call. It holds the one-call preparation, the loop writer's first and later turn in a session, the profile switch, regeneration, and the loop reviewer. |
| `compare/` | The 8 answers (2 steps × A and B × 2 samples), the manifest, the locked plan, and the prompts of sample 1 for both steps in A and B. |

Provider: Claude, requested `opus`, reported `claude-opus-5-5` for every call. The example is invented: `app/tests/support/synthetic-exec-debug.ts`. No work code and no work logs are used.

How it was made, from `app/` (the plan is the DSP-196 loop plan):

```
node --import ./scripts/ts-resolve.mjs scripts/profile-locked-compare.mjs --phase baseline-198 --case exec-debug --plan-record <plan record> --steps W1.2 --provider claude --model opus --earlier <an earlier Essentials text> --out <dir>
node --import ./scripts/ts-resolve.mjs scripts/profile-locked-compare.mjs --phase compare-198 --case exec-debug --plan-record <plan record> --steps W1.2,W1.7 --provider claude --model opus --out <dir>
```
