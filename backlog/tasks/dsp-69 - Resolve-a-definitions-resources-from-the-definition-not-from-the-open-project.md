---
id: DSP-69
title: >-
  Resolve a definition's resources from the definition, not from the open
  project
status: Review
assignee: []
created_date: '2026-09-20 09:01'
updated_date: '2026-09-20 11:26'
labels: []
dependencies:
  - DSP-68
priority: high
type: bug
ordinal: 15701
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The collapse this whole stage stands on. createFileRoleResolver anchors a graph's role paths to the WORKING FOLDER, and GRAPH_FORMAT.md states it as the rule: paths are relative to the project root the caller supplies, not to the graph file. So a graph from repo A, run against repo B, looks for its roles inside B and finds nothing. Introduce resourceRoot on the declaration: paths resolve under it, climbing out of it is still refused, it defaults to the declaration's own folder, and when it points elsewhere the dependency is written down and shown. The load-bearing consequence is that resourceRoot is a READ anchor and never a working root. Decided with the card rather than discovered later: results are written to a run-scoped location DSpatch owns or to an explicitly declared root, never to resourceRoot and never by default to a working root - otherwise the standalone development-loop definition would write its reports into the DSpatch repository, which is this stage's own collapse arriving through the back door.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A definition in folder A with roles in A resolves correctly while folder B is the working folder.
- [ ] #2 A definition declaring resourceRoot pointing at the DSpatch working copy resolves the five specialist roles.
- [ ] #3 A path climbing above the resource root resolves to nothing, in the existing wording.
- [ ] #4 The resource root never appears among the run's working roots.
- [ ] #5 The three existing graphs still load unchanged.
- [ ] #6 Result paths never anchor to resourceRoot.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REWORKED AND CLOSED under the amended rule, run 20260920-104500-folders, calls 007 and 009.

THE RULE NOW: every relative path in a declaration resolves under one root - the folder the declaration file sits in, unless resourceRoot moves it - and no path may climb out of that root. Where DSpatch found the file decides nothing; .dspatch/loops is where the app looks, not a second base.

The graph refusal survived by being measured against the resource root rather than a folder computed from where the file was found, which collapses the two bases into one: graph and a role path now meet the same boundary and are let past it the same way. The refusal also MOVED LAYER - measured against the resource root it is decidable from the declaration's text alone, so it now lives in parseLoopDefinition as graph-climbs-out and the filesystem layer has nothing left to rule on. The renderer, which is handed text and no filesystem, now meets exactly the refusal the main process does. The withdrawn rule was hiding a check in the wrong module.

WHAT THE WITHDRAWN RULE WAS HIDING: definitionHomeFor matched the last two path segments case-insensitively anywhere, without checking that a project surrounded them, so a declaration in C:\Downloads\.dspatch\loops\ silently anchored its reads two levels wider than its own folder with nothing saying so. Reported rather than verified - the old source is untracked and no longer exists to re-examine - but impossible going forward, checked by execution.

All three live declarations adapted in the same change. GRAPH_FORMAT.md now carries two worked declarations, checked by execution with the JSON extracted from the document rather than retyped.

Verified in report 008 (PASS WITH FINDINGS). Finding A - no test asserted the DEFAULT anchor for a declaration in the standard location, so reintroducing the home-folder rule would have left the suite green - closed by a pair of tests written as two calls of one body, proven to bite by temporarily reinstating the withdrawn rule: the standard-location case fails, its twin passes. That asymmetry is the point; the pair fails on location, not on a fixture difference.

Candidate sha256:872b85ca. 793 fast tests, 0 fail.
<!-- SECTION:NOTES:END -->
