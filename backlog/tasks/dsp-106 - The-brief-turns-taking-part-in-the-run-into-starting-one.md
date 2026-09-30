---
id: DSP-106
title: The brief turns taking part in the run into starting one
status: To Do
assignee: []
created_date: '2026-09-30 18:11'
updated_date: '2026-09-30 18:43'
labels:
  - loop graph roles
dependencies: []
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second trial of DSP-98's mandate, run live-2026-09-30T18-09-00-946Z on 30 September, with DSP-99 through DSP-103 all in place. The mandate asks that the run already under way pass through the graph in short steps without project work so the existing animations can be filmed. The coordinator's prompt carried the engine sentence 'The loop is running: it is not something for this run to design, build or demonstrate' verbatim, and the coordinator still briefed 'Execute a single DSpatch loop iteration that walks the graph from start to delivered state' and 'Create or trigger a DSpatch loop that passes through its nodes sequentially'. It then recorded honestly that it had not surveyed the project and so did not know what nodes exist or how to trigger a loop. The implementer, given a brief to trigger something, could not do so without reading, and declared blocked rather than reading, which is the right answer to that brief. So the defect is the brief and not the mandate: no step reached the reading that its own participation is the delivery, because the run it is part of is the thing being demonstrated. Where this behaviour is defined: the coordinator node's purpose in docs/loop/graphs/dspatch-development-loop-runnable.graph.json and the run coordinator role in docs/loop/roles/run/dspatch-run-coordinator.role.md, together with the engine preamble in app/src/shared/loop-chat.ts. The engine sentence exists and was delivered, so this is not a missing instruction; what is missing is a shape of brief for an assignment whose work is the run's own passage. Do not solve it with special handling for demonstrations or for any other category of request, and do not require a more technical mandate from the person. That the model may also be a factor is untested: one run, one model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An assignment whose work is the run's own passage through the graph can be briefed as that, without being turned into something to trigger or build
- [ ] #2 A step can tell that taking part in the run is itself the delivery, from what it is sent rather than from inference
- [ ] #3 No special handling is introduced for any category of request, and no more technical mandate is required of the person
- [ ] #4 The behaviour is attributed to a named source: the node's purpose, the role text, or the engine preamble
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope note, 30 September. What is observed: the coordinator's brief in run live-2026-09-30T18-09-00-946Z asked the next agent to create or start a loop although that agent was already taking part in one, and the coordinator's own prompt carried the engine sentence saying the loop is running and is not something for this run to design, build or demonstrate. What is not established: why. The implementer's reply declared blocked and gave its stated reason, but what it understood is not observable from a reply and must not be asserted. Whether the model is a factor is untested. The cause remains unproven, no further provider experiment is to be run for this card, and no demonstration feature is to be added. This card stays open and separate; it does not block closure of the routing fixes, which were verified independently of it.
<!-- SECTION:NOTES:END -->
