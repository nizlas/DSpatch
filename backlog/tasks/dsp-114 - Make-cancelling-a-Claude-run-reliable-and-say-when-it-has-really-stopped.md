---
id: DSP-114
title: Make cancelling a Claude run reliable and say when it has really stopped
status: Done
assignee: []
created_date: '2026-10-22 20:08'
updated_date: '2026-10-22 20:41'
labels:
  - integration
  - reliability
dependencies:
  - DSP-109
priority: high
type: spike
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-109 (Niclas, 22 Oct 2026). In the live cancel-reply run of DSP-109 (loop run 20261022-203000-dsp109live, record .dspatch-loop/runs/20261022-203000-dsp109live/logs/cancel-reply-subscription.json, report 001 in the same run directory; local and Git-ignored), ClaudeAgentSdkAdapter.cancel() (AbortController) resolved 1 ms after it was called, but Claude Code kept working: seven read-only tool calls (Glob at 3056 ms, Read x6 between 5966 and 7646 ms after send) started after cancel() resolved, the provider transcript shows a further model request about 5 s after the cancel (api-request entries at 20:04:00.525, 20:04:02.902 and 20:04:07.452 UTC), and the terminal 'cancelled' event arrived 7032 ms after the cancel call. No file changed, but usage accrued after the cancel, and no result message arrived, so that run's usage is unknown. DSP-109's AC #5 accepted that this behaviour was tested and recorded, not that it is acceptable product behaviour.

Goal: investigate and propose a clear cancellation contract for Claude runs in DSpatch, then (in a later, separately authorized step) implement it. Scope of the proposal:
- distinguish a requested cancellation from a confirmed end of the run, in the adapter's API, events and records;
- prevent new tool operations after a cancellation request wherever DSpatch can control it;
- handle work already in progress, including a possible forced termination of the provider process, and what that means for the session's later use;
- state the limits honestly: provider work and usage already started cannot be undone, and DSpatch may not see all of it;
- verify both the time to a confirmed end and any operations or file changes after the request.

Do not lock the solution to a particular SDK mechanism (for example Query.interrupt(), Query.close(), AbortController, a permission callback, or process termination) before its documented and observed behaviour has been examined for the installed SDK and Claude Code versions. Consider how the same contract applies to the Cursor adapter, without changing it in this task unless the proposal says so and Niclas agrees.

Relevance index: docs/RUNTIME_PLATFORM_ROADMAP.md (runtime and session handling); docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md section 2 "Enforcement follows execution" (where a control must sit to be effective).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A written proposal for a cancellation contract that separates a requested cancellation from a confirmed end of the run, and says how each appears in the adapter's API, events and run records
- [x] #2 The documented and observed behaviour of each candidate SDK or process mechanism for stopping a run is recorded for the installed SDK and Claude Code versions, with documentation separated from observation, before one is chosen
- [x] #3 The proposal states how new tool operations are prevented after a cancellation request where DSpatch can control it, how work already in progress and forced termination are handled, and what DSpatch cannot prevent (provider work and usage already started)
- [x] #4 The proposal defines how verification measures time to a confirmed end and any tool operations, model requests or file changes after the request, and reuses the DSP-109 cancel-reply record as the baseline
- [x] #5 No implementation and no live provider call happen under this card unless Niclas authorizes them separately
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reviewed proposal (22 Oct 2026; loop run 20261022-210000-dsp114plan: Researcher report 001, Reviewer ACCEPT in report 002). Not implemented; implementation needs Niclas's separate authorization.

Cause (code-read and documented, timing inferred): ClaudeAgentSdkAdapter.cancel() only calls abortController.abort(). In the installed SDK 0.3.306 the abort handler is the transport close(): it ends the CLI's stdin, then after 2000 ms (and on Windows a further 5000 ms) kills the process. Stdin EOF does not interrupt the current turn, so Claude Code kept calling tools and the model until the kill; 2000 + 5000 ms matches the observed 7032 ms. No interrupt was sent (only Query.interrupt() sends one, documented for streaming-input mode; the adapter uses a string prompt). The adapter kept emitting events until the stream ended.

Contract:
- Requested: cancel() emits an additive event run.cancel_requested and resolves; it never awaits interrupt() unboundedly.
- Confirmed end: run.finished(cancelled) only when the SDK stream has ended, with an optional additive field end: 'stopped' | 'forced' | 'unconfirmed'. On the cancel path a result message is recorded (usage kept) but does not by itself end the run. A run.finished without end (Cursor) means "not reported", never stopped. No new RunStatus.
- Between request and end, events are still emitted and recorded, counted from run.cancel_requested.

