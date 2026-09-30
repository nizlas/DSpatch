---
id: DSP-101
title: Let the loop take an assignment whose result is not a change to the project
status: Review
assignee: []
created_date: '2026-09-22 20:18'
updated_date: '2026-09-22 21:32'
labels:
  - loop graph roles
dependencies: []
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From DSP-98, point three of Niclas's correction. The bundled loop assumes every assignment ends in changed project code. The coordinator node asks for 'the bounded change, what is deliberately outside it, and what would count as done'; the implementer node asks for 'what you changed and why'. Given a mandate to walk the graph and change nothing, the coordinator briefed 'Create a temporary test scenario that demonstrates the liveness animation sequence in the MiniDAWLab project', and the meaning of the task was lost at that first step. The graph offered no shape of brief for a run that correctly produces nothing. The loop must be able to carry out and review an assignment whose result is an answer, a calculation, an analysis or a completed activity, with no change to the project. Keep concrete development requirements where the assignment really is development; this is not an invitation to soften the loop generally. Make references to DSpatch's own development unambiguous: that a person uses or tests DSpatch is not a commission to develop DSpatch. That conflation is what the reviewer acted on when it went from 'this concerns the DSpatch loop engine' to 'DSpatch artefacts must therefore be built'. Two things not to do. A result Maestro stores as Markdown does not mean the agent should create a file in the project; do not change the storage format merely because an assignment has no code change. And no special handling for demonstrations, liveness or any other category of request: Maestro gets no hidden methodology.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The bundled graph's node purposes and result descriptions accommodate an assignment whose result is an answer, an analysis or a completed activity, without presuming a change to the project
- [x] #2 Concrete development requirements remain where the assignment concerns development
- [x] #3 Role text distinguishes working on DSpatch's own code from a person using or testing DSpatch, so the second does not read as a commission to do the first
- [x] #4 A result stored as Markdown is not described in a way that asks the agent to create a file in the project, and the storage format is unchanged
- [x] #5 The effect on the shared role sources and the generated Cursor agents is examined, with any deliberate change to the external development flow reported rather than arriving as a side effect
- [x] #6 No special handling is introduced for any category of request
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented entirely in text: no runtime branch was added or altered, and the only code change is a test. The runnable graph's purpose, five node purposes, four produces notes and two terminal purposes now ask for the bounded piece of work and name a change as one kind of it. The coordinator is told not to convert an answer, a calculation, an analysis or a completed activity into a change so that it has a familiar shape, which is the exact move that lost the assignment on 22 September. The implementer is told that leaving the folders as it found them is a finished step rather than a skipped one, and the reviewer that unchanged working folders are the assignment honoured rather than a delivery that is missing, which is the other half of DSP-99. Development requirements were made conditional and never removed, and one is now stronger: where the work was a change to the code, the commands and their exit codes are not optional and an account without them is not one. DSP-96's conditional now says DSpatch's own code rather than this project's own, closing the pronoun collision DSP-98 documented between the role's 'this project' and the message's 'the project'. Four roles gained a paragraph saying that exercising, testing or recording the product does not make DSpatch the thing being worked on, the reviewer's worded against the move it actually made. The exemption paragraph that invited the document hunt now says naming what you could not use is not licence to go looking for it. Storage is untouched: every producing step still declares markdown-file, and report.writtenBy names the coordinator so the sentence naming a path is never sent, which was true and untested and is now pinned with a negative control. Nothing recognises a demonstration, a liveness run or any other category, and the graph note says so. All five shared role sources changed, so all five generated Cursor agents were regenerated; the generator reported every file as generated and unchanged since, so nothing hand-edited was overwritten. This is a deliberate change to the external development flow, not a side effect. Implementer ran typecheck, test:loop 537 tests, test:live 68 tests, roles:generate compare then write, and a dry run of the runnable graph reaching delivered, all as expected. Coordinator re-ran the whole suite after handover, 49 files, exit 0. Open: the run coordinator role carries the new briefing rule with no automated check, since nothing asserts on that file's prose; a real run is what tests it.
<!-- SECTION:NOTES:END -->
