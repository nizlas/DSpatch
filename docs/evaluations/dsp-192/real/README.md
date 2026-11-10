# The three profiles through the real provider flow (DSP-192 follow-up, 10 November 2026)

The same change in Essentials, Standard and Teacher through DSpatch's real provider flow with the provider and model Niclas has chosen in DSpatch, **Claude, model id `opus`**, at instruction version 8. Nothing simulated, no answer written by hand: the product's windows, job service, revision snapshot, walk loop drawing and roles, run engine, Claude adapter and record did the work over a fresh profile and a disposable project, with Niclas's own profile and reviews untouched.

## Contents

| Path | What it is |
| --- | --- |
| `side-by-side.md` | The texts side by side, made by `app/scripts/profile-real-collect.mjs`: the runs, the three plans with the reviewer's verdicts, then for the simple step and the complex step the Standard, Essentials and Teacher texts as the loop's writer wrote them, and the Essentials and Teacher alternatives made after the Standard walk. Generation path named at every text. |
| `JUDGMENT.md` | The judgment: abstraction level, clarity and pedagogical help per profile and path, correctness, what the comparison shows and what it cannot. |
| `summary.json` | The trial's summary: provider, model, the authorization reference, the chosen steps, the three jobs, the four explanations. |
| `trial-results.json` | Every check the trial script made, with its time. |
| `records/generated/<review>/<job>.review.json` | The walk definition each loop run wrote: the plan, every step's text, places and provenance. |
| `records/generated/<review>/<job>.walk-loop/record.jsonl` | The run record: the journal, and every prompt and reply of the planner, the writer and the reviewer. |
| `records/generated/<review>/<job>.walk-loop/summary.json` | The loop's own summary: the path, the rounds, every turn with its time. |
| `records/<review>.explanations.json` | The step explanation store of the Standard review: the four alternatives with their prompts, texts and status. |

Absolute paths of the temporary folders are written as `<home>…`. No credential, login name or private endpoint is kept; the Claude authorization reference in `summary.json` is the text DSpatch shows in Session details, a reference to Niclas's go-ahead, not a token.

## How it was run

1. `node --import ./scripts/ts-resolve.mjs scripts/profile-real-trial.mjs --provider claude --model opus` from `app/`, after `npm run build`: a fresh profile seeded with the project, the agent and the model; DSpatch's main window, the project opened from Recent, Open review, the pair chosen; *Prepare code walks* with Claude, `opus`, Standard and the loop; the walk window opened and the reading profile switched to Essentials and to Teacher on the two steps; then a new review of the pair prepared by the loop in Essentials, and another in Teacher. Every DSPATCH_, CLAUDE_ and ANTHROPIC_ variable of the launching shell is dropped, so DSpatch sees the machine's own environment; the adapter refuses a launch that carries Claude Code's variables.
2. The first attempts of the day stopped on faults of the script itself (a bridge call that bypassed the start page, the finished job line, a streaming status read as a failure, the All reviews button), each fixed in the script; the run kept here is the one in which the Standard loop and the four switches ran in one attempt and the two remaining loops in a resumed attempt over the same profile (`--resume`). The provider was asked the same things each time; the earlier attempts' texts are not kept.
3. `node scripts/profile-real-collect.mjs <evidence folder>` wrote `side-by-side.md`; the judgment was written by hand against the code.

## Steps

Simple: the registration in `startSession` (`src/session.ts` target 3–5), W1.1 in all three plans. Complex: `settle` (`src/link.ts` target 32–38), W1.5 in the Standard plan and W1.4 in the Essentials and Teacher plans. The plans differ because each loop run plans anew and the planner is not told the profile; the writer-path texts are therefore compared by code place.
