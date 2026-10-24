---
id: DSP-122
title: 'NEW-C: resume a Claude provider session in a new adapter instance'
status: Review
assignee: []
created_date: '2026-10-24 00:20'
updated_date: '2026-10-24 04:27'
labels:
  - integration
  - reliability
dependencies:
  - DSP-116
  - DSP-121
priority: high
type: feature
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NEW-C from the reviewed runtime plan (runs 20261023-170000-dsp119doc material, 20261023-200000-ws1 report 011, 20261023-230000-ws1b reports 010-013). Niclas chose direction C on 24 October 2026: a workspace switch disposes the adapter session, and returning resumes the same provider session; this is to be verified live later. This card establishes support for resuming a Claude provider session in a new adapter instance, ahead of wiring Claude into the app's chat (DSP-117, not implemented here).

Today `ClaudeAgentSdkAdapter.resume()` rejects (`app/src/adapter/claude-agent-sdk-adapter.ts`), while within one instance every later turn already passes `resume` with the provider session UUID DSpatch derives from its own session ID; that mechanism has provider-side run evidence: in the DSP-115 follow-up live run a fresh Claude Code process resumed the same session and recalled a marker after the earlier process had been observed to exit. What is not observed: DSpatch's own registration path in a new instance, environment alignment (the child's `CLAUDE_CONFIG_DIR` versus a host-side lookup), store retention across an app restart, and how the CLI answers `resume` for a UUID it does not hold (DSpatch chooses the UUID, so an equal init `session_id` is a consistency check, not proof of continuity; marker recall is).

Requirements: keep the established provider session identity and the metadata a later resume needs; separate locally available session information (a local lookup such as the SDK's documented `getSessionInfo`, which can also report nothing for a session with no extractable summary) from provider-confirmed resumption (the first turn's init and its answer); never claim that a local file or a matching ID alone proves context continuity; distinguish a missing session from other failures where the evidence allows, otherwise state uncertainty; refuse to resume after an unconfirmed or unknown end in a way that keeps the block on continued work (the adapter's in-memory refusal does not survive a new instance); reuse the existing adapter contracts and authentication guard; no broad SDK investigation and no separate SDK integration. Offline-verified only until live evidence exists; the live probes (P3 + P4' chain, R-A0 unknown-ID control, P1 for Cursor) are prepared for a later authorized run on an identified candidate, not run here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ClaudeAgentSdkAdapter.resume(sessionId, config) registers an established session in a new instance so that its first send passes resume with the same derived provider session UUID; the config must match what the session needs (working directory, policy) or the resume is refused with the reason
- [x] #2 Local session information is checked before the first send through a documented local lookup and reported as local evidence only; provider-confirmed resumption is recorded from the first turn's init and answer; nothing presents a local file or a matching ID as proof of context continuity
- [x] #3 A missing session, a refused resume at the first send and an unspecified error are reported distinctly where the evidence allows, otherwise with stated uncertainty; the DSP-121 choice applies; no automatic recap fallback
- [x] #4 A session whose last run ended unconfirmed or unknown according to DSpatch's record is not resumed; the block on continued work in that working copy stays until acknowledged, and the refusal says why
- [x] #5 The metadata a later resume needs is saved and read back with the conversation without a format regression (a format version bump if a field is added); older files without it behave as before
- [x] #6 Verified offline with a substituted query (success in a new instance within one process, missing, refused at first send, unspecified error, unconfirmed end, metadata round trip) and the existing provider tests; the authentication guard and tool policy are unchanged; the live probes are prepared as runnable commands on an identified candidate but not run; the card states that support is offline-verified only until live evidence exists
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (24 Oct 2026, run 20261024-010000-resume-plan): planned together with DSP-121 (reviewed before implementation); implementation follows DSP-121 in its own run. Offline-verified only until live evidence exists; the live probes are prepared, not run.

