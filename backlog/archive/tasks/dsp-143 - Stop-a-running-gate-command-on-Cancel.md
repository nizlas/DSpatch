---
id: DSP-143
title: Stop a running gate command on Cancel
status: Done
assignee: []
created_date: '2026-10-27 07:44'
updated_date: '2026-10-27 10:16'
labels:
  - loop
dependencies: []
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Recorded in DSP-139 (and earlier). Cancel during a gate step stops the walk before the next step, but the command DSpatch started runs until it ends or reaches its time bound (loop-live-run.ts walk signal; the gate branch races only the step deadline). The process-group kill already exists for the time bound.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Merged into DSP-145, 27 Oct 2026: the gate's command now runs through the shared workspace command runner with the walk's abort signal, so Cancel stops it and its child processes; covered by a live test in loop-gate-check.test.ts.

Archived 27 Oct 2026 with status Done meaning closed, not implemented as written: see the note above for whether it was superseded or merged into DSP-145.
<!-- SECTION:NOTES:END -->
