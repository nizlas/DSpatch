---
id: DSP-164
title: >-
  Verify DSpatch on Windows from the repository and fix the review's correctness
  findings
status: Review
assignee: []
created_date: '2026-11-03 18:29'
updated_date: '2026-11-03 19:33'
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
- [x] #1 A development host running as electron.exe has its data-folder claim honoured through a verified process identity, not a wider name list; concurrent starts never give two owners
- [x] #2 The fast test group separates product defects from Linux assumptions: shared tests are portable and platform-specific ones are bounded, with no relevant Windows check skipped to get green
- [x] #3 A DSpatch tool whose Copilot pre-tool hook failed is not executed; allowed calls still run (createWorkspace, addFolders, openWhenTurnEnds covered)
- [x] #4 A stale host-running.json with a reused PID is not taken for a live host, and Replace never signals a process whose identity is not verified
- [x] #5 A snapshot that is incomplete, unreadable or late is never presented as a complete observation or attributed to a command's moment, and never yields a false verified outcome
- [x] #6 Windows packaging statements in INSTALL.md and release notes match what is built; nothing is built or published
- [x] #7 Verified on Windows from the repository: dev start, standalone host start and reuse, close and reopen during work, a real Copilot turn, follow-up and Stop, a small loop in a disposable project and a basic review; what could not be run is reported
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (3 November 2026): step 1, the Windows host claim of a development host running as electron.exe, and the fast group's Linux assumptions. Order after that: Copilot pre-hook refusal before execution, remote host identity, snapshot correctness, Windows packaging statements, then verification on Windows with a real Copilot.

Result (3 November 2026, Windows 11, run from the repository; commits 77e5c68, a03e711, 8a81c37, 4d93435, 174da85, 3556ce0, 4a372d3; nothing pushed, built or published).

Fixed:
- Windows host claim (77e5c68): a claim on Windows carried no identity and held only for a process called node or dspatch, so a development host running as electron.exe never held its claim and every launch could start another host over the same data. A host now holds a named pipe for its life and records it as its identity. Concurrent starters could also crash on Windows (EPERM for a lock entry being deleted).
- A starter that lost the race for the local host reported "Host exited with code 3" (4a372d3); it now waits for the winner.
- Copilot (a03e711): DSpatch's own tools ran after their pre hook failed; they are now refused before execute. Whether a refused call ends the turn is unchanged and open (see decisions below).
- Remote (8a81c37): host-running.json records the host's identity; the probe, start and desktop-claim checks accept only the process it names, and Stop answers failed=unverified without signalling a process it cannot confirm.
- Snapshots (4d93435): unreadable folders and files, missing roots and files changed while read make a look incomplete; incomplete looks give no file lists; a look finished after Claude's hold is attributed to no command moment; the Copilot/Cursor moment is described as when DSpatch hears of the command; the synchronous fingerprint is bounded.
- Docs (174da85): v0.1.2 was never published; tag builds publish no Windows host package since v0.1.4; Windows runs from the repository; npm 11 leaves Electron undownloaded after npm ci.
- Tests that assumed Linux were made portable or bounded with a stated reason (77e5c68, a03e711, 3556ce0).

Verified on Windows:
- Tests: typecheck; fast 1455 pass, 2 skipped; loop 644; live 120; provider 169 (1 skipped); host group 7 of 8 local-host tests, 1 bounded to Linux; Copilot hook, required-hook, review-question and review-job tests against the real Copilot runtime 1.0.28 with a stand-in model; Windows remote steps through real PowerShell.
- Real windows, isolated profile, `npm run dev -- --user-data-dir=...`: the standalone host started as electron.exe with a pipe identity; a real Copilot turn and a follow-up that remembered it; Stop during a running command (the command ended as stopped, no process left); the client closed during a 45 s command and reopened: the same host process, the turn finished while closed, sent once, history intact; six concurrent starts eight times gave one host and one owner; the chat loop over a disposable project with a failing test: work fixed it, check ran npm test, "Assignment met", one file changed; a review of the two commits showed the diff and could be marked reviewed.

Not verified: the POSIX host steps' identity match (needs a Linux /proc; syntax-checked and helpers run in Git's sh only); the POSIX suites' new cases; Claude on Windows; the larger development loop; a real SSH connection to or from Windows; UX acceptance.

Observed and not fixed (recorded for later): reopening a project whose last chat sent nothing shows "Could not resume the agent session" because Copilot keeps no session without a message; a stopped turn reads "stopped · provider work unknown" live and "Nothing was received for this turn before DSpatch stopped listening" after reopening; `npm run dev` does not refresh the build identity, so a development host reports an old commit.
<!-- SECTION:NOTES:END -->
