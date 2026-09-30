---
id: DSP-99
title: Tell the step that judges the work what the run actually changed
status: Review
assignee: []
created_date: '2026-09-22 20:12'
updated_date: '2026-09-22 20:46'
labels:
  - loop runtime
dependencies: []
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From DSP-98. In run chat-loop-2026-09-22T19-50-58-359Z the reviewer reported BUGS_INVENTORY.md and PERSON_NAMES_INVENTORY.md as the implementer's delivery. Those files were uncommitted leftovers of the runs on 20 and 21 September against the same working folder, present in the baseline snapshot before this run began. The reviewer had no dishonest step in its reasoning: it read the filed result, found it thin, ran git status and git diff, and took what it saw to be the delivery. DSpatch already knew better. The runner computes the snapshot delta on every step and writes it into the journal as 'Snapshot <before> to <after>. Changed: none.' The journal is not in anyone's prompt. A step asked to judge what was delivered should be handed the run's own account of what changed, so it does not have to infer delivery from a working folder that holds other runs' uncommitted work. This is about giving a step a fact the run already has, not about restricting what a reviewer may read or making the delta the only evidence: a reviewer may still read the code, and should be able to see when the run's account and the working copy disagree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A step whose message is assembled for judging delivered work is given the run's own account of what changed, taken from the same computation that writes the journal line, not a second one that can disagree with it
- [x] #2 The account distinguishes a run that changed nothing from a run whose changes are unknown, and says which it is
- [x] #3 The addition is visible where the node's brief is shown, so a reader can see it is carried without reading the prompt builder
- [x] #4 A run that changes nothing still produces a usable account rather than an empty section
- [x] #5 Checks cover the wording and its presence for the reviewing step, and its absence where it does not belong
- [x] #6 The account states the extent of the comparison and the times of both observations, so a reader cannot over-read a bare verdict
- [x] #7 Changes already present in the working folder before the run are not attributed to the run
- [x] #8 The wording does not attribute an observed difference to the agent, since other work can run in the same folder at the same time
- [x] #9 The wording does not let unchanged content read as evidence that nothing was read or that the task was not performed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in app/src/shared/loop-chat.ts and app/src/main/loop-live.ts. A step that consumes an earlier step's result now receives the run's own before-and-after measurement of the working folders, appended beside the received results so the head's promise and the message's content stay one decision. Which steps get it is read off the drawing's consumes rather than any node id, which on the runnable loop means the implementer, researcher, verifier, reviewer and report step, and not the entry coordinator or the terminals. RunChangeAccount is a tagged type with not-measured and measured variants, because an unhashed run produces empty file lists that would otherwise be indistinguishable from a run that changed nothing. The not-measured branch opens by saying it is not the same as nothing and carries the run's own reason. The measured branch was reworded after Niclas's correction: the subject is the folders between two observed moments rather than the run, the figure reads N files differ rather than N files changed, and the refusal to attribute sits at the figure, since a difference between two observations does not establish who made it when other work may run in the same folder. The negative claim survives, because the measurement bounds it in that direction. Both observation instants are printed from LiveSnapshotRef.takenAtUtc alongside the snapshot identities, with the second labelled as the most recently finished step rather than the run's end. The standing note says the measurement covers these folders only, includes anything else that wrote there, is evidence rather than a limit on reading, is good for ruling work out rather than crediting it, and that unchanged content is not evidence that nothing was read or that the task was not done. Disagreement between the account and the working copy is asked for as a finding rather than designed away. One real defect was found on handover and returned: npm run test:live failed on the implementer's own assertion, which compared the run's final observation against a message built one step earlier. Instrumented evidence showed the message carries the instant the record held when it was built, so the test was wrong and the plumbing correct; a sibling test was passing only because two walks landed in the same millisecond and had the same fix. Coordinator re-ran npm run test:live exit 0 and npm run typecheck exit 0 after the handover. No provider call, no snapshot policy change, no packaging.
<!-- SECTION:NOTES:END -->
