# DSP-192 · Explanation profiles: baseline, comparison and judgment

Material for [DSP-192](../../../backlog/tasks/dsp-192%20-%20Clarify-the-explanation-profiles-pedagogical-responsibilities-in-the-reference-and-derive-the-role-descriptions-and-runtime-instructions-from-it.md): the instructions before the change, the prompts the product builds after it, the texts a stand-in model wrote from them, and the judgment of those texts.

**Not evidence of a provider.** The texts were written by a Claude model running as a Claude Code subagent outside DSpatch's providers; the product's prompt builders made the prompts, but the product's job service, run engine and record were not used. What Niclas's provider does with the same prompts is not established here.

## Contents

| Path | What it is |
| --- | --- |
| `baseline/instructions-v7.md` | The presentation instructions at version 7 (before DSP-192), printed from the source of that version with `app/scripts/print-instructions.mjs`: the shared rules, the three readers, the deepening rules and the regenerate rule. |
| `baseline/README.md` | Where the representative Standard answers before the change are: DSP-189's connect run 2. |
| `instructions-v8.md` | The same sections at version 8 (after DSP-192), printed the same way, to read beside the baseline. |
| `run/manifest.json` | The revision pair, the folder the stand-in read, and the nine prompts with their generation paths. |
| `run/prompts/*.md` | The nine prompts, verbatim as the product's builders made them at instruction version 8. |
| `run/answers/*.md` | The nine answers, verbatim as the stand-in wrote them. |
| `run/JUDGMENT.md` | The judgment: correctness against the code, the help for each profile's reader, Path A against Path B, version 7 against 8, what the comparison cannot show, the fault fixed once, remaining weaknesses. |

## The nine prompts

| Name | Path | Step | Profile | Version |
| --- | --- | --- | --- | --- |
| `writer-essens-W1.1` | A: loop writer (`writeStepPrompt`) | W1.1 | Essentials | 8 |
| `writer-standard-W1.1` | A | W1.1 | Standard | 8 |
| `writer-pedagog-W1.1` | A | W1.1 | Teacher | 8 |
| `writer-essens-W1.5` | A | W1.5 | Essentials | 8 |
| `writer-standard-W1.5` | A | W1.5 | Standard | 8 |
| `writer-pedagog-W1.5` | A | W1.5 | Teacher | 8 |
| `present-essens-W1.5` | B: step explanation channel (`stepExplanationPrompt`), prepared text = DSP-189 Standard W1.5 | W1.5 | Essentials | 8 |
| `present-pedagog-W1.5` | B | W1.5 | Teacher | 8 |
| `writer-essens-W1.5-v7` | C: A with version 7's reader, boundary and deepening rules substituted | W1.5 | Essentials | 7 |

Path A is how the walk loop writes a step during generation; Path B is how a profile alternative is made after the walk exists; Path C is the before-picture for Essentials. The plan, revision and steps are the same in all nine. The profile keys in the names are the product's internal ids (`essens`, `standard`, `pedagog`); the readers are called Essentials, Standard and Teacher.

## How it was made

1. `node --import ./scripts/ts-resolve.mjs scripts/profile-compare.mjs <output folder>` from `app/` writes the synthetic connect repository and its revision folder to a temporary directory, builds the nine prompts with the product's builders and writes `run/prompts/` and `run/manifest.json`. The locked plan is walk W1 of DSP-189's connect run 2, transcribed into the script with its briefs and places.
2. One fresh Claude Code subagent per prompt, with Read, Grep and Glob restricted to the revision folder, answered the prompt and wrote the answer to `run/answers/`.
3. The answers were read against `src/link.ts` and `src/session.ts` at both revisions and judged in `run/JUDGMENT.md`.

The temporary revision folder is not kept; the synthetic case is `tests/support/synthetic-walks.ts` (`CONNECT_CASE`) and can be written again by the script.
