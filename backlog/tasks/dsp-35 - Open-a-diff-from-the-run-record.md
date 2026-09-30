---
id: DSP-35
title: Open a diff from the run record
status: To Do
assignee: []
created_date: '2026-09-18 07:08'
labels: []
dependencies:
  - DSP-25
priority: medium
type: feature
ordinal: 15950
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A run record already carries snapshot ids and per-file hashes for the files a run changed, added and removed. A reviewer cannot yet open any of it in the window, so the evidence exists and cannot be read. This is the surfacing half of DSP-25 #3.

Call 006 investigated it as a cheap addition and found it is not one. FileDiff renders a unified diff string; the record stores hashes and paths. The missing piece is a main-process read that turns a snapshot id and a path into a unified diff, plus a channel for it.

The interesting half is a decision rather than a wiring job: what to show when the working copy has moved on since the snapshot. A diff against the file as it is now is not the diff the run produced, and showing it as though it were would be the same class of untruth this delivery has spent its time removing. Saying so plainly is probably better than reconstructing history DSpatch does not keep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reviewer can open the change a run made to a named file, from the run record, after a restart.
- [ ] #2 When the working copy has moved on since the snapshot, the window says so rather than presenting a current diff as the one the run produced.
<!-- AC:END -->
