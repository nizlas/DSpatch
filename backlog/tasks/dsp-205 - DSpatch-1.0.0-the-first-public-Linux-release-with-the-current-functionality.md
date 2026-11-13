---
id: DSP-205
title: 'DSpatch 1.0.0: the first public Linux release, with the current functionality'
status: Done
assignee: []
created_date: '2026-11-13 08:55'
updated_date: '2026-11-13 09:12'
labels:
  - release
dependencies: []
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas approved the app icon (DSP-204) and asked for DSpatch 1.0.0 as an ordinary public Linux release, not a pre-release, with the functionality DSpatch has now (13 November 2026). The version becomes 1.0.0; the release notes say briefly what DSpatch offers, that the release is for Linux, how to install and upgrade, including Restart host, and which known limitations remain. The .deb, the Linux host package, the manifest and SHA256SUMS are built and published from one tagged commit. No functional change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 app/package.json and its lock file say 1.0.0, and docs/releases/v1.0.0.json publishes Linux only and does not mark a pre-release
- [x] #2 docs/releases/v1.0.0.md says what DSpatch offers, that the release is for Linux, how to install and upgrade (with Restart host), and the known limitations
- [x] #3 The v1.0.0 GitHub release is a full release (not a pre-release) with the .deb, the Linux host package, host-manifest.json and SHA256SUMS
- [x] #4 The published .deb installs in clean containers, and an upgrade from 0.1.25 keeps the person's conversation, review with its delegated result, agent choice, zoom, review preferences and own loop, across Restart host and a restart
- [x] #5 About DSpatch shows 1.0.0 for the app and for the running host after Restart host and after a restart of the client
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Version 1.0.0 and release notes. 2. The upgrade trial also keeps a review preference set through the previous release and reads About DSpatch (Copy) after Restart host and after a restart. 3. Targeted checks: typecheck, the trial script's syntax, the version-compare test. 4. Commit, push, tag v1.0.0; the package workflow publishes. 5. linux-verify with published=true, previous=v0.1.25. 6. Record results.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Released 13 November 2026: https://github.com/nizlas/DSpatch/releases/tag/v1.0.0, a full release marked Latest (not a pre-release). Tag v1.0.0 on 80f2053; host 1.0.0-80f2053a4e26; package run 43397430674 (hosts-and-deb, publish-release green; Windows jobs skipped by docs/releases/v1.0.0.json). Assets: dspatch_1.0.0_amd64.deb, dspatch-host-1.0.0-80f2053a4e26-linux-x64.tar.gz, host-manifest.json, SHA256SUMS.

Before tagging: npm run typecheck passed; tests/about.test.ts and tests/remote-transport.test.ts 20/20 on Windows. scripts/prepare-bundled.test.mjs gave 16/18 on Windows: the Linux-only bundle case and the symlink case are Windows-specific (a win32 client, and EPERM on symlinks), unrelated to the version; the package workflow runs that test on Linux and it passed there.

The upgrade trial (scripts/trial-package/upgrade.mjs) gained: review preferences (both walk column widths) saved through 0.1.25's own review window and checked after the upgrade in the window and on disk, and after a restart; and Help > About DSpatch opened over the start window, Copy version information pressed through the X server, and the copied text checked after Restart host and after a restart of the client.

Published trial, linux-verify run 43398219082 (published=true, previous=v0.1.25): clean containers 14/14 (downloads, SHA256SUMS, install without Node or npm, Remote Session installs the carried host with github.com unreachable, host runs 1.0.0-80f2053a4e26, a simulated Copilot turn). Upgrade from 0.1.25 41/41: Restart host offered and replaced the 0.1.25 host; conversation, the review with its delegated result (awaiting the person's assessment before and after), agent choice, zoom, review preferences and the own loop kept, after Restart host and after a restart; About DSpatch read 'DSpatch 1.0.0 (80f2053a4e26) / Running host: 1.0.0 (80f2053a4e26)' both times. Agent turns are from a SIMULATED provider; no model account was reached.

Not established: distributions other than Ubuntu and Debian, arm64, Wayland, GNOME's and KDE's own docks, Windows packages, and the quality of a real model's review.
<!-- SECTION:NOTES:END -->
