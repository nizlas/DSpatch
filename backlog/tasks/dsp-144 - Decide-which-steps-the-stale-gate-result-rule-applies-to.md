---
id: DSP-144
title: Decide which steps the stale-gate-result rule applies to
status: To Do
assignee: []
created_date: '2026-10-27 07:44'
labels:
  - loop
dependencies: []
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-139 review R-1 (I4, I5). The rule replaces the outcome of any agent step that was handed a gate result if the working folders differ from the tested snapshot. A rework step that is handed a failing result and edits as intended would be overridden too (no shipped drawing does this), and a gate whose command writes into the tree (a build directory, a test cache) makes its own result permanently unusable. Options: a node flag limiting the rule to judging steps (a node configuration contract), and excluding declared build output from the comparison.
<!-- SECTION:DESCRIPTION:END -->
