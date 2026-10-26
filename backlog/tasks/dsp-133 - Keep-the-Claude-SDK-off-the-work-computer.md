---
id: DSP-133
title: Keep the Claude SDK off the work computer
status: To Do
assignee: []
created_date: '2026-10-26 13:04'
labels: []
dependencies: []
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Proposal P-4 (run 20261026-200000-linux-claude), before step 3 of Niclas's 26 Oct order (Copilot SDK at work). Claude must not run on the work computer, neither as a development agent nor as a provider in DSpatch. Today @anthropic-ai/claude-agent-sdk is an ordinary dependency, so npm ci on the work computer downloads Claude Code's binary even though DSpatch never starts it there (DSPATCH_CLAUDE_AUTHORIZATION is absent by default). Open question Q4 for Niclas: is installing that binary without running it allowed? If not, make the Claude SDK an optional dependency or install profile that the work setup omits, with the Claude path refusing plainly when the SDK is absent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Niclas's answer to Q4 recorded
- [ ] #2 If installation is not allowed, a documented work install contains no Claude SDK or Claude Code binary and DSpatch states plainly that Claude is unavailable
<!-- AC:END -->
