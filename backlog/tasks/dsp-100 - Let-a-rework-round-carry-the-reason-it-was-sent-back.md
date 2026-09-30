---
id: DSP-100
title: Let a rework round carry the reason it was sent back
status: Review
assignee: []
created_date: '2026-09-22 20:13'
updated_date: '2026-09-22 21:14'
labels:
  - loop graph
dependencies: []
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From DSP-98. When implementation-review returned RESULT: rework on edge e12, the implementer was re-prompted with the coordinator's original brief and nothing from the reviewer, because the implementer node declares consumes: [coordinator] and received is built strictly from that static list regardless of which edge arrived. The mandate is also suppressed on a revisit. The implementer, handed back its own unanswered question with no new information, treated the re-prompt itself as the answer, wrote 'I understand the clarification' and then narrowed the limit on its own. Two places in the repository already assert the behaviour we do not have. The runnable graph's implementer node says it is 'told what the review said, rather than a stranger handed a second attempt at someone else's work', and the comment on the precedence constant reasons from 'the rework round is exactly where a reviewer's account of the assignment arrives and the original does not'. In this graph neither arrives. What a step receives should be able to depend on the edge that brought it there. A sensible shape is for an edge to be able to say what it delivers, falling back to the node's consumes when it says nothing, so existing graphs keep their behaviour; decide that within the task if a better shape presents itself in the code. This is not about the rework case alone, but the rework case is where its absence does damage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 What a step receives can depend on the edge that brought the run to it, with a node's existing declaration continuing to apply unchanged where the edge says nothing
- [x] #2 The runnable graph's rework edge delivers the review's result to the implementer, and the node's own note is true of the graph once it does
- [x] #3 The missing-result check still stops a run whose path cannot supply a declared input, with a message naming the edge where that is what went wrong
- [x] #4 The editor shows what a step receives in a way that stays true when it depends on the edge
- [x] #5 Checks cover a rework round receiving the review, a first visit receiving the brief, and a graph that declares nothing per edge behaving as before
- [x] #6 The research step receives the implementer's actual question, and the implementer receives the research answer when the work resumes, coordinated with DSP-95 rather than implemented twice
- [x] #7 The choice of inputs is explicit in the graph and visible in the existing node inspection, without hardcoded role names and without handing every step the whole history
- [x] #8 An input is bound to the right run, the right producing node and the right visit, so a later rework cannot receive an older review result
- [x] #9 A first visit is not made to require a result that cannot exist yet
- [x] #10 The original assignment and the user's later corrections survive a revisit, and returning to a node is not by itself treated as an answer to an unanswered question
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. LoopEdge gains an optional delivers, a list of node ids that replaces the target node's consumes for that arrival only; an edge that says nothing leaves the node's own list deciding, so existing graphs behave identically, and an empty list is the statement that this arrival hands over nothing. The rule is one pure function, inputsFor(node, arrival), in app/src/shared/loop-run.ts. Replacement rather than addition is what keeps a first visit from being asked for a result no step has produced: an arrival is a point in the walk and can require what is true at that point, so that criterion is structural rather than a special case. Binding: latestResultOf is replaced by resultHandedOver, keyed on run, node and occurrence, with the runner tracking which visit of the source produced the outcome that routed the run here. Where an edge delivers its own source that visit is pinned, so a third rework round cannot receive the first review; anything else resolves to the most recent completed visit, which is what a standing list has always meant. required-result-missing now carries the edge id and sends the reader to the edge where that is where the promise was made. checkResultFlow asks of each delivered id the same questions consumes is asked but about the edge's source, since asking about the target would pass a drawing that reaches the target by another route. The runnable graph declares delivers on e12, e03 and e06 with notes. Visibility: the node inspector takes every incoming edge, so the received section reads as route-dependent and names each arrival; the edge inspector gained a delivers field. carriesRunChange from DSP-99 was corrected in passing, since it asked consumes alone and would have denied the run's measurement to a step handed a review only by its rework edge. The mandate now returns on a revisit, reversing DSP-79's suppression, argued from TASK_PRECEDENCE rather than from the incident alone and framed as repeated unchanged rather than as a new assignment; DSP-79's notes record the reversal. Every revisit is also told that returning is not itself an answer to a question it asked. Implementer ran typecheck, test:loop, test:live, test:chat, test:presentation and the whole suite, all exit 0, plus a dry run of the runnable graph and a byte-identical serialiser round trip. Coordinator re-ran npm test after handover, 49 files, exit 0. Open and deliberately not decided: the edge inspector's text field cannot express an empty delivers, which is a three-state value in a two-state control and needs a UX choice; and delivers is unpinned for a node other than the arrival's own source, which matches the rule consumes has always had and which nothing in the drawing yet needs.
<!-- SECTION:NOTES:END -->
