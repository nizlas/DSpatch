---
id: DSP-102
title: >-
  A step that must declare an outcome should not pass as success by not
  declaring one
status: Review
assignee: []
created_date: '2026-09-22 20:18'
updated_date: '2026-09-23 05:43'
labels:
  - loop runtime
dependencies: []
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From DSP-98, point four of Niclas's correction, kept deliberately separate from the transfer fixes. In run chat-loop-2026-09-22T19-50-58-359Z the implementer was offered RESULT: blocked and asked a question instead; the verifier was offered RESULT: blocked, wrote BLOCKED in bold prose, and never put it on the line it was asked for. Both were routed as success, and by the time the reviewer ran, two non-results had been filed as results. Establish first which nodes actually require an explicit outcome and which deliberately allow an ordinary reply, since the loop has both on purpose. Where a declaration is mandatory, its absence must not become success. If the present contract cannot express that difference, come back with a short proposal before changing the general routing rather than changing it and reporting afterwards. Two things are excluded by name: no searching free prose for the word blocked or any other token, and no model judging what a reply meant. Any new failure path must be coordinated with DSP-97, which is the open question about what the loop says when work was accepted and the run could not report on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Which nodes require an explicit outcome and which deliberately allow an ordinary reply is established from the graph and stated
- [x] #2 Where a declaration is mandatory, a reply that makes none does not route as success
- [x] #3 If the present contract cannot express the difference, a short proposal is returned before the general routing is changed
- [x] #4 No free-prose token matching and no model judging the meaning of a reply is introduced
- [x] #5 Any new failure path is reconciled with DSP-97 rather than deciding that question silently
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Approved by Niclas on 23 September for coordinator, implementer and verifier in the scope reported. The approval is retrospective and the earlier decision point was passed without it: the card required a short proposal before the general routing was changed, and what he was given at the time was a three-option question rather than the proposal's substance, its costs and its refusals, after which the change was built and packaged in build 7f55597e147a4455. The written proposal was delivered afterwards, on 23 September, and the approval follows it. Recorded here so the sequence is not lost: the change is sound, the governance was not. For the record the general routing code was never changed; loop-run.ts and loop-chat.ts carry no DSP-102 behaviour change, only a corrected rationale comment in carriesRunChange, and what changed is the bundled loop's node contracts and the stopped terminal's purpose text.
<!-- SECTION:NOTES:END -->
