---
id: DSP-213
title: >-
  Release 1.0.1: a Linux and Windows pre-release with the SFTP host transfer and
  the Help guide
status: Review
assignee: []
created_date: '2026-11-15 23:30'
updated_date: '2026-11-15 23:30'
labels:
  - release
dependencies:
  - DSP-211
  - DSP-212
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 15 November 2026: push the evening's finished work and publish a release for Linux and Windows with the SFTP host transfer, the Help guide and the updated documentation, so that a colleague can install the Linux client the next day and connect to a Windows host. Built by the package workflow from one commit: the .deb, the Windows installer, both host packages, the manifest and SHA256SUMS. Published as a pre-release (the project's rule for a test build): the Windows installer's open points (DSP-182) and the remote reconnection are not tried yet. Niclas's running Windows host and client are not touched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Version 1.0.1 committed with notes that state the outstanding manual tests; main pushed without force
- [x] #2 The tag build publishes the .deb, the Windows installer, both host packages, host-manifest.json and SHA256SUMS; the clients' bundled manifest matches the published host packages
- [x] #3 The published files are checked against SHA256SUMS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
15 November 2026. main pushed 7c2e237..06bae7e (no force): 08de9ac (SFTP transfer, Cancel; DSP-211), 7ecc6ce, e6b07c9 (Help guide; DSP-212), 06bae7e (version 1.0.1, notes, docs/releases/v1.0.1.json with prerelease true). Annotated tag v1.0.1 on 06bae7e. Package run 43763872058: plan, hosts-and-deb (with its installed-package standalone trial), windows-installer and publish-release succeeded; windows-install-trial is for manual runs. Published https://github.com/nizlas/DSpatch/releases/tag/v1.0.1 as a pre-release:
- dspatch_1.0.1_amd64.deb 402925636 bytes, sha256 69e570b7897e1a2393ede7e1602c81c6fa779a29bff2109010958079d8f2bcb0
- DSpatch-Setup-1.0.1.exe 411505210 bytes, sha256 e8c4eb20aad4a4e84b93e24fa124161e4c9e1a5b825df7c089b847c561b3bf31
- dspatch-host-1.0.1-06bae7eb2d64-linux-x64.tar.gz (d3ce4628…), -win32-x64.tar.gz (79e981ab…), host-manifest.json (contract e79215b20268b2ba), SHA256SUMS
Checked after publication: all files against SHA256SUMS; the .deb's build identity 06bae7e with no dirty files, its bundled manifest identical to the published one, both host packages bundled. Not checked here: the Windows installer's bundled manifest (no 7z on this machine; the installer job builds from the same host packages). Before the tag: typecheck, ssh-connection 28/28, help-guides 2/2, markdown, build.
<!-- SECTION:NOTES:END --><!-- SECTION:NOTES:END -->
