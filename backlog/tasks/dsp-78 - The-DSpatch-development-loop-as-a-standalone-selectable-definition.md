---
id: DSP-78
title: 'The DSpatch development loop as a standalone, selectable definition'
status: Review
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-20 16:36'
labels: []
dependencies:
  - DSP-69
priority: high
type: feature
ordinal: 15710
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A declaration, a graph and a resourceRoot pointing at the DSpatch working copy so the five specialist role files are referenced rather than copied, living outside the DSpatch repo and reachable through the manual picker. Its location under development must never make all of development a working root. The planner reversed its own recommendation here and the reasoning is worth keeping: it first proposed two graphs because the coordinator node could not be both a truthful drawing and runnable, then found that splitting the coordinator's work three ways makes one graph viable. What belongs in the drawing is declarative routing, roles, bounds and what each step must leave. What belongs to the runner is mechanical: writing the handoff, binding it to run and visit and call, checking the result exists, storing it once, counters and faults and reconciliation. What must stay a role is judgement: what the mandate means, classifying what the step needs, writing the brief, deciding what goes to Niclas, reconciling an ambiguous outcome, and writing backlog status. The re-scoped coordinator - brief, classify, reconcile, report - is true of both the Cursor loop and a Maestro one; what differs is the delegation mechanism, which the drawing never depicted either way. What would reverse it again: if re-scoping forces the node's role source away from SKILL.md toward a role that exists only for DSpatch, we would be maintaining a second governance document, and two graphs sharing one role set becomes the lesser cost. Checkable while authoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Selectable from outside every open folder.
- [x] #2 Roles resolve to the real files with the dependency shown.
- [x] #3 development as a whole is never a working root.
- [x] #4 The divergences from the Cursor loop are written in the definition itself.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, call 019. The implementer that held the assignment was cut off after about forty seconds by a model usage limit; the coordinator finished the leftover tests and the standalone file. Declaration: C:\Users\nicla\development\dspatch-loop-definition\dspatch-development-loop.loop.json, id dspatch-development-loop-runnable, resourceRoot ../DSpatch, roles referenced not copied, reachable through the manual picker. FORBIDDEN_LIVE_GRAPH_ID is gone; refuseLiveWorkingRoots still names DSpatch when it is a working root. Review nodes are agents in both drawings (gap 7). Dry-run of the subset completed coordinator -> implementer -> verifier -> implementation-review -> coordinator-report -> delivered with 0 provider turns. typecheck clean, fast 860, live 62. No package. IT IS NOT OUR LOOP. UX of the picker: HUMAN_PENDING. Report: .dspatch-loop/runs/20260920-104500-folders/reports/019-implementer-the-development-loop-as-a-definition.md
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-20 16:35
---
Finishing after the implementer was cut off by a model usage limit. Focus: standalone definition, id-guard removal, review nodes as agents, tests.
---
<!-- COMMENTS:END -->

## The number of graphs is a consequence, not a goal

<!-- SECTION:NOTES:BEGIN -->
Niclas, 20 September: **the runnable graph does not have to match today's documented Cursor process.** What it must preserve is the roles, the division of responsibility, the verification and the possibility of rework. What it may drop is anything that exists only to work around Cursor's limited subagent depth.

So the question this card carried â€” one graph or two â€” is no longer a decision to take in advance. It falls out of which properties the runnable graph keeps. The card should say, in plain words a person can read, **which properties it preserves and which limitations it removes.**
<!-- SECTION:NOTES:END -->
