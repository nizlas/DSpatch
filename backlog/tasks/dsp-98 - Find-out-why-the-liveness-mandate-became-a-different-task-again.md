---
id: DSP-98
title: Find out why the liveness mandate became a different task again
status: Done
assignee: []
created_date: '2026-09-22 20:02'
updated_date: '2026-09-30 18:12'
labels:
  - loop investigation
dependencies: []
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigation before anything else changes. Niclas ran the runnable development loop on 22 September 2026 at 21:50 local with the mandate 'Las inte projektet. Bara gor en jattesnabb loop iteration som bara visar liveness nagra sekunder i varje nod och simulerar en jattekort task. Sa man kan filma sjalva animeringarna. Dvs skicka vidare tasks direkt till nasta nod att bara vanta 2 sek och sedan skicka vidare igenn osv tills den nat delivered. Deliveryn i denna graf ar att ta sig igenom alla animeringarna av livenss fram till delivered bara.' The intent was that the run already under way should walk the graph so he could film DSpatch's existing animations. No code, no separate simulator and no new animation infrastructure was ordered. Maestro handles the transitions; the agents do their steps and leave the answers the call contract asks for. Exactly two seconds is not the point. What appeared in the window instead: the reviewer's RESULT: rework cited BUGS_INVENTORY.md and PERSON_NAMES_INVENTORY.md as delivered artefacts and demanded a demonstration scenario, node configuration and animation infrastructure; the implementer then wanted to create something like demo-liveness.js with a simulated node sequence and console output; and an agent read 'do not read the project' as still permitting a hunt for DSpatch documents before going on to examine the working folder. This is the second time the same mandate has become a different task, after DSP-91 was meant to address the first. Two separate trails to follow: where the inventories came from, and where participating in the running demonstration became building one. One hypothesis to test rather than assume: whether the roles' conditional for work on DSpatch's own code was triggered merely because the person mentioned DSpatch's animations. Using the product is not by itself a commission to develop the product.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The run id and the established build and graph version are stated, with any version link that cannot be established recorded as unknown
- [x] #2 The first established deviation on each trail is given with short exact quotations and where they are found
- [x] #3 Observation, inference and what the record cannot answer are kept apart
- [x] #4 The step that actually asked for the rework is established
- [x] #5 The smallest justified correction is proposed and placed: role or skill, the graph's task or inputs, the runtime contract, or session and result binding
- [x] #6 No product code, role text or graph is changed by this investigation, and no special handling for particular words is proposed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second trial, 30 September, recorded as Addendum 2 in docs/research/dsp-98-why-the-liveness-mandate-became-a-different-task.md. Run live-2026-09-30T18-09-00-946Z, same graph and model claude-haiku-4-5, mandate verbatim, fresh throwaway folder, with DSP-99 through DSP-103 all in place. Ended coordinator to implementer to stopped on e01 and e05 after two calls and 68 seconds with RESULT: blocked, and no observed file changes. The project-reading restriction was respected by both steps, which is new: the coordinator recorded that it had not surveyed the project, and the implementer declared blocked rather than reading, saying it could not execute the loop while honouring the constraint. No step understood that it was already taking part in the run: the coordinator's prompt carried the engine sentence that the loop is running and is not something for this run to design, build or demonstrate, and its brief still said to execute a single DSpatch loop iteration and to create or trigger a loop. Given that brief the implementer's blocked is correct, so the first deviation is again the brief, at the same step as on 22 September. Registered as DSP-106; this card stays Done and the open defect lives there.
<!-- SECTION:NOTES:END -->
