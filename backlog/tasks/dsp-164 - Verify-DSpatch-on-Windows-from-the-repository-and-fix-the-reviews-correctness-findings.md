---
id: DSP-164
title: >-
  Verify DSpatch on Windows from the repository and fix the review's correctness
  findings
status: In Progress
assignee: []
created_date: '2026-11-03 18:29'
updated_date: '2026-11-03 18:29'
labels:
  - windows
  - review
  - reliability
dependencies: []
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 3 November 2026: after the review of d0b23ad..cfb34b0, get DSpatch verified on Windows when run from the repository (no installer, no release), then fix the concrete correctness defects before the cosmetic pass. Linux releases are for colleagues; Windows is run from the repository while debugging.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A development host running as electron.exe has its data-folder claim honoured through a verified process identity, not a wider name list; concurrent starts never give two owners
- [ ] #2 The fast test group separates product defects from Linux assumptions: shared tests are portable and platform-specific ones are bounded, with no relevant Windows check skipped to get green
- [ ] #3 A DSpatch tool whose Copilot pre-tool hook failed is not executed; allowed calls still run (createWorkspace, addFolders, openWhenTurnEnds covered)
- [ ] #4 A stale host-running.json with a reused PID is not taken for a live host, and Replace never signals a process whose identity is not verified
- [ ] #5 A snapshot that is incomplete, unreadable or late is never presented as a complete observation or attributed to a command's moment, and never yields a false verified outcome
- [ ] #6 Windows packaging statements in INSTALL.md and release notes match what is built; nothing is built or published
- [ ] #7 Verified on Windows from the repository: dev start, standalone host start and reuse, close and reopen during work, a real Copilot turn, follow-up and Stop, a small loop in a disposable project and a basic review; what could not be run is reported
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (3 November 2026): step 1, the Windows host claim of a development host running as electron.exe, and the fast group's Linux assumptions. Order after that: Copilot pre-hook refusal before execution, remote host identity, snapshot correctness, Windows packaging statements, then verification on Windows with a real Copilot.
<!-- SECTION:NOTES:END -->
