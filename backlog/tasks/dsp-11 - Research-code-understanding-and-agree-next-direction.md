---
id: DSP-11
title: Understand review needs from Phase 0
status: To Do
assignee: []
created_date: '2026-09-14'
updated_date: '2026-09-14 20:13'
labels:
  - ux
milestone: m-1
dependencies:
  - DSP-6
documentation:
  - docs/VISION.md
  - docs/REVIEW_RESEARCH.md
  - BACKLOG.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

The working Phase 0 application gives us real experience to guide the next product direction. Before selecting advanced review features, identify where Niclas loses context, struggles to explain a change or cannot judge the evidence. The five concept seeds are possible responses, not a substitute for understanding the need.

### Scope

Use DSP-5/DSP-6 findings and a short walkthrough with Niclas on an identified build. Capture concrete code-understanding questions, navigation difficulties and uncertainty about tests or agent explanations. Separate his observations from agent hypotheses and describe the small sample honestly. Reuse existing feedback where it answers the question; prepare only the missing observations.

Provide a concise needs brief and representative comparison tasks for DSP-14. This story does not select or implement a new review interaction. The independent tool and research surveys in DSP-12 and DSP-13 may proceed after DSP-6 without waiting for this human walkthrough.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Phase 0 feedback is consolidated with source/build references and distinguishes direct user observations from agent hypotheses.
- [ ] #2 Niclas has assessed the remaining review/navigation questions in a bounded walkthrough, or existing recorded feedback explicitly covers them; unresolved questions are labelled.
- [ ] #3 A small set of representative code-change tasks and baseline observations is available for comparing future interactions, including how understanding, orientation and uncertainty will be assessed.
- [ ] #4 The needs brief records its sample and scope limitations and does not treat the five concept seeds as selected features.
- [ ] #5 The DSP-12 and DSP-13 documents are re-checked against Niclas's DSP-6 AC#3 feedback before DSP-14 consumes them, and any conclusion the new feedback changes is corrected in place rather than left standing.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Criterion #5 was added on 15 September 2026 by Reviewer call 011 of run `20260915-174013-p6qd`, finding F7, and it records a judgement rather than a fault to repair.

**Both surveys ran ahead of this dependency.** DSP-12 and DSP-13 were executed on 15 September, in parallel with the work on DSP-6, at Niclas's own suggestion. Both depend on DSP-6, and the substance of that dependency is that they should be grounded in real use — DSP-6 AC#3, his own assessment of Phase 0, was outstanding when they ran and still is. The bookkeeping was done properly and roughly 2,400 lines of documents exist, so nothing was lost.

What makes it worth a criterion rather than a note is how feedback-sensitive that grounding turned out to be. The DSP-12 researcher states that it re-weighted its entire gallery on DSP-5's trial findings: Niclas read a complete diff without reporting difficulty, and what he did report was orientation and state, so the survey leans toward return-to-position rather than better diffs. His AC#3 assessment is a second and larger tranche of evidence of exactly that kind. Two large documents should not be treated as settled input to DSP-14 before it has been read against them.

**Also carried here**, from the same review: the composer's distance from the restored panel is an orientation problem DSP-6 described accurately rather than solved — measured at 1265 and 1584 pixels below the panel, off screen at rest. That is this task's material, not a reopening of DSP-6.

### DSP-6 AC#3 feedback, 16 September 2026 — Niclas, not an inference

He closed Phase 0 as a **functional test**. In his words: the design of where things should be found in menus and the like needs a great deal of iteration; it feels like one big debug window. He will not re-walk packaged identity `a75ae56759fc9cad`. The assessed walkthrough remains the 15 September trial on `b4a87678dd5203cd`.

Criterion #5 now has that feedback to read DSP-12 and DSP-13 against. Do not treat “he read a complete diff without reporting difficulty” as the last word on orientation: he has now said the whole window is a debug surface and that findability in menus is the unfinished design work. That is a user observation. It does not select a review concept and it does not start an IA rewrite from this card.
<!-- SECTION:NOTES:END -->
