---
id: DSP-178
title: >-
  Merge walk navigation stops for the same before/after change instead of
  keeping separate Old/New place stops
status: In Progress
assignee: []
created_date: '2026-11-06 09:40'
updated_date: '2026-11-06 10:05'
labels:
  - ux
  - review
dependencies:
  - DSP-175
ordinal: 98100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 6 November 2026: in code walks, references to the old and new side of the same change are already shown in one shared diff pane, but still appear as separate navigation places in the step panel and navigation counters. The remaining issue is to make that pair one navigation stop so the reading flow matches one explained change.

The stop model must reuse existing pane grouping where suitable, keep reference identities and review semantics unchanged, keep distinct stops where the explanation genuinely moves focus, and apply to saved walks without regeneration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 From/To references to the same change in one step are one navigation stop and one shared pane
- [ ] #2 Before → After marks both sides for the merged stop; Before/After mark only their shown side
- [ ] #3 Legacy saved walks render with the new stop presentation without regeneration
- [ ] #4 Distinct places in the same file remain separate when they are not one paired change
- [ ] #5 Cross-file call/implementation places remain separate stops
- [ ] #6 Step counters, next/previous, and step-level direct stop selection follow the merged-stop model
- [ ] #7 Coverage, approvals, thread anchoring and saved decisions are unchanged
- [ ] #8 Relevant tests and an isolated Linux/Xvfb window trial with simulated provider are run, with screenshots and limits stated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 6 November 2026 on Linux. Governing decisions read: VISION.md section 3.4 (code walks explain behavior through code), REVIEW_COVERAGE_AND_CODE_WALKS.md (plan vs shown vs decided remain separate), DSP-175 notes (shared pane grouping and review thread semantics), and AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 5 (no separate review pipeline).

Implementation in progress:
- Added renderer stop-grouping logic (`walk-panes.ts`) on top of existing shared-pane grouping: adjacent stations in the same step and pane are merged only when they include both base and target sides; otherwise they remain separate stops.
- Added regression tests in `app/tests/walk-panes.test.ts` for merged From/To stops, separate same-side places, and cross-file separation.
- Wired walk navigation (`ReviewView.tsx`) to stop-level movement and step-level stop lists/counters while keeping original place identities in state and references.
- Wired timeline highlighting (`ReviewTimeline.tsx`) so merged stops mark both sides together in Before → After while still marking only visible-side rows in side-specific views.

Verification status:
- Could not run `npm run typecheck` or tests in this environment because `node`/`npm` are unavailable (`command not found`).
- Xvfb window trial and screenshots are therefore still pending in an environment with the repository's Node toolchain installed.
<!-- SECTION:NOTES:END -->
