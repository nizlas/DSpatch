---
id: DSP-88
title: Switching loop must not discard unsaved edits after merely saying so
status: Review
assignee: []
created_date: '2026-09-21 05:40'
updated_date: '2026-09-21 07:07'
labels: []
dependencies:
  - DSP-86
priority: high
type: bug
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Correction from Niclas before delivery of the 20 September cleanup mandate: preserving unsaved edits was explicitly part of that mandate, and the current behaviour does not honour it. Choosing another loop in the graph editor's dropdown, or opening another definition, states that the drawing was never written and then discards it anyway. Informing is not preserving. Offer Save / Discard changes / Cancel BEFORE the switch is carried out, and carry it out only on an answer. Cancel leaves the drawing and the current choice exactly as they were. This needs no new product decision: DSP-86 already built the save-or-cancel question at run start, with the registration of an unsaved drawing, the write, and the GRAPH_SAVED_ELSEWHERE broadcast that follows it. Reuse that machinery and that wording rather than inventing a second dialogue; the only new element is the third answer, Discard changes, which the run-start case does not need. DSP-85's implementer recorded the present behaviour as a deliberate inheritance from DSP-84 and said a prompt would be a new card. This is that card.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Choosing another loop with unsaved edits asks Save / Discard changes / Cancel before anything is switched.
- [ ] #2 Cancel leaves the drawing unsaved and the current choice unchanged.
- [ ] #3 Save writes the drawing and then switches; Discard changes switches without writing.
- [ ] #4 Opening another definition from file behaves the same way.
- [ ] #5 The question reuses DSP-86's save-before-run machinery and wording rather than a second dialogue.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
One question, two occasions, three answers. DSP-86's save-or-cancel was written inline in
`startChatLoopRun`; it is now `describeUnsavedDrawingQuestion` in
`shared/unsaved-drawing.ts`, which takes the drawing and an occasion (`run` or `switch`)
and returns the title, the message, the detail, the buttons and, parallel to the buttons,
what each one means. The switch is the run's question plus one button: Save, Discard
changes, Cancel. Cancel is last, is the default and is the escape key's answer in both
shapes, because a mis-pressed dialog must not be the one that writes a file or throws a
drawing away. A unit test asserts that the switch's answers minus `discard` are exactly
the run's, which is #5 as a property rather than an intention.

`askAboutUnsavedDrawing` and `writeUnsavedDrawing` in `main.ts` are the shared machinery.
The write does all three things DSP-86 did inline: writes the file, forgets the
registration, and broadcasts `GRAPH_SAVED_ELSEWHERE` so the editor stops reporting changes
it no longer has. That broadcast now carries the occasion, because *the run is walking
these changes* is true of only one of the two senders.

`settleUnsavedDrawingBeforeRedraw` is what the switch calls, and it is called *before* the
switch is carried out: on Cancel the handler returns having recorded nothing, drawn
nothing and moved nothing. It runs after the definition has been judged, so a loop that
cannot run does not provoke a question about a switch that was not going to happen. On
Discard the registration is forgotten immediately, so a run a minute later cannot offer to
save work the person threw away.

Two callers: `CHOOSE_LOOP_DEFINITION`, which is both the dropdown and **Open loop...**,
and `openGraphFileForEditing`. **File > Open Graph File... does ask**, which the card left
to be decided: it draws over the same canvas through the same `open`, so the work it can
take away is the work the chooser can take away, and a person should not have to know that
two of the three ways in protect their edits and the third does not. It asks after the file
has been picked, because a dismissed file chooser is not a switch.

The dropdown is put back when the switch did not happen. A `<select>` changes itself before
the handler decides anything, so a declined switch would otherwise leave the control
displaying a loop that was never adopted, which is the obvious way this fix could lie.
`chooseLoop` now answers `switched` or `unchanged` and the `onChange` restores the value on
`unchanged`.

Wording. `describeChoiceMade` reported the loss; it now reports the answer, so the sentence
is *your changes were saved first* or *you chose to discard your unsaved changes*, and the
window no longer narrates an act nobody authorised. The standing chip reads
`Unsaved - nothing takes this without asking` rather than `a run will ask first`.

Walked in the real window with no provider call, through a new
`unsaved-edits-survive-a-switch` scenario against two throwaway loops under the temporary
directory: Cancel from the dropdown, Cancel from the File menu, Save from the dropdown,
Discard changes from **Open loop...**, each round reading the chooser's displayed value,
the stored choice, the canvas and the bytes of both graph files. The rounds are chained, so
the Save round writing a changed file is what establishes that the edits survived the two
cancels. DSP-86's own walk was re-run and still passes on both its answers. Harness, logs,
result files and pictures in
`.dspatch-loop/runs/20260920-104500-folders/logs/026-implementer/`. Report 026.
<!-- SECTION:NOTES:END -->
