---
id: DSP-117
title: Run a chat session through the Claude adapter
status: To Do
assignee: []
created_date: '2026-10-23 12:34'
labels:
  - integration
  - reliability
dependencies:
  - DSP-116
priority: medium
type: feature
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up of DSP-116 (Niclas, 23 Oct 2026). Today the app's chat service creates `CursorSdkAdapter`, or `PresentationAdapter` in presentation mode (`ensureAdapter` in `app/src/main/chat-service.ts`); the Claude adapter is reached only from `experiment-work.ts`. This card wires a chat session to `ClaudeAgentSdkAdapter` behind the existing `ChatAdapter` seam, as the next step of the agreed runtime order ([RUNTIME_PLATFORM_ROADMAP.md section 1.2](../../docs/RUNTIME_PLATFORM_ROADMAP.md#agreed-runtime-order), "Claude first, at home").

Two defects DSP-116 left latent become acceptance criteria here, because they only matter once Claude runs in the chat:

- **Ledger contradiction.** After `run.finished` with `end: stopped` or `forced`, the chat service calls `markStopped`, and for an agent turn in `stopped-confirmed` the attempt ledger (`attempt-ledger.ts`, `stillRunning`) sets `provider: false` ("The run reported an end."), while the attempt's reason says provider work on requests already sent is unknown. `dspatchProcess: false` is also wrong for Claude, whose Claude Code process the adapter spawns and observes.
- **UI and `unconfirmed`.** `toUiEvent` forwards only `status`, and the renderer branches on `status === 'cancelled'` (`turn-routing.ts`, `recovery.ts`). An `unconfirmed` end, recorded as `outcome-unknown` in the ledger, would be shown as an ordinary cancel.

Scope before start: the selection mechanism (how a session chooses Claude), the ChatAdapter members the Claude adapter does not yet provide (`providerMessageTypes`, `streamPumpFinished`, `modelReported`, `hasActiveRun`, `resume`) and the UI wording need a short planning pass and Niclas's approval. This card grants no implementation mandate by itself. Authentication follows DSP-109's rules (personal Max authorization; no API-key fallback, no credential handling). Cursor stays the default and unchanged. A live Claude test needs Niclas's explicit authorization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A chat session can run through ClaudeAgentSdkAdapter by an explicit selection agreed in planning; Cursor remains the default and its behaviour is unchanged
- [ ] #2 The ChatAdapter members the Claude adapter does not yet provide are supplied, or the chat service handles their absence without misreporting a run
- [ ] #3 Ledger: after run.finished cancelled with end stopped or forced, the attempt's structured stillRunning no longer claims the provider stopped (provider work is unknown, consistent with the attempt's reason), and dspatchProcess reflects the Claude Code process the adapter spawned and saw exit
- [ ] #4 UI: run.finished end reaches the window; an unconfirmed end is shown as not confirmed, never as an ordinary cancel, and stopped and forced are distinguishable, with provider work shown as unknown
- [ ] #5 Verified offline with a substituted query and the existing chat-service tests; Cursor and presentation paths unchanged; any live Claude test only with Niclas's explicit authorization
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Related follow-up notes carried from DSP-116 (visible here because they matter once Claude runs in the chat; not acceptance criteria of this card unless the plan makes them so):
- 7 s / 8 s coupling: ClaudeAgentSdkAdapter's DISPOSE_BOUND_MS (7 s) is documented only in the adapter and pinned by a literal 8_000 in a test; main.ts's DISPOSE_TIMEOUT_MS (8 s) does not name it, and ChatService.dispose runs closeSession before adapter.dispose, so the real headroom is under 1 s. Lowering main.ts's value fails no test.
- Process-disposal limits: a process that survives the stop sequence's kill stays alive after dispose (recorded unconfirmed, no second kill); DisposalRecord docs overstate slightly (killedBy stop-sequence also when that kill threw or returned false; exited means without a kill from this adapter); a spawn after dispose has finished is unobserved; whether TerminateProcess ends claude.exe's grandchildren and whether the real CLI exits within 5 s of abort are not established live (DSP-109 measured ~7 s for the SDK's abort path).
- Other latent items: first-turn SDK module load is outside CANCEL_END_BOUND_MS; a turn whose previous turn is still open after 15 s is rejected without a terminal event and the chat service would record it as failed.
<!-- SECTION:NOTES:END -->
