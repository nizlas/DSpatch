---
id: DSP-210
title: >-
  Short hover text with full text in a readable view across the rest of the app
  (R7 beyond the workflow surfaces)
status: To Do
assignee: []
created_date: '2026-11-14 13:53'
labels: []
dependencies:
  - DSP-209
references:
  - docs/missions/adaptive-execution/STATE.md
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas decided on 14 November 2026 (answer to DSP-209's Q6) that the principle of short, useful hover text applies to the whole app: a hover is a short label, never the only place a status, an action or an instruction appears, and the full text lives in a persistent, readable and selectable detail view. DSP-209 S26 applied it to the workflow surfaces (loop editor, canvas, loop control bar, handoff prompt, the chat's loop surfaces, step, branch, final and proposal cards). This task covers the rest of the app: the review and walk views (ReviewView, PairReview, WalkLoopFollow and related, DSP-152's area), the continuity panel, the sidebar and the remaining windows. Recorded as a separate task by Niclas's decision; it does not block closing DSP-209's extension. Not started.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every hover text outside the workflow surfaces swept by DSP-209 S26 is a short label for the user, and the status, action or instruction it carried is also visible or reachable without hovering
- [ ] #2 Long explanations that lived only in hover text are in a persistent detail view that stays open and can be read and selected
- [ ] #3 WalkLoopFollow.tsx is handled first, since it is a loop window
<!-- AC:END -->
