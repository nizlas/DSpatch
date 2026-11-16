---
id: DSP-217
title: Code walks anchor the active step on its exact lines and read as finished after a correction
status: Review
assignee: []
created_date: '2026-11-16 15:00'
updated_date: '2026-11-16 18:00'
labels:
  - review
  - ui
  - agents
dependencies: []
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request of 16 November 2026: two corrections in code walks.

1. Visual anchoring. Mark the exact code lines the active step's explanation is about, also when the code is unchanged, with a clear frame and a discreet background that differs from the diff's red and green. Bring the step to the right code area when it opens. Line numbers in the pane heading are not enough.

2. Clean up after a walk is corrected. User text must not contain internal editing notes such as "I rewrote W3.3 to fix…"; a correction must result in one coherent, finished explanation. When a claim is withdrawn, the step's continued relevance is reconsidered: keep and rewrite the step if it still explains a verified, relevant relation; otherwise remove the step, and its pane if no other step uses it. Update affected references and navigation without losing review status for unaffected steps.

Investigate W3.3 "When args carry no normalization" concretely, checking the remaining claim against the code rather than trusting the discussion agent's defence of the step. Correct both the existing walk and the generation/revision flow that let the editing note through. Unchanged code is only included when it helps the reader understand the change, with the relevant lines clearly marked.

Governing decisions: docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md sections 7 (references lead to the code view with a clearly highlighted target), 9 (review state follows the reviewed content; changed instructions do not silently replace earlier reasoning) and 10; DSP-202 (a place's changed rows red/green, the arriving place's changed rows an amber edge); AGENT_BEHAVIOUR_AND_ORCHESTRATION.md (what agents are told is visible in their role sources); the walk loop's one correction round (DSP-189).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A place of the active step with no added or removed row has its exact lines framed and tinted, apart from red/green; a place with any change keeps only the diff marking; changes elsewhere in the file decide nothing; the pane opens with the place's lines in view
- [x] #2 The writer is told a rewrite is a finished text; an answer that speaks about its own writing is asked for once more; a second failure keeps the earlier valid text, cuts nothing, and goes to the review verdict as a finding, so the step is reworked or delivered with an objection
- [x] #3 The reviewer judges a withdrawn claim's step for continued relevance (rewrite or remove) and treats edit notes as findings; the planner removes such a step and its unused place
- [x] #4 After a replan, kept texts that name a removed or renumbered step are written again; opened and walked marks and the reading position follow a step's content to its new id
- [ ] #5 W3.3 checked against the code and the existing walk corrected (on the work computer pc54065-2316; not investigated, not corrected)
- [x] #6 Targeted tests; typecheck; the anchor seen in the app
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
State on 16 November 2026, committed with DSP-216:

Niclas's corrections the same day: the frame only where a place has no change; W3.3's walk is on the work computer and does not block the general fix; a rewrite that still has edit notes is a failed check through the existing rework flow, never cut down and shown as finished.

- Anchor (`review-model.ts` `unchangedPlace`, `ReviewTimeline.tsx`, `review.css`): per place of the active step (and the places its stop shows with it on both sides), when its range holds only context rows and marks no changed row, its exact rows in the active pane are `rv-anchor`: an amber frame (left edge as the row's shadow, carried by the sticky gutter; top, right and bottom drawn over the row) and a 10 % amber tint. A place with any added or removed row, mixed or not, keeps only the diff marking (red/green and DSP-202's amber edge on the changed rows). Changes elsewhere in the file do not count. Placing a pane centres the place's lines when they fit; a taller place shows its change, or its first line near the top.
- Rewrite as finished (`walk-loop.ts`, `walk-loop-run.ts`, role sources in `docs/loop/roles/review/`): the writer's rework prompt and role say a rewrite replaces the old text for a reader who never saw it, with no word about the earlier text, the findings or what changed, and that a withdrawn claim is replaced by what the code shows. `editNotesIn` finds paragraphs that speak about the writing (first-person editing verbs, revision labels, the reviewer or the earlier text, English and Swedish; not what the commit rewrote, not "we", not the code's old version). Such an answer is asked for once more. If the second answer still has notes, the check has failed: the earlier valid text is kept where there is one (else the step is empty), nothing is cut, and the reviewer's verdict gets a DSpatch finding about the step: an accept becomes rework on the first review and objections on the final one, so the walks are delivered with the objection on record.
- Relevance (reviewer and planner roles and prompts): a withdrawn claim makes the reviewer judge whether the corrected step still explains a verified relation that matters; if not, a structural finding removes the step, and the planner removes it with its place unless another step shows it, adjusting the neighbours' briefs. An edit note is an explanation finding. Unchanged code gets a place only when it helps understand the change, with exactly the lines explained.
- References and status: after a replan, a kept text that names a removed or renumbered step id is written again with a finding saying which. `carryStepMarks` moves opened and walked marks and the reading position to a step's new id when its content is unchanged and unambiguous, so a removal does not cost later steps their status.
- Checks: `tests/walk-loop.test.ts` (notes found and prose not; prompts; the second ask; a second failure reworked rather than accepted; earlier text kept and delivered with an objection; references rewritten after a removal), `tests/review-model.test.ts` (unchanged, changed, mixed, removed side, change elsewhere in the file; renumbered step keeps its marks and position), `tests/walk-pane-width.test.ts`: 60 pass; typecheck; build. In the app (this checkout's build, headless, isolated profile, a synthetic file with one change): a mixed place and a changed line have no frame, an unchanged place in the same file is framed and tinted, and each place's lines are in view when its step opens.
- Open (#5): the walk with W3.3 "When args carry no normalization" was shown on Niclas's Linux work computer pc54065-2316. It has not been investigated or corrected; its claim has not been checked against the code. Screenshots of it describe the problem and are not evidence about the code.
- Not tried: a real model following the new rules; the look on a real screen.
<!-- SECTION:NOTES:END -->
