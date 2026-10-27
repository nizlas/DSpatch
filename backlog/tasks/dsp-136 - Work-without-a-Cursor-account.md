---
id: DSP-136
title: Work without a Cursor account
status: Review
assignee: []
created_date: '2026-10-26 15:33'
updated_date: '2026-10-27 02:33'
labels: []
dependencies: []
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 26 Oct 2026: his Cursor account is closed. No feature may assume a working Cursor connection. The Cursor adapter stays a possible product choice, but hard-coded Cursor dependencies and requirements for a Cursor login are removed: startup, connection checks, open-project gates, model lists, the review discussion's provider and anything else that builds or calls a Cursor adapter without the person having chosen Cursor. Existing Cursor conversations stay readable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Nothing at startup, on opening a project, on opening review or on navigation builds or calls a Cursor adapter unless Cursor is the chosen provider
- [x] #2 Without a usable Cursor login every non-Cursor flow works, and the window states Cursor's unavailability only where Cursor is chosen
- [x] #3 Existing Cursor conversations remain readable; switching them to another provider is explicit, with the carried context disclosed
- [x] #4 Verified offline with the offline guard; Cursor is never contacted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Paused 26 Oct 2026 before implementation; handoff for I-2a written (run 20261026-230000-host-review, handoffs/005-implementer.md): no adapter at startup, no automatic Cursor check, no Cursor gate, fresh state = no provider chosen, explicit Start new <chosen> / Resume with <recorded>.
S6 (run 20261026-230000-host-review, I-2a): `@cursor/sdk` is still imported statically when the main process starts (`chat-service.ts` imports `Cursor` for `Cursor.auth.status()`, and `cursor-sdk-adapter.ts` imports the SDK). Loading the module is not a connection, but the evidence that nothing connects at startup comes only from the guarded test process (offline guard) and the presentation-mode scenario logs, not from an unguarded real launch.

Result (run 20261026-230000-host-review; I-2a calls 5 and 10; Verifier 008 PASS; Reviewer 009 ACCEPT): nothing at startup, on opening a project, on opening review or on navigation builds or calls Cursor unless Cursor is chosen; a fresh install has no agent chosen ('Choose an agent'), only explicit choices are stored (userData/dspatch-agent-choice.json); no automatic Cursor connection check (explicit 'Check Cursor connection'); no Cursor gate; a conversation recorded with another agent opens with its history and asks 'Start new <chosen> session' / 'Resume with <recorded>' - no silent fallback; a stored but unusable choice is named with its reason; loops stated as Cursor-only (P-NEW-1). Offline only; presentation-mode windows; Cursor never contacted. Not verified: a real non-presentation launch. Follow-up: after a refused forced agent choice the panel and stored choice disagree and the refusal appears in the chat failure box (backlog note); @cursor/sdk still imported statically at startup (S6).

27 Oct 2026: P-NEW-1 (loops Cursor-only) resolved by DSP-138 - loop runs use the chosen agent.
<!-- SECTION:NOTES:END -->
