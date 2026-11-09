---
id: DSP-183
title: 'Release 0.1.11: a Linux-only pre-release from main with the build-identity fix'
status: In Progress
assignee: []
created_date: '2026-11-09 09:00'
updated_date: '2026-11-09 09:00'
labels:
  - release
dependencies:
  - DSP-182
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 9 November 2026: a pre-release from the latest main with a working `.deb` for Linux x64, the matching Linux host package, the manifest and SHA256SUMS, so that he can install DSpatch on his work computer and review code. Follows the release process in docs/INSTALL.md: version commit and notes, a local package from the clean commit, `linux-verify`, the packaged trials and the upgrade trial in a container, the tag, the package workflow's publication, checks of the published files and `release.mjs --published`.

Windows is not part of this release. The Windows uninstaller's Bitdefender problem and the remaining Windows window trials stay open in DSP-182, which is not marked done. Because a tag build also built and published the Windows installer and the Windows host package, the package workflow gets the smallest change that lets one tag publish Linux only: an optional `docs/releases/<tag>.json` (`{"platforms": ["linux"], "prerelease": true}`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Version 0.1.11 committed with user-facing notes that state the known limits; the workflow can publish a tag for Linux only, as a pre-release, without building or publishing Windows artifacts
- [ ] #2 The .deb and the Linux host package carry one build identity from the release commit and no Windows runtime files; linux-verify, the packaged trials and the upgrade trial pass, with limits stated
- [ ] #3 v0.1.11 published as a pre-release with the .deb, the Linux host package, the manifest and SHA256SUMS; the published files checked and the installed smoke test run against the published release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 9 November 2026 on Linux. main fast-forwarded from 32030e3 to origin/main 65180d9 (no local unpushed commits, clean working copy); tags up to v0.1.10 (a pre-release with the Windows installer, built before the build-identity fix e5866b9); v0.1.11 free.
<!-- SECTION:NOTES:END -->
