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
Release candidate 0.1.4 (2 November 2026): ready for Niclas's demonstration assessment. Full registered host group passes 108 tests across nine files with no skips; all three typecheck groups and application build pass. Eighteen bundle integrity tests pass. GitHub's Linux build runs those bundle tests and the installed Electron/SSH standalone trial before uploading artifacts or publishing. The installed candidate trial has 40 passing checks; release-tag CI must independently pass on the clean commit. No known departure from the approved unified-host design remains; Windows execution and real-provider/demo acceptance are outstanding. Scratch and evidence artifacts stay ignored; only implementation, tests, decision records and release configuration are committed.

Implementation and verification (2 November 2026, unified-host continuation): local startup discovers or boots the standalone host and uses RemoteLink over authenticated loopback; utility-process lifetime is limited to isolated harnesses. The Linux bundle contains validated host archives and refuses missing/corrupt build metadata. Loose-chat reattachment returns the active session rather than replacing it. Local recovery rediscovers changed ports with unknown-outcome/no-replay semantics. Acquisition is serialized with identity-owned directories to prevent a delayed stale cleaner admitting a second writer. Independent static review reported no remaining blocking issue in that ownership slice; broader review led to the endpoint-recovery repair.

Executable evidence: lifecycle, transport, ownership and client-boundary selection passed; 18 bundle-integrity tests passed; the application build passed. Installed candidate trial `app/release/trial-standalone/2841189-1793658738493/results.json` reports 40 passes, zero failures, real Electron windows and real SSH with simulated providers. The same host survived local close/reopen, SSH takeover during work and completion with both clients closed; one attempt and its history persisted. No manually populated host cache; archive SHA matched. Initial trial script had a DevTools port collision, fixed in the trial, not counted as an application pass. Trial containers were removed. The candidate was built before committing; the release must build from a clean tagged commit. No live user profile or model was used. Windows, actual-provider performance and Niclas's UX/demo acceptance remain unverified.

Decision and current focus (2 November 2026): Niclas explicitly approved one standalone host model for local and SSH use and requested a single downloadable Linux release for a demonstration. Local clients discover/start the host and connect over authenticated loopback; remote clients discover/start the same host through SSH tunnelling. Closing a client disconnects and leaves started work on the host. One user data folder and host claim, one attached client, no command replay, provider policies and cancellation boundaries remain. No login-time service is introduced. Bundle the Linux standalone host with the desktop installation so local startup and SSH deployment need no separate package download. Implement, verify isolated lifecycle and packaging paths, review and publish one new Linux release; do not modify live user state for testing. This supersedes the older desktop-host lifetime decision recorded below. CLI fallback: task updated as Markdown.

Decision (Niclas's assignment of 1 November 2026, which asked for the storage to be examined and a solution chosen): one data folder per user of a machine, the application's own (`userData`). Before this the desktop used `~/.config/DSpatch` and a host over SSH `~/.local/share/dspatch-host` (Windows `%APPDATA%\\DSpatch` and `%LOCALAPPDATA%\\dspatch-host`), so a machine reached over SSH started from an empty environment.

Implemented in `app/src/main/host-data.ts`, `host-process.ts`, `remote-host.ts`, `shared/host-bootstrap.ts`, `main.ts`, `ssh-connection.ts`, `HostLink.tsx`. A host claims the folder atomically before reading it. The claim names its kind. An open application hands over only with nothing running, and says where the work went; a host left running is attached to, from the application on that machine too, over loopback and without SSH. Another client replaces the last, which is told. The local host still ends with its client: only a host started over SSH outlives one. An older folder is adopted after one backup of both sides; a differing record stays on both sides, a conversation under its own id, and the person is told. A failed adoption does not stop a start and is retried.

Opening the project a turn runs in used to start a new session, which ended that turn with an unknown outcome. That was the worst finding of the packaged trial: now a client that attaches gets the open session and follows the turn, with nothing sent; a different project or a new chat is refused until the work is done. An independent review reported five blockers, all fixed before release: a failed adoption stopping every start, an isolated run using up the real adoption, a clock step making a live claim look dead, a non-atomic claim, and an unbounded adoption against a bounded start. A replaced client could also not return to local work, an older defect the trial found.

Verified with `app/scripts/trial-package/continuity.mjs`: installed packages, two containers, real sshd, real windows, SIMULATED provider, a real earlier host for the adoption. Windows: scripts parsed by PowerShell, paths unit-tested, nothing run. Remaining known limit: between the second busy check and the host closing, a turn could still begin in a window left open during a handover (a window of milliseconds). On Windows a replaced host is ended rather than closed in order. A saved loop choice that is a path exists on one machine only. Two real computers are untried and await Niclas.
<!-- SECTION:NOTES:END -->
