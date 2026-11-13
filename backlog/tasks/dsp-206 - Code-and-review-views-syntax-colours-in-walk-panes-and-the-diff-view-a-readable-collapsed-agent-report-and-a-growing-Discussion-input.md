---
id: DSP-206
title: >-
  Code and review views: syntax colours in walk panes and the diff view, a
  readable collapsed agent report, and a growing Discussion input
status: In Progress
assignee: []
created_date: '2026-11-13 10:10'
labels:
  - review
  - ui
dependencies: []
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas asked for three improvements of DSpatch's code and review views (13 November 2026), after the 1.0.0 release and without a new release; he assesses the result first.

1. Syntax colours in the walk panes and the Gerrit-style diff view: comments, strings, keywords, types and function names distinguishable where the language support allows, on changed and unchanged rows, in Before, After, Before -> After and expanded context / Whole file. Text colour shows syntax; backgrounds keep showing additions, removals and the walk's exact changed lines (DSP-202: a pane's own changed lines strong, other changes weaker, unchanged context the plain dark background; the arrival flash only on the arriving place's changed lines; review bands and agent edges stay clear). One coherent theme for the existing dark look, readable on every diff background and during the arrival flash; no theme picker. Reuse an established highlighter, not per-language regular expressions; C/C++ first, common project languages through the chosen solution; unknown languages plain without errors. Tokenise each revision's own whole file (a visible place starting inside a multi-line comment stays a comment; base and target never mixed). Exact text, indentation, line numbers, wrapping, selection and copying preserved; no needless re-tokenising on scrolling or switching panes.

2. The collapsed agent report row in the Gerrit-style diff view ('Agent review · walk ... · remaining lines · awaiting your assessment') is clipped at the bottom and the code view starts before it fits. Reproduce, fix the layout cause; header and status fully readable and clickable, height from content with a long walk title, a narrow window, wrapping and zoom; code below without overlap; collapsed and expanded, several reports; reports start collapsed and keep the person's choice across updates. No hidden status, no fixed height.

3. The Discussion input grows like a modern chat field: one line when empty; grows with typing and pasting, with explicit and soft line breaks; up to a maximum adapted to the window height, conversation and send controls still reachable; a scrollbar inside only at the maximum; shrinks on deletion; one line again after a send clears the draft, draft kept on a failed send; recomputed on pane width, window size, zoom and re-docking; draft, focus, caret and selection kept, caret visible while typing. Consistent in the walk window, docked in the diff view and in a window of its own; existing send and newline shortcuts kept.

Presentation and input only: Accept, delegation's exact line scope, coverage and human decisions keep their behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 C/C++ (and other common languages through the chosen highlighter) show comments, strings, keywords, types and function names in distinct colours in walk panes and the diff view, on strong and weak green/red and unchanged rows, in Before, After, Before -> After and Whole file; unknown languages are plain without errors
- [ ] #2 Each revision is tokenised from its own whole file: a place starting inside a multi-line comment shows it as a comment, and different base and target content is coloured from its own side; exact text, indentation, line numbers, selection and copying are unchanged, and tokens are not recomputed on scrolling or switching panes
- [ ] #3 Syntax colours keep a readable contrast on every diff background and during the arrival flash; DSP-202's own/other/context backgrounds, the arrival flash on the arriving place's changed lines, review bands and agent edges are unchanged
- [ ] #4 A collapsed or expanded agent report in the diff view is fully readable and clickable with a long walk title, a narrow window and enlarged zoom, and the code starts below it without overlap; reports start collapsed and keep the person's choice across updates
- [ ] #5 The Discussion input is one line when empty, grows with typed and pasted text and soft wrapping up to a window-dependent maximum where it scrolls inside, shrinks on deletion and after a send, keeps the draft on a failed send, and keeps draft, focus, caret and selection on width, window, zoom and re-docking changes; consistent in the walk window, docked in the diff view and in its own window; send and newline shortcuts unchanged
- [ ] #6 Targeted regression tests and a real-window trial under Xvfb cover the three changes, with screenshots judged for readability and layout; Accept, delegation's exact line scope, coverage and human decisions are unchanged
<!-- AC:END -->
