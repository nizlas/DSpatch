---
id: DSP-6
title: Improve the main friction and assess the complete development workflow
status: To Do
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-14'
labels:
  - ux
  - ui
milestone: m-0
dependencies:
  - DSP-3
  - DSP-4
  - DSP-5
documentation:
  - docs/VISION.md
  - BACKLOG.md
  - docs/REVIEW_RESEARCH.md
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Use feedback from actual use to make a small improvement for Niclas, then assess all of Phase 0. After DSP-6 he should make real code changes through chat, review diffs and run builds/tests, with cancellation, error handling and saved history in place.

### Scope and proposed approach

Define the improvement from DSP-5's most important observation. State the specific behaviour change and assessment criteria before implementation. Keep it small; additional wishes get separate tasks. If the trial found nothing to fix, document that and proceed to the whole-workflow assessment rather than inventing a feature to fill the plan.

Phase 0's complete conventional diff is the review baseline for this assessment. It does not choose the permanent code-view layout, navigation, rendering approach or explanation mechanism. Preserve real changes and revision-linked evidence for future views; do not introduce speculative frameworks to anticipate them. Advanced review ideas remain hypotheses for later discovery.

Test the combined DSP-2–4 result and any UX improvement. Niclas should open a repository, discuss a small task, let the agent change code, review the complete text diff and run a relevant build/test with a clear result for the correct code version. Follow-up/rework, cancellation, understandable recovery and continuing after restart must work. Earlier changes and results remain without duplicate execution.

### Verification and continuation

Report technical results for the delivered version, including successful and failing commands, cancellation and restart after file changes. Niclas assesses the same version and personally completes a bounded change from request to diff and test result. Remaining obstacles must be resolved or explicitly accepted; an agent cannot mark his assessment complete.

Niclas can remain in the human-interactive mode in subsequent increments. His decision on 14 September 2026 is to continue through DSP-6 and then take stock before further product implementation. Hand Phase 0 observations and unresolved needs to [DSP-11](dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md), the planned HCI, prior-art and concept study. Discuss the next direction for review features and Maestro with Niclas using that evidence. Discovery is subsequent work, not a new completion requirement for DSP-6.

### References

[VISION.md, sections 1.1, 14 and 15](../../docs/VISION.md#14-implementation-phases).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The selected improvement is traceable to DSP-5 and has concrete criteria, or there is a justified decision that no such change is needed.
- [ ] #2 The improvement is verified against its purpose. The combined workflow makes a real code change, shows affected files and the full text diff, and runs a relevant build/test with results tied to the correct code version. Cancellation, error handling and restart preserve work without automatic repetition.
- [ ] #3 Niclas has personally completed and assessed all of Phase 0 on an identified version, including code change, diff, build/test and continuing after restart. Remaining obstacles are resolved or explicitly accepted by him.
- [ ] #4 Results and lessons are documented for the planned post-Phase-0 HCI/prior-art study and direction review with Niclas. BACKLOG.md identifies that next focus without fixing advanced review features, interaction design, editor technology or Maestro topology. Completing that later study is not required to finish DSP-6.
<!-- AC:END -->
