---
id: DSP-116
title: >-
  Respect the adapter's cancellation bound in the chat service and end the
  observed Claude child on dispose
status: Review
assignee: []
created_date: '2026-10-23 10:53'
updated_date: '2026-10-23 11:31'
labels:
  - integration
  - reliability
dependencies:
  - DSP-115
priority: high
type: feature
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up of DSP-115 for two lifecycle gaps it carried as notes N5 and N6 (Niclas, 23 Oct 2026). Smallest coherent fix; no larger rebuild; Cursor adapter behaviour unchanged; no live model call.

**N5 - cancel confirmation.** The chat service (`app/src/main/chat-service.ts`) waits `CANCEL_CONFIRM_MS` = 10 s for a terminal event after a cancel and then moves the attempt to `outcome-unknown`. The Claude adapter's escalation (`CANCEL_INTERRUPT_WAIT_MS` 3 s + `CANCEL_ABORT_WAIT_MS` 10 s + `CANCEL_KILL_WAIT_MS` 2 s) can take up to 15 s before its one terminal `run.finished`. The chat service also records every `run.finished` with status `cancelled` as `stopped-confirmed` and ignores `end`, so an `unconfirmed` end would be recorded as a confirmed stop.

**N6 - dispose.** `ClaudeAgentSdkAdapter.dispose()` aborts and closes each outstanding query and waits at most 5 s for the stream pumps. It neither waits for nor kills the Claude Code child it observes through `spawnClaudeCodeProcess`, and records nothing about it. The SDK's own abort path took ~7 s on Windows in DSP-109, so a process that exits after dispose returns can leave the child running (Windows does not end children with their parent).

**Effect on today's call paths (read in code, 23 Oct 2026).** The app's chat service creates `CursorSdkAdapter` (or `PresentationAdapter` in presentation mode); the Claude adapter is reached only from `experiment-work.ts`. So N5 is latent in the app: it matters when the Claude adapter is wired into the chat service, which is not this task. N6 affects the experiment command today: every Claude scenario ends with `dispose()` and then the process exits, including after a wait timeout or an exception while a run is still active. main.ts bounds `chatService.dispose()` by `DISPOSE_TIMEOUT_MS` = 8 s.

Keep the distinction between the local process having exited and possible remaining work at the provider (`providerWorkAfterEnd: unknown`). Carried separately, not in scope: DSP-115's R1, S1-S5 and the `followUp.runId` reporting error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Claude adapter declares how long it can take from cancel() to its terminal run.finished, derived from its existing constants rather than a new duplicated number; the Cursor adapter declares nothing and its behaviour and code are unchanged
- [x] #2 The chat service's cancel confirmation wait uses the adapter's declared bound when present, with any grace documented, and otherwise keeps the existing 10 s; it neither records outcome-unknown nor reports a confirmed stop before the adapter's bound has passed, and the wait stays bounded
- [x] #3 The chat service records run.finished cancelled with end unconfirmed as outcome-unknown, not stopped-confirmed; stopped and forced are recorded as a confirmed local end with provider work stated as unknown; a run.finished without end is handled as before
- [x] #4 dispose() takes care of each outstanding run's live observed Claude Code child: it waits a bounded time for the observed exit, kills the child if it has not exited and waits a bounded time again, reusing existing bounds where they fit, and records per run whether the exit was observed or could not be confirmed, readable after dispose
- [x] #5 dispose, cancel and normal process exit work together: at most one terminal event per run and none after dispose, no timers left running, no events to removed listeners, no kill of a process already seen to exit, dispose idempotent; covered at each stop-sequence wait
- [x] #6 Offline tests cover the bounds and races with injected timers, plus real local substitute processes where process exit or kill must be observed; relevant groups pass and typecheck passes; no live model call
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (23 Oct 2026, run 20261023-110000-dsp116): call paths mapped by the coordinator (see Description); next Implementer call 1 for the smallest coherent fix of N5 and N6, then Verifier and Reviewer on the same content-identified candidate; commit locally after ACCEPT; no push, no live call.

