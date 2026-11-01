---
id: DSP-161
title: One work context for local and remote use of a machine
status: Review
assignee: []
created_date: '2026-11-01'
labels: [remote]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A person who has worked in DSpatch on a computer can connect to it over SSH from another one and continue with the same projects, conversations, reviews, decisions and loop information, and later return to local use. One data folder per user, one host writing to it at a time, a predictable handover, reopening saved context kept apart from attaching to running work, and no job sent or started twice. Older separate data folders are adopted after a backup, without overwriting or arbitrarily choosing between conflicting records.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (Niclas's assignment of 1 November 2026, which asked for the storage to be examined and a solution chosen): one data folder per user of a machine, the application's own (`userData`). Before this the desktop used `~/.config/DSpatch` and a host over SSH `~/.local/share/dspatch-host` (Windows `%APPDATA%\\DSpatch` and `%LOCALAPPDATA%\\dspatch-host`), so a machine reached over SSH started from an empty environment.

Implemented in `app/src/main/host-data.ts`, `host-process.ts`, `remote-host.ts`, `shared/host-bootstrap.ts`, `main.ts`, `ssh-connection.ts`, `HostLink.tsx`. A host claims the folder atomically before reading it. The claim names its kind. An open application hands over only with nothing running, and says where the work went; a host left running is attached to, from the application on that machine too, over loopback and without SSH. Another client replaces the last, which is told. The local host still ends with its client: only a host started over SSH outlives one. An older folder is adopted after one backup of both sides; a differing record stays on both sides, a conversation under its own id, and the person is told. A failed adoption does not stop a start and is retried.

Opening the project a turn runs in used to start a new session, which ended that turn with an unknown outcome. That was the worst finding of the packaged trial: now a client that attaches gets the open session and follows the turn, with nothing sent; a different project or a new chat is refused until the work is done. An independent review reported five blockers, all fixed before release: a failed adoption stopping every start, an isolated run using up the real adoption, a clock step making a live claim look dead, a non-atomic claim, and an unbounded adoption against a bounded start. A replaced client could also not return to local work, an older defect the trial found.

Verified with `app/scripts/trial-package/continuity.mjs`: installed packages, two containers, real sshd, real windows, SIMULATED provider, a real earlier host for the adoption. Windows: scripts parsed by PowerShell, paths unit-tested, nothing run. Remaining known limit: between the second busy check and the host closing, a turn could still begin in a window left open during a handover (a window of milliseconds). On Windows a replaced host is ended rather than closed in order. A saved loop choice that is a path exists on one machine only. Two real computers are untried and await Niclas.
<!-- SECTION:NOTES:END -->
