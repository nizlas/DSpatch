---
id: DSP-22
title: Build a graph editor for agent loops
status: Review
assignee: []
created_date: '2026-09-15 20:18'
updated_date: '2026-09-15 21:45'
labels:
  - ux
dependencies:
  - DSP-21
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Niclas chose this direction on 15 September 2026 and described the editor himself: pick graph objects from a small palette — agent, gate, router, a plain arrow, a dashed arrow for declared failure types such as a specification failure — place them, connect them as in an ordinary graph editor, then click an object and see its attributes in an inspector, such as an agent's model type and the alternative sizes it can use for work of different implementation size or complexity.

It is a prototype, and its purpose is to find out whether building a loop this way is a sensible way to work. That question is answered by him using it, not by it being finished.

### Why it can be built in parallel with the runner

Because Niclas made the observation that settles it: **the editor is the same regardless of how we handle something getting stuck.** A hung call, a lost report or a dead process is the runner's concern and is deliberately undrawable. What the editor edits is topology and attributes, and neither changes when the fault policy does.

So the only shared prerequisite is [DSP-21](dsp-21%20-%20Define-the-agent-loop-graph-format.md), the graph format. After that this task and [DSP-18](dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md) proceed against the same file, independently. A graph written by hand is enough to develop against; a running loop is not required.

### The attribute that connects to work already recorded

An agent node carrying a model, with alternative sizes for different complexity, is the product-side face of two things already in the backlog: [DSP-19](dsp-19%20-%20Choose-models-in-DSpatch-interactively-and-per-loop-step.md), which requires a Maestro loop to specify a model per step, and [DSP-8](dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md), which tests whether choosing by task character actually pays off in our own loop. The editor should present what the format defines rather than inventing its own notion of model or size — and where the runner does not yet honour an attribute, say so in the inspector instead of implying it works.

### Bounds

Read and write the format, place and connect, inspect and edit. Nothing else. Automatic layout, an undo history and visual polish are explicitly out; they are the parts with the least to teach us per hour spent, and the prototype's job is to teach us something.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A palette offers the graph object kinds to place: agent, gate, router, a plain connection and a dashed connection for a declared failure type such as a specification failure. Objects are placed on a canvas and connected as in an ordinary graph editor.
- [ ] #2 Selecting an object opens an inspector showing that object's attributes, editable there: for an agent at least its model, and the alternative sizes it may use for work of different implementation size or complexity. The inspector shows the attributes the format defines, and marks any the runner does not yet honour.
- [ ] #3 The editor reads and writes the shared graph format, and a graph written by hand opens, round-trips and is not silently reformatted or reordered. An invalid graph is refused with the reason, not partially loaded.
- [ ] #4 Niclas can reproduce the structure of the reference figure in docs/assets/agentloop_generisk.png, including its declared failure edges, and judge whether building it that way was reasonable.
- [ ] #5 Runtime fault handling is deliberately absent from the canvas: a hung or undelivered call is the runner's concern and is not drawn. The editor does not grow a vocabulary for it.
- [ ] #6 An agent node shows which role description it is bound to, and the binding can be changed from the inspector. A reference that resolves to nothing is shown as broken rather than as an agent with no instructions.
- [ ] #8 The graph's target framework is visible while editing, is chosen deliberately, and drives the warnings shown, so a warning is always about a real target rather than about frameworks in general. A new graph starts at whatever the connected account suggests, and picking a different one — including one this account cannot run — takes a moment and no ceremony. Changing the target later presents what the new one cannot enforce and what it newly allows, and applies nothing on its own.
- [ ] #9 Deliberately out of scope for the prototype, and stated in the task rather than discovered: automatic layout, an undo history, multi-user editing and visual polish beyond legibility.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
16 September 2026, Niclas: the figure's double-headed *frågar* arrows are a future consultation (an agent fetching another agent's summary via an API not yet specified). Drop them from the first demo rather than inventing a connection kind. The editor demo loads our own development loop, which already has neither that dialogue nor an `external` node.
<!-- SECTION:NOTES:END -->
