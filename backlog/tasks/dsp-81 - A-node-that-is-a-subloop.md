---
id: DSP-81
title: A node that is a subloop
status: To Do
assignee: []
created_date: '2026-09-20 09:21'
labels: []
dependencies:
  - DSP-75
priority: high
type: feature
ordinal: 15707
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A coordinator must be able to delegate to an agent OR A SUBLOOP, await the result, and continue with preserved context - through Maestro, even where the provider has no nested subagent call of its own. The good news is that the runner is already re-entrant: runLoopGraph is an ordinary async function holding no module state, touching no filesystem, taking its work as an injected executor. So a subloop node IS an executor that calls runLoopGraph on the child graph, awaits it, and maps the child's result to a step execution. Nothing about the walk changes, and NESTING NEEDS SEQUENCING RATHER THAN CONCURRENCY - the parent is blocked at that node by construction. A new node kind rather than an attribute on agent, because the validation rules genuinely differ: no role, a required map from the child's terminal ids to this node's outcomes, and a derived outcome set. The child run id is DERIVED rather than generated - parentRunId slash NNN-nodeId, the same shape archivePlacement already builds - so the run id, the report path and the journal line agree without a second convention. The child gets its own complete record naming its parent run, node and visit, because a child run is a run and should be openable as one. One budget rule prevents a whole class of escapes: a child may restrict its parent's budget and may never expand it, from a shared pool - otherwise a parent bounded at twelve calls could spawn five subloops of twelve and its bound would mean nothing. Cancel and pause must cross the boundary or the same defect class DSP-37, DSP-38 and DSP-39 fought one level down arrives again. Recursion is refused at validation and depth is bounded. A child graph containing a human node inherits the existing dead end rather than creating a new one, and should propagate the question honestly rather than being refused.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A parent completes when its child reaches a terminal, with the mapped outcome routing the parent's edge.
- [ ] #2 The child run has its own record naming its parent run, node and visit, and is openable in the graph view with a way back.
- [ ] #3 A recursive definition is refused at validation and nesting depth is bounded, both reported rather than silent.
- [ ] #4 A child's runtime fault reconciles at the parent, naming the child run and node.
- [ ] #5 Cancelling the parent stops the child.
- [ ] #6 The child's calls count against the parent's pool, and a child limit restricts rather than expands it.
- [ ] #7 The conversation does not drown in the child's step lines.
<!-- AC:END -->
