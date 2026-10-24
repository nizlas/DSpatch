---
id: DSP-123
title: >-
  Scripted scenarios that wait for loop-definition are stale since the loop
  chooser moved to the graph editor
status: To Do
assignee: []
created_date: '2026-10-24 13:14'
updated_date: '2026-10-24 17:10'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
24 Oct 2026 (run 20261024-070000-dsp121-flow, Verifier call 4 sweep of every presentation-mode scenario): confirmed stale at the loop-chooser wait - roots exit 71 (:4713), loop-choice exit 67 (:1206), folders exit 68 (:4534). Two more scenarios found stale for other reasons, both pre-existing since f83f476 (2026-09-30) and unrelated to DSP-121: (A) loop-continuous exit 73 (choiceDidNotCarry) - it still expects the editor chip to say 'as saved on disk' (~:1897), wording removed in f83f476; with unsaved edits Open Graph File now asks first and the fixture sets no DSPATCH_UNSAVED_DRAWING. (B) says-less exit 76 (deletedProseStillOnScreen) - conversationText() reads the whole transcript textContent, including the closed step-prompt <details> added in f83f476 (App.tsx ~:6192-6201), which carries the words 'mandate' and 'walks'. Passing in the same sweep: presentation, errors, history (x2), loop-result, switch (x2), one-view, stop-asked, unsaved-switch, liveness, liveness-look, resume-choice. Several presentation-mode recipes in app/README.md lack --user-data-dir (presentation) or a project path (loop-result); recipes should always carry --user-data-dir and DSPATCH_CHAT_EXPECT_USERDATA.
<!-- SECTION:NOTES:END -->
