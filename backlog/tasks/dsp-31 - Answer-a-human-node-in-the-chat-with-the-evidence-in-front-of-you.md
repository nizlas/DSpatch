---
id: DSP-31
title: 'Answer a human node in the chat, with the evidence in front of you'
status: To Do
assignee: []
created_date: '2026-09-17 19:44'
labels: []
dependencies:
  - DSP-30
  - DSP-43
priority: high
type: feature
ordinal: 15600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

The graph format has a human node and nothing has ever stopped at one. It is the piece that turns a loop from something a person launches into something a person takes part in, and it is the only place in the design where DSpatch asks rather than reports.

Asking well is harder than it looks. A question with no evidence beside it is an invitation to rubber-stamp, and a rubber-stamped approval is worse than no approval at all: it launders an agent's judgement as a human decision. So the node must bring its evidence with it — what was decided or produced before, what the declared choices are, and why the answer is needed.

### The two mistakes to design against

**An ordinary message must not be counted as consent.** A person looking at a waiting question and typing a thought about it has not answered it. If DSpatch cannot tell discussion from decision, the user learns to stop talking, which is the opposite of the product.

**A loop can return to the same node.** An answer belongs to one run and one visit. Reusing an earlier answer for a later decision would be DSpatch inventing a human judgement that nobody made.

### Relationship to DSP-18 and DSP-28

This is the human half of DSP-18 criterion #4. The graph view marking the node as waiting belongs to DSP-28's live graph, reusing it rather than building a second highlight.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the graph reaches a human node the window shows which decision or information is needed and why, together with the relevant results and evidence from the preceding work, and presents any declared choices understandably.
- [ ] #2 The user can answer through the ordinary chat surface or through clear controls beside the question, and the corresponding node is marked as waiting in the graph view.
- [ ] #3 The answer is saved and bound to the right run and the right visit to that node before the run continues, so a loop that returns to the same node never reuses an earlier answer for a new decision.
- [ ] #4 An ordinary chat message is not accidentally counted as approval, and it is apparent when the user is answering the waiting question and when they are only discussing the evidence.
- [ ] #5 The mandate typed in the composer is the answer to the loop's opening human step, recorded against that step and that visit, and declining to start is recorded as a decision rather than as an absence.
<!-- AC:END -->
