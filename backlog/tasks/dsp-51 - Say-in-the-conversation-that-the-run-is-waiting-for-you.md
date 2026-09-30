---
id: DSP-51
title: Say in the conversation that the run is waiting for you
status: To Do
assignee: []
created_date: '2026-09-18 18:08'
updated_date: '2026-09-19 08:51'
labels: []
dependencies:
  - DSP-45
priority: high
type: bug
ordinal: 15598
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While DSpatch waits for the command confirmation the conversation's last line is 'Entered gate' and it stays there for up to ten minutes. The wait is not a journal entry, so formatChatLiveLogLine writes no line and activityLine has nothing newer to return. The question and its two buttons are in the other column. If the person does not look right, the loop appears to hang and then ends having checked nothing. activityLine is right to invent nothing; DSpatch is waiting for you is not an invention but a fact DSpatch knows and does not write down. Emitting a journal entry rather than special-casing the renderer also gives the record something it lacks: that a run spent time waiting on a person, and how long.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 While the run waits for a confirmation, the conversation says so, naming what is waited for and where the answer goes.
- [ ] #2 The record shows that the run waited on a person and for how long.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in run `20260918-171500-shape`, call 007. **Both criteria met in the runtime; the on-screen half is HUMAN_PENDING as everything drawn is.**

**The vocabulary decision, recorded because the next reader will ask why the pause's kinds were not reused.** `run-held` / `run-released` are the pause control's, and the runner records `run-held` *before* `node-entered`, for a step that has not started, with nothing in flight. A gate holding a command in front of a person is the opposite: the step is running, it has asked a question, and the answer decides what it does next. A reader who could not tell those apart could not tell a run nobody has resumed from a run waiting for an answer. So `waiting-for-person` and `person-answered` were **added after** them, leaving records written by an earlier build parsing unchanged, and a test asserts a run that waits emits neither `run-held` nor anything else a pause would emit.

The plumbing is the only part that is not a string. The wait happens inside `settleOffer`, inside the gate step, while the journal is written by the walk — so `StepContext` gained `note`, a **closed two-kind port**: a step may say it is waiting on a person and that the wait ended, and may not write `run-ended`, `edge-taken` or a fault. The walk keeps the account of the walk. `STEP_NOTE_KINDS` is the one place to widen it. The entry is recorded by the same `record` as every other, so it reaches the chat column, the record on disk and a graph view in another window with no second channel and no second vocabulary. `activityLine` is unchanged and still invents nothing — there is simply now a real line to return.

The test that matters takes its reading **from inside the `runProjectTest` that is doing the waiting**, not from the log afterwards, because a test that read the log later would pass against the very silence this fixes. It asserts the reading immediately before the gate asks still says `Entered gate`, that the reading during the wait does not, that it names the command and the column, and that its source is the journal rather than something the window invented.

**Left open, and it is the same defect one mechanism away:** `formatChatLiveLogLine` still returns `null` for `run-held` and `run-released`, so a run paused by the control is as silent in the conversation as this gate wait used to be. That is now the only place in the loop where DSpatch waits and says nothing.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Superseded in part. **Kept, and still needed:** the journal kinds `waiting-for-person` / `person-answered`, the chat line, the record of how long a run waited, and the graph's waiting state. Those serve human nodes (DSP-31) and pause (DSP-29, DSP-33). **Removed:** the thing being waited for. There is no command confirmation to wait on. Re-target at the human node rather than closing on the confirmation wait.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
