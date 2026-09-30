---
id: DSP-84
title: 'Open, choose and run the same loop, as one continuous thing'
status: Review
assignee: []
created_date: '2026-09-20 19:25'
updated_date: '2026-09-20 20:18'
labels: []
dependencies:
  - DSP-82
priority: high
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TRACED FIRST, 20 September. PICK_LOOP_DEFINITION does two things: it adds the file to pickedDefinitionPaths so the list knows about it, and it calls noteChosenLoopDefinition so the workspace remembers it. The editor's path calls chooseLoop(path) alone, which resolves and reads the declaration and never touches the selection. So a definition opened in the editor is drawn but is not in the chat's list and is not chosen, Use loop runs workspaceLoopDefinitionKey or the built-in default instead, and the graph view switches to that run's drawing. Niclas met exactly this: he opened the DSpatch loop's definition, pressed Use loop, and a different loop ran under a view that changed graph. WANTED: the loop chooser gathers discovered and hand-opened definitions with several available to choose between; opening a .loop.json in the editor makes it available in that same list; the editor offers Use this loop for the opened definition, which selects it for the next mandate and starts nothing; which loop the next mandate will use is plain to see; the graph view shows that same loop when the run starts; 'Open the chosen loop' is replaced or clarified so the relation between the choice and the editor is comprehensible; a definition that cannot run shows its reason at the point of choosing, with no silent fallback to another loop. ONE SOURCE FOR THE CHOICE - reuse the existing list, loading and workspace storage rather than a second selection in the editor that can drift from the chat's. The chosen loop is restored with its workspace. A run in progress keeps its pinned graph version and a new choice applies to the next run. Unsaved graph edits are handled explicitly so the app never shows one version and silently runs another. A .graph.json opened directly must not be presented as an already chosen loop definition. Several available loops do not require editor tabs. Liveness improvements stay deferred.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A definition opened in the editor appears in the same list the chat chooses from.
- [ ] #2 Use this loop in the editor selects that definition for the next mandate and starts nothing.
- [ ] #3 Which loop the next mandate will use is stated where the person is about to start one.
- [ ] #4 Use loop runs the chosen definition, and the graph view shows that same loop when the run starts.
- [ ] #5 A definition that cannot run says why at the point of choosing; nothing falls back to another loop silently.
- [ ] #6 The choice has one source: the editor and the chat cannot hold different answers, and it is restored with the workspace.
- [ ] #7 A run in progress keeps its pinned version; a new choice applies to the next run.
- [ ] #8 Unsaved graph edits are handled explicitly rather than shown as one version and run as another.
- [ ] #9 A .graph.json opened directly is not presented as a chosen loop definition.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementer, 20 September: implemented and walked in the real window. The editor now has Use this loop, which calls a new CHOOSE_LOOP_DEFINITION handler that does what PICK_LOOP_DEFINITION does — adds the path to pickedDefinitionPaths and calls noteChosenLoopDefinition — so one selection serves both surfaces; the editor holds no key of its own and reads the answer back out of LIST_LOOP_DEFINITIONS. Open the chosen loop is now Open the loop that will run. Runnability is judged once, in app/src/main/loop-choice-check.ts, shared by the preview and the choice, so a refusal at the point of choosing is the run's own refusal and names what is still selected. Unsaved edits are stated, not resolved: the saved file is what runs and the window says so. Scripted window trial .dspatch-loop/runs/20260920-104500-folders/logs/022-implementer/ walked both definitions end to end and passed; evidence and open items are in report 022. Status and acceptance ticks left to the coordinator.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-20 19:25
---
Traced by the coordinator before the card was written: chooseLoop reads, PICK_LOOP_DEFINITION selects, and the editor only ever calls the first.
---

created: 2026-09-20 20:18
---
Packaged as build identity e2ba0df1d7db6e60 (84 files, git 12578f8 + 157 dirty), tree sha256:86c65ee1... (candidate-29.json). DSpatch.exe written 22:17. Awaiting Niclas's judgement on the window wording: the Next chip, the sentence under the composer, and whether 'Open the loop that will run' now reads clearly.
---
<!-- COMMENTS:END -->
