---
id: DSP-140
title: >-
  Let a drawing declare its gate command, and decide whether the chat loop gets
  a gate
status: Done
assignee: []
created_date: '2026-10-27 07:44'
updated_date: '2026-10-27 10:16'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed without implementation, 27 Oct 2026 (DSP-145): superseded. The development agent now chooses and runs its own build and test commands through DSpatch's command tool, so no drawing needs a declared command field and the chat loop needs no gate. The trust question it raised does not arise.

Archived 27 Oct 2026 with status Done meaning closed, not implemented as written: see the note above for whether it was superseded or merged into DSP-145.
<!-- SECTION:NOTES:END -->
