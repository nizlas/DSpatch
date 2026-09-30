---
id: DSP-97
title: >-
  Decide what the loop says when the work was accepted and the run could not
  report on it
status: Done
assignee: []
created_date: '2026-09-22 18:35'
updated_date: '2026-09-30 19:35'
labels:
  - loop-graph decision
dependencies: []
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Handed back for a decision from the DSP-96 complement, report .dspatch-loop/runs/20260920-104500-folders/reports/032-implementer-a-later-correction-and-what-delivered-means.md. Not started, and deliberately not patched. In dspatch-development-loop-runnable.graph.json the coordinator-report node declares no outcomes and no declared failures, so it has no routable way to say it could not do its own step. Since DSP-96 such a step is told to describe an obstacle in ordinary prose rather than open with a word the graph cannot route, which is right, because the alternative faults the run at the last node and loses the report with it. The consequence is one narrow path: a report step that files a report saying it could not do its own work still produces success, takes e14 and reaches delivered, whose ending is success. What that marks is the tick on the Delivered node in the graph view and nothing else. The recorded outcome is still verification-not-performed, the badge reads from the outcome and not from the terminal, runOutcomeFrom never reads terminalNodeId, and the sentence beside it still says the run says nothing about the project. The worst case is already caught: produces.required true means a step that files nothing faults with required-result-missing and never reaches delivered. So nothing is broken until a report step actually hits an obstacle; the tick is simply ahead of the facts on that one path. The decision is what ending this loop should have for it. Routing to stopped would be untrue, since the work was completed, verified and accepted and is in the working copy. Routing to needs-a-decision would be untrue, since the review accepted and there is nothing to decide except that the summary is missing. A new terminal is a change to this loop's own vocabulary of endings and is an authoring decision. The same gap exists on implementation-review, which also declares no failures, so a blocked reviewer today ends the run as an undeclared-product runtime fault; whether both get a route, and whether they share one, is the same decision. Do not resolve it by relabelling delivered and do not resolve it by reading report text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The loop has a routable answer for a step that completed the work but could not report on it, or it is recorded as a decision that it should not
- [x] #2 Whether implementation-review shares that route is settled at the same time
- [x] #3 Delivered is not relabelled and no mechanism reads a report body to decide an outcome
- [x] #4 The loop has a destination for a step that could not complete its reporting contract, described factually as ended without complete reporting rather than asserting the work is done
- [x] #5 The actual reason is preserved and any evidence about completed work is stated separately from the ending itself
- [x] #6 implementation-review may share the destination where its reporting contract cannot be fulfilled, with the reason still distinguishable, and its ordinary verdicts keep their existing routes
- [x] #7 No missing report is inferred from free prose and no report body is read to decide an outcome
- [x] #8 Delivered is not relabelled and no general redesign of terminal states is undertaken
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Direction approved by Niclas on 30 September: do not introduce a terminal that asserts the work is done merely because a report is missing or files exist. The wording is Ended without complete reporting. Apply it in the supplied graph and its presentation using existing mechanisms. If the existing contract cannot express this without a new runtime mechanism, the gap and a minimal proposal come back rather than the mechanism being built. The provenance half of this card's overlap with DSP-102 and DSP-103 is handled there: a fallback outcome is marked as the engine reading an absence rather than the step's verdict.

Done on 30 September 2026 in the supplied graph only, with existing mechanisms and no new runtime machinery. A fourth terminal `reporting-incomplete`, labelled "Ended without complete reporting", `ending: not-success`. `coordinator-report` gains `reported` and `could-not-report`; `implementation-review` gains `could-not-review` alongside its three untouched verdicts. Edge `e14a` carries the report step there, `e13a` the review, and the two are told apart by the edge, the outcome name and the node the run came from (#1, #2, #6). `whenUndeclared` on both nodes makes a reply that names nothing a route rather than a fault at the last step of the run, and the recorded outcome's provenance keeps the step's own verdict distinct from the engine reading an absence (#7).

The ending asserts nothing about the work in either direction, `delivered` is unchanged, and `runOutcomeFrom` still never reads `terminalNodeId`, so the recorded outcome and the badge are what they were (#3, #8). The step's account is filed before the route is chosen, which is what makes the reason recoverable: the ending says the run did not report, the report that exists says why, and evidence about work that was done stays in the earlier steps' results and in the working copy (#5).

Verified on the runnable graph in `loop-run.test.ts` — the report step's route, the review's shared route, the three ordinary verdicts still on e11/e12/e13, `delivered` off the path, no tick, and filed-before-routed in the journal — and in `loop-live.test.ts` for the reply that names nothing, which needs a real reply read.

CORRECTION TO THE VERIFICATION CLAIM. The implementation report recorded `npm run test:loop` as exit 0. That claim was premature and is withdrawn. Run on the handed-over working copy, the group failed: one test of 563, `loop-run.test.ts:1110`, "ends at the new terminal when the report step says it could not report". The cause was in the test helper and not in the graph or the engine. `dryRunLeavingBodies` overwrote every result body with a fixed placeholder, so a decision's scripted account never reached the body and the assertion that the reason survives the route had nothing to read. The helper now keeps a scripted summary as the body and leaves the placeholder everywhere else. The two runs are distinct and both are on record: the earlier run of `test:loop` failed 1 of 563; the later run, after the helper was fixed, passed 563 of 563, and the whole suite passed 1223 of 1223 including `test:live`, which `test:fast` does not cover. `npm run typecheck` exits 0.

LIMITATIONS CARRIED FORWARD, neither of them an acceptance criterion of this card and neither addressed here. The new terminal has not been looked at in the running app: the tick, the reached mark and the node panel's account of the new outcome are derived from the fields set here and are asserted by unit test, so how it renders is intended rather than observed. And a reply opening with `BLOCKED` or `SPEC_ERROR` at `implementation-review` still produces an `undeclared-product` runtime fault, because `declaredFailureFrom` is read before any outcome and the node declares no failures; giving it a failure vocabulary is a separate decision about this loop and was out of the approved scope.
<!-- SECTION:NOTES:END -->
