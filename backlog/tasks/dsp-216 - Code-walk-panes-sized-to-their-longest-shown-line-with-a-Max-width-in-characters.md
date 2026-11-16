---
id: DSP-216
title: Code walk panes sized to their longest shown line, with a Max width in characters
status: Review
assignee: []
created_date: '2026-11-16 12:30'
updated_date: '2026-11-16 14:00'
labels:
  - review
  - ui
dependencies: []
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request of 16 November 2026: better automatic pane widths in code walks.

With Wrap lines off:
- Each code pane's width follows the longest code line of what the chosen view shows by default. Folded (hidden) rows do not affect the initial width.
- A compact field beside Wrap lines: "Max width: [120] chars". Default 120; empty means no limit.
- The value limits the code text's width; line numbers, diff markers, margins and a scrollbar come on top.
- Shorter content gives narrower panes, within the existing minimum width; not every pane becomes 120 characters wide.
- Lines over the limit stay readable by horizontal scrolling.
- Panes take their room in the horizontal map; they are not squeezed to fit the window.

A changed maximum recomputes the widths at once. The setting is a user preference. The field is disabled while Wrap lines is on, keeping its value.

Keep resizing by hand and the existing navigation. Widths must not jump during ordinary scrolling, and an update must not lose the active step or the reading position.

Verify with short lines, lines around 120 characters, longer lines, and no limit; look at it in the app.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A code pane's width is its longest default-shown line, capped by Max width, plus its gutter, at least the minimum width
- [x] #2 Max width field beside Wrap lines, default 120, empty for no limit, saved per computer, disabled while wrapping
- [x] #3 A changed limit recomputes widths without losing the active place or the line being read; widths set by hand win
- [x] #4 Targeted tests for the width rule; typecheck
- [x] #5 Seen in the app
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done (16 November 2026), committed together with DSP-217, which changes the same files:

- `app/src/renderer/walk-pane-width.ts`: the width rule (longest default-shown line in columns, tabs to eight; Before leaves out added rows, After removed ones; capped by Max width; plus two line-number columns, 3.4rem of gutter and text padding from review.css, the measured vertical scrollbar and the border; at least the map's 260 px minimum) and the per-computer preference (`dspatch.review.paneMaxChars` in local storage: a number, `none` for no limit, default 120).
- `ReviewTimeline.tsx`: the map loads every pane's files and works out each code pane's width from its places' default ranges (`stationRanges` at the chosen level), so panes not drawn yet already have their width and panning or scrolling moves nothing. Rows opened by hand do not count. Width set by hand still wins; Markdown panes keep the full view; the old grow-for-the-change request is skipped for a pane sized this way. When widths are worked out again, the active pane keeps its place on screen. The code font's column and the scrollbar are measured once by a hidden probe.
- `ReviewView.tsx`: "Max width: [120] chars" beside Wrap lines; each valid value applies at once, empty is no limit, other text is marked invalid and changes nothing; disabled while lines wrap, value kept.
- Decision within the decided design: Wrap lines still never sets a width (30 October 2026), so wrapping on keeps the widths worked out with the limit; the field is only disabled.
- Checks: `tests/walk-pane-width.test.ts` (6: short lines, 119/120/121, longer lines, no limit, folded and view-hidden rows, tabs, field parsing); typecheck; build. In the app (this checkout's build, headless, isolated profile, a synthetic three-file walk): short file 428 px; lines of 115/104/123 columns at 120 give 1036 px and the 123-column line scrolls; 80 gives 733 px; no limit gives the 237-column file 1928 px, wider than the window; invalid text marked and ignored, the field restored on leaving it; Wrap lines on disables the field with 120 kept and the widths unchanged; the active pane stayed in place through every change; the limit was stored.
- Known: room for a vertical scrollbar is always reserved, so a pane whose rows fit without one shows up to about two more columns than the limit.
- Not tried: dragging an edge after a recompute, and the look on a real screen (Niclas's trial).
<!-- SECTION:NOTES:END -->
