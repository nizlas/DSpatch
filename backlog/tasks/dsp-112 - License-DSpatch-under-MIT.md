---
id: DSP-112
title: License DSpatch under MIT
status: Done
assignee: []
created_date: '2026-10-22'
updated_date: '2026-10-22'
labels:
  - maintenance
dependencies: []
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas authorized adding an MIT license and publishing one commit on main. Add the standard license with copyright 2026 Niclas Danielsson, align application package metadata, and link the license from the README. Third-party licenses and provider terms remain separate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root LICENSE contains the standard MIT license and copyright notice.
- [x] #2 Application manifest and lockfile root metadata both declare MIT; dependencies are unchanged.
- [x] #3 README links to LICENSE and clarifies third-party terms.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (22 Oct 2026): prepare the licensing-only change from main at 16a8caffbb7b22c7027d8ae108b7e308d27a976a in an isolated snapshot, then publish one fast-forward commit through GitHub. The home computer's uncommitted DSP-109 notes and unrelated untracked files are not accessed or modified. Backlog CLI is unavailable in this API-based snapshot; task Markdown is maintained directly.

Completed: root LICENSE added, README linked, and only the license field changed in app/package.json and the root package entry of app/package-lock.json. JSON parsing and structural comparison confirmed no other manifest or lockfile changes; private remains true. Standard MIT text and the README link were checked. No runtime code changed, so no build or runtime tests were needed. DSP-109 and its probe status are unchanged.
<!-- SECTION:NOTES:END -->
