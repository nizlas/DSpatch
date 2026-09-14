---
id: DSP-14
title: Compare and try code-review concepts
status: To Do
assignee: []
created_date: '2026-09-14 20:13'
labels:
  - ux
milestone: m-1
dependencies:
  - DSP-11
  - DSP-12
  - DSP-13
documentation:
  - docs/VISION.md
  - docs/REVIEW_RESEARCH.md
  - BACKLOG.md
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

The surveys and actual user needs must shape which ideas we try. Comparing concepts after research helps avoid treating an appealing first idea as an already chosen feature.

### Scope

Bring together the needs brief, interaction gallery and research synthesis. Compare all five seeds in docs/REVIEW_RESEARCH.md: guided code flow with tree highlights, essential diffs, conceptual differences, benefits/risks in code and text, and a zoomable minimap or another overview. Invite Niclas's further ideas and include alternatives from research.

Select one or two promising interactions for inexpensive sketches or a disposable prototype. Compare with the existing complete-diff workflow on identified, comparable code-change tasks. Observe whether Niclas understands the changed behaviour, can locate evidence and relevant dependencies, stays oriented and can challenge a wrong or incomplete explanation. Record scope and order effects; time/click counts are supporting observations.

Produce a recommendation and trade-offs for DSP-15. Full code/diff access and revision references remain available. This story does not ship a production review feature or build a general editor/orchestrator.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All five seeds and relevant research-derived alternatives are compared against user needs and evidence; open questions and reasons to retain, combine or reject ideas are explicit.
- [ ] #2 One or two inexpensive sketches or prototypes and the rationale for selecting them are available, without committing to a final UI or architecture.
- [ ] #3 Niclas has tried the selected interactions against the baseline on identified tasks; observations of understanding, orientation, evidence use and study limitations are recorded.
- [ ] #4 The trial checks access to the full change set and the ability to challenge unsupported explanations rather than treating attractive presentation or fewer clicks as sufficient success.
- [ ] #5 A concise recommendation with trade-offs and unresolved questions is ready for the review/Maestro direction decision in DSP-15.
<!-- AC:END -->
