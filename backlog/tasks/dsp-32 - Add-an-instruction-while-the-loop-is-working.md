---
id: DSP-32
title: Add an instruction while the loop is working
status: To Do
assignee: []
created_date: '2026-09-17 19:44'
labels: []
dependencies:
  - DSP-30
  - DSP-53
priority: medium
type: feature
ordinal: 15700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Watching an agent work and realising it has misunderstood something is a common experience, and today the only responses DSpatch offers are to let it finish or to cancel it. A person should be able to say *also consider this* without destroying the work in flight.

### The promise this story must not make

It must not claim to change a provider call that is already running. DSpatch does not control what happens inside a turn once it has been sent, and a product that implied otherwise would be lying at the moment the user most needs to trust it. For this delivery it is enough that the instruction is taken up at the next safe handover.

So the visible sequence is: received, not yet applied — then, later, the step that got it. Both halves matter. Saying only the first leaves the user wondering whether it was ever used; saying only the second hides the delay they can see with their own eyes.

### The hazard

A message typed during a run must not start a competing run in the same working copy. Two agents writing the same files is the one failure this project cannot recover from cleanly, and the guard belongs here rather than in a reviewer's comment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The user can supply further context or a correction while the loop is working, and it is taken up at the next safe handover rather than being promised to a provider call already in progress.
- [ ] #2 The window shows that the instruction has been received but not yet applied, and afterwards which coming step received it.
- [ ] #3 The instruction and how it was handled are saved in the run history.
- [ ] #4 A message sent during a run never starts a competing run in the same working copy.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Blocked in practice by DSP-53: Send is disabled for the whole of a loop run, so this story cannot be tried until the composer stays usable. The interaction model (§3, §4.4) is the governing description of what the message means once it can be sent.
<!-- SECTION:NOTES:END -->


## Revised against INTERACTION_MODEL v1.2

<!-- SECTION:NOTES:BEGIN -->
Criterion #1 says the instruction is taken up "at the next safe handover". §4.4 is now wider and the card must not be read as narrower than it: an instruction can reach the next handover **or the same agent when its interrupted step is continued**, and "always the next agent" must not become a product rule. What matters is the distinction between **received** and **delivered to the agent**, and never implying an agent already working has been told something it has not.

Where the provider genuinely cannot deliver to an agent mid-step, establish that for our actual integration and report it as a limitation rather than assuming it holds universally.
<!-- SECTION:NOTES:END -->
