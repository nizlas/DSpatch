---
id: DSP-179
title: >-
  Unify review profile typography in Step/Discussion and add explicit
  regeneration for profile alternatives
status: In Progress
assignee: []
created_date: '2026-11-06 11:35'
updated_date: '2026-11-06 11:35'
labels:
  - ux
  - review
dependencies:
  - DSP-176
  - DSP-178
ordinal: 98200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 6 November 2026: fix the review presentation profiles so Essens/Pedagog do not render denser than Original, keep profile changes in content (not typography), make Essens choose a tighter core explanation, and add an explicit action to regenerate the current profile alternative on the same saved walk step.

The change must preserve the existing code-place/navigation work, avoid automatic model calls, keep late/error behavior safe (old alternative stays visible), and keep review semantics (coverage, approvals, threads, decisions) unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Profile alternatives use the same readable typography baseline as Original in Step and Discussion surfaces
- [ ] #2 Essens profile instructions enforce a concise core explanation and keep deeper mechanics under Show more
- [ ] #3 Prompt contract keeps short part and details separated, with non-redundant Show more content
- [ ] #4 Current profile alternative can be regenerated explicitly without auto-calls on open/navigation
- [ ] #5 Existing alternative remains visible while regeneration is pending and after regeneration failure
- [ ] #6 New alternatives store profile-instruction version metadata
- [ ] #7 Relevant tests are run and results recorded
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 6 November 2026 on Linux.

Implemented so far:
- Added `PRESENTATION_INSTRUCTION_VERSION` and persisted it on new presentation requests and stored questions.
- Updated Essens and common presentation rules for explicit core-budget behavior and clearer short-vs-details separation.
- Added explicit regenerate action in the step profile line (`profile-regenerate`) and improved status text so an existing alternative is described as staying visible during retries.
- Fixed dense profile rendering in Step by rendering profile alternatives inside `rv-explanation` typography (`rv-profile-explanation rv-explanation`).
- Tightened generic answer-shape instruction to explicitly avoid repeating the short part in details.
- Updated profile and service tests for instruction version and revised Essens prompt text.

Verification status:
- Could not run tests/typecheck in this runtime because Node is unavailable (`node: command not found`).
<!-- SECTION:NOTES:END -->
