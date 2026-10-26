---
id: DSP-117
title: Run a chat session through the Claude adapter
status: Review
assignee: []
created_date: '2026-10-23 12:34'
updated_date: '2026-10-26 13:04'
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
- [x] #1 A chat session can run through ClaudeAgentSdkAdapter by an explicit selection agreed in planning; Cursor remains the default and its behaviour is unchanged
- [x] #2 The ChatAdapter members the Claude adapter does not yet provide are supplied, or the chat service handles their absence without misreporting a run
- [x] #3 Ledger: after run.finished cancelled with end stopped or forced, the attempt's structured stillRunning no longer claims the provider stopped (provider work is unknown, consistent with the attempt's reason), and dspatchProcess reflects the Claude Code process the adapter spawned and saw exit
- [x] #4 UI: run.finished end reaches the window; an unconfirmed end is shown as not confirmed, never as an ordinary cancel, and stopped and forced are distinguishable, with provider work shown as unknown
- [x] #5 Verified offline with a substituted query and the existing chat-service tests; Cursor and presentation paths unchanged; any live Claude test only with Niclas's explicit authorization
- [x] #6 A conversation recorded with one provider is never resumed through another; switching providers is a new provider session whose recap is disclosed and removable before anything is sent
- [x] #7 The Claude chat tool policy is explicit and shown in the session context; no Bash
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Related follow-up notes carried from DSP-116 (visible here because they matter once Claude runs in the chat; not acceptance criteria of this card unless the plan makes them so):
- 7 s / 8 s coupling: ClaudeAgentSdkAdapter's DISPOSE_BOUND_MS (7 s) is documented only in the adapter and pinned by a literal 8_000 in a test; main.ts's DISPOSE_TIMEOUT_MS (8 s) does not name it, and ChatService.dispose runs closeSession before adapter.dispose, so the real headroom is under 1 s. Lowering main.ts's value fails no test.
- Process-disposal limits: a process that survives the stop sequence's kill stays alive after dispose (recorded unconfirmed, no second kill); DisposalRecord docs overstate slightly (killedBy stop-sequence also when that kill threw or returned false; exited means without a kill from this adapter); a spawn after dispose has finished is unobserved; whether TerminateProcess ends claude.exe's grandchildren and whether the real CLI exits within 5 s of abort are not established live (DSP-109 measured ~7 s for the SDK's abort path).
- Other latent items: first-turn SDK module load is outside CANCEL_END_BOUND_MS; a turn whose previous turn is still open after 15 s is rejected without a terminal event and the chat service would record it as failed.

From DSP-121's flow review (24 Oct 2026, run 20261024-070000-dsp121-flow, Reviewer 005 S6): authentication_refused is DSpatch's own credential rule, assessed from the process environment when the Claude adapter is built (claude-agent-sdk-adapter.ts ~:381-432, ~:2089-2091). Within the same process both Try again and Start new session hit the same refusal. When the Claude adapter reaches the chat, do not offer Try again for it and say it is DSpatch's rule rather than 'Authentication was refused.' Also: the window's Try again does not pass acknowledgedAttemptIds yet (needed to lift the unconfirmed-end block), and the chat still builds the Cursor adapter regardless of the recorded provider.

Mandate (Niclas, 26 Oct 2026): introduce or complete an explicit provider selection through the existing architecture so the main chat can run through the Claude adapter, Cursor kept; main chat and review discussion keep separate conversation and session identities; a provider switch never resumes another provider's session ID nor silently sends history; existing protections for unconfirmed ends and unknown resume support kept; the review discussion's tool and write limits keep applying, and if Claude cannot meet them yet that path stays blocked and says so. Offline only: substituted query or mocked SDK, no Claude profile reads, no real provider sessions, no model calls. The open authentication question is to be stated before the live trial; no reuse of credentials without permission and no silent fallback to separately billed API use. Live Claude test at home later, with Niclas. Claude must never run on the work computer, neither as development agent nor as provider in DSpatch.

Focus (run 20261026-200000-linux-claude, base c6cb57e): planning together with the new Linux card.

Result (run 20261026-200000-linux-claude, candidate 003 sha256:a370406b...44629 on c6cb57e; plan Planner 001 + Reviewer 002 ACCEPT with B1-B4; Implementer calls 3-6, 9, 11; Verifier 007 PASS, 010 rework PASS; Reviewer 008 REWORK R1-R4, 012 ACCEPT). OFFLINE-VERIFIED ONLY on Windows (substituted SDK, presentation adapters); no Claude turn has run through the window; nothing on Linux.

Implemented: per-conversation provider selection (StoredSession.provider v2): Agent choice in Open a project (Cursor default; the Cursor-connection gate only when Cursor is chosen; opening with Claude builds and calls no Cursor adapter) and in the composer (switching = new-provider-session with the recap disclosed and removable; locked while a turn, command or loop runs); an existing conversation always opens with its recorded provider; back-stop before any adapter call when recorded and selected providers differ (provider-differs; never resumed through another provider; Start new Cursor/Claude session named); Claude only when the launch sets DSPATCH_CLAUDE_AUTHORIZATION (absent by default, subscription kind only; assessAuthentication/providerEnvironment untouched; no API-key path); CHAT_PERMISSIONS Read, Glob, Grep, Edit, Write, allowed Read(/**), Edit(/**), dontAsk, no settings, no MCP, no Bash, shown as toolPolicySent; expectedToolPolicy on Claude resumes; cached adapter of another provider replaced; Cursor facts labelled as Cursor's when Claude is selected; model claude-haiku-4-5 by name; a refused new Claude session keeps the conversation with Switch to Cursor; ledger end for stopped/forced (provider unknown, process exit seen), unconfirmed unchanged, Cursor unchanged; UI labels 'Stop not confirmed · provider work unknown', 'stopped · provider work unknown', 'stopped (forced) · provider work unknown'; authentication_refused offers no Try again and names DSpatch's credential rule; DISPOSE_TIMEOUT_MS = DISPOSE_BOUND_MS + 1 s. AC#2 note: the members once listed as missing exist (claude-agent-sdk-adapter.ts resume, providerMessageTypes, streamPumpFinished, modelReported, hasActiveRun); the chat says what Claude cannot answer (no model list, login not checked by DSpatch). Review discussion stays Cursor text-only and says why.

Also in this run: test:chat made two real Cursor API calls through a pre-existing unsubstituted test (refused 403 plan_required; no model answer); fixed, all groups audited, and an offline guard (scripts/test-offline-guard.mjs, loaded by run-tests.mjs) now refuses non-loopback connections and the Claude SDK import in every test group.

HUMAN_PENDING: the live Claude trial at home (docs/LINUX_HOME_TRIAL.md Part B) - needs Niclas's authorization, Claude Code's own login on that machine with extra usage off, and Q3 (does the 22 Oct subscription scope cover the home Linux machine?). Not observed live: init tools/mcp_servers under CHAT_PERMISSIONS, Edit covering Write, the reported model, dispose/exit times, resume across processes (DSP-122). UX of both Agent selects, 'Claude (off)' and small-height layout unaccepted. Follow-ups: DSP-132 to DSP-135.
<!-- SECTION:NOTES:END -->
