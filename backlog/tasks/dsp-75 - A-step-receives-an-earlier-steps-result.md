---
id: DSP-75
title: A step receives an earlier step's result
status: Review
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-20 13:32'
labels: []
dependencies:
  - DSP-74
priority: high
type: feature
ordinal: 15707
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The one genuine gap in the model. Today edges carry control flow and nothing else, so the Verifier receives the Implementer's report and the work version to be checked is not expressible at all. Add consumes on a node: a list of node ids, resolved to the most recent completed visit of each within the run, and made part of what the step is given. Two new fields in total across this and the required-result card, and the shape should stop there - no report-format or quality schema, because judging the work is the appointed agent's or the human's and checking that a result exists and belongs to the right step is the runner's.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A verifier node consuming an implementer node receives that reference, observable in the record.
- [ ] #2 Consuming a node that has not run in this visit's history is a validation error, not an empty input.
- [ ] #3 A second visit consumes the second result, not the first.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, calls 013 and 015. A node declares consumes [nodeId]; the runner resolves each through latestResultOf and hands the result to the step.

BINDING IS TO A VISIT, NOT A NODE. A loop can return to the same node, and an old result must not reach a new visit - the same trap DSP-31 named for human answers, where a stale answer and a fresh one look identical. The test drives a loop that goes round: worker files, the checker sends it back, worker files again, and the second checker must receive the SECOND attempt at occurrence 2. The Verifier confirmed the test discriminates - at the moment of reading there are two worker entries, so a first-match-by-node implementation fails it - and hardened it further by handing latestResultOf a deliberately out-of-order array, proving resolution is by occurrence rather than by array position.

A STEP WHOSE CONSUMES CANNOT BE SATISFIED IS NOT STARTED AT ALL. A step given an empty report would do its work about nothing and report it as done, which is the expensive shape of this mistake.

ONE BODY, ONE STRING, structurally rather than carefully. For a runner-filed result the executor's one string is what the store writes and what the record holds. For a self-filed result the runner READS THE FILE BACK; the Verifier checked the branch rather than the comment and confirmed execution.resultBody is never consulted there, and that the live executor sets it to undefined whenever the node files its own. A received markdown-file result travels to the next step as a path to read, not as quoted text, because a pasted body is a second copy that can disagree.

Validation refuses before a run what it can know: self-consumption, unknown nodes, a node that declares no result, and a node no path runs first. It deliberately does not claim to know what a particular run will do, since a rework edge legitimately hands a result backwards.

Verified in report 014. Candidate sha256:9b2ed51c.
<!-- SECTION:NOTES:END -->

## Premise loosened, 20 September 2026

<!-- SECTION:NOTES:BEGIN -->
`consumes` should carry the **content** a step needs, not a path to a file. A file is a transport and is required only when the definition asks for one. See DSP-74's note.

And a subloop may be a producer and a consumer too, so the shape of this field should be settled together with nested orchestration rather than ahead of it.
<!-- SECTION:NOTES:END -->

## One line to add before starting, 20 September 2026

<!-- SECTION:NOTES:BEGIN -->
**`consumes` on a terminal node is legal, and it means what the run returns.**

Worth stating explicitly because the opposite is the natural rule for someone to write: terminals declare no outcomes, run no work and have no outgoing edges, so refusing inputs looks consistent. If that rule is written, nested orchestration has to undo it and reopen the format question â€” and a terminal receiving a result is how a child run returns something to its parent **without a fourth field**.

Two more boundaries. Resolution is **within the current run only**, and `consumes` must never reach inside a child run: a parent may consume what a subloop returned, never a node within it, or the child stops being substitutable, which is the one property that makes nesting worth having. And the payload is **content plus metadata** â€” which run, node, visit, and the work version the result concerns â€” rather than a path.
<!-- SECTION:NOTES:END -->
