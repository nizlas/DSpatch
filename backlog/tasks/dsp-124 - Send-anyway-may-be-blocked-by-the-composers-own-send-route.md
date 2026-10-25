---
id: DSP-124
title: Send anyway may be blocked by the composer's own send route
status: Done
assignee: []
created_date: '2026-10-24 17:29'
updated_date: '2026-10-25 22:40'
labels: []
dependencies: []
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by reading 24 Oct 2026 (run 20261024-070000-dsp121-flow, Reviewer 005 P1), not measured. 'Send anyway, leaving … unresolved' (App.tsx ~:2955) and the Execution-state 'Continue, leaving the earlier attempt unresolved' (~:3161-3163) call send(attemptIds). send() computes composerSendRoute(composerState) (~:1879-1883), whose unresolvedAttempts (~:566, attemptRefLabels(runState.needsAcknowledgement.agentTurn)) still lists the very attempts being acknowledged, so the route returns blocked before sendPrompt is reached. Not a stale closure (composerState is in the callback's deps). If confirmed, after a restart with an outcome-unknown turn the window cannot send in that conversation at all (Enter and both buttons blocked) - the trap the code's own comments warn about. No scripted scenario presses send-anyway. Affects DSP-4's window path (AC #3/#11).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One scripted or manual press of Send anyway in a conversation with an outcome-unknown agent turn shows whether the message reaches sendPrompt with the acknowledgement.
- [x] #2 If blocked, the route is computed with the acknowledged attempts removed from unresolvedAttempts, and Enter, Send anyway and Continue agree.
- [x] #3 A scripted scenario presses Send anyway and judges that the message was sent once and the attempt is recorded as acknowledged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (25 Oct 2026, run 20261025-090000-send-anyway, base 3d79b07): reproduce the Send anyway flow offline through the real renderer, IPC and chat service with the presentation adapter; establish the intended behaviour from DSP-4; if confirmed, fix the cause with a regression test that fails before and passes after.

Result (25 Oct 2026, run 20261025-090000-send-anyway, base 3d79b07): a real fault, confirmed offline through the real renderer, IPC and chat service with the presentation adapter. Cause: send(acknowledgedAttemptIds) computed composerSendRoute(composerState) whose unresolvedAttempts still listed the attempts being acknowledged, so the route returned blocked before sendPrompt was reached. Intended behaviour (DSP-4 #3/#11; attempt-ledger decide/acknowledgeAcross; ChatService.sendPrompt): an explicit Send anyway produces exactly one send carrying the named attempts, recorded as acknowledged and staying unresolved. Fix: composerSendRoute(state, acknowledged) leaves out exactly the acknowledged AttemptRefs (conversation and attempt ID), ignored for loop routes; send() passes the acknowledgement; Enter and the button's enabled state unchanged. Kept: an unnamed attempt still blocks; the same ID in another conversation does not count; Enter still blocks; the no-session reason first; outstanding turn, other work, loop runs and walks get no exemption; the service gate and the Claude unconfirmed-end rule untouched. Regression tests: the resume-choice ok phase with the new seed option --unknown-turn exited 90 before (no SEND_PROMPT, adapter empty, draft kept) and 0 after (exactly one SEND_PROMPT with the draft and acknowledged [{A's conversation, dsp-attempt-0005}], the adapter received the draft alone, the attempt stays outcome-unknown with acknowledgedAtUtc); the route test 'is not blocked by the attempts it acknowledges' failed before, passes after. Reproduced independently by the Verifier on an unfixed copy. Reviewer ACCEPT. Not done: the Execution-state row button (same send path, route unit-tested) was not pressed in the window; no double-click trial.
<!-- SECTION:NOTES:END -->
