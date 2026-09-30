---
id: DSP-87
title: 'The chat says less, and stops claiming silence while answers arrive'
status: Review
assignee: []
created_date: '2026-09-20 20:40'
updated_date: '2026-09-21 06:33'
labels: []
dependencies:
  - DSP-86
priority: high
type: bug
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's cleanup mandate of 20 September, parts three and four, which are one job because the text to delete and the bug to fix are the same paragraphs. THE BUG FIRST, it is the real fault: the app says '281 s with nothing back' while replies and activity are visibly arriving. Check that streamed text and tool events update activity for the RIGHT run and the RIGHT step. Never show that nothing has come back while activity is being received. Remove the current long waiting text and do not replace it with new explanatory paragraphs. THE PROSE: remove the whole 'Next mandate walks...' line including paths and explanations about the next run; remove 'Who is working, on what, and what happens next' with all its content; remove the standard paragraph 'A loop run is working. Sending adds your message...'; remove the long and duplicated 'This wait is longer...' passages. KEEP streaming replies, real tool activity, concrete errors, and questions the person needs to answer. If a message is sent during a run, any acknowledgement must be short and appear at that message. Simplify the composer placeholder to something like 'Describe the task. Enter sends, Shift+Enter starts a new line.' Remove the words 'mandate' and 'walks' from these user-facing texts. This is a deletion task: the burden of proof is on anything that stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Streamed text and tool events update activity for the correct run and step.
- [ ] #2 The app never reports that nothing has come back while activity is being received.
- [ ] #3 The long waiting text is gone and no new explanatory paragraph replaces it.
- [ ] #4 Next mandate walks..., Who is working on what and what happens next, the standard loop-run paragraph and the This wait is longer passages are all gone.
- [ ] #5 Streaming replies, real tool activity, concrete errors and questions to answer all remain.
- [ ] #6 A message sent during a run gets at most a short acknowledgement shown at that message.
- [ ] #7 The composer placeholder is short and says how Enter and Shift+Enter behave.
- [ ] #8 The words mandate and walks no longer appear in these user-facing texts.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The false silence was two clocks, not one. `App.tsx` computed the line beside the
composer from `describeSendWait`, whose inputs are `busy === 'sending'` and the direct
chat's `activeTurn`. A loop run holds `busy` at `sending` for its whole length and never
creates an `activeTurn`, so the send-wait clock ticked from Send to the run's end with
nothing able to stop it � while the loop's real activity arrived on a different identity
entirely, addressed to a run and a step. Activity recorded against one identity and read
against another, as the assignment guessed, but in the reader rather than the writer:
`foldStepActivity` and `stepStanding` were correct throughout.

Three surfaces repeated the claim, from two sources. The send-wait clock wrote the
composer's status and a second, longer paragraph under it. `conversationStanding`'s
working branch wrote *the first step to answer. Nothing has come back yet* from
`replies.length === 0`, and `replies` holds finished replies � so it was true of every
streaming step. `loopTurnStatusText` wrote the same claim a third time on the run's own
caption; the window walk found that one still on screen 958 ms into a stream over 37
drawn characters, after the two louder copies had gone.

Fixed by making one function decide: `activityLine` now returns `text` (where the run
is, from the journal) and `stepText` (what the open step is doing, from `stepStanding`),
and the composer's status is the second. The send-wait clock no longer runs during a loop
pass at all. The working run's four standing paragraphs are gone; `loopTurnStatusText`
for a run in flight is `The loop is running.` and nothing else.

Deletions: the `Next mandate�` sentence and `describeNextMandateLoop`; the four
paragraphs and their disclosure for a working run; `composerRouteNote`'s standing
paragraph for a message joining a run; the `This wait is longer�` note and
`SEND_WAIT_LONG_MS`. `mandate` and `walks` replaced with `assignment`, `task`, `run` and
`going` across `App.tsx`, `loop-control.ts`, `loop-control-runtime.ts`, `loop-run-view.ts`,
`loop-transcript.ts`, `loop-instruction.ts` and `working-roots.ts`. The prompt protocol's
own `Mandate:` marker is model-facing and untouched.

Taken from DSP-86: `runViewState` takes the control's phase, so the editor's title reads
`waiting for you` when the control beside it does.

Verified in the real window with no provider call, through a new `chat-says-less`
scenario: 84 readings across one run, 30 of them with the reply growing, none of them
with a silence claim on screen; all seven silence sightings at zero drawn characters.
Harness, log, result and pictures in
`.dspatch-loop/runs/20260920-104500-folders/logs/025-implementer/`. Report 025.
<!-- SECTION:NOTES:END -->
