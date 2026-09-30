---
id: DSP-39
title: Let the control notice a cancel on its fast path
status: To Do
assignee: []
created_date: '2026-09-18 09:20'
labels: []
dependencies:
  - DSP-37
priority: low
type: feature
ordinal: 15550
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The walk in loop-run.ts now reads the abort signal before entering each node, which is what DSP-37 added. That check is currently the only thing standing between an autonomous run and a cancel it would otherwise ignore.

awaitStepRelease reads the abort signal only inside its waiting loop. Its first line returns early when the control says start, so in autonomous mode, which is the ordinary live shape, the control answers start without ever consulting the signal. A cancel arriving at that moment is seen by the walk and by nothing else.

That is sound today and it is a silent dependency. Anyone who later moves, narrows or removes the walk check will restore the original defect without touching the code that appears to handle cancellation.

Call 012 found this and deliberately did not fix it, because the fix reaches into the control runtime and the call was scoped to leave that alone.

The question to settle is whether the control should consult the signal on its fast path as well, so that cancellation is handled where a reader expects to find it rather than only where it happens to work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A cancel arriving while the control is answering start is noticed by the control, not only by the walk.
- [ ] #2 Removing or narrowing the walk check does not silently restore a run that keeps working after a cancel.
<!-- AC:END -->
