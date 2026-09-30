---
id: DSP-52
title: Measure the attribute support table instead of asserting its rows exist
status: To Do
assignee: []
created_date: '2026-09-18 18:08'
labels: []
dependencies:
  - DSP-46
priority: high
type: bug
ordinal: 15599
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DSP-46 gave every graph attribute a row in ATTRIBUTE_SUPPORT and closed the hole role fell through. But the rows already there were not checked, and limits is declared honoured false while the runner enforces it: loop-run.ts computes deadlineAt from limits.maxMinutes, checks it, and faults with step-timed-out naming the figure. The Verifier proved this with a negative control, two runs of the shipped drawing differing only in that number, one completing and one faulting. So the shipped graph tells every reader that the bound protecting them from a hung provider call does not exist. This is DSP-46's own defect mirrored: role was validated and then ignored by the table whose only purpose is to disclose exactly that, and limits is honoured and then disclaimed by it. The table is now complete without being true. A table of disclosures nothing measures is the same evidence shape DSP-45 replaced at the confirmation door, left in place one file away.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The limits row states what is actually enforced, with a caveat if only part of it is.
- [ ] #2 A test executes each attribute declared unhonoured and fails if the runner acts on it, rather than asserting a row exists.
<!-- AC:END -->
