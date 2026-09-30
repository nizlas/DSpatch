---
id: DSP-44
title: Say "I could not check this" without the run breaking
status: To Do
assignee: []
created_date: '2026-09-18 17:25'
updated_date: '2026-09-19 08:51'
labels: []
dependencies:
  - DSP-43
priority: high
type: feature
ordinal: 15592
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

When there is no command to run, the gate returns a runtime fault and the run stops under stop-and-reconcile, telling the user their files were changed and DSpatch cannot say whether they still work. That was the right answer while the gate was mandatory: a loop that knowingly started without its second half had sold something it could not deliver, and the fault was how it said so.

As a general behaviour it is wrong. A project whose check nobody has worked out is an ordinary state, not a broken machine, and reconciliation is what a person does when something might have half-happened. Nothing half-happened here. Asking for reconciliation teaches people that DSpatch's reconciliation messages can be ignored, which is expensive for the ones that matter.

### The distinction that must not collapse

DSP-26 #2 names five states and they all stay distinct. Only one moves: "there was nothing to run" becomes a verdict the graph routes. "There was a command and it would not start" and "it started and never came back" remain faults, because in those cases something really did break and the run's outcome really is unknown.

### What this unlocks

Once "not checked" is a routable outcome rather than a stop, a graph can send it somewhere useful — today to an ending that says so plainly, later to a human node that asks how the project should be checked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When there is no command to run, the run reaches an ending saying the work was not checked, rather than stopping as though DSpatch had broken.
- [ ] #2 That ending is plainly distinguishable from tests that ran and failed, from a command that could not be started, and from one that did not finish — on screen and in the saved record.
- [ ] #3 A command that could not be started, and one that did not finish, still stop the run for a person, exactly as they do now.
- [ ] #4 A person reading a finished run can tell, without inference, whether their project was actually checked.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in run `20260918-171500-shape`, call 002, together with DSP-43.

When the gate finds nothing to run and the node declares `not-verified`, it now returns that outcome instead of a runtime fault, and the run completes at a `not-checked` terminal rather than stopping under stop-and-reconcile.

**Exactly one state moved, and it was checked from both sides.** A command that could not be started still produces `no-outcome-delivered`, and one that did not finish still produces `step-timed-out`; both still stop the run for a person. A gate that does not declare `not-verified` also still faults, and its message now names the drawing as the reason, because on that path the reader's next question is why an ordinary state stopped the run and the answer is in the graph file rather than in their project. The same command record was run through the untouched `dspatch-live-duration` fixture as a negative control, where the gate draws no third verdict and still faults.

The command record itself is unchanged: `notRun.kind` is still `no-command-configured` and `exitCode` is still `null`, so `runOutcomeFrom` reads the commands before the status and the new completed walk reports `verification-not-performed` rather than earning `work-verified` by arriving somewhere.

**Open for Niclas, not blocking.** The `nothing-changed` and `not-checked` endings share the recorded outcome `verification-not-performed`, and the shared sentence ends "Anything the agent changed is still in the working copy, unchecked" — which on a run that changed nothing is a warning about changes that do not exist. The recommendation is to thread the snapshot counts `main.ts` already holds into `RunOutcomeInput` as an optional field and fix only the sentence, rather than adding a sixth outcome kind while DSP-26 is in Review and awaiting his assessment.
<!-- SECTION:NOTES:END -->

## Verification Notes

<!-- SECTION:VERIFY:BEGIN -->
Call 003 verified this on candidate-2.

**#1, #2 and #3 are reproduced.** #3 was checked across the full three-by-two matrix — each of the three `notRun` kinds on each of the two real graphs — and exactly one cell moved, only on the graph that declares the outcome. `dspatch-live-duration` was proved byte-identical against candidate-1's recorded hash rather than by `git diff`, which would have been empty for the wrong reason because `docs/loop/graphs/` is untracked.

**#4 is PARTIAL, not PASS.** Call 002's own §6.2 said two endings share the outcome `verification-not-performed` and its paragraph. It is **three**. The third is `stopped`, where an agent that refused the task is told, word for word, that the project was not tested and that anything it changed is still in the working copy unchecked. For that ending all three clauses are wrong at once. Telling three different runs apart from one identical paragraph is exactly the inference this criterion forbids.

**The recommended fix is wider than call 002 proposed.** Threading the snapshot counts cannot separate `stopped` from `nothing-changed`, because both have zero counts and empty command lists. The distinguishing fact is which terminal the walk reached, and `main.ts` holds `result.terminalNodeId` at the same moment it holds the counts. Thread the terminal id. Same additive shape, still no sixth `RunOutcomeKind` while DSP-26 awaits Niclas.
<!-- SECTION:VERIFY:END -->

## Rework Notes

<!-- SECTION:REWORK:BEGIN -->
Call 004 fixed #4. The terminal node id is threaded as an additive optional `walk` field on `RunOutcomeInput`, carrying the terminal and the bounded moved paths.

`runOutcomeFrom` deliberately does **not** read it. DSP-26 #3 is that arriving at a terminal earns nothing, and `runOutcomeFrom` is the single place that could allow a second way round that rule, so the terminal may change the sentence and may never change the value. A test asserts this over every terminal the chat loop has, for three different command lists.

Measured result: the three endings that shared one paragraph now produce **3 distinct sentences of 3, against 1 of 3 before.** `stopped` says the agent stopped instead of doing the work and no longer warns about changes that were not made; `nothing-changed` says there was nothing to test and no longer describes anything as unchecked.

No sixth `RunOutcomeKind`, so DSP-26's vocabulary did not move while it awaits Niclas. The badge remains *nothing was checked* for all three, which is now true of all three rather than misleading. Whether `nothing-to-check` would be the better vocabulary is a question for Niclas, not a residual defect.
<!-- SECTION:REWORK:END -->

## Verification (call 006)

<!-- SECTION:NOTES:BEGIN -->
Verified on `candidate-6`. **#4 PASS in the record, HUMAN_PENDING on screen. The verifier withdrew its own PARTIAL from call 003.**

Three endings now produce three distinct sentences, measured as 3 of 3 against 1 of 3 before. `stopped` says the agent stopped instead of doing the work and its own reply is the account of why; `nothing-changed` says there was nothing to test and nothing is left unchecked. Neither warns about changes that were not made.

One dependency worth knowing: **without the walk the three collapse back to two**, measured. The distinctness rests entirely on `closeChatLoopRecord` passing it, which it does and which is the only caller that can. Any future reader that recomputes the sentence rather than reading the stored `outcomeText` loses the distinction silently.

The badge stays `nothing was checked` for all three. With three true sentences beneath it that is correct rather than residual; a sixth `RunOutcomeKind` named `nothing-to-check` remains Niclas's vocabulary call, alongside DSP-26.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Superseded in part. **Kept:** "I could not check this" must be a routed ending rather than a fault, and the three endings must read as three situations. **Removed:** its home, the `not-verified` verdict of a gate that spawns one configured command. The equivalent is now an agent's own `could-not-check` verdict. Re-target the criteria at the agent step rather than closing them.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
