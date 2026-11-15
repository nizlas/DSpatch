---
id: DSP-213
title: >-
  Release 1.0.1: a Linux and Windows pre-release with the SFTP host transfer and
  the Help guide
status: In Progress
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
- [ ] #1 Version 1.0.1 committed with notes that state the outstanding manual tests; main pushed without force
- [ ] #2 The tag build publishes the .deb, the Windows installer, both host packages, host-manifest.json and SHA256SUMS; the clients' bundled manifest matches the published host packages
- [ ] #3 The published files are checked against SHA256SUMS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- SECTION:NOTES:END -->
