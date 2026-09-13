---
id: DSP-10
title: Use English consistently across the project
status: Review
assignee: []
created_date: '2026-09-13 19:56'
updated_date: '2026-09-13 20:21'
labels: []
dependencies: []
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make English the maintained language for project documentation, agent instructions, backlog prose, code comments, product strings and saved reports. Keep Swedish available for conversation with Niclas. Preserve stable IDs, commands, historical evidence and the approved colour palette. Review the newly pushed app and the two open documentation proposals.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Maintained prose and product text on the proposed branch are in English; historical evidence is explicitly identified and preserved.
- [x] #2 AGENTS.md makes the project language explicit, including the distinction between conversation and persisted artifacts.
- [x] #3 Links, task metadata and acceptance states remain valid; language changes preserve application logic and styling.
- [x] #4 Open documentation proposals are accounted for so merging them cannot silently restore Swedish maintained prose.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Translate the pushed snapshot, preserve historical evidence verbatim, validate structure and application invariants, and publish a reviewable PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The language migration is based on pushed main 1797018f01c1f3dee7e3199a317fa8fb169b9fbd. Maintained documentation, role/skill instructions, task descriptions and criteria, source comments, developer messages and UI strings are English. Swedish conversation remains allowed. Existing task IDs, filenames, dependency/status/AC values and original DSP-1/DSP-7 evidence are preserved; historical notes are clearly labelled. The original Swedish diagram remains as a historical source, with an editable English Mermaid equivalent in VISION 1.9.

The current colour palette is recorded as Niclas's approved starting point. CSS and palette values are unchanged; this does not accept the whole UX. The README now reflects the pushed skeleton and completed calibration rather than claiming they are absent.

Validation:
- Compared parsed ASTs for all 10 changed TypeScript/TSX/JavaScript source files. All 38 differences are human-facing string/template/JSX text; identifiers, control flow, types and operation structure are unchanged.
- Confirmed identical CSS and lockfile; equivalent parsed packaging/configuration data and agent frontmatter except descriptions; package.json differs only in description; HTML language changes from sv to en.
- Checked all original task metadata and AC states; preserved complete historical note bodies verbatim. Backlog.md 1.52.0 reads eight main-branch tasks and milestone m-0 (1/7 complete).
- Checked 63 maintained local links on the main proposal, including legacy heading anchors, and 68 links for each translated proposal tree.
- Built an isolated renderer with React 19.3.0 and checked ready, loading and error DOM states against a simulated bridge, including seven capability rows and the ready acknowledgement. Parsed both Mermaid diagrams successfully. The loop skill passes quick_validate.py; git diff --check passes.

Limitations: no new Windows/Electron packaging, actual account call or visual UX acceptance was performed. Browser-based layout checks were unavailable because the browser download timed out. Existing Windows verification refers to the original source and artifact, not a newly built translated executable.

The separate model-selection and Maestro proposals (PRs #4 and #7) have English overlays prepared on the language branch, preserving their scope and original task states. They are to be published as dependent PRs, not folded into this language change. The earlier Swedish Maestro Word export remains version 1.0; its English Markdown edition is explicitly version 1.1.

Ready for Niclas to review. No product task was closed, no provider integration added, and no merge to main is included.
<!-- SECTION:NOTES:END -->
