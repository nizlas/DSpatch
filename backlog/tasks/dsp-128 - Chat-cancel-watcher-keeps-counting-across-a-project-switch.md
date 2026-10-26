---
id: DSP-128
title: Chat cancel watcher keeps counting across a project switch
status: To Do
assignee: []
created_date: '2026-10-26 01:45'
labels: []
dependencies: []
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the Verifier in run 20261026-130000-review-discussion (DSP-127, report 004 finding 1; chat code not changed by DSP-127). In the review-discussion scenario the main chat's post-cancel observation reported verdict provider-kept-working with workspaceFileCountAtCancel 3 -> AfterWatch 4 over a 16 s watch: the watch spanned the scenario's switch from project P1 (3 files) to P2 (4 files), so it compared two different workspaces. In real use a cancel followed by a project switch could produce a misleading 'provider kept working' reading. Investigate whether the watcher should stop, or be marked not comparable, when the project changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A cancel watch that spans a project switch does not compare file counts across workspaces; its reading says it was cut short or not comparable
- [ ] #2 A regression test covers a cancel followed by a project switch
<!-- AC:END -->
