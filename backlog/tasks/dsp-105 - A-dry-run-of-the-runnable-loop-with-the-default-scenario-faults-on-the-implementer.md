---
id: DSP-105
title: >-
  A dry run of the runnable loop with the default scenario faults on the
  implementer
status: Done
assignee: []
created_date: '2026-09-30 18:08'
labels:
  - loop tooling
dependencies: []
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during DSP-103, arrived with DSP-102. The scenarios in app/scripts/run-loop-graph.mjs are written for the drawn loop and name its nodes, and happy-path scripts the implementer to plain success. Since DSP-102 the runnable loop's implementer declares outcomes, so a plain-success product faults with undeclared-product. Running npm run loop:dry-run with the runnable graph and the default scenario therefore stops on the implementer, which looks like a defect in the graph rather than a scenario written for a different drawing. A scenario naming nodes a graph does not have should say so before it walks anything.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Walking a graph with a scenario written for another drawing says so, rather than faulting partway as though the graph were wrong
- [x] #2 The runnable loop has a scripted scenario that reaches delivered, or the default is documented as unscripted for it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Not a regression in the graph. The unscripted awaiting-human scenario walks the runnable loop to delivered, exit 0.

Done on 30 September 2026, both parts in the tooling layer and neither graph touched. `run-loop-graph.mjs` now compares a scenario's scripted node names against the loaded graph's node ids before it walks anything, and where any are missing it names them, says the scenario was written for a different drawing, and exits 2. Only names are compared: nothing reads what a scenario meant, and no scenario is adjusted to make a graph pass. Running the default against the runnable loop now reports `niclas-mandate, route-next-step, niclas-assessment` up front instead of faulting at the implementer partway through (#1).

`runnable-delivered` is the scripted scenario for the runnable loop and reaches Delivered on e14, exit 0, five calls, no provider turns (#2). Every step is scripted with a declared name rather than plain success, which is what DSP-102 made those nodes require. The six existing scenarios still behave as documented against the drawn loop: happy-path, spec-error and limit-routed exit 0; timeout, limit-reached and awaiting-human exit non-zero on purpose. Full suite 1223/1223.
<!-- SECTION:NOTES:END -->
