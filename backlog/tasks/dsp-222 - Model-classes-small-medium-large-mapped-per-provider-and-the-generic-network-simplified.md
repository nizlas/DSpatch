---
id: DSP-222
title: 'Model classes small, medium, large mapped per provider, and the generic network simplified'
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, models]
dependencies: [DSP-220]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Where the generic agent network has small, medium and large variants of the same role that differ only in model capacity, show and run them as one logical node with a model selection policy. Reuse DSP-209 S19's `select` policy and `selectsModel` edges: an option may name a provider-independent model class (small, medium, large, describing intended capacity), mapped to a concrete model in the configuration of the run's provider. The class is chosen before the visit from the route the deciding step took, under an explicit policy in that step's instructions; the chosen class, concrete model and reason are recorded, and a missing mapping is said plainly instead of switching model silently. No new parallelism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 Variants are merged only where instructions, responsibilities, inputs, outputs and routing match apart from model capacity; differences in task or path are kept and the merges are recorded with why behaviour is preserved.
- [x] #2 A `select` option can name a model class; the class maps to a model through the run provider's configuration, never the graph; an unmapped class is reported before and during the run and is not replaced by a hidden model.
- [x] #3 The chosen class, concrete model and reason are recorded per visit, and a revisit with another class runs with that model.
- [x] #4 The merged role shows as one node with a compact note on its dynamic model choice; the run view and node panel show the model chosen; the layout is readable.
- [x] #5 Targeted tests cover the merge preserving the flow, class choice varying between slices and the model reaching the adapter.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (18 November 2026): inventory done. Mergeable: Implementer small+medium and Explorer small+medium (identical routing). Kept apart: Implementer large (design QA and large review), Researcher medium/large (different challenge steps), Reviewer and Skeptic variants (different outcomes), Tech Lead steps (different tasks). Next: model classes in the `select` option, provider mapping, then the graph.

Result (18 November 2026). Merged: Implementer small+medium into `implementer` and Explorer small+medium into `explorer`, each with a `select` policy whose options are the model classes small and medium. Their role texts differed only in the depth of the same work, and their routing was identical (Implementer: success to QA, spec-error/research-needed/blocked to Tech Lead's dispatch, limit-reached to wrap-up; Explorer: success to Skeptic (small), the same failures), so the merged node keeps every route once and the dispatch's outcome names stay (`implementer-s`, `implementer-m`, `explorer-s`, `explorer-m`), now as edges into one node that carry `selectsModel`. Tech Lead's dispatch states the class policy and gives its reason on the `RESULT:` line. Kept apart because their paths differ, which the engine cannot route by class: Implementer large (design QA and the large Reviewer), Researcher medium/large (different Skeptics), Reviewer and Skeptic small/large (different outcomes, escalation), the Tech Lead steps (different tasks). No selector nodes became redundant: Tech Lead's dispatch also routes to other roles. 35 nodes and 130 edges (from 37 and 140), 19 roles (from 21).

Mechanism: `ModelOption.modelClass` beside `model` (exactly one), `stepModelChoice` resolving a class through the run provider's `ModelClassMap`, the same rule for the journal (`modelClass`, model, reason) and the live session; a revisit with another class switches Claude's session model or opens a new session elsewhere, as S19 does. The mapping is read from `modelClasses` in `dspatch-model-choice.json` (kept when the chat's model is saved). An unmapped class runs the chat's model, said in the Runs with line and in each visit's reason; the model check compares mapped models with the provider's list. No mapping UI yet: the file is edited by hand.

Display: a select step is taller and carries a third line, "model by route: small · medium" in the editor and the class and model a run chose in run mode; the node panel edits a class per option and shows the chosen class live. The graph was laid out by hand in layers (planning column, main column, a worker row under the dispatch, QA/review/challenge tiers, the report chain); Arrange gives fewer counted crossings (846 against 1500, mostly the parallel limit-reached routes) but a diagonal that reads worse. No route passes behind an unrelated node in either.

Checks: the type check; generic-agent-network (38, among them the merge, a class varying between slices with its reason recorded, the class's model reaching the adapter on a revisit, an unmapped class said plainly, option validation), loop-model-select, loop-layout, loop-edge-routing, loop-graph-write, loop-provider, loop-provider-agnostic, graph-proposal, graph-authoring-tools. Seen in this checkout's build, headless with an isolated profile: the simplified graph at 40%, the model line on both merged nodes, the unmapped-class sentence and the node panel's class options. Not seen: the run-mode model line during a real run; not tried with a real provider.
<!-- SECTION:NOTES:END -->
