---
id: DSP-63
title: Nothing in the chat drawing can produce a failed handover
status: To Do
assignee: []
created_date: '2026-09-19 14:46'
labels: []
dependencies:
  - DSP-57
priority: medium
type: feature
ordinal: 15620
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
INTERACTION_MODEL section 10 trial 11 names failed handovers alongside empty replies, and run 20260919-142600-converse could not provoke one: the chat loop has two agent steps and no branch that fails a handover, so there is nothing in the drawing to drive it with. The behaviour is covered by unit tests only, which is weaker than the window evidence the other halves of that trial now have. Either the drawing gains a shape that can fail a handover, or a harness can inject one, or the trial records that this half is evidenced differently and why. Related and unprovoked for the same kind of reason: a genuinely empty provider reply cannot be requested from a model on demand.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Trial 11's failed-handover half is either drivable through the window or explicitly recorded as evidenced another way.
<!-- AC:END -->
