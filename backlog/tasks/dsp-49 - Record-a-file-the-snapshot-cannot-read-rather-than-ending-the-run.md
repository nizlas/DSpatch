---
id: DSP-49
title: 'Record a file the snapshot cannot read, rather than ending the run'
status: To Do
assignee: []
created_date: '2026-09-18 16:13'
labels: []
dependencies:
  - DSP-44
priority: medium
type: bug
ordinal: 15595
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A file locked by another process makes snapshotTree throw, and the executor calls it outside its own try/catch, so an ordinary Windows state ends the run as a broken machine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run whose project contains a file DSpatch cannot read reports which files it could not read, and does not stop as though DSpatch had broken.
<!-- AC:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Unaffected in substance and now more important. DSpatch's own before-and-after snapshot survives the correction as **corroboration** — the strongest evidence the record holds, and the only kind that is not the provider's account of itself. A locked file must therefore be recorded as unreadable rather than ending the run.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
