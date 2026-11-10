# DSP-189 evaluation materials: code walks by one call and by the planner, writer and reviewer loop

Materials for Niclas's judgment of the first evaluation version of the walk loop (10 November 2026). Everything here is generic synthetic code from `app/tests/support/synthetic-walks.ts` and `app/tests/support/synthetic-cases-more.ts`; no workplace code.

## Three kinds of evidence, kept apart

1. **Product behaviour with the simulated provider.** Automated tests and the window trial (`app/scripts/walk-loop-trial.mjs`, run in `linux-verify`). They establish the interface, the routing, the one correction round, the state, cancellation, the record and the rendering. They say nothing about text quality.
2. **The product path with a stand-in for the provider, answered by a model outside DSpatch.** `app/scripts/walk-loop-answer.mjs` runs the real job service, revision snapshot, drawing, roles, engine, readers and record; only the adapter is substituted by one that writes each prompt to a file and waits for an answer file. The answers were written by Claude subagents (one per role session, with read-only access to the revision folder), outside DSpatch's providers. The files here are the exact prompts the product sent, the exact answers it read, and the definitions it wrote. **This is not evidence of the product path with Niclas's provider**, and the answer times are a subagent's, not a provider's. One harness artefact: the product prompt says "your working folder" because the real session runs inside it; the stand-ins took the folder's path from the exchange's metadata.
3. **Niclas's judgment with his provider on real code.** Open; nothing here replaces it. Acceptance criterion 5 of DSP-189 stays open for it.

## Files

| File | What it is |
| --- | --- |
| `JUDGMENT.md` | The synthesis for the task report: what the loop added across the five cases, what the reviewer did, what the evaluation found about the product, wait and usage as far as they exist, and what remains. |
| `JUDGMENT-connect.md`, `JUDGMENT-work-queue.md` | Two independent judges' readings (each by a model with no sight of the other or of the synthesis), against the code, of the loop, the one call and *Explain this* for those two cases. |
| `connect-loop-standard.md` | The connect case (TypeScript: a connection with retries, two outcomes, a deferred callback) through the loop, Standard profile, first reviewer instruction: plan, every step's text, the reviewer's verdict, every prompt and answer. |
| `connect-loop-standard-2.md` | The same case run again after the reviewer's instruction was sharpened (a statement about the code that is not true is a finding whatever its size). |
| `connect-single-standard.md` | The same case, profile and stand-in through today's one call. |
| `work-queue-loop-standard.md`, `work-queue-single-standard.md` | The work-queue case (C++: a mutex-protected map of shared slots, a worker thread, waiting and notification, shutdown) through the loop and through one call. |
| `setting-loop-standard.md`, `setting-single-standard.md` | A simple setting (TypeScript: an option declared, passed on from the environment, used as a loop bound). |
| `snapshot-loop-standard.md`, `snapshot-single-standard.md` | A shared snapshot (C++: a `shared_ptr` published under a mutex, a feed callback replacing it, a consumer thread reading outside the lock). |
| `context-loop-standard.md` | External code context (TypeScript app calling a library of the workspace, `count-lib`, pinned at 1.0.0 while the library's HEAD moved on), first run: the reviewer's structural finding here was caused by a defect in the loop's prompts, found by this run and fixed in the task. |
| `context-loop-standard-2.md` | The same case after the fix and with the sharpened reviewer: three explanation findings, three steps written again, accepted. The first drafts and the final texts are shown side by side under the steps. |
| `context-single-standard.md` | The same case through one call. |
| `explain-this-connect.md`, `explain-this-work-queue.md` | *Explain this* on the central lines of each case (the prompt is unchanged since DSP-188; the answers are the ones judged there, 9 November 2026). |

Each run file starts with the run's facts (status, path through the drawing, rounds, turns, times) and ends with every prompt and answer whole, so a claim in a judgment can be checked against the text it is about.

## How to read the comparison

Judge understanding, not counts: can the reader follow the course (calls, returns, alternatives as alternatives, the worker or callback and its context), is each shown place explained at the Standard reader's level, is what the text claims true of the code (the code is in the synthetic cases' files), and does the deepening continue the first part. Look at whether the reviewer's findings were real shortcomings, whether the rewritten steps improved, and whether something the reviewer should have caught was missed.
