---
id: DSP-86
title: 'One graph view, before, during and after a run'
status: Review
assignee: []
created_date: '2026-09-20 20:40'
updated_date: '2026-09-21 05:36'
labels: []
dependencies:
  - DSP-85
priority: high
type: feature
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's cleanup mandate of 20 September, part two. Abolish the separate run view. REMOVE: 'Leave the run view', the 'The run on screen' panel with its node list, and 'What the words mean'. The graph editor keeps the SAME layout, graph, zoom, panning and node panel when a run starts. The run shows itself through the graph's liveness indicators; the chat carries the running activity and the replies. DURING a run: editing and the loop choice are locked, and the running graph version stays pinned as it is today; panning, zooming, selecting nodes and reading their instructions all still work; no switch to another panel, another set of headings or another set of explanatory texts. A pause, and waiting for the person, still mean the run is going on and the graph stays locked. WHEN THE RUN REALLY ENDS: unlock the graph and the loop choice automatically, keep the same graph and the same view state, and if Use loop is still ticked the Ready pulse returns to the entry point without the person having to toggle the feature off and on. Ready means ready for a new task; the finished run's result stays in the chat. No button should be needed to get back to editing. ALSO, part five of the same mandate, because it is the same surface: remove 'This run so far' and the raw log beneath the graph, and the long footnote about run version and drawing. Let the graph have the freed space. Keep the run journal as diagnostics reachable from a menu when wanted; it must not occupy the ordinary graph view. Keep the improved node panel with its Markdown role text and collapsed Advanced, working during a run with editing locked. The walking glint along the edge and the end-node tick are separate work and stay deferred; the Ready pulse restoration belongs here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Leave the run view, The run on screen with its node list, and What the words mean are gone.
- [ ] #2 Layout, graph, zoom, panning and node panel are unchanged when a run starts.
- [ ] #3 During a run editing and the loop choice are locked while panning, zooming and reading node instructions still work.
- [ ] #4 A pause or a wait for the person keeps the run going and the graph locked.
- [ ] #5 When the run ends the graph and loop choice unlock automatically, with the same graph and view state kept.
- [ ] #6 With Use loop still ticked the Ready pulse returns to the entry point without toggling anything.
- [ ] #7 No button is needed to return to editing.
- [ ] #8 This run so far, the raw log under the graph and the version footnote are gone, and the graph uses the space.
- [ ] #9 The run journal is still reachable as diagnostics from a menu.
- [ ] #10 The node panel keeps its Markdown role text and collapsed Advanced, and works during a run with editing locked.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The run banner, `WatchedRunInspector` and the self-opening journal are gone from
`LoopEditor.tsx`; the editor no longer loads the run's pinned drawing over the author's,
because since DSP-85 the canvas already holds the chosen loop. What is left of the run in
the view is the state appended to the title line, the marks on the nodes, and the control
and standing at the right-hand end of the palette row.

`viewIsLocked` in `shared/loop-run-view.ts` now answers false for an ended run and for a
stand-by offer, which is the whole of the automatic unlock (#5, #7): no code path presses
anything. The run's own controls sit in the palette row because that row is
`height`-fixed in the stylesheet — putting them in the header's chip strip cost the
drawing 110 pixels of height at the moment a run started, which the window trial measured
and which is the failure this card is about wearing a different hat. While a run walks the
palette's place/connect buttons step aside for the controls rather than sitting there
greyed.

**Ready again (#6) is raised by the main process, not the chat window.** The obvious home
is `App.tsx`'s send, since `Use loop` is that composer's tick — but the pulse appears in
the graph view, and a window on `#editor` has no `App` mounted, so a restoration living
there would fire for nobody in the one place it is meant to be seen. The tick is recorded
in `chatLoopIntended` from the `prepareChatLoop` call it already makes, and
`offerReadyAgainAfterRun` raises the same stand-by offer after `runAudience.end`.

**What "the run pins its version" means now.** The run still pins its bytes and the view
no longer changes, so the obligation became a truthfulness one: `pinCheck` compares the
re-serialised drawing on screen with the run's `graphText`, and a chip says *Not the
drawing on screen* or *Pinned version unreadable* when they differ. Three of the four ways
they could drift are closed at the source — choosing draws, editing is locked, and
starting against unsaved edits asks first. The fourth, a standalone `.graph.json` opened
from the File menu, is the case the chip is for, and the run's marks are withheld from a
drawing that is not the run's.

**Save-or-cancel at start.** The editor registers its unsaved drawing with the main
process (`NOTE_UNSAVED_DRAWING`); `startChatLoopRun` asks before reading the file, writes
and re-resolves on *Save and run*, and refuses by name on *Cancel*. The registration is
cleared when the editor window closes, because closing discards unsaved edits and a later
run must not offer to save work a person threw away.

**Dry-run is locked during a run too.** Not an edit, but it walks the graph and puts its
own marks on the nodes the live run is marking. The window trial found it live in an
otherwise locked editor.

This may settle DSP-36 — a finished run's marks give way to the Ready pulse at once, and
the result stays in the chat — which is for the coordinator to judge, not this
implementer. DSP-80's walking glint and end-node tick stay deferred; the immediate
handover from a finished run to Ready means there is currently no moment on the graph at
which a completed run is marked as completed.
<!-- SECTION:NOTES:END -->
