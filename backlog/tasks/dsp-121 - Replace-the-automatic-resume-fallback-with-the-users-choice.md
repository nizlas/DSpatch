---
id: DSP-121
title: Replace the automatic resume fallback with the user's choice
status: Review
assignee: []
created_date: '2026-10-24 00:20'
updated_date: '2026-10-24 08:53'
labels:
  - integration
  - reliability
dependencies:
  - DSP-4
priority: high
type: feature
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's decision of 24 October 2026, from the independently reviewed session-handling analysis (run 20261023-230000-ws1b, reports 010-013): when resuming a provider session is refused or fails, DSpatch must not fall back automatically. Today `openProviderSession` in `app/src/main/chat-service.ts` opens a new provider session at once, queues the recap and prepends it to the user's next message with no separate choice, and the save that follows overwrites the stored session ID with the new session's, so a temporary cause (a moved folder, a file lock, a network or authentication error) permanently loses the pointer to a session that might still be resumable; every failure reads as the same refusal.

Approved behaviour (both providers; Cursor today, Claude through NEW-C): keep the old session ID on record until the user chooses; offer three choices - try again; start a new session with a visible recap the user can remove before sending; keep reading the history without starting an agent. No recap or user prompt is sent automatically to a new session as a fallback. If an earlier send may have reached the provider, say so; never resend automatically in a way that could duplicate work. Only opening the history or showing the resume failure must not start a model turn. Distinguish "the provider says it does not have the session" (final) from "the resume failed: <error>" (may be temporary) where the evidence allows it; otherwise state the uncertainty. Normal successful resume and compatibility with older Cursor conversations without a provider field stay as they are. This changes DSP-4's tested fallback behaviour; DSP-4 AC #2's wording ("any new provider session and its limitations are disclosed") still holds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a resume is refused or fails, no new provider session is opened and no recap is queued automatically; the previous provider session ID stays on record unchanged until the user chooses
- [x] #2 The window offers three choices - try again, start a new session with a visible recap the user can remove before sending, or keep reading without starting an agent - and nothing is sent until the user sends
- [x] #3 The refusal distinguishes a session the provider says it does not have from a resume that failed with an error, where the evidence allows it; otherwise it states the uncertainty; the wording never claims a provider check that was not made
- [x] #4 If an earlier send may have reached the provider, the window says so and nothing is resent automatically; opening the history or showing the resume failure starts no model turn
- [x] #5 A successful resume behaves as before; older Cursor conversations without a provider field still resume as before; DSP-4 criteria #1-#6 keep holding
- [x] #6 Verified offline with a fake adapter and substituted responses (refused, missing, unspecified error, success); DSP-4's existing tests updated to the approved behaviour; no live call
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (24 Oct 2026, run 20261024-010000-resume-plan): implementation plan by the Backlog Planner, reviewed independently before implementation; implementation follows in its own run, before DSP-122.

Plan (24 Oct 2026, run 20261024-010000-resume-plan): reports/001-planner.md section 2 as amended by reports/003-coordinator-plan-addendum.md (Reviewer REWORK on plan text only, no product decision). Design: continuity kinds resume-refused / resume-failed / resume-unavailable with providerSessionOpen false, resumeFailure {kind, detail, providerCode}, earlierSendsMayHaveReached from the ledger's unresolved agent-turn attempts, choices try-again / new-session / keep-reading; openProviderSession returns handle null; buildConversation keeps the stored session unchanged while no provider session is open; requireSession refuses send and cancel; evidence() returns null adapter readings; IPC retry-resume and discardPendingRecap. The resumed statement is worded from the adapter's resumeEvidence ('provider-answered' | 'local-record' | 'none'), never from the capability flag. Defaults taken: (a) adapter-cannot-resume treated as refusal; (b) saved messages without a recorded session still open a new session with a removable recap; (d) the recap is removable on every new-provider-session. A loop run may start from the refusal state (it uses its own sessions). Try again reopens like any reopen: a running build or test command is stopped.

Focus (run 20261024-020000-dsp121, base 96a6c37): implementation, Implementer call 1 = main process half.

