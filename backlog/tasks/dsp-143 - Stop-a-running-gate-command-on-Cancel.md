---
id: DSP-143
title: Stop a running gate command on Cancel
status: To Do
assignee: []
created_date: '2026-10-27 07:44'
labels:
  - loop
dependencies: []
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Recorded in DSP-139 (and earlier). Cancel during a gate step stops the walk before the next step, but the command DSpatch started runs until it ends or reaches its time bound (loop-live-run.ts walk signal; the gate branch races only the step deadline). The process-group kill already exists for the time bound.
<!-- SECTION:DESCRIPTION:END -->
