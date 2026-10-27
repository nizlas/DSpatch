---
id: DSP-144
title: Decide which steps the stale-gate-result rule applies to
status: Done
assignee: []
created_date: '2026-10-27 07:44'
updated_date: '2026-10-27 10:16'
labels:
  - loop
dependencies: []
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-139 review R-1 (I4, I5). The rule replaces the outcome of any agent step that was handed a gate result if the working folders differ from the tested snapshot. A rework step that is handed a failing result and edits as intended would be overridden too (no shipped drawing does this), and a gate whose command writes into the tree (a build directory, a test cache) makes its own result permanently unusable. Options: a node flag limiting the rule to judging steps (a node configuration contract), and excluding declared build output from the comparison.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Merged into DSP-145, 27 Oct 2026: the approval rule applies only where a declared outcome leads to a success terminal (a rework step is never overridden), freshness is measured against each command's after-run snapshot in every working folder, and a command that changed files while it ran is shown as such rather than making its result unusable.

Archived 27 Oct 2026 with status Done meaning closed, not implemented as written: see the note above for whether it was superseded or merged into DSP-145.
<!-- SECTION:NOTES:END -->
