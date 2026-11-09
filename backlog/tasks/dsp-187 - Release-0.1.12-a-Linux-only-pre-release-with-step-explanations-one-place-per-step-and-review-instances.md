---
id: DSP-187
title: >-
  Release 0.1.12: a Linux-only pre-release with step explanations apart from
  the discussion, one place per step and reviews as instances
status: In Progress
assignee: []
created_date: '2026-11-09 18:00'
updated_date: '2026-11-09 18:00'
labels:
  - release
dependencies:
  - DSP-184
  - DSP-185
  - DSP-186
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 9 November 2026: after DSP-184, DSP-185 and DSP-186 are implemented and verified, publish a Linux pre-release with the x86_64 .deb, the matching Linux host package, the manifest and SHA256SUMS through the existing release flow (the tag's docs/releases/v0.1.12.json keeps it Linux only and a pre-release), verify the packaged and installed client and the build identity, and publish no new untested Windows artifacts. DSP-182 stays open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Version 0.1.12 committed with user-facing notes stating the limits
- [ ] #2 Client and host carry one build identity; packaged trials, upgrade from 0.1.11 and linux-verify pass
- [ ] #3 Published as a Linux-only pre-release; files checked; installed smoke test against the published release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- SECTION:NOTES:END -->
