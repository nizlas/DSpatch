---
id: DSP-171
title: Make the review discussion's answers easier to read
status: In Progress
assignee: []
created_date: '2026-11-04 10:40'
updated_date: '2026-11-04 11:10'
labels:
  - ui
  - review
dependencies: []
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 4 November 2026. The answers already have paragraphs, lists and code, and still read as a dense wall of text, in the docked panel and in the discussion's own window. Body line height about 1.5; clear space between paragraphs and between separate list items while nested lists still read as one; a prose measure of about 75-85 characters in wide windows, while a narrow panel uses its width without large margins; each question told from its answer, and exchanges from one another, with space and quiet marks; inline code toned down to monospace on a subtle background with no visible border around every identifier; code blocks kept as clear surfaces of their own whose long lines scroll inside the block; Show more, The code it rests on and Explain more simply gathered in one quiet row of actions, with room above it, that wraps well; colour used sparingly for questions, links and any accent, meaning never carried by colour alone, contrast good. A presentation change: the answers' content, references and functions stay; no rewriting, no invented headings, no folding of earlier answers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Body text in the discussion has a line height of about 1.5, clear space between paragraphs and between separate list items, and nested lists that still read as one
- [ ] #2 Prose keeps a measure of about 75-85 characters in a wide window; a narrow docked panel uses its width
- [ ] #3 A question is told from its answer and exchanges from one another by space and quiet marks, not by colour alone
- [ ] #4 Inline code is monospace on a subtle background without a border around each identifier; code blocks are surfaces of their own that scroll long lines inside the block
- [ ] #5 Show more, The code it rests on and Explain more simply sit in one quiet action row with room above it, wrapping well
- [ ] #6 Judged in real windows with one content-rich example, docked narrow and in a wide window of its own, at more than one zoom level, with before and after of the same content
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (4 November 2026): the discussion's styles in review.css and the shared markdown rules in styles.css; before and after shots of one content-rich example.

Result (4 November 2026). `src/renderer/review.css`, one section scoped to `.rv-discussion` (the docked panel and the discussion's own window are the same page): the thread's gap 1.5rem with a faint rule between exchanges; each question on a surface of its own (a 4 % tint of the text colour, a 3 px muted bar, rounded) at 1.5 lines; answers at 1.5 lines; 0.85rem between paragraphs, 0.4rem between list items, a nested list 0.25rem from its item with 0.2rem between its own items; the measure the panel already kept (78 characters on paragraphs, items and the question text) left as it was, since a narrow docked panel is narrower than that and so uses its width; inline code without a border, on a 9 % tint at 0.88em; code blocks on a 5 % tint with 6 px corners, long lines scrolling inside the block; the details block behind a muted bar. `src/renderer/DiscussionAnswer.tsx`: *Explain more simply* moved into the row that holds *Show more* and *The code it rests on* (`ShortThenMore` takes `actions`), the row 0.8rem under the text, in the body face, muted and underlined, wrapping when narrow; the `data-ev` names are unchanged (`answer-simpler`, `answer-show-more`, `answer-show-code`), so the scripted review flow still finds them. Nothing of the answers' text, references or actions changed; the chat window's answers are untouched, their `.markdown` rules in styles.css apply there as before.

Judged in real windows: one recorded discussion of three exchanges (long identifiers, paragraphs, nested bullet and numbered lists, a table, two code blocks, details and references; the picture Niclas mentioned did not reach me, so the example is my own, written into the pair's discussion record on an isolated profile) photographed before and after at the same content, window size and level: the discussion's own window at 1180×860 at levels 0 and 2, and the panel docked in a 1500×900 review window at 0 and −1, with the second answer's Show more and The code it rests on open in one pair. The before/after pairs are composed side by side in the session's scratchpad (`wheel-trial/evidence/compare`) and were sent with the report. Limits: my judgement of the look, not Niclas's; the Step tab's explanations (`.rv-explanation`, `.rv-deepening`) and the chat window keep their earlier rules, which is a question for him.
<!-- SECTION:NOTES:END -->