Plan (24 Oct 2026, run 20261024-010000-resume-plan): reports/001-planner.md sections 3-4 as amended by reports/003-coordinator-plan-addendum.md. AC #4 note: enforced in ChatService on the conversation's ledger for sessions recorded as Claude; the adapter keeps the same-instance guard. The rule does not read the adapter's in-memory disposals() records (DSP-116), which can be 'unconfirmed' for a run the ledger has settled; if P4' shows processes lingering after normal turns those records must be persisted and read here. Cursor keeps DSP-4's order (resume, then the send gate); neither path bypasses the block. AC #5 note: format version 2; v1 builds read v2 files as newer, read-only; provider written explicitly for Cursor too. AC #6 note: probe subcommands per plan section 4; the Cursor subcommand has no code guard and is never invoked with a repository path during verification; the first-send classification table stays empty until R-A0; capabilities().resume stays 'unknown' until P3 passes; the Claude resumed statement never presents an equal session ID as confirmed recall.

From DSP-121's review (S4): classifyResumeFailure is keyed on providerCode alone; for the addendum's 'local record missing, environment not aligned -> unknown' row the Claude adapter must throw a distinct code (e.g. local_record_missing_unaligned) and classifyResumeFailure gains that one case in DSP-122. Resume statements must be judged at the argument level, not only by call names: say what resume() and the first send actually carried.

Focus (run 20261024-030000-dsp122, base 3e764a2 after DSP-121): implementation, Implementer call 1 = Claude adapter resume(), local lookup seam, resumption record, capability 'unknown', expectedToolPolicy + policyDigest, Cursor disposals(), provider-group tests.

Result (24 Oct 2026, run 20261024-030000-dsp122, base 3e764a2, accepted candidate 003 sha256:bb2ce0b8438d585abb265f919d5d7bf81b61c2ca3e7cb4590be5f5dc82e0a44f): Implementer calls 1, 2, 4, 7; Verifier calls 3, 5, 8 (PASS); Reviewer calls 6 (REWORK: B1 Claude context statement keyed on the file instead of the adapter called; B2 README/statement claimed the window's try-again acknowledges the attempt) and 9 (ACCEPT). OFFLINE-VERIFIED ONLY: no live model call, no real Claude Code or Cursor process, no probe run, Niclas's Claude profile not read. Checks on candidate 003: typecheck; build; usage (no arguments) exit 64; provider 78/78; chat 339/339; fast 1162/1162 (candidate 001, unaffected files). What exists: ClaudeAgentSdkAdapter.resume() with the injected local lookup (getSessionInfo(uuid, {dir: workspacePath}) by default), codes config_mismatch / local_lookup_failed / local_record_missing / local_record_missing_unaligned / authentication_refused, resumption record (localLookup, lookupEnvironment, firstTurn from the SDK init and terminal only; idMatches a consistency check), PROVIDER_MISSING_FORMS empty until R-A0, policyDigest(), capabilities().resume 'unknown', Cursor disposals(); StoredSession.provider with CONVERSATION_FORMAT_VERSION 2 (a carried provider-less session keeps its file at version 1 while no provider session is open; rewritten as v2 only once a provider session is open over it; a DSP-121 build reads v2 files as newer/read-only); ChatService unconfirmed-end rule on the ledger for Claude-recorded sessions (does not read disposals(); Cursor keeps resume-then-gate); context statements chosen from the adapter that was called. DSP-117 dependencies: the renderer's try-again does not pass acknowledgedAttemptIds yet; the chat service still builds the Cursor adapter regardless of the recorded provider (a Claude-recorded file met by Cursor gets the Cursor wording, which is true of that call); expectedToolPolicy set by nothing in the product yet. Prepared probes (experiment-work subcommands, none run): resume-after-dispose (P1+R-C1+R-C2, 2 Cursor turns, NO code guard - Niclas's say-so only; verified only through argument tests), resume-chain start|continue (P3+P4', 2 Claude turns +1 with --same-process, --subscription-authorization required), resume-unknown-id (R-A0, up to 1 Claude turn), resume-controls (R-A1/R-A2, 0 turns, authorization still required), local-lookup (plan 4.5, 0 turns, no guard, reads Niclas's Claude profile - needs his agreement). Before a live P4' is read: tighten liveness() so a non-ESRCH kill failure yields pass null, not true. Optional notes left open: copilot folded into cursor in the handle-to-stored mapping (S3); 'The format this build writes' doc phrase (S5); the window does not read resumption() (S8). Not Done: live acceptance (P3 recall in a new process, R-A0) pending Niclas's authorization.
<!-- SECTION:NOTES:END -->
