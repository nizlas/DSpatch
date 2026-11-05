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
6 November 2026: main = origin/main at ab07ca4 (DSP-176; DSP-175's completion 6a75dfe before it); no upstream commits to integrate. Version commit f6104c1 pushed. linux-verify at f6104c1 green (run 42123823468): fast 1582 (6 skipped), host 144 (3 skipped), review 257, chat 362 (7 skipped), presentation 311, provider 170, loop 674, live 116 (6 skipped), zoom trial 78, dock trial 54, governor 27.

Local package of f6104c1: dspatch_0.1.8_amd64.deb (sha256 0953b2a9…), dspatch-host-0.1.8-f6104c13597b-linux-x64.tar.gz (b574c894…), host-manifest.json; client, host and manifest name f6104c13597b, build identity clean. With `DSPATCH_TRIAL_CLIENT` at the unpacked client, own Xvfb: profile trial 59/59, thread trial all passed, dock trial 54/54.

Upgrade from 0.1.7 (container, `upgrade.mjs --from v0.1.7 --to` the local .deb): 27/27. The trial now also makes a review with a delegated result and saves zoom levels in 0.1.7 and checks both after the upgrade. **Finding:** 0.1.8 changes the host contract (DSP-175's host methods), so the 0.1.8 client cannot use the 0.1.7 host: it asks before any window, "Another DSpatch host is running here", and *Stop it and continue* ends the older host and starts this one's. That is the existing designed path for an incompatible host; *Restart host* in the window applies to updates with the same contract (0.1.6 → 0.1.7). The trial now handles both ways (answering the question with xdotool; the Dockerfile installs xdotool, and locally it is brought in with UPGRADE_TRIAL_XDOTOOL_ROOT). The release notes say so.

`release.mjs --stage`: 5 checks passed (the .deb against SHA256SUMS, installs, no Node, Connect installs the carried host with github.com unreachable, nothing asked of GitHub), then stopped at its restart of the client with a stand-in github.com, as for 0.1.7; timed out after 25 min; its containers removed. Covered after publication by `release.mjs --published`.
<!-- SECTION:NOTES:END -->
