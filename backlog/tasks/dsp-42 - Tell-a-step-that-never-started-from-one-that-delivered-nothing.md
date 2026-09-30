---
id: DSP-42
title: Tell a step that never started from one that delivered nothing
status: To Do
assignee: []
created_date: '2026-09-18 09:40'
labels: []
dependencies:
  - DSP-37
priority: low
type: feature
ordinal: 15580
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
no-outcome-delivered now has three call sites and two of them mean the step never began, rather than the step ran and delivered nothing usable, which is what the name says and what the generic reconcile guidance still assumes.

The detail and reconcile strings carry the distinction and are true. The kind alone no longer does. Anything that groups or counts by fault kind will conflate a hung agent with a cancelled run that started nothing.

Nothing aggregates on it today, so this is not a defect. It becomes one the first time a run list, a dashboard or a what went wrong lately view groups by kind, and the fix then is a discriminator rather than a rename.

Related and worth settling at the same time: result.path advances before both cancellation checks, so a cancelled run path includes the node it never entered, with no matching node-entered journal entry. Pre-existing, now reachable for routers too, and a plausible source of an off-by-one in any view that reads path as nodes visited.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A view that groups runs by fault kind does not show a cancelled run that started nothing alongside a hung agent.
- [ ] #2 A cancelled run does not report having visited a node it never entered.
<!-- AC:END -->
