---
id: DSP-201
title: >-
  A walk step's Accept decides about the whole change instead of the lines the
  step marks
status: Review
assignee: []
created_date: '2026-11-12 13:14'
updated_date: '2026-11-12 13:40'
labels:
  - review
dependencies: []
priority: high
type: bug
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas found in 0.1.22 that Accept on a walk step decides about far more than the step marks: a new file of 417 added lines, a step marking lines 151-159, and Accept offered and recorded for lines 1-417. Accept, Exempt and Withdraw in a walk must decide about exactly the changed lines the walk's marking (the place's focus, drawn light green) covers, the same range the marking is drawn from; context, expansion, whole-file view, scrolling, callers and other places never widen it, and removed lines follow the same exact rule. The whole chain follows: the decision's model and validation, saving and reading back, coverage and file percentages, the walk's and the diff window's marks, and who-reviewed summaries. Older whole-hunk decisions are kept and not reinterpreted; where their origin cannot be established the walk says so and lets the person keep or withdraw them. Mark this step walked through stays a progress mark. No release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Accept, Exempt and Withdraw in a walk act on exactly the changed lines of the current place's focus, computed from the same reference and rows the marking is drawn from
- [x] #2 Expansion, whole file, scrolling, context places and other places never widen the scope; unchanged context lines are never counted; removed lines follow the same exact rule
- [x] #3 The button and confirmation name the exact lines that are saved
- [x] #4 The 417-line regression: marking 151-159 gives 9 accepted lines, 1-150 and 160-417 remain, the same after reopening and restart; withdrawing affects only those lines
- [x] #5 Two places in one hunk, overlapping places without double counting, removed and mixed changes are covered by tests
- [x] #6 Older whole-hunk decisions are preserved and not reinterpreted; where their origin is unknown the walk says so and offers keep or withdraw; the handling and its effect on earlier coverage figures are documented
- [x] #7 New decisions record where they were made (walk place or diff window)
- [x] #8 Real-window trial: the walk's marking, the scope Accept shows, the saved decision and the diff window's marks agree; expanded context changes nothing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Trace the walk's decision path (HunkDecisions, decide, hunkRanges, pair record, coverage). 2. An exact lines scope and an origin in the model, the pair record and the host's mark request, validated. 3. The scope from the same reference rows the marking is drawn from; one decision block per place. 4. Coverage, the pair bridge and the history line by line. 5. Older whole-change decisions kept, flagged where they reach beyond a marking, kept or withdrawn by the person. 6. Targeted tests, a real-window trial, VISION 3.4 decision, evaluation README.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause (v0.1.22 code): HunkDecisions offered one decision per hunk overlapping the place's focus and saved { kind: 'hunk' }; over a pair, decide wrote hunkRanges(hunk), every changed line of the hunk, into the pair record; currentHunkDecisions and computeCoverage counted the whole hunk. A new file is one hunk, so a place inside it accepted all of it (417 lines, not 9). The pair record itself already decided per line (DSP-150).

Fix: markedChangedLines(rows, focus, ownSide) reads the changed lines from referenceRows, the rows the marking is drawn from; a walk place marks its own side only (DSP-175), an opened location both. DecisionScope gains { kind: 'lines' }; ReviewDecision and PairMark gain an optional origin (walk step/place, opened, diff, kept); validated in checkStateForSave and the host's mark request (malformed origin refused, nothing written). Coverage, the pair bridge (lineDecisionsFromPair, pairHolds) and the history read line by line; a partly decided hunk says how much. The Review section shows one block per place with the exact lines in its buttons and confirmation; Withdraw clears exactly the place's lines. The diff window sends origin diff; its hover names the walk step.

Older decisions: a 0.1.22 walk Accept over a pair, the diff window's file and selection marks, and pre-pair { kind: 'hunk' } decisions cannot be told apart, so their intended scope is not established. They are kept and counted as recorded (earlier coverage figures unchanged, possibly overstating intent); where one reaches beyond a place's marking the walk says so and offers Keep it as recorded (same outcome, origin kept, over the lines it still holds) or Withdraw it (clears those lines). No range is derived from the walk shown now.

Verification: tests/walk-decision-scope.test.ts (7) — 417-line regression 9 accepted / 408 remaining (2.2%) in the walk record and the pair record, after save/read-back, withdraw affects only those lines; two places in a hunk (14), overlapping (15, no double count), context not counted, removed and mixed changes, older decisions, validation. review-pairs.test.ts: origin kept across a host restart, malformed origin refused. review group on Windows: all pass except review-context.test.ts 'reads lib as context', which fails the same on a clean 1e4bdab checkout (path separator in the test), unrelated. Typecheck node, renderer, tools green.

Real-window trial scripts/accept-scope-trial.mjs on Windows, 32 of 32 (docs/evaluations/dsp-201/final): the walk marks rows 151-159; Accept names new lines 151-159 before and after Whole file; the saved mark is target 151-159 with origin walk W1.1; the diff window draws 151-159 of 417 reviewed; a second place adds its own 5 and withdrawing it leaves 9; same after reopening the walk window and after restarting app and host; an earlier whole-file mark without origin is read as 417, flagged uncertain (408 beyond), withdrawn, and the place accepts its 9 again; the file list shows 2%. Not done: a negative control in a window against 0.1.22, Linux, CI.
<!-- SECTION:NOTES:END -->
