---
id: DSP-140
title: >-
  Let a drawing declare its gate command, and decide whether the chat loop gets
  a gate
status: To Do
assignee: []
created_date: '2026-10-27 07:44'
labels:
  - loop
  - providers
dependencies: []
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-139 (Q1). The example dspatch-duration-check binds its gate command in code (EXAMPLE_GATE_COMMAND, app/src/shared/loop-editor-run.ts), shown in the editor. A command field on gate nodes in the drawing format would let other drawings, and possibly the chat loop under an agent without command tools, declare their own check. Open: the trust question (Run would execute a shell line written in any drawing file), INTERACTION_MODEL.md section 6/8 (no mandatory Command field in ordinary chat), and how the editor shows and saves the field.
<!-- SECTION:DESCRIPTION:END -->
