---
id: DSP-203
title: >-
  Delegating a walk mandates its exact changed lines, with remaining lines as
  the default
status: Review
assignee: []
created_date: '2026-11-12 15:21'
updated_date: '2026-11-12 21:15'
labels:
  - review
dependencies: []
priority: high
type: bug
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas (12 November 2026): delegating a walk mandates whole hunks (walkScope in ReviewView picks every hunk a step of the walk plans), so a walk over lines 151-159 of a new 417-line file delegates 417 lines. The mandate must be the union of the walk places' exact changed lines, the same definition as Accept (DSP-201) and the marking (DSP-202). Two choices: Review remaining lines in this walk (default: lines without a holding decision of the person or an accepted delegated assessment) and Review all lines in this walk (a complementary review that changes no decision); the line count shown before start; no empty job. The mandate is stored at start and governs the instruction, validation, what is recorded, the report and coverage. Agent review never replaces a person's decision; the manual mark stays the main mark, a supplementary agent assessment gets a small separate indicator. Older jobs keep their stored mandate. No release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A walk delegation mandates exactly the union of its places' changed lines (markedChangedLines), never whole hunks; 151-159 of a new 417-line file mandates 9 lines
- [x] #2 Two choices before start, remaining lines (default) and all lines, each with its line count; remaining excludes lines the person decided and lines an accepted delegated assessment covers; no empty job is started
- [x] #3 The stored mandate governs instruction, validation, recording, report and coverage; nothing outside it is recorded even if the agent reports the whole file; context may be read and cited but is never counted
- [x] #4 Agent review never replaces or withdraws a person's decision, also when the person decides while the job runs; the manual mark stays the main mark and a supplementary agent assessment shows a small separate indicator, pending and accepted apart; no line counts twice
- [x] #5 Older jobs keep their stored mandate and are not reinterpreted; their scope reads as recorded
- [x] #6 Tests for the cases listed and a real-window trial of the two choices and their counts; governing docs updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: walkScope in ReviewView built the mandate from every hunk a step of the walk planned (coverage.hunks plannedBy -> pairRanges(hunkLocations)), so a new file delegated whole. The host already clipped answers to the mandate's ranges; the wide mandate came from the window.

Fix: walkChangedLines unions the places' markedChangedLines (the Accept lines, DSP-201/202) over diffSkeletonRows; undecidedLines gives the remaining lines (no person decision, no accepted assessment). Delegating offers Review remaining lines (default) and Review all lines with counts; no empty job. DelegationScope.basis stored and validated (host scopeFrom, jobFrom). Diff strip: the person's band stays, a thin agent edge beside it (dotted awaiting, solid accepted); the walk says the decision stands. Older walk jobs keep their whole-change scope, said in the report. VISION 3.4 and REVIEW_COVERAGE updated.

Verification: walk-delegation-scope.test.ts 8 (417 -> 9; whole-file answer clipped to 9; overlap union; sides; remaining; all with half decided, accept and withdraw; decisions during a job; older jobs and saving). 139 related tests pass; Linux CI tests run 43248650068 green. walk-delegation-trial.mjs 23/23 on Windows and on Linux under Xvfb (dock run 43248641922, with Accept 32/32, marking 37/37, prefs/About 20/20, dock 54/54). Evidence docs/evaluations/dsp-203. Not established: real agent review quality (simulated); the edge's legibility on Niclas's screen.

Released in 0.1.24 (https://github.com/nizlas/DSpatch/releases/tag/v0.1.24, Linux-only pre-release, tag on cc7c72c; package run 43293936160). Published trial (linux-verify run 43295145703): the published .deb, host package, manifest and SHA256SUMS in clean containers, 14 of 14; the upgrade from v0.1.23 27 of 27: the new client met the 0.1.23 host a closed window left running, offered Restart host, replaced it with 0.1.24-cc7c72c68e6f, and the conversation, agent choice, project, own loop, zoom and a review with a delegated result were kept, also after a restart.
<!-- SECTION:NOTES:END -->
