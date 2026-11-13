---
id: DSP-205
title: 'DSpatch 1.0.0: the first public Linux release, with the current functionality'
status: In Progress
assignee: []
created_date: '2026-11-13 08:55'
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
- [ ] #1 app/package.json and its lock file say 1.0.0, and docs/releases/v1.0.0.json publishes Linux only and does not mark a pre-release
- [ ] #2 docs/releases/v1.0.0.md says what DSpatch offers, that the release is for Linux, how to install and upgrade (with Restart host), and the known limitations
- [ ] #3 The v1.0.0 GitHub release is a full release (not a pre-release) with the .deb, the Linux host package, host-manifest.json and SHA256SUMS
- [ ] #4 The published .deb installs in clean containers, and an upgrade from 0.1.25 keeps the person's conversation, review with its delegated result, agent choice, zoom, review preferences and own loop, across Restart host and a restart
- [ ] #5 About DSpatch shows 1.0.0 for the app and for the running host after Restart host and after a restart of the client
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Version 1.0.0 and release notes. 2. The upgrade trial also keeps a review preference set through the previous release and reads About DSpatch (Copy) after Restart host and after a restart. 3. Targeted checks: typecheck, the trial script's syntax, the version-compare test. 4. Commit, push, tag v1.0.0; the package workflow publishes. 5. linux-verify with published=true, previous=v0.1.25. 6. Record results.
<!-- SECTION:PLAN:END -->
