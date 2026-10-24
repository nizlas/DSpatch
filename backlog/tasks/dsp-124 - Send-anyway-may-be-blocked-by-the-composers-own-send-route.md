---
id: DSP-124
title: Send anyway may be blocked by the composer's own send route
status: To Do
assignee: []
created_date: '2026-10-24 17:29'
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
- [ ] #1 One scripted or manual press of Send anyway in a conversation with an outcome-unknown agent turn shows whether the message reaches sendPrompt with the acknowledgement.
- [ ] #2 If blocked, the route is computed with the acknowledged attempts removed from unresolvedAttempts, and Enter, Send anyway and Continue agree.
- [ ] #3 A scripted scenario presses Send anyway and judges that the message was sent once and the attempt is recorded as acknowledged.
<!-- AC:END -->
