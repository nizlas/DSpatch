---
id: DSP-132
title: 'Ask about code in review through Claude, text-only'
status: To Do
assignee: []
created_date: '2026-10-26 13:04'
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