Result of run 20261023-110000-dsp116 (23 Oct 2026, base 5e445c3, candidate sha256:2edaf9d2dfaa6ae1915e2420287d59c4f62a7f50f1e59cae7c0656e0efacf410): Implementer calls 1-2, Verifier call 3 (7/7 PASS), Reviewer call 4 ACCEPT, no rework. Reports in .dspatch-loop/runs/20261023-110000-dsp116/reports/.
- N5 fixed: optional AgentAdapter/ChatAdapter member cancelEndBoundMs ("longest time from cancel() to the terminal run.finished, guaranteed by the adapter's timers"). Claude adapter declares CANCEL_END_BOUND_MS = max(CANCEL_INTERRUPT_WAIT_MS + CANCEL_ABORT_WAIT_MS + CANCEL_KILL_WAIT_MS, PREVIOUS_TURN_EXIT_MS) = 15 s, derived, no new literal. Chat service confirmation window = declared ? max(cancelConfirmMs, bound + CANCEL_CONFIRM_GRACE_MS 1 s) : cancelConfirmMs (10 s, unchanged); 16 s with the Claude adapter. Expiry note names the declared bound instead of the ~50 ms claim. run.finished cancelled: end unconfirmed -> outcome-unknown; stopped/forced -> stopped-confirmed with "provider work on requests already sent is unknown"; no end (Cursor, Presentation) -> unchanged. New turns stay blocked while cancel-requested or outcome-unknown (ledger mayRepeat).
- N6 fixed: dispose() is idempotent (one shared promise) and never throws; clears listeners, abandons stop sequences, aborts and closes, waits DISPOSE_EXIT_WAIT_MS 5 s (the former inline pump wait, now named and on the injected timers) for pumps and observed exits, kills each still-alive observed child unless the stop sequence already sent a kill, waits CANCEL_KILL_WAIT_MS 2 s; DISPOSE_BOUND_MS 7 s < main.ts DISPOSE_TIMEOUT_MS 8 s. disposals() records per run pid, killedBy, exit, outcome exited / killed-and-exited / unconfirmed, providerWorkAfterEnd unknown; nothing is emitted. The previous-turn wait ends at dispose (its 15 s timer no longer outlives dispose). experiment-work adds claudeDisposal only on Claude records.
- Tests: provider 63/63 incl. new heavy file claude-agent-sdk-adapter-process.test.ts (2 real local substitute processes via process.execPath; registered heavy in run-tests.mjs so fast stays process-free); chat 300/300; fast 1131/1131; typecheck 0; Cursor adapter unchanged. Verifier's own instruments: chat window 4/4, real-process dispose 8/8 (kill at ~5.0 s, worst case 7010 ms, no pending timers, no events after dispose, pid gone); negative control: base 5e445c3 left the substitute alive after dispose, candidate ended it.
- Call-path finding: the app's chat service uses CursorSdkAdapter or PresentationAdapter, so N5 was latent in the app; N6 affected the experiment command.
Carried, not done (separate notes): S1 after end stopped/forced the ledger's stillRunning.provider is false while the reason says provider work is unknown, and dspatchProcess false is wrong for Claude - fix with the wiring of the Claude adapter into the chat service (ledger contract); N4 toUiEvent drops end, so an unconfirmed end would show as an ordinary cancel - wiring task; S2 main.ts DISPOSE_TIMEOUT_MS does not name DISPOSE_BOUND_MS (headroom under 1 s once wired); S3 DisposalRecord docs: killedBy stop-sequence also when that kill threw or returned false, exited means without a kill from this adapter; N1 a process surviving the stop sequence's kill stays alive after dispose, recorded unconfirmed; N2 first-turn SDK load outside the bound (documented); N3 previous-turn path can end without a terminal (existing); N5 a spawn after dispose has finished is unobserved (optional guard in spawnObserved). DSP-115's R1, S1-S5 and the followUp.runId error remain separate.
Live-only, not established: whether the real CLI exits within 5 s of abort and close (DSP-109 measured ~7 s, so a live dispose may kill it); whether TerminateProcess ends claude.exe's grandchildren; that the experiment process exits after dispose; provider work after the local end.
Status: Review.
<!-- SECTION:NOTES:END -->
