---
id: DSP-170
title: 'Ctrl and the mouse wheel zoom a window, one step per notch'
status: Review
assignee: []
created_date: '2026-11-04 10:40'
updated_date: '2026-11-04 11:39'
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
- [x] #1 Ctrl+wheel forward zooms the window under the pointer in by one level, backward out, within -8..8, saved and restored as the keys' zoom is
- [x] #2 It works over the chat's text field, a code view and other scrolling surfaces, with no scroll and no second zoom
- [x] #3 A docked discussion panel zooms with its review window; undocked on its own; its own saved level survives docking
- [x] #4 Partial events from a high-resolution wheel accumulate to one step per ordinary notch
- [x] #5 Verified with unit tests and in real windows on an isolated profile, saying which input was injected and what a physical mouse still has to show; the keys and menu still work
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (4 November 2026): Electron's zoom-changed event read in main/window-zoom.ts beside the keys, unit tests, then real windows on Windows and the Linux zoom trial.

Result (4 November 2026). `src/main/window-zoom.ts`: beside `before-input-event`, each page attached to a window gets one `zoom-changed` listener (Electron's event for Chromium's request to zoom on Control and the wheel), which applies `in` or `out` to whichever window the page is in at that moment, through the same `apply` as the keys and the menu: same step, bounds, memory and window division, nothing else added. Why this is the right place: on Windows and Linux Chromium treats a wheel with Control held and a wheel's ordinary deltas as no scroll at all; what the page's own handlers do not cancel comes back to the browser process, which counts notches in `WebContentsImpl::HandleWheelEvent`, carrying a high-resolution wheel's fractions over and rounding the sum to the nearest notch, and asks its embedder once per notch; Electron emits the event and zooms nothing itself. No page of DSpatch cancels a Control+wheel event (the timeline reads Shift+wheel only), so nothing scrolls or zooms besides. A touchpad's precise deltas with Control are a scroll to Chromium, as in Chrome, and stay one. Unit tests in `tests/window-zoom.test.ts`: a notch in a page zooms the page's window and nothing else, in and out, within the bounds, remembered as a key is; the keys still work; the listener follows the panel's page between windows and is given once however often it moves; a destroyed page zooms nothing (18 tests). Typecheck, fast (1489) and review (199) groups green on Windows.

Verified in real windows on Windows 11 (an isolated profile, the simulated provider, 150 % display scale, 41 checks; the instrument in the session's scratchpad), the wheel turned through Windows' own input queue (SendInput: the pointer over the place, Control pressed, WHEEL_DELTA 120 per notch, Control released), which is what a mouse's driver hands the window; no physical mouse was turned: (1) over the chat's text field, one notch forward → level 1, a second → 2, back → 1, back → 0, nothing typed, normal size not written; (2) a high-resolution wheel's quarter notches (30): four make exactly one step, eight more two more, four back one back — Chromium rounds the carried fraction, so the step comes at the second quarter; three notches in a burst → three levels; (3) ten notches stop at 8, twenty back at -8; (4) a notch without Control leaves the level alone; the keys (Ctrl+=, Ctrl+-) and the menu still work; (5) over the review's code view (a 240-line change): a plain wheel scrolls it; Control and a notch zooms the review to -1, then -2, the code not scrolled by the notch (the zoom moves the position with the content, 300 → 243 px, the rows now smaller), the chat window still at 0; (6) the discussion in its own window: a notch over its field → 1 with the review at -2; over the thread → 2 with the thread not scrolled, a plain wheel over the thread scrolls it; docked: the panel takes the review's -2 with its own 1 saved, a notch over the docked field takes the review and the panel to -1 together, undocked it is back at 1; (7) after a restart the chat opens at 0, the review at -1, the panel in its own window at 1. Electron's `webContents.sendInputEvent` was not used for the wheel: it follows each injected wheel event with a synthetic phase-ended copy that keeps the ticks, so one injected notch counts twice (level 2 from one, recorded), which is the injection's doing and not a mouse's. Chromium with Control and precise (touchpad) deltas, injected that way: level unchanged.

Found on the way and fixed under DSP-167 (5d3f545): the docked panel was placed with the page's CSS pixels as if they were the window's device-independent pixels, so at every level but normal size it lay in the wrong place, at -2 outside the window. `panelSlot` now scales the room by the page's zoom factor.

Linux (4 November 2026, the linux-verify workflow on GitHub's Ubuntu 24.04 runner, run 41822133935 on 3b8eb59, all jobs green: tests, provider-tests and the zoom trial's 76 checks). The wheel turned through the X server (xdotool: the pointer over the place, Control held, the wheel's button pressed, Control released), which is what a mouse's notches are to Chromium there: over the chat's text field one notch forward → 1, another → 2, back → 1, back → 0, nothing typed, normal size not written; a notch without Control changes nothing; three notches in a burst → 3; nine more stop at 8; the keys still work beside the wheel; over the review's code view (a 240-line change) a plain wheel scrolls, Control and a notch back takes the review from -2 to -3 with the code not scrolled by it and the chat still at 2, a notch forward brings -2 back, saved; over the discussion in its own window a notch back → 2 with the review still at -2, forward → 3 again. Fractions of a notch injected through Electron (recorded, not required): the level after four eighths forward then four back read 0, 1, 1, 1, 1, 0, 0, 0, each injection counted twice by Electron's synthetic phase-ended copy, so a quarter per injection, and the step at half a notch as on Windows.

Recorded, not required, and open: a notch with Control over the docked discussion did nothing on the runner. The X screenshot taken just before it (`docked-panel-before-wheel.png` in the run's evidence) shows the review window with its room for the panel blank, and the docked page reports `document.visibilityState` "hidden" while its field has the keyboard focus (the key path worked: a key in the docked field zoomed both). Chromium does not take a wheel to the zoom counter for a hidden widget. So under Xvfb the docked view is treated as hidden and is not drawn at all; no trial so far has looked at the docked panel on Linux with anything but DevTools captures of the page, which leave the view out. Whether a real Linux desktop shows the docked discussion is unknown, and v0.1.6 on Linux is affected if it does not: DSP-172.
<!-- SECTION:NOTES:END -->
