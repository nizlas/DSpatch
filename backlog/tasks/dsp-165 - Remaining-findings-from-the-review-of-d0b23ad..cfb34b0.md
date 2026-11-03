---
id: DSP-165
title: Remaining findings from the review of d0b23ad..cfb34b0
status: To Do
assignee: []
created_date: '2026-11-03 19:33'
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
- [ ] #4 Chat: reopening a chat that sent nothing starts a session instead of showing a resume error; a stopped turn reads the same live and after reopening; npm run dev refreshes the build identity
<!-- AC:END -->