Mechanism (smallest combination):
(a) A per-run PreToolUse hook without matcher: after the request it returns permissionDecision 'deny' plus continue:false and a stopReason (documented to run before allow rules and permission modes, so it works in dontAsk with pre-approved tools; canUseTool does not). Its texts are named constants recorded in the run record, because they reach the model's conversation.
(b) Query.interrupt() in documented streaming-input mode: the prompt becomes a one-message async iterable (ClaudeQueryFunction prompt type and an optional interrupt() on ClaudeQueryHandle). Stdin stays open for interrupt only because a hook is registered (SDK code) - documented in the code comment.
(c) Order: set the flag, call interrupt(), wait up to 3 s for the stream to end; never abort first (abort closes stdin and hook callbacks could not be answered).
(d) Escalation: abort(), wait up to ~10 s; end 'forced'; if still open, end 'unconfirmed' and refuse new turns. An interrupt() rejection is recorded and escalates. dispose() clears the timers and emits nothing after the terminal.
Fallback, only if the live run shows (b) does not stop within the bound: a custom spawnClaudeCodeProcess to observe the process exit and kill at once (costs: no graceful shutdown, incomplete transcript).
Session reuse: documented resume continues where the session left off; nothing documented about resume after an interrupt or kill - to be tested with a follow-up turn.
Limits: a request already in flight and requests sent before the hook or interrupt take effect are billed; a tool already executing finishes; an Edit approved before the request cannot be undone (the diff shows it); without a result message usage stays unknown; DSpatch sees only what the stream delivers.

Verification. Offline (substituted query; existing cancel tests at test :324, :351, :989 reworked, since they rely on the abort): cancel_requested before cancel() resolves; no run.finished while the stream is open even after a result (S1); end 'stopped' on stream end; the hook passes before and denies after the request, per run; interrupt() called once and no abort/close before the bound (fake timers); a never-ending stream gives abort, then 'unconfirmed' and send() refused; interrupt() rejection escalates; the prompt is a one-message iterable; record fields cancelRequestedAtUtc, hook firings (time, tool, decision), interrupt outcome, tool_use blocks after the request and tool results that were not a hook denial.
Live (one cancel-reply run plus a short follow-up turn, separately authorized, existing model configuration), compared with DSP-109's baseline recomputed the same way: time from request to run.finished (baseline 7032 ms, forced) reported in ms and pass when end is 'stopped' within the 3 s bound; tool results executed after the request (baseline 7 tool_use blocks) 0, denied tool_use allowed and recorded; transcript api-request entries after cancelRequestedAtUtc (baseline 2) 0; result and usage recorded or unknown; no content change; no events after the terminal; which mechanism stopped the run (hook, interrupt or the model ending); follow-up turn on the same session id finishes without error; DSP-109's string-prompt observations (title, init, accountInfo, session id, unrequested models) re-recorded under streaming input and any change flagged.

Decisions for Niclas: (1) authorize implementation (under DSP-114 or a follow-up card); (2) scope: hook + streaming input + interrupt (recommended; the hook alone would make a text-only cancel slower, up to ~10 s), or the hook alone as a probe; (3) authorize one live cancel-reply run with a follow-up turn.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (22 Oct 2026): Niclas asked for a short, reviewed proposal only - cause of the late stop in DSP-109's cancel-reply run, smallest change for a cancellation contract, targeted verification against that run. No product implementation, no live calls; model inheritance per existing configuration. Run journal .dspatch-loop/runs/20261022-210000-dsp114plan.

Proposal delivered (22 Oct 2026, run 20261022-210000-dsp114plan; reports 001 Researcher, 002 Reviewer ACCEPT; local and Git-ignored). The reviewed proposal is the Implementation Plan section of this card. AC #1-#4 met by the proposal (documentation, SDK code reading and DSP-109 observations kept apart; live behaviour of interrupt(), the hook and session reuse marked to test). AC #5: no implementation and no live call happened. Awaiting Niclas: authorize implementation, choose scope (recommended: hook + streaming input + interrupt), authorize one live cancel-reply run with a follow-up turn.

Niclas approved the reviewed proposal on 22 Oct 2026: PreToolUse hook plus interrupt(), streaming input and bounded escalation. Planning task closed; implementation continues in DSP-115 with the Reviewer's S1-S4 as explicit criteria.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Planning spike done (22 Oct 2026). Cause of the late stop in DSP-109's cancel-reply run: the adapter's abort only closes Claude Code's stdin; the SDK kills the process after 2000 + 5000 ms on Windows (matching the observed 7032 ms) and stdin EOF does not interrupt the turn. Approved contract: run.cancel_requested, a confirmed end with end stopped/forced/unconfirmed, a per-run PreToolUse deny hook, interrupt() with streaming input, bounded escalation, refusal of new turns when the end is unconfirmed. Reviewed in run 20261022-210000-dsp114plan (Reviewer ACCEPT). Implementation: DSP-115.
<!-- SECTION:FINAL_SUMMARY:END -->
