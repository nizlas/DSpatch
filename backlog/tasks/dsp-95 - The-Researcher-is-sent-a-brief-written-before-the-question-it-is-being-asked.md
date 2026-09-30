---
id: DSP-95
title: The Researcher is sent a brief written before the question it is being asked
status: Done
assignee: []
created_date: '2026-09-22 17:19'
updated_date: '2026-09-22 21:14'
labels:
  - architecture loop-graph
dependencies: []
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Registered from DSP-92 finding F11, as a bounded defect in what the graph sends, not as a proposal. In docs/loop/graphs/dspatch-development-loop-runnable.graph.json the researcher node declares consumes: [coordinator], and it is reached only by edge e03, which the implementer takes when it declares research-needed. So the Researcher receives the coordinator's opening brief, written before any question existed, and does not receive the implementer's statement of what stopped the implementation and what it needs answered. The drawing's notes explain the constraint that produced this: a node whose consumes cannot be satisfied on the path the run actually takes would stop the run, and the implementer has left nothing on its first visit. That is a real constraint and the reason the shape is what it is; it is not a reason for the input to be wrong. That edge e03 has never been walked live is not a reason to defer a demonstrated fault in which inputs are sent: the fault is established by reading the drawing and the executor, and a live walk would confirm it rather than discover it. Do not manufacture a research-needed run to prove it first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Researcher's message contains the implementer's statement of the question that triggered the research, not only the coordinator's opening brief
- [ ] #2 The change does not make the run stop on a path where the earlier result does not exist
- [ ] #3 The reason for whatever shape is chosen is recorded where the drawing already explains its consumes constraint
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed by DSP-100, which made what a step receives depend on the arriving edge. Edge e03 delivers the implementer's question to the researcher and e06 returns the answer to the implementer, both covered by tests. Nothing of this card is left undone.
<!-- SECTION:NOTES:END -->
