---
id: DSP-89
title: A window trial must not be able to hang without bound
status: To Do
assignee: []
created_date: '2026-09-21 05:41'
updated_date: '2026-09-22 19:24'
labels: []
dependencies: []
priority: medium
type: chore
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CAUSE OF THE SEVEN-HOUR HANG IS UNKNOWN and must be recorded as unknown until it is established. On the night of 20 September the DSP-86 implementer wrote its report and its snapshot at 00:16 and its call did not return until the coordinator's session was interrupted at 07:35. The coordinator wrote 'almost certainly a stray Electron process' in chat; that was a guess stated as near-fact and no evidence was gathered for it. No stray electron or DSpatch process was present when the machine was checked afterwards, which does not settle the question either way. WHAT WAS ESTABLISHED, by reading the harnesses and main.ts: no window trial has any time limit. The harness pattern is to start electron.exe with its output piped to a file, which blocks the shell until the process exits; nothing bounds that wait, nothing kills the window on a failure path, and nothing checks afterwards that the process is gone. main.ts already carries evidence that this can bite: exitWith defers the exit code until windowShown is true, so a window that never appears never exits, and the comment beside it records an earlier probe that hung for three minutes before external termination. WANTED: every window trial bounded, so that a finished result can never leave the coordinator waiting. A deadline inside the window that ends the process with a distinguishable exit code; the harness terminating the process on every path out including failures; and the harness confirming no process is left behind. The exit must carry a code that says the deadline was reached, so a timed-out trial cannot be mistaken for a passed one. SEPARATELY, the coordinator's own wait on a specialist has no bound either: a Task call blocks until the specialist returns, and the only present lever is running it in the background so a completion notification arrives instead. Whether the loop's instructions should require that for calls that drive a window is a question for DEVELOPMENT_LOOP.md, not code. Keep any further diagnosis of the 20 September hang on this card and out of a packaging pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A window trial ends itself at a deadline rather than waiting without bound.
- [ ] #2 A trial that reached its deadline exits with a code that cannot be mistaken for a pass.
- [ ] #3 The harness terminates its window on every path out, including failure paths.
- [ ] #4 The harness confirms no electron process is left behind when it finishes.
- [ ] #5 The cause of the 20 September seven-hour hang is recorded as unknown until evidence establishes it.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cause of the 22 September sightings, established by the implementer that caused them and recorded here 22 September 2026. This is an instrument fault, not a product hang, and it does not settle the 20 September seven-hour hang, which stays unknown.

Both idle windows Niclas saw were DSP-94 window trials. The implementer reports two mistakes of its own. It first used a scenario's internal name instead of the harness name 'one-view', which fell through to the full workflow and made a real provider call before timing out - so the window stood on screen with a prompt typed and unsent while it waited for a provider that was never going to answer usefully. And it reused one temporary user-data profile across scenarios, which left an older run's record beside the new one. Neither is the product hanging; both are the harness doing something unintended and nothing bounding it while it did.

That is the point this card already makes, now with a dated example: the window was not broken, it was waiting, and nothing on disk said what for. A deadline alone would have ended these two and still left no way to tell a timed-out trial from a slow one.

--- previous note, 22 September 2026, the observations themselves ---

A DSP-94 window trial opened a DSpatch window on the scratch project %TEMP%\\dspatch-chat\\sample-20260922-185821-djTwWS, created 20:58:21 local. Niclas saw the window at 21:00 with a probe prompt typed into the composer and not sent, the status line reading 'Waiting for your message.' He reports it stood like that for several minutes. By 21:02 no DSpatch.exe, electron.exe or window with that title existed, so the trial ended and cleaned up on its own. A second window followed: four electron.exe started 21:04:33, sitting on the project picker with %TEMP%\\dsp94-trial-project and %TEMP%\\dsp94-userdata, still alive at 21:08 and gone by the time the implementer reported.

What the coordinator could establish from outside while it was happening: no source file had been written since 20:57:49, and no node, python, electron or DSpatch process belonging to the trial was running during the first sighting. So the wait was real and the harness was not busy with anything observable. No trial log was written to the run folder, which is itself part of the problem this card names - a trial that idles leaves nothing behind to diagnose it with.

Worth carrying into the fix: a deadline is not enough on its own if a trial can idle silently inside its bound. Whatever exit code says the deadline was reached should be accompanied by something on disk saying what the trial was waiting for when it stopped.
<!-- SECTION:NOTES:END -->
