---
id: DSP-142
title: 'Rework after a failed gate, bounded as a rework round'
status: Done
assignee: []
created_date: '2026-10-27 07:44'
updated_date: '2026-10-27 10:16'
labels:
  - loop
dependencies: []
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-139 (Q3). In dspatch-duration-check a failed test ends at tests-failed. A fail edge back to work is not counted as a rework round (the runner counts only outcomes named rework, loop-run.ts; runLiveGraph passes none), so it would be bounded only by maxCalls and end as limit-reached, which is worded as not a failure of the work. Decide how a gate's fail counts against maxReworkRounds before drawing such an edge.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Merged into DSP-145, 27 Oct 2026: outer rework is the check step's rework outcome with concrete findings, counted by the runner against maxReworkRounds, with limit-reached routed to not-met (dspatch-chat-loop). A failed command inside a step is a tool result to the same agent, not a rework round. The duration-check example keeps tests-failed as its ending.

Archived 27 Oct 2026 with status Done meaning closed, not implemented as written: see the note above for whether it was superseded or merged into DSP-145.
<!-- SECTION:NOTES:END -->