Run 20261024-020000-dsp121 round 1: Verifier PASS (typecheck; chat 334, presentation 275, fast 1147; switch scenario both phases exit 0 on a fresh kit; real userData untouched). Reviewer REWORK: B1 the not-open session-context statement claimed the path and model name were not sent, but the refused resume() call passed both to the provider's SDK; S1 the once-only recap assertion was lost in the test rewrite; S2 resume-unavailable should say a retry gives the same answer. Rework in progress. For Niclas's window check (Reviewer item 8): the choice panel is unreachable with the presentation adapter; use a throwaway --user-data-dir and a conversation whose session ID Cursor does not hold.

Result (24 Oct 2026, run 20261024-020000-dsp121, base 96a6c37, accepted candidate 002 sha256:6149993735e49a22f87b1fbd75ed3d6f51627d6419fb75d75e49e1698dee2afc): Implementer calls 1, 2, 5; Verifier calls 3 and 6 (PASS); Reviewer calls 4 (REWORK: B1 context statement over-claimed what the refused resume call carried; S1 once-only recap assertion; S2 unavailable wording) and 7 (ACCEPT). Offline only: fake adapter and the presentation adapter on a fresh kit; no provider contacted; Niclas's real user data untouched. Checks on candidate 002: typecheck; chat 334/334; presentation 275/275 and fast 1147/1147 (candidate 001, unaffected by the delta); switch scenario both phases exit 0 (candidate 001). What the window cannot show with the presentation adapter: the refusal state and the choice panel (the presentation adapter resumes everything); verified by the pure view-module tests, recovery tests and the typecheck only. Manual check for Niclas (Reviewer report 004 item 8 + 007): in a throwaway --user-data-dir, make a Cursor conversation whose session Cursor no longer holds (edit session.dspatchSessionId to a fresh dsp-session-<uuid>), then look at the choice panel above the composer, the drawer, the '(on record, not open)' fact, the file's session block unchanged on disk, send refused with 'Show the choices' and text kept, Keep reading, Try again (a new Cursor runtime per attempt; a running command is stopped), new session with Remove the recap, the double panel when an unresolved attempt coexists, Cancel with no run, and the 'What DSpatch sent' statement in the refusal state. Optional notes left open: S3 refuse retry-resume while a session is open; S6 resumeError doc comment; S4 the env-unaligned 'unknown' row needs a distinct provider code from DSP-122 (recorded on DSP-122). Not Done: awaits Niclas's manual acceptance.

Focus (run 20261024-050000-dsp121-ui, base 3f847a0): a deterministic presentation scenario for the refused and failed resume states through the real choice panel, plus a double-click start file for Niclas's visual check. Simulated provider answers only; no provider contacted.

Result (24 Oct 2026, run 20261024-050000-dsp121-ui, base 3f847a0, accepted candidate 002 sha256:441cfbe32f3c24a96b961c6fa64b0d5ba641bf864eb96eb16f657b8c7ae0c660): a deterministic presentation scenario for the refused and failed resume states - DSPATCH_CHAT_RUN=resume-choice with DSPATCH_CHAT_RESUME=refused|failed|refused-once (the presentation adapter's SIMULATED answers; no provider asked), hold mode DSPATCH_CHAT_HOLD=1 that leaves the window open, the start file app/scripts/start-resume-choice.cmd (reset reseeds), README section, exit codes 87-89, and a visible line in the panel and drawer in these phases ('Presentation mode: this refusal or failure is simulated ...'). Implementer calls 1 and 4; Verifier calls 2 and 5 (PASS: three phases exit 0 on fresh kits with 12/9/8 main-process checks, negative control exit 37, switch regression exit 0, presentation 283, fast 1170, chat 339, real userData untouched); Reviewer calls 3 and 6 (ACCEPT). The scenario drives the real panel through the real buttons and IPC into an unchanged chat-service; the stored session is read from disk before and after; nothing is sent until a choice and a send. Simulated behaviour only: it shows the window's behaviour, not any provider's resumption. Follow-ups: drop /I in the start file's mode check so it matches presentationResumeMode exactly; the double panel with an unresolved attempt and Cancel with no run are not scripted. Niclas's visual acceptance pending (hold window launched for him).
<!-- SECTION:NOTES:END -->
