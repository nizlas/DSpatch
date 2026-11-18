---
id: DSP-224
title: Merge the generic graph's size variants with a per-visit review route chosen independently of model class
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, models, graph]
dependencies: [DSP-222, DSP-223]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Continue merging the generic development graph's size variants after DSP-222 and DSP-223: one node per shared role with a dynamically chosen model class. The engine records, per visit, the choices that decide what follows (model class and review route) as explicit, independent information, so a merged node can be followed by the right continuation; no special cases for named roles or sizes. Choices survive revisits and rework and stay apart between subtasks; the journal shows what was chosen and why. Candidates: Implementer (small/medium node and large), Researcher (medium, large), Reviewer (small, large), Skeptic (small, large); variants with a genuinely different responsibility stay apart under names for that responsibility. The canvas shows the class used by the current visit (Small/Medium/Large, or S/M/L when small) and, before a run, that the class is chosen dynamically. Hand layout updated; older graphs and settings keep working. No parallelism, no release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 Model class and review route are chosen independently per visit and kept through revisits and rework, without leaking between subtasks; the journal shows each choice and its reason.
- [x] #2 The merged roles keep their earlier continuations, design QA, reviews, escalations, failure paths and limits; any variant kept apart is named for its responsibility.
- [x] #3 A running node shows the current visit's class (full name or letter) with the concrete model in its details, and before a run that the class is chosen dynamically.
- [x] #4 Hand layout readable; older graphs and model class settings still load; no parallelism.
- [x] #5 Verified with simulated runs and in the interface; real-provider status reported separately.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result (18 November 2026). **Engine.** A graph may declare `choices` (id, label, meaning, options, default). A node `decides` choices and states them on `CHOICE: <choice> <option> <reason>` lines, independently of its outcome; a missing or invalid value takes the default with the reason saying so. An edge `sets` a value and may be taken only `whenChosen`; a `select` model policy may be `chosenBy` a choice. Values travel with the arrival (`ArrivalRef.choices`) through revisits and rework until a deciding step or an edge changes them, so the next dispatch replaces the earlier subtask's choices. A visit is not offered an outcome whose edges all exclude it by a choice its node does not decide (`nodeForVisit`). Journal: `choice.<id>`/`choiceBy.<id>` on `node-entered`, `choicesDecided`/`choicesSet` on `edge-taken`, `modelChosenBy` and `modelClassUsesChat` in the model record. Validation: unknown choices or options, ambiguous guarded routes, uncovered values. Nothing names a role or size. Module `app/src/shared/loop-choices.ts`.

**Graph.** 35 → 31 nodes, 130 → 111 edges, 19 → 15 roles. Merged: Implementer (the small/medium node and large; classes small/medium/large), Researcher (medium, large), Reviewer (small, large; standard/thorough route → class small/large), Skeptic (small, large; same). The dispatch now names one capability per worker and decides `class` and `review`. The Implementer's success goes to QA on the standard route and to design QA on the thorough one; the Researcher's challenge follows the route; Explorer and Data Curator edges set standard and Infrastructure and Experiment Analyst edges set thorough, as their checks were before. `design-review` and `escalate` return to the same node with the route set to thorough and are not offered on a thorough visit. Kept separate: the planning gates `reviewer-readiness`/`reviewer-plan-gate` (renamed from `reviewer-s-…`) and `reviewer-job-gate` (own tasks, Reviewer role), QA and design QA (different checks), and the Tech Lead steps with roles Tech Lead and Tech Lead (medium). Roles merged into implementer, researcher, reviewer and skeptic role files; depth is a task parameter. Hand layout redone; no route crosses an unrelated node.

**Canvas.** Before a run a chosen-per-visit node says "class chosen per visit: S · M · L"; during and after one, a tag on the node's top edge shows the latest visit's class (Small/Medium/Large; S/M/L below 75 % zoom) and the line below the visit number and model ("visit 2 · model-l", "visit 1 · chat model …"); the hover and the node panel give the class, model, provider, how it was decided and, for Use chat model, which chat model it resolved to.

Checks: type check, build, and the targeted files generic-agent-network (48), loop-model-select, loop-graph-write, loop-chat, loop-run, graph-authoring-tools, loop-provider, loop-provider-agnostic, graph-proposal, loop-edge-routing, loop-layout, loop-run-view. Simulated runs (scripted executor and the live executor with a simulated adapter): one Implementer node with class and route chosen independently in four combinations; a revisit after rework runs the new dispatch's choices, not the earlier subtask's; earlier continuations and escalations for every merged role; the badge, the journal and the model sent to the adapter agree visit by visit. In the window (this checkout's build, headless, isolated profile, no model call): the graph before a run, and recorded scripted runs shown in Run view at Implementer visit 1 (Small, Use chat model), visit 2 (Large) and the end (Reviewer and Skeptic Large on the thorough route), at 100 % and 60 % zoom. Not tried: any real provider.

Known difference: an escalated review or challenge continues the same node; on Claude that keeps its standard pass in the session's history (model switched), on other agents a new session opens. Choices, `sets` and `whenChosen` are shown read-only in the editor and edited in the graph file.
<!-- SECTION:NOTES:END -->
