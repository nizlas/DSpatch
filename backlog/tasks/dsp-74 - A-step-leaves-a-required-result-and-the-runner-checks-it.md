---
id: DSP-74
title: 'A step leaves a required result, and the runner checks it'
status: Review
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-20 13:32'
labels: []
dependencies:
  - DSP-70
priority: high
type: feature
ordinal: 15706
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
General support for results and handovers, with no development-loop specifics, and most of it already exists. ArchivePolicy.path, ReportPolicy.writtenBy, archivePlacement(), StepContext.archive, StepExecution.archiveRef and the runId/occurrence/callId binding are all present and computed - the live executor simply ignores context.archive, and the dry-run executor already prints what a real run would file. So the gap is behaviour, not design. Add one field, produces, saying whether a result is required and in what form, because archive and report say where and who but never whether. Add one runtime fault kind, required-result-missing, distinct from no-outcome-delivered so the reconcile sentence can name which result was required and who was to file it. One canonical body stored once: the file is canonical for a markdown form and the run record for a stored form, with archiveRef pointing at it and the chat rendering from the reply the record already holds, so nothing is written twice. A graph that sets none of this behaves exactly as today - a simple loop must work without the full report package, satisfied by the fields being optional rather than by a second code path. Note for whoever builds it: a missing result must NOT be modelled as an edge. RUNTIME_FAULT_PHRASES refuses failure kinds named missing-report, no-report, no-result and not-delivered, and that refusal is right - an edge would route onward, and a missing report is exactly when nobody should.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A node with a required result that leaves nothing stops the run as a reconcilable fault naming the expected path and the responsible node.
- [ ] #2 A read-only node's result is filed by the runner.
- [ ] #3 A graph setting none of this behaves exactly as today.
- [ ] #4 No report body is written twice.
- [ ] #5 The result is retrievable from the run record by run, node and visit.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, calls 013 and 015. A node can declare produces { required, form, note }; the runner files the result, checks presence and provenance, binds it to run/node/visit/call, and journals result-filed.

THE PLANNER WAS RIGHT AND BY A WIDER MARGIN THAN EXPECTED: archive, report.writtenBy, archivePlacement, StepContext.archive and the runId/occurrence/callId binding all already existed and were computed and dropped. The live executor never looked at context.archive, and nothing anywhere could say a result was REQUIRED. Two node fields and one runtime-fault kind closed both cards.

WHERE THE PLANNER WAS WRONG, and it is a gap rather than an error: it assumed the runner could write. It cannot - loop-run.ts imports no Node, and that is load-bearing, because it is what makes the dry-run executor STRUCTURALLY unable to reach a disk rather than promised not to. Filing is therefore an injected port. Consequence: a run given nowhere to file, whose graph requires results, is REFUSED BEFORE IT STARTS. The alternative was a run reaching a terminal with completed and every check unperformed - the exact silence this card exists to end, produced by the machinery built to end it.

A MISSING REQUIRED RESULT TAKES NO EDGE. The Verifier confirmed in the implementation, not the test: the fault returns before decideNextStep is reached, so edge selection is downstream code that never executes. It is a distinct kind from no-outcome-delivered, because a step that produced a routable success and left no evidence is the more dangerous case. The sentence tells the reader the two possibilities need different answers and that the step's own outcome cannot tell them apart.

THE LINE IS HELD: nothing opens, parses, measures or branches on a result's content. The single exception is an all-whitespace check, which is presence and not quality, now symmetric across runner-filed and self-filed with one shared function and one sentence.

Path containment: absolute paths, drive letters and .. are REFUSED, not normalised. The Verifier widened the escape set to twelve shapes including UNC, drive-relative and root-relative, all refused, with nothing landing beside the run folder on disk.

Verified in report 014 (PASS WITH FINDINGS); all six findings closed. Candidate sha256:9b2ed51c. 841 fast, 57 live, 147 heavy, 0 fail.

STILL OPEN: no shipped graph declares produces or consumes yet - that is DSP-79, and the first real graph will find what fixtures cannot. Results are not durable across a restart. The store is synchronous. resultRoot is documented and unimplemented. Symlinks are not considered by the path check - unmeasured, not an observed hole, noted on DSP-77.
<!-- SECTION:NOTES:END -->

## Premise loosened, 20 September 2026

<!-- SECTION:NOTES:BEGIN -->
Niclas has clarified two things that bear directly on this card, before it is started.

**A result's content is not the same thing as a report file.** The content is what the next step needs; the file is a *transport*, needed only when the loop definition explicitly asks for one. So the default for a simple task is **no file at all** â€” avoid double-writing and avoid a mandatory report package. `produces.form` should make "no file" the ordinary case rather than an opt-out.

**`produces` and `consumes` are not locked as the only permitted new fields.** That was my question to the planner and he has declined to answer it yet, because a node may also be a **subloop**, and invoking one and returning its result may need vocabulary we have not thought of. Keep the first implementation small, reuse what exists â€” but do not undersize the field to honour a constraint that has been lifted.
<!-- SECTION:NOTES:END -->

## Reshaped before starting, 20 September 2026 â€” the time-critical edit

<!-- SECTION:NOTES:BEGIN -->
**The record is canonical; a file is an optional export.** The earlier note in this card had a `form` enum with a markdown file as one canonical shape. That is now inverted, because Niclas separated a result's content from the file as a transport:

    produces: { required: boolean, alsoWriteFile?: boolean, note?: string }

`archive` and `report` stop being *the result mechanism* and become *the file-export policy*, which is what they should always have been. A simple task writes no file at all. This is a smaller change than the enum, not a larger one.

**Do not assume a run id is top-level.** Criterion 5 makes a result retrievable by run, node and visit. A subloop's child run has an id of the form `<parentRunId>/<NNN>-<nodeId>`, so that addressing must keep working for a child run id â€” which also lets `required-result-missing` name which child run was missing its result.
<!-- SECTION:NOTES:END -->
