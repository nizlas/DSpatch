---
id: DSP-165
title: Remaining findings from the review of d0b23ad..cfb34b0
status: To Do
assignee: []
created_date: '2026-11-03 19:33'
updated_date: '2026-11-03 21:18'
labels:
  - review
  - follow-up
dependencies: []
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Findings from the 3 November 2026 review (DSP-164) that were not fixed there, for later passes. Each is a candidate, not a decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Copilot: a turn stopped after a failed hook has a bound; one runtime per session does not pile up; a taskkill failure is not logged as success; setup follows the proxy and npm registry settings; claude auth status has a timeout; the login link is the login URL
- [ ] #2 Remote: a mistyped SSH password is not replayed; the Windows tunnel clears forwards from the user's ssh config; installing over an existing version folder neither nests nor fails; a host still starting is not taken for one started by hand; the askpass handler survives malformed input; the Windows askpass launcher keeps multi-line host-key prompts
- [ ] #3 Loop and review: code-walk provenance names the served model, not 'default'; AgentPicker's default test agrees in both places; 'Not logged in' is routed to the provider that said it; transcript ordering is consistent for unparseable dates and between client and host clocks
- [x] #4 Chat: reopening a chat that sent nothing starts a session instead of showing a resume error; a stopped turn reads the same live and after reopening; npm run dev refreshes the build identity
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (3 November 2026, Niclas's request): acceptance criterion #4, the three findings from the Windows verification: a reopened chat that never sent anything, a stopped turn read the same live and after reopening, and a current build identity in npm run dev with a running host's identity kept apart from the new client's. The default loop and the hook-failure policy are not changed here; both remain Niclas's open decisions.

Acceptance criterion #4 done (3 November 2026, commits b6d4a4e and d400557):
- A reopened chat that never sent anything opens as a first session: no resume is asked of the provider and no error is shown. Verified on Windows with real Copilot, isolated profile: a chat opened, nothing sent, the host ended and the window restarted; the host logged "had nothing sent through it; a new session is opened instead of a resume" and the window opened the chat with no resume error.
- A stopped turn keeps how its process ended in the saved message, and the saved badge comes from the live label. Verified on Windows with real Copilot: a command stopped mid-run read "stopped · provider work unknown" live; saved as cancelled/stopped; after closing and reopening the client it read the same, and the old "Nothing was received…" text did not appear.
- npm run dev writes the build identity; a build carries its source digest; a running host keeps the build it started from. Verified on Windows: after a source change and a new client against the still-running host, the host line read "The host runs f0a2e88177eb, build 085c8b79; this window is f0a2e88177eb, build 54950dc1. End the host to run this build."; End host started a host of the new build and the note went.
- Tests: fast 1465, chat 368, host 106, presentation 288, typecheck; all pass.

Observed, not fixed: on Windows the standalone host inherits a listening socket of the client that started it (the client's DevTools port stayed bound after the client ended until the host ended). Only a debugging port was seen held; whether other client handles leak into the host is not established.

Not done here, by Niclas's instruction: the default loop (DSP-160) and whether a failed Copilot pre hook ends the turn remain his open decisions. POSIX host identity (DSP-164) is still not verified on Linux: no Linux environment is reachable from this Windows machine (no WSL, Docker or SSH host).

Decision confirmed by Niclas on 3 November 2026 (no earlier date recorded): both questions this card left open are settled: a failed Copilot pre hook refuses only the identified call (contract section 6), and DSP-160's default loop was intended, with remembered choices kept.
<!-- SECTION:NOTES:END -->
