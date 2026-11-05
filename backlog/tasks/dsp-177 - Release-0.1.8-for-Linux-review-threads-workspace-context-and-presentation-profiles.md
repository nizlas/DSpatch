---
id: DSP-177
title: >-
  Release 0.1.8 for Linux: review threads and recommendations, Ask and following
  answers, the workspace as read context, and presentation profiles (DSP-175,
  DSP-176)
status: In Progress
assignee: []
created_date: '2026-11-06 01:00'
updated_date: '2026-11-06 01:00'
labels:
  - release
dependencies:
  - DSP-175
  - DSP-176
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 6 November 2026: push main and publish a Linux release, 0.1.8, with DSP-175 (and its completion round) and DSP-176, following the release process in docs/INSTALL.md: version commit and notes, a local package from the clean commit, the packaged trials (profile, thread and dock trials with `DSPATCH_TRIAL_CLIENT`), the container upgrade trial from 0.1.7, `linux-verify`, then the tag, the package workflow's publication, checks of the published files and `release.mjs --published`. No Windows release. DSP-175 and DSP-176 stay in Review for Niclas's acceptance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 main pushed with DSP-175 and DSP-176; version 0.1.8 committed with user-facing notes that state the known limits
- [ ] #2 The .deb, host package, manifest and SHA256SUMS name one release commit; the packaged trials, the upgrade from 0.1.7 and the release checks pass, with limits stated
- [ ] #3 v0.1.8 published; published files checked against SHA256SUMS and the manifest; the installed smoke test run against the published release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
6 November 2026: main = origin/main at ab07ca4 (DSP-176; DSP-175's completion 6a75dfe before it); no upstream commits to integrate. Current focus: the version commit and notes.
<!-- SECTION:NOTES:END -->
