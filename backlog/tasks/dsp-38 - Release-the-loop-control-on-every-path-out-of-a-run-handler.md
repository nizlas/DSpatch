---
id: DSP-38
title: Release the loop control on every path out of a run handler
status: Done
assignee: []
created_date: '2026-09-18 09:04'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-29
priority: medium
type: bug
ordinal: 15500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both run handlers in main.ts claim the loop control with beginRun before entering the try whose finally releases it. A synchronous throw in that gap would leave the control claimed by a run that is not walking.

Call 011 measured what would follow. Nothing a person can reach recovers it: pause, continue, either mode change, Cancel, and an endRun for a different run all leave it claimed, and every later run is then refused with a sentence naming a run that does not exist. The only way out is restarting DSpatch.

It is not reachable today. Both gaps were scanned and contain no await and no then, so they are atomic, and every statement in them is either pure or internally guarded: an object literal, a SHA-256 of a string, a date, and an audience broadcast that wraps each send in try and catch and asks whether the WebContents is destroyed.

So this is a fragility with no trigger rather than a defect with a workaround. It is worth closing because it becomes reachable the first time somebody adds a line of bookkeeping between the claim and the try, and because the failure it would produce is worse than the one the claim was introduced to prevent.

The two abort variables share the exposure. They are cleared only in that same finally, and neither Cancel handler clears them, so a wedge would take the main.ts guard down with the controller and Cancel could free neither.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run handler that fails between claiming the control and starting work leaves the control free for the next run.
- [ ] #2 No refusal names a run that is not actually walking.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed in call 012 together with [DSP-37](dsp-37%20-%20Notice-a-cancel-between-two-steps-before-starting-the-next-one.md), which carries the shared numbers. Unverified.

Both handlers now open the `try` immediately after `beginRun`, with nothing between, so the existing `finally` covers the claim. Reading `announcement` inside the `finally` was what made the old shape hard to fix, which is why this is four lines moved rather than one: the version id and the ending variables are computed before the claim, the announcement is built inside the `try`, and both `finally` blocks name the run from `request.runId` and the version id instead. The Implementer checked rather than assumed that `runAudience.end` guards on the run id, so an ending broadcast for a run no window heard start clears nothing.

**The handoff's second half is handled by the same move:** with the claim inside the `try`, a throw on the way in also clears `editorLoopAbort` and `chatLoopAbort`. Clearing was deliberately **not** added to either Cancel handler — `abort()` is a request, the run's own `finally` is what clears the variable, and clearing it in Cancel would break the `aborted` reads that decide whether the run reports itself cancelled.

**The honest framing of the two tests is the most useful thing in this entry.** Nothing in the old gap could throw, so there is no live defect to reproduce, and the Implementer separated the two accordingly rather than letting a passing test imply more than it covers.

The **regression test** reads `main.ts`, strips comments, brace-matches away the refusal branch, and requires what remains between the claim and the `try` to be empty. It is the only one that fails without the fix, naming the handler and quoting the offending line. The instrument is the same one `loop-run-view.test.ts` already uses on the stylesheet, for the same stated reason: **the defect is introduced later by someone adding a line, and only the file can answer whether a line was added.**

The **second test passes either way and is a measurement, not a guard.** It drives the real controller in both shapes to show what each produces — an uncovered claim leaves a later run refused by a sentence naming a run that is not walking; a covered claim leaves the control free. It is evidence of *why the first test matters*, and explicitly not evidence that `main.ts` is fixed. The handlers are Electron IPC handlers with no harness, so the source-shape test is the only thing binding the file to the right shape.
<!-- SECTION:NOTES:END -->
