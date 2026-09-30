---
id: DSP-85
title: The loop is chosen in the graph editor
status: Review
assignee: []
created_date: '2026-09-20 20:40'
updated_date: '2026-09-20 21:25'
labels: []
dependencies:
  - DSP-84
priority: high
type: feature
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's cleanup mandate of 20 September, part one, and it supersedes the earlier cleanup prompt. The loop chooser and the file picking move OUT of the chat and INTO the graph editor. The editor gets a dropdown of available loop definitions and an Open loop... button for reaching one from file. Choosing a loop draws its graph and selects it for running, in one gesture. Opening a valid definition adds it to the same list and selects it. Neither starts anything. REMOVE: 'Open the loop that will run', 'Open our Cursor process drawing', 'Use this loop', and the 'Next:' marker - all four become unnecessary once choosing and drawing are the same act. From the chat, remove the loop dropdown and 'Choose a file...'; the Use loop tick stays. KEEP the ability to open a standalone graph for editing through the File menu, and such a graph must not silently displace the chosen runnable loop. One shared stored choice, the existing one. No hidden demo loop may replace what the person chose. If opening or choosing fails, show a short error at the chooser and keep the previous choice plainly visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The graph editor has a dropdown of available definitions and an Open loop... button.
- [ ] #2 Choosing a loop from the dropdown draws its graph and selects it for running, and starts nothing.
- [ ] #3 Opening a valid definition from file adds it to the same list and selects it.
- [ ] #4 Open the loop that will run, Open our Cursor process drawing, Use this loop and the Next: marker are gone.
- [ ] #5 The chat no longer has a loop dropdown or Choose a file...; Use loop remains.
- [ ] #6 A standalone graph can still be opened for editing from the File menu and does not displace the chosen runnable loop.
- [ ] #7 The choice is one stored value shared by chat and editor, and no hidden demo loop replaces it.
- [ ] #8 A failed open or choice shows a short error at the chooser and leaves the previous choice plainly visible.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementer, 20 September: implemented and walked in the real window. The editor's header now carries `Loop [dropdown] [Open loop…]`; picking an entry, or opening a file, is one call to `CHOOSE_LOOP_DEFINITION`, which now also takes the file dialog when given `null`. That handler already stored the choice through `noteChosenLoopDefinition` and the picked-paths list, so choosing and drawing share DSP-84's single stored value and no new selection state exists. `PICK_LOOP_DEFINITION` is gone with the chat's dropdown and `Choose a file…`; `Use loop` is untouched. Removed from the editor: Open the loop that will run, Open our Cursor process drawing, Use this loop, and the `Next:` chip. A standalone graph still opens from File → Open Graph File… over a new `TAKE_GRAPH_TO_EDIT`/`GRAPH_TO_EDIT` pair, draws, and leaves the chooser showing the chosen definition. Refusals reuse `judgeChosenLoop` but now carry a one-line `brief` — first error plus a count — which reads in the status line while the chip says only Not chosen; the previous choice stays selected. The walk found and fixed a real fault: `chooseLoop(null)` resolved its default from discovered rows only, so a remembered external definition was silently replaced on mount by the repository's own chat loop, which is exactly what #7 forbids; a regression test in app/tests/loop-choice.test.ts now guards it. Trial and evidence in .dspatch-loop/runs/20260920-104500-folders/logs/023-implementer/, report 023. The "Next mandate walks…" sentence under the composer was left for DSP-87. Status and acceptance ticks left to the coordinator.
<!-- SECTION:NOTES:END -->
