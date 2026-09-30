---
id: DSP-68
title: Find and choose a loop definition without starting anything
status: Review
assignee: []
created_date: '2026-09-20 09:01'
updated_date: '2026-09-20 10:14'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 15700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There is no unit of 'a loop you can choose' today, only a constant path in main.ts. This introduces a small versioned declaration file giving a stable id, name, short description, the graph's path and how resources are found, plus non-recursive discovery at the standard location .dspatch/loops/*.loop.json beside each open folder, and a manual picker for a declaration anywhere else. Several definitions per folder are supported by there being several files. Discovery reads one directory per folder and never walks a codebase. Finding or opening a definition makes it selectable and starts nothing at all. An error in one declaration shows on its own row and leaves the others selectable, which means discovery must not be one try/catch around the whole directory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Several definitions in one folder all appear, distinguishable by name and origin.
- [ ] #2 A malformed declaration shows its finding on its own row and the others stay selectable.
- [ ] #3 No path outside .dspatch/loops/ is read during discovery, asserted rather than promised.
- [ ] #4 Selecting a definition starts nothing.
- [ ] #5 A definition picked from outside every open folder appears in the same list, labelled by origin.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, calls 002-005. Declaration format, parser, non-recursive discovery of .dspatch/loops/*.loop.json, per-row errors, and a Choose a file... picker for a declaration outside every open folder. A picked file joins the same list as a row labelled 'chosen by hand'; an unparseable one is listed with its finding rather than raising a dialog error; the picked key becomes the selection only if it loaded. Nothing is persisted across a restart - that belongs to DSP-71. Verified in report 004 (PASS WITH FINDINGS); all five findings closed. Candidate sha256:b8a0340c. UX acceptance HUMAN_PENDING. The picker's native dialog rests on unit tests and reading, not on a window trial.
<!-- SECTION:NOTES:END -->
