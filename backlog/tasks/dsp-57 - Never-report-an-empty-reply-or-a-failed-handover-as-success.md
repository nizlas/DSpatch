---
id: DSP-57
title: Never report an empty reply or a failed handover as success
status: To Do
assignee: []
created_date: '2026-09-19 12:28'
labels: []
dependencies:
  - DSP-53
priority: high
type: feature
ordinal: 15614
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
INTERACTION_MODEL v1.2 sections on reliable execution and check 11. An empty reply, an interrupted call or a failed handover must not silently count as a successful result, and must not leave the run inexplicably hanging with no way to tell whether anything is still active. Preserve the assignment, the history and the work already done, explain the situation in ordinary language, and offer a concrete next action within the remaining limits. Recovery must not duplicate an action whose outcome is still unknown. This is the reliability half of the value DSpatch adds over talking to an agent directly, and it is the thing the user cannot work around himself.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An empty reply is never reported as a successful result.
- [ ] #2 After an interrupted call or a failed handover the user can tell whether work is active, waiting or stopped.
- [ ] #3 The assignment and history survive, and a concrete next action is offered within the remaining limits.
- [ ] #4 No recovery repeats an action whose outcome is unknown.
<!-- AC:END -->
