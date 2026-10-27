---
id: DSP-142
title: 'Rework after a failed gate, bounded as a rework round'
status: To Do
assignee: []
created_date: '2026-10-27 07:44'
labels:
  - loop
dependencies: []
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-139 (Q3). In dspatch-duration-check a failed test ends at tests-failed. A fail edge back to work is not counted as a rework round (the runner counts only outcomes named rework, loop-run.ts; runLiveGraph passes none), so it would be bounded only by maxCalls and end as limit-reached, which is worded as not a failure of the work. Decide how a gate's fail counts against maxReworkRounds before drawing such an edge.
<!-- SECTION:DESCRIPTION:END -->
