---
id: DSP-82
title: 'The definition is the way in: open a loop in the editor from its .loop.json'
status: Review
assignee: []
created_date: '2026-09-20 16:58'
updated_date: '2026-09-20 19:09'
labels: []
dependencies:
  - DSP-78
priority: high
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the editor opens a .graph.json and nothing else. A definition is therefore only an entry point for RUNNING a loop, not for seeing or editing one, and a person who has chosen a loop still has to go and find its graph file by hand. Niclas: the loop definition is to be the shared entry point for choosing, showing, editing and running a loop. Opening a .loop.json in the editor must read the declaration and open the graph it points at, resolved through the definition's own resourceRoot - reusing openLoopDefinitionFile and openChosenLoop, the same loading the definition chooser uses, not a second parser. The editor must say which loop is open, and a save must write to the graph the definition points at. The chosen loop's graph must also be openable directly from the app without hunting for a file again. Direct opening of a .graph.json may remain as a separate function but must not be needed to open a defined loop. The old shortcut to the Cursor process's documentation drawing must not be confused with the chosen runnable loop. No replanning of the format is needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opening a .loop.json in the editor shows that definition's graph, with roles resolved through its resourceRoot.
- [x] #2 The same loading path as the definition chooser is used, asserted rather than promised.
- [x] #3 The editor names the loop that is open, by definition name, not only by file path.
- [x] #4 Saving writes to the graph file the definition points at.
- [ ] #5 The chosen loop's graph opens from the app without a file dialog.
- [ ] #6 The development-loop shortcut is distinguishable from the chosen runnable loop and says which it is.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, call 020. Report: .dspatch-loop/runs/20260920-104500-folders/reports/020-implementer-the-definition-is-the-way-in.md. Candidate sha256:f4423b3ae16a88cf7b7d35fcfd3bfb11daeb59f5c8389152a14843c6db3ea212, confirmed by the coordinator with --expect.

WHAT WAS BUILT. OPEN_LOOP_GRAPH gained two request kinds, both routed through the existing chooseLoop: 'chosen-loop' resolves what Send would walk, and 'definition' resolves a declaration by path through rowForKey and openChosenLoop. The pick dialog now decides by the format field rather than by extension, so a person may point at either file. A new module loop-graph-open.ts holds openedFromDefinition and openedFromGraphFile as two entry points that cannot borrow each other's anchor.

THE REUSE IS STRUCTURAL, NOT PROMISED, and that is criterion 2. openedFromDefinition has no filesystem and no root, so it cannot resolve a role except through the resolver it was handed. The test asserts the observable asymmetry: the same graph opened through the old anchor resolves both roles to null. A reintroduced second parser anchored at ownRoot fails rather than passing quietly.

CRITERIA 1, 2 AND 4 ARE MEASURED, including against the real out-of-repo declaration, which was opened read-only and not edited. Save targets the graph and not the declaration, asserted; newline is detected in the graph, with a fixture whose two files deliberately disagree so the assertion cannot pass by coincidence.

CRITERIA 3, 5 AND 6 ARE CODED AND WORDED BUT NOT TRIED IN A WINDOW, and the implementer said so rather than implying otherwise. The editor is a window and unit tests cannot show what a person reads in it. HUMAN_PENDING: the header naming the loop, the chosen-loop button opening with no dialog, and whether 'Open our Cursor process drawing' can still be mistaken for the chosen runnable loop.

typecheck clean. fast 867 pass 0 fail, up from 860 with seven added tests and no other movement. loop 419/0. live 62/0. Coordinator re-ran typecheck and fast independently. No provider turn, no agent run against this repository, no package, no commit.

ONE DECISION TAKEN, NOT DEFERRED: with nothing chosen, 'Open the chosen loop' falls back to the same default Send would walk rather than refusing. Consistent by construction; the refusal sentence applies only when no definition resolves at all.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-20 16:58
---
Focus: OPEN_LOOP_GRAPH gains a definition path that reuses openLoopDefinitionFile + openChosenLoop, and a chosen-definition kind that reuses chooseLoop. Editor header names the loop. Save targets the definition's graph.
---

created: 2026-09-20 17:13
---
Coordinator verified independently: candidate-24 --expect matches, typecheck clean, fast passed. The standalone declaration outside the repo is byte-identical.
---

created: 2026-09-20 19:09
---
Criterion 3 evidenced in a window by call 021's trial: chosen-definition-work-advanced-closed.png shows the header reading 'Chat loop - Simple chat loop' with the declaration named in the status line. Criteria 5 and 6 still want Niclas.
---
<!-- COMMENTS:END -->
