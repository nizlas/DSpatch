---
id: DSP-222
title: 'Model classes small, medium, large mapped per provider, and the generic network simplified'
status: In Progress
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
- [ ] #1 Variants are merged only where instructions, responsibilities, inputs, outputs and routing match apart from model capacity; differences in task or path are kept and the merges are recorded with why behaviour is preserved.
- [ ] #2 A `select` option can name a model class; the class maps to a model through the run provider's configuration, never the graph; an unmapped class is reported before and during the run and is not replaced by a hidden model.
- [ ] #3 The chosen class, concrete model and reason are recorded per visit, and a revisit with another class runs with that model.
- [ ] #4 The merged role shows as one node with a compact note on its dynamic model choice; the run view and node panel show the model chosen; the layout is readable.
- [ ] #5 Targeted tests cover the merge preserving the flow, class choice varying between slices and the model reaching the adapter.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (18 November 2026): inventory done. Mergeable: Implementer small+medium and Explorer small+medium (identical routing). Kept apart: Implementer large (design QA and large review), Researcher medium/large (different challenge steps), Reviewer and Skeptic variants (different outcomes), Tech Lead steps (different tasks). Next: model classes in the `select` option, provider mapping, then the graph.
<!-- SECTION:NOTES:END -->
