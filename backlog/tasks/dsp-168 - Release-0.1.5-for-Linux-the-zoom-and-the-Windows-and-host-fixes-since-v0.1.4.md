---
id: DSP-168
title: >-
  Release 0.1.6 for Linux: the zoom and the Windows and host fixes since v0.1.4,
  after an unpublished v0.1.5 tag
status: In Progress
assignee: []
created_date: '2026-11-04 06:33'
updated_date: '2026-11-04 08:29'
labels:
  - release
dependencies: []
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new Linux release from the completed changes since v0.1.4: each window's own zoom (DSP-167) and the Windows, host and chat fixes (DSP-164, DSP-165, DSP-165.1). The Google integration (DSP-166) stays parked. Verify the changed Linux paths on Linux before publishing: the POSIX process identity in the remote steps and Replace refusing an unconfirmed process; a local start past its bound stopping its own late host; zoom in real Linux windows. Build from the clean tagged commit, publish the Debian amd64 package, the Linux host package, manifest and checksums, try the published package in a clean container and an upgrade from v0.1.4 that keeps conversations, settings and a person's own loops. No Windows installer. Niclas's UX acceptance of DSP-167 is not part of this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The POSIX host identity and Replace refusal, the late-host stop and the window zoom are run on Linux, with the evidence named
- [ ] #2 The release v0.1.5 is published on GitHub from the tagged commit with the .deb, the Linux host package, the manifest and SHA256SUMS
- [ ] #3 The published .deb installs and starts in a clean Linux container, and an upgrade from v0.1.4 keeps conversations, settings and the person's own loops
- [ ] #4 Release notes state the user-visible changes and the verification limits honestly
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Linux CI workflow: test groups on Linux and a zoom trial in real Xvfb windows. 2. Fix release blockers found. 3. Bump to 0.1.5, release notes, tag, publish through the package workflow. 4. Published-package and upgrade trials on CI. 5. Backlog and docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (4 November 2026): a Linux CI workflow for the three Linux verifications, run on the release candidate before tagging. Found so far: scripts/trial-package/standalone.mjs pinned the version to 0.1.4 and would have failed the package workflow for any later tag; pin removed.

Linux verification (4 November 2026): the linux-verify workflow, run 41792402401 at a4c2bbd20f4b on the linux-verify branch: fast 1488 pass (6 skipped), host 138 (3 skipped), review 199, chat 362 (7 skipped), presentation 288, provider 170; the host group holds the POSIX identity through /proc, Replace's refusal of an unconfirmed process, the late-host stop and the concurrent slow starts, run by a real sh. The zoom trial: 55 checks in real Xvfb windows (see DSP-167). Found and fixed on the way: on POSIX a start whose own host was still on its way returned when another starter won, leaving that host to take the folder later (local-host.ts, the Windows-only wait made general); a conversation path through a file read as an unreadable file on POSIX (ENOTDIR) where Windows reads it as no file; the executable resolver used this machine's path rules for the platform it was told about; and six tests assumed Windows (drive-letter fixtures, the live file's line ending, a late-result fixture that is a Windows case by the product's own rule in stopWorkspaceTest). The standalone trial pinned the version to 0.1.4. The review tests need a full clone (fetch-depth 0).

The tagged v0.1.5 build (871eccd) was not published: the package workflow's installed trial failed in 'remote attach during work', and its evidence (kept on failure from here on, with the time on each client line) showed renderer-ready 5 s after did-finish-load locally and 36 s for the remote client, each at the moment a screenshot was taken. The window is shown when its page reports ready from its first animation frame; on Linux a zoom set before that frame (by the main process at adoption, or by the preload for normal size) left the hidden renderer drawing nothing. Fixed in a5d1a9d: a page seen for the first time is not touched, its preload sets only a level other than normal size; the zoom trial now checks that the first window and the restarted window at level 2 are shown on their own (1 ms), 57 checks, run 41798827206; the installed trial passed on the same code by hand, 40 checks with v0.1.4's timings, run 41798830717. The v0.1.5 tag stays, unpublished, as v0.1.2 did; the release is 0.1.6. In run 41798827206 the provider group's 'a stop during the job ends as cancelled, on the runtime's word' failed once with the job failed 43 ms after its start, before the stop; the same code passed that test in five runs before.
<!-- SECTION:NOTES:END -->
