---
id: DSP-115
title: Cancel a Claude run reliably and record when it has really stopped
status: Review
assignee: []
created_date: '2026-10-22 20:41'
updated_date: '2026-10-22 21:34'
labels:
  - integration
  - reliability
dependencies:
  - DSP-114
priority: high
type: feature
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements the cancellation contract Niclas approved on 22 Oct 2026 in DSP-114 (reviewed proposal in DSP-114's Implementation Plan; run 20261022-210000-dsp114plan, reports 001 Researcher and 002 Reviewer ACCEPT): a per-run PreToolUse hook that denies after a cancellation request, Query.interrupt() with streaming input, bounded escalation, and records that separate a requested cancellation from a confirmed end. Baseline: DSP-109's live cancel-reply run (run 20261022-203000-dsp109live).

Scope: the Claude adapter (app/src/adapter/claude-agent-sdk-adapter.ts) and the experiment program (app/src/main/experiment-work.ts), with compatible additive changes to shared types and event handling (app/src/adapter/types.ts, agent-adapter.ts comment, event consumers only where needed); Cursor behaviour unchanged. Offline only until a live run is separately authorized. Model inheritance per existing configuration.

Baseline reconciliation (coordinator, 22 Oct 2026; raw data unchanged): the cancel request is placed at about 20:04:02.319 UTC by aligning the record's Glob tool.started (send + 3056.4 ms) with the transcript's Glob tool_use entry (20:04:02.816), so send is at about 20:03:59.760 and the cancel at send + 2559.4 ms (inference; alignment error is milliseconds). Definition: a model request "after the cancel" is a transcript api-request entry whose timestamp is later than the cancel request. By that definition: api-request #1 (20:04:00.525) was in flight at the cancel and its response continued, producing the Glob tool_use after the cancel; #2 (20:04:02.902, +0.58 s) and #3 (20:04:07.452, +5.13 s) started after it. The correct count is two model requests after the cancel. DSP-109's report and card said "at least one further model request about 5 s after the cancel", counting only #3; that statement was incomplete, not wrong about #3. Tool calls: seven tool_use blocks (Glob, Read x6) after the cancel, all executed (each followed by a user/tool_result entry).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cancel() emits an additive run.cancel_requested event and resolves without awaiting interrupt() unboundedly; exactly one terminal run.finished per run, with an optional end field stopped | forced | unconfirmed; a run.finished without end (Cursor) means not reported; no new RunStatus
- [x] #2 S1: on the cancel path a result message is recorded with its usage but does not end the run; the terminal waits for the confirmed end; the existing cancel tests that relied on abort are reworked
- [x] #3 Evidence for the end is defined and recorded: stopped and forced require an observed local process exit of the Claude Code child (or a documented SDK guarantee cited in the code), not merely the end of the SDK stream; forced means the abort/kill path ran; unconfirmed when no exit is observed within the bound, after which new turns are refused; the record states that provider-side work already started is unknown
- [x] #4 A per-run PreToolUse hook without matcher denies every tool after the request with continue:false; its permissionDecisionReason and stopReason are named constants recorded in the run record (S5); the hook passes before the request and in later runs
- [x] #5 S4: interrupt() via a one-message streaming-input prompt, called once after the flag; a rejection is caught, recorded and escalates; bounded wait then abort then bounded wait; dispose() during the waits clears timers and emits nothing after the terminal; ClaudeQueryHandle gains optional interrupt(), ClaudeQueryFunction the iterable prompt type
- [x] #6 S2/S3: the record holds cancelRequestedAtUtc, hook firings (time, tool, decision), the interrupt outcome, tool_use blocks after the request and tool results that were not a hook denial, and the end with its evidence
- [x] #7 Deterministic tests cover races between normal completion, cancel and escalation (cancel after the result, cancel during escalation, repeated cancel, dispose during the waits) with exactly one terminal event, plus the preserved authentication rule, tool isolation (strictMcpConfig, exact tools), the session title and turn-to-run-id binding under streaming input
- [x] #8 Cursor behaviour unchanged (CursorSdkAdapter untouched or changed only compatibly with its tests passing); typecheck and the relevant test groups pass; no live call before a separate authorization
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (22 Oct 2026): implementation through the development loop (Implementer, Verifier, Reviewer), offline only; no live call. Run journal .dspatch-loop/runs/20261022-213000-dsp115impl.

Offline implementation completed (22 Oct 2026, loop run 20261022-213000-dsp115impl, base 1c35622): Implementer, Verifier (all eight checks PASS; 22 own race scenarios and 5 real node-process cases), Reviewer REWORK (B1, B2), rework round 1 (B1, B2, N1-N4), Verifier re-check (all PASS; 29 scenarios, 5 real-process cases), Reviewer ACCEPT. Accepted candidate snapshot sha256:b55da4182c328e181e1ba9e71fc80a3526abfb118bb13d0f63b2005a9f0dc673, committed unchanged as the next local commit. No live call; claude.exe never spawned.

What exists (app/src/adapter/claude-agent-sdk-adapter.ts, types.ts, agent-adapter.ts comment, app/src/main/experiment-work.ts, tests; CursorSdkAdapter unchanged, event consumers unchanged):
- Contract: cancel() emits the additive run.cancel_requested (after run.started; a cancel during the previous-turn wait is deferred, never orphaned) and resolves; repeated cancel is idempotent; exactly one terminal run.finished, with optional end stopped | forced | unconfirmed (a missing end, as from Cursor, means not reported). On the cancel path a result is recorded with its usage but does not end the run (S1).
- End evidence (Niclas's point 1): the SDK contract does not guarantee process exit when the stream ends, so the adapter observes the Claude Code child itself through the documented spawnClaudeCodeProcess option (same command, args, cwd, env and signal; guarded environment re-checked, values never logged). stopped = interrupt path, stream ended and observed exit; forced = abort and, if still alive, SIGKILL of the observed process, then observed exit; unconfirmed = no observed exit within the bounds (3 s after interrupt, 10 s after abort, 2 s after kill), after which new turns in the session are refused until an exit is observed. A query handle without an observed process is never a confirmed end. spawn-failed and not-started cover runs where no process ever existed. Every cancellation record says providerWorkAfterEnd: unknown.
- Mechanism: per-run PreToolUse hook without matcher; after a cancel request (not after dispose) it returns permissionDecision deny, continue:false and stopReason; the two texts are named constants recorded in every Claude record. interrupt() via a one-message streaming-input prompt, called once; a rejection or a missing method escalates at once. dispose() during the waits clears timers and emits nothing more.
- Records: cancelRequestedAtUtc, hook firings (time, tool, tool_use id, decision), interrupt outcome, abort and kill times, the end and its evidence (pid, exit code, signal, bounded 4 KB stderr tail labelled as raw CLI output), tool_use blocks after the request, results not denied and results ok after the request. The spawn wrapper's comment names both documented differences from the SDK's own spawn (no stderr tail in exit errors, d.ts :9782-9785; no executable-existence check, d.ts :2477).
- Preserved under streaming input: the subscription and API-key authentication rules, strictMcpConfig and the exact tools, title, settingSources [], dontAsk, turn-to-run-id binding of init and account observations, resume on later turns.
Tests: provider group 51/51; chat group 296/296 (shared AgentEvent changed); typecheck exit 0; Cursor adapter unchanged. These show the adapter's logic and configuration against substitutes, not the real CLI's behaviour.

Carried, not done: R1 the stderr tail is read without waiting for stderr to close on the error path (diagnostic only); S1 run.cancel_requested's at is the emission time, which on the deferred path can be later than cancelRequestedAtUtc; N5 chat-service's 10 s cancel confirmation is shorter than the adapter's 15 s worst case and end is not forwarded to the chat UI (for the wiring task); N6 dispose() does not kill the observed child (follow-up).

Proposed live test (needs Niclas's authorization; one execution): one cancel-reply run plus one short follow-up turn in the same session, on the rebuilt program, fresh fixture, claude-haiku-4-5, clean child environment, existing Max login, the registered subscription authorization. Compare with the reconciled DSP-109 baseline (cancel at send+2559 ms; 7032 ms to the terminal, forced by the SDK's kill; seven executed tool calls; two model requests started after the cancel): pass when end is stopped with exit evidence and the time from cancelRequestedAtUtc to the terminal is within the 3 s bound (report the ms); toolResultsNotDeniedAfterRequest for tools started after the request is 0 (a denied tool_use from the in-flight response allowed and recorded); no transcript api-request after cancelRequestedAtUtc; no content change; no events after the terminal; the record shows which mechanism acted (hook firings, interrupt outcome); the result and usage after the request recorded or unknown; the follow-up turn on the same provider session finishes without error; DSP-109's observations (verified/rule-met, exact tools, no MCP servers, title, no unrequested model usage, continuity) re-recorded under streaming input with any change flagged. forced or unconfirmed, or a follow-up failure, is a recorded finding, not a reason to retry.
Status: Review (live verification pending authorization).
<!-- SECTION:NOTES:END -->
