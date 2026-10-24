---
id: DSP-123
title: >-
  Scripted scenarios that wait for loop-definition are stale since the loop
  chooser moved to the graph editor
status: To Do
assignee: []
created_date: '2026-10-24 13:14'
labels: []
dependencies: []
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 24 Oct 2026 (run 20261024-060000-dsp121-ux, Verifier call 3): the scripted scenario several-working-roots (DSPATCH_CHAT_RUN=roots, DSP-72) and the other waits at app/src/renderer/workflow-script.ts :1206 and :4534 wait for data-ev loop-definition, which App.tsx no longer renders since f83f476 (2026-09-30; the chooser is editor-loop-definition in LoopEditor.tsx). The roots scenario times out with exit 71 at the loop-chooser wait, before its Folders step, so nothing in it is exercised. The only successful roots records are from 2026-09-20. app/README.md has no recipe for roots. Not a product fault; a maintenance gap in the scripted scenarios.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The three stale loop-definition waits are updated to the editor's element or removed, with the reason recorded.
- [ ] #2 The roots scenario runs to exit 0 on a fresh kit with the presentation adapter, with a README recipe and the userData guard.
- [ ] #3 Any scenario found unrunnable in the same way is listed and fixed or retired, never left as a silent timeout.
<!-- AC:END -->
