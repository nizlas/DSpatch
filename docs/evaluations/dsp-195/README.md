# DSP-195 · Essentials in a whole generated walk, traced

Material for [DSP-195](../../../backlog/tasks/dsp-195%20-%20Essentials-visible-text-is-as-full-as-Standards-in-a-whole-generated-walk-trace-the-one-call-and-loop-chains-fix-the-established-cause.md), after DSP-192 and DSP-194. **Providers:** Copilot (`copilot-default`, reported `gpt-6-luna`), the configured provider, and Claude (`opus`, reported `claude-opus-5-5` where the harness captured it), the provider that reproduced the observation. The example is the invented debug-attach case of `app/tests/support/synthetic-attach.ts`; nothing here comes from a real project.

| Path | What it is |
| --- | --- |
| `JUDGMENT.md` | What drove the long text, in which stage, what changed, what the person now sees, what is established and what is not. |
| `side-by-side.md` | Every text of the comparison as the person reads it, before Show more and behind Show more apart, generated from the runs below. |
| `one-call/` | Whole walks prepared by the one-call preparation (the product default), per profile, provider and version: the definition, the provider turns with the reported model, the job result; the first prompt for one version 9 and one version 10 sample. `v9r-*` are the version 10 harness with the prompt put back to version 9 exactly; `abl-claude-essens-neutral` is a version 9 variation with the profile-blind content lines made neutral. |
| `locked/plan.json` | The locked plan: the Copilot loop planner's answer at version 9 (`loop/v9-attach-loop-essens/`), fixed for every locked run. |
| `locked/before-*`, `locked/after-*` | The loop writer (Essentials, Standard, Teacher) and the profile switch (Essentials, Teacher after the run's own Standard) on steps W1.1 (the attach configuration) and W1.6 (connecting to the listener), at version 9 and 10; prompts for the Claude sets. |
| `locked/connect-after-copilot/` | DSP-194's connect case at version 10, to compare with `../dsp-194/locked/final-v9/`. |
| `locked/ablation-*` | The controlled variations with Claude: at version 9 the writing rules' content line, the shared task and role purpose, the brief, the reference's calibration; at version 10 the shared rules on understanding and scope and the walk rules on orientation and transitions. Answers and manifests. |
| `loop/` | Whole loops: Copilot at version 9 (the locked plan's source) and Copilot and Claude at version 10, with every writer answer and the reviewer's prompts and answers. |
| `window/` | Window trials through DSpatch's real windows with the one-call preparation: pictures of the Step panel before Show more, with Show more open, and after a profile switch, and the panel's text as read. |

How it was made, from `app/`:

```
node --import ./scripts/ts-resolve.mjs scripts/walk-real-chain.mjs --case attach --method single|loop --profile essens|standard|pedagog --provider copilot|claude [--model opus] [--variant v9] --out <dir>
node --import ./scripts/ts-resolve.mjs scripts/profile-locked-compare.mjs --phase final|ablation-195 --case attach --plan-record <loop record.jsonl> --steps W1.1,W1.6 --provider copilot|claude [--model opus] --out <dir>
node --import ./scripts/ts-resolve.mjs scripts/profile-real-trial.mjs --case attach --method single --switch-only --profiles essens,standard --provider copilot --model copilot-default --out <dir>
node scripts/walk-step-surface.mjs <definition.review.json> .vscode/launch.json
```

Each script's header says exactly what it runs and what it does not. The synthetic repository is made anew for each run, so commit hashes differ between runs while the file content is the same. Absolute paths of temporary folders are written as `<home>…`.
