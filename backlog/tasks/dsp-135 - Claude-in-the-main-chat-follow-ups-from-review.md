---
id: DSP-135
title: 'Claude in the main chat: follow-ups from review'
status: To Do
assignee: []
created_date: '2026-10-26 13:04'
labels: []
dependencies:
  - DSP-117
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Collected from run 20261026-200000-linux-claude (Reviewer 008/012, Verifier 007/010). S-a: when Claude is chosen at open and the conversation was recorded with Cursor, the Cursor resume is disclosed only in the panel note - announce it, or prefer no call plus Start new Claude session (Niclas to decide). S-b: the open panel's Cursor gate follows the panel's choice, so on a machine without Cursor a Claude-recorded project opens only after choosing Claude in the panel. S-c: production startup still constructs a Cursor adapter for environment info (adapterId/capabilities; no call) and 'How this is wired' names that startup adapter. S-d: the reason for 'Claude (off)' is only in a tooltip and Session details. Completed or failed Claude turns record the process exit as unknown; an adapter-reported exit would make normal turns precise. Presentation adapters reuse session IDs across a provider switch (SIMULATED only). Layout: .composer overflow may clip edge focus rings at small heights; Send can scroll out of view; 14 px headroom at the narrow check. Q5: show the observed apiKeySource and account per Claude turn in Session details, blocking later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each item decided with Niclas or fixed, with a test where behaviour changes
<!-- AC:END -->
