---
id: DSP-110
title: >-
  Find out what the VS Code Agent Host offers an AHP client on the work
  computer, without prompts
status: To Do
assignee: []
created_date: '2026-10-21 15:08'
labels:
  - integration
dependencies: []
priority: medium
type: spike
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evaluate AHP early and independently of PROP-A (DSP-109), as a bounded investigation, not a migration commitment or a complete remote development solution (Niclas, Q3, 21 Oct 2026). Per Niclas's Q3/Q4 answers the investigation targets the concrete Copilot / VS Code Agent Host path on his work computer, in the approved VS Code/Copilot environment and a separate repository clone, directly or remotely. Running Claude inside VS Code is not required. Plan baseline: run 20261021-133119-plan-rt, report 003 (Reviewer ACCEPT, report 004), amended.

Start the VS Code Agent Host (`code agent host`, localhost with its connection token, per VS Code documentation), connect the official TypeScript client (@microsoft/agent-host-protocol) from a standalone script outside the app, and record what the host offers and where execution and controls would sit. Provider documentation says the Agent Host speaks AHP JSON-RPC over WebSocket and that Claude and Codex harnesses are disabled when Copilot enterprise-managed settings apply; none of it is observed yet.

Constraints: respect the work environment's security and content-exclusion policies; do not disable or bypass mandatory hooks or managed settings; no Claude or Anthropic credentials on the work computer; no work repository content is sent anywhere by this probe. Exclusions: sending prompts; any AgentAdapter implementation; DSpatch UI; migration; policy or content-exclusion implementation; Cursor-over-ACP; setting up remote access.

Dependencies: none on DSP-109. Needs the approved work VS Code/Copilot environment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A record states the machine role (work computer, separate clone), VS Code and Agent Host versions, protocol and client versions, the start command, the address and transport the host listened on, and whether the client connected
- [ ] #2 The record lists the harnesses the host exposed to this client and each one's authentication state, or the exact error; 'Copilot harness not usable from an external client' and 'no usable harness in this environment' are valid recorded outcomes; a Claude harness, if listed, is recorded but not authenticated
- [ ] #3 The record states what was observed about where managed settings and hooks apply on this path (in the host process or only in a client), or that it could not be observed, with reference to the content-exclusion contract's 'Enforcement follows execution'
- [ ] #4 No prompt was sent, no billed call was made, no mandatory control was disabled and no Claude or Anthropic credential was used on the work computer; the record says so
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow-up proposal, not a card yet (PROP-B1, adjusted 21 Oct 2026): if this probe finds a usable Copilot harness, repeat DSP-109's code-change fixture through the Agent Host on the work computer with a freshly generated synthetic fixture (no work material), from a standalone script calling generateExperimentRepo, under the environment's mandatory controls; test client disconnect/reconnect, cancel and host-loss reporting; record per combination the same verdict fields as DSP-109 #4 plus host and protocol versions; end in a short recommendation (direct only, AHP for Copilot only, or a broader AHP direction), comparing against DSP-109's baseline only where the provider difference allows. Claude over AHP is not required. Depends on this card and DSP-109's result. Create it after this probe reports.
<!-- SECTION:NOTES:END -->
