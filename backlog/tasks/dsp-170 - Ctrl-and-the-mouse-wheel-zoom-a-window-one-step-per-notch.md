---
id: DSP-170
title: 'Ctrl and the mouse wheel zoom a window, one step per notch'
status: In Progress
assignee: []
created_date: '2026-11-04 10:40'
updated_date: '2026-11-04 10:41'
labels:
  - ui
  - windows
dependencies: []
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 4 November 2026. Beside the zoom keys of DSP-167: Ctrl held and the wheel rolled forward, away from the person, enlarges; the other way shrinks. The same zoom as the keyboard, step 1 at factor 1.2 and levels -8..8, with the same persistence and window division: only the window under the wheel changes; a docked review discussion zooms with its review window; an undocked one on its own; the undocked panel's saved level survives docking; the level is saved on the client and restored as before. It works over the chat field, code views and other scrolling surfaces, and the gesture is consumed: no scroll of the content at the same time, no second zoom by Chromium or an editor. A plain wheel is as before. A high-resolution wheel's partial events give one step per ordinary notch, not several. No second handler: the existing zoom architecture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ctrl+wheel forward zooms the window under the pointer in by one level, backward out, within -8..8, saved and restored as the keys' zoom is
- [ ] #2 It works over the chat's text field, a code view and other scrolling surfaces, with no scroll and no second zoom
- [ ] #3 A docked discussion panel zooms with its review window; undocked on its own; its own saved level survives docking
- [ ] #4 Partial events from a high-resolution wheel accumulate to one step per ordinary notch
- [ ] #5 Verified with unit tests and in real windows on an isolated profile, saying which input was injected and what a physical mouse still has to show; the keys and menu still work
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (4 November 2026): Electron's zoom-changed event read in main/window-zoom.ts beside the keys, unit tests, then real windows on Windows and the Linux zoom trial.
<!-- SECTION:NOTES:END -->
