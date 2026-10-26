---
id: DSP-132
title: 'Ask about code in review through Claude, text-only'
status: Review
assignee: []
created_date: '2026-10-26 13:04'
updated_date: '2026-10-26 22:54'
labels: []
dependencies:
  - DSP-117
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Proposal P-1 (run 20261026-200000-linux-claude). The review discussion runs on Cursor with toolPolicy text-only (tools: []) in an empty DSpatch-owned folder; Claude is not offered there because its text-only limits are not verified. Hypothesis: a Claude policy of tools: [], allowedTools: [], dontAsk, settingSources: [], strictMcpConfig: true yields an init tools list and mcp_servers list that are empty. DSP-109 saw claude.ai connectors appear without strictMcpConfig. Probe: one live turn with Niclas's authorization at home, reading init tools and mcp_servers. Decision after the probe: enable Claude in the review discussion or keep it blocked. Never on the work computer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A live probe at home (Niclas's authorization) records the init tools and mcp_servers for the proposed Claude text-only policy
- [ ] #2 Claude is offered in the review discussion only if the probe shows no tools; otherwise it stays blocked with its stated reason
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Niclas, 26 Oct 2026: widened - the review discussion's provider becomes explicit and visible through the shared provider handling: default from the project's choice for a new discussion, a choice when review is opened standalone, its own conversation and provider-session identity, the chosen provider kept on reopen, never resumed through another provider, no automatic fallback, no session or send on opening review or navigating, existing Cursor discussions readable, switching to Claude explicit with history kept and the carried context clear. Claude for the review discussion with technically enforced limits (no code change, no Bash, no development loops) through SDK/tool controls, not prompt text alone; the main chat's edit permissions not enabled in review; a bounded adapter change if needed. Verified offline with a mocked SDK; Cursor never contacted. The live probe of init tools/mcp_servers stays for the home trial.
I-2b (run 20261026-230000-host-review, call 7): the review discussion's provider is explicit (default from the main window for a new discussion, a choice when standalone, kept on reopen, no fallback, switch with a disclosed recap; record format 2). Claude in review runs under REVIEW_PERMISSIONS: tools [], allowedTools [], disallowedTools [Bash, PowerShell, Edit, Write, NotebookEdit, Agent, WebFetch, WebSearch, Skill, mcp__*] (names checked against BUILTIN_TOOL_NAMES in sdk.d.ts 0.3.306), dontAsk, settingSources [], strictMcpConfig, and a deny-every-tool PreToolUse hook without continue:false. Configured and offline-verified with a substituted SDK only, not observed live; the init tools/mcp_servers probe (AC#1) stays for the home trial.

Result (run 20261026-230000-host-review; I-2b calls 7 and 10; Verifier 008 PASS; Reviewer 009 ACCEPT): the review discussion has its own explicit agent (default from the main window's session or chosen agent for a new discussion only; standalone/example/direct require a choice; stored provider wins on reopen; unusable kept with its reason; never resumed; switching disposes the session and discloses a removable recap; each question records provider, session id and tool policy; format 2, a v1 file read as is and not rewritten on read). Claude in review uses REVIEW_PERMISSIONS - tools [], allowedTools [], disallowedTools [Bash, PowerShell, Edit, Write, NotebookEdit, Agent, WebFetch, WebSearch, Skill, mcp__*], dontAsk, no settings, strictMcpConfig, and a PreToolUse hook denying every tool without ending the turn; the review path refuses any adapter without exactly that policy; CHAT_PERMISSIONS digest unchanged. OFFLINE-VERIFIED ONLY (mocked SDK, presentation adapters); AC#1 live probe at home still needed (whether tools [] / disallowedTools / mcp__* hold and the SDK merges the hooks' decisions into deny).

AC#2 note (coordinator, 26 Oct 2026): Niclas's instruction of 26 Oct makes Claude usable in the review discussion now, with technically enforced limits (REVIEW_PERMISSIONS + deny-all hook), ahead of the live probe; the probe (AC#1) confirms this or revokes it - if the init tools or mcp_servers are not empty, Claude is blocked in review again with the stated reason.
<!-- SECTION:NOTES:END -->
