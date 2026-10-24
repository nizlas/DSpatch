---
id: DSP-67
title: The composer takes 171 px from the conversation the moment you send
status: To Do
assignee: []
created_date: '2026-09-19 22:06'
updated_date: '2026-10-24 17:55'
labels: []
dependencies:
  - DSP-60
priority: medium
type: feature
ordinal: 15624
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while fixing DSP-66, and deliberately not touched there. At the moment a send goes out the composer grows from 123 px to 262 px and the thread pays for all of it, dropping its viewport from 572 px to 401 px. Of that, 132 px is the 'this send needs acknowledgement / Send anyway' block, which appears for the whole of every turn in a scratch project, and 7 px is the control row wrapping. The scroll follow now copes with the shrink, so this is no longer a correctness problem - it is a question about what belongs on screen while a reply streams. A block a third the height of the conversation, present for every turn, is a lot of the window spent on something the reader has usually already accepted. INTERACTION_MODEL section 9 asks for the conversation to have the main space and for what a person may have to act on to stay visible; those two pull in opposite directions here and the balance is a product judgement rather than an implementation choice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The acknowledgement block does not take a third of the conversation's height for the whole of every turn.
- [ ] #2 What a person actually has to act on remains visible.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
24 Oct 2026 (DSP-121 flow, run 20261024-070000-dsp121-flow, Reviewer 008 F1): the resume panel and the new-session block live under the thread, and .conversation has min-height: 0 while the transcript has min-height: 4rem (styles.css ~:738-760), so whenever the controls under the thread need more height than the window has, the transcript's minimum overflows onto the composer. Measured at 706 x 837: thread 194 px at rest, 296 px with the new-session block, 71 px with its summary open (bounded to min(12rem, 15vh)). Estimated thresholds at 700 px wide: the thread reaches its minimum at roughly 828 px inner height with the summary open and ~707 px at rest. Cheapest relief: the summary's envelope note inside the bounded region. The structural question - what belongs under the thread - is this card's.
<!-- SECTION:NOTES:END -->
