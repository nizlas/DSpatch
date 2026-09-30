---
id: DSP-36
title: 'Mark the terminal a run reached, and clear it when the next run starts'
status: Review
assignee: []
created_date: '2026-09-18 07:28'
updated_date: '2026-09-21 20:38'
labels: []
dependencies:
  - DSP-86
priority: high
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two things that turned out to be one. ORIGINALLY: call 007 found that an editor window watching a finished run was switched to a different run the moment anyone pressed Run in the other window - a decision to take rather than a fault, and DSP-86 has since taken it: a finished run now gives the graph back at once and a new run starts in the same view with nothing to displace. NOW, from Niclas's bounded visual mandate of 21 September, the concrete behaviour this card was waiting for. When a run reaches a SUCCESSFUL terminal - Assignment met, Delivered - show a clear but discreet green tick on that node. Other end outcomes are marked too, but without a green success tick. Decide success from the graph's RECORDED OUTCOME; do not work it out by comparing the node's display name, which would make a drawing's wording decide what DSpatch believes happened. The end marking stays on screen while the entry point pulses Ready again for the next assignment, so a finished run and a ready loop are visible at once. It is cleared when the next run starts. Switching loop must not carry a marking across to another graph. Add no panels, status paragraphs, buttons or settings, and keep the same graph view before, during and after a run, including the automatic unlock and the Ready pulse that DSP-86 built.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A person studying a finished run in the editor window is not silently moved to a different run by an action taken in another window.
- [ ] #2 A run starting is still visible to someone who wants to follow it, without them having to look for it.
- [ ] #3 A reached successful terminal shows a clear but discreet green tick.
- [ ] #4 Other end outcomes are marked, and not with a green success tick.
- [ ] #5 Success is decided from the recorded outcome, not by comparing the node's display name.
- [ ] #6 The end marking stays while the entry point pulses Ready again.
- [ ] #7 The marking is cleared when the next run starts.
- [ ] #8 Switching loop does not carry a marking across to another graph.
- [ ] #9 A person studying a finished run is not silently moved to a different run by an action in another window.
<!-- AC:END -->

## Liveness wish recorded here, 20 September 2026

<!-- SECTION:NOTES:BEGIN -->
Niclas asked for this alongside two other graph-view animations, and it belongs here rather than in a card of its own because it **is** this card's question: a reached terminal keeps an outcome mark, *Assignment met* gets a green tick, and **the previous run's marks are cleared when the next mandate starts.**

That last clause is the decision this card exists to make — what a finished run in the editor does when a new run begins — now answered concretely by the person who has to read it. The other two wishes, the entry node returning to Ready and a glint along the active edge, are DSP-80.

Not built in the folders stage.
<!-- SECTION:NOTES:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Success is a declaration in the drawing, never a label. `LoopNode` gained an optional
`ending` attribute — `success` or `not-success`, refused by the loader on anything that is
not a terminal — and `terminalDeclaresSuccess` is the only thing that decides a tick. All
four repository graphs declare theirs. The window trial's reading is two copies of the chat
loop differing on one line, both with the terminal labelled *Assignment met*: the copy
declaring success got the green tick, the copy declaring not-success got a grey ring and no
tick. A tick decided by the wording would have appeared twice.

Which terminal was reached now leaves the main process. `RunResult.terminalNodeId` was
already computed and was not on the `ended` event; it is, behind a `status === 'completed'`
guard in `terminalReachedBy`, because the runner leaves the field null on every other status
today and a mark that borrowed one if that stopped being true would tick a faulted run. The
dry run applies the same guard, so a walk that stopped at a bound earns no more than a live
one would.

The mark outliving the run is `FinishedRunMarks`, captured in `LoopEditor` when the `ended`
event arrives and merged under the live states by `markedNodes`. That is what lets the
terminal keep its tick while the entry step pulses Ready again — measured at one instant in
the trial: entry `ready` with two animations, `done` ticked. `receiveRunEvent` drops the
marks when a run starts, and `finishedMarksBelongTo` compares the serialised drawing rather
than a version id, so another graph cannot inherit them through a node id it happens to
share. Both were walked: the mark was gone in the second run and absent when a standalone
graph was opened over the same view. The comparison normalises to `\n` on both sides, so how
a file is checked out cannot decide whether a mark appears.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-21 05:36
---
Likely settled by DSP-86: a finished run now gives the graph back at once and its marks give way to the Ready pulse, so a new run starts in the same view with nothing to displace. Report 024 raises this; the coordinator should confirm against the card's own criteria before closing it.
---

created: 2026-09-21 16:01
---
Paused mid-implementation 21 September 17:57 for a machine shutdown, call 027, implemented jointly with DSP-80. The terminal is now carried on the ended event as RunResult.terminalNodeId behind a status === 'completed' guard - it was not leaving the main process before - and success comes from a new ending attribute on the graph rather than from any label. Nothing seen in a window; no acceptance may be ticked. See the run journal's paused_for_shutdown block and report 027.
---

created: 2026-09-21 20:38
---
Not UX-approved: Niclas says he has not yet run a loop through to the end, so the terminal marking has not been seen in use. Stays in Review.
---
<!-- COMMENTS:END -->
