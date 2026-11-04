---
id: DSP-172
title: >-
  Is the docked discussion drawn on Linux? Under Xvfb its view is hidden and a
  wheel over it reaches nothing
status: Review
assignee: []
created_date: '2026-11-04 11:39'
updated_date: '2026-11-04 14:08'
labels:
  - linux
  - review
  - windows
dependencies: []
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by DSP-170's Linux zoom trial (4 November 2026, run 41822133935). On GitHub's Ubuntu runner under Xvfb with openbox, the review discussion docked in the review window reports document.visibilityState 'hidden', the room kept for it is blank in a screenshot of the X display (docked-panel-before-wheel.png in the run's zoom-trial artifact), and Control with a wheel notch over it zooms nothing, while keys typed into its field reach it and zoom the window. The same page in its own window is drawn and takes the wheel. No trial so far has looked at the docked panel on Linux with anything but DevTools captures of the review page, which leave the WebContentsView out, so whether a real Linux desktop draws the docked discussion is unknown; v0.1.6 on Linux is affected if it does not. Find out, first with a probe on the runner (the view's aura stacking against the window's own page, setVisible, and whether showing the view again changes visibilityState), then on a Linux desktop. The docked panel's bounds are right since 5d3f545 (DSP-167).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 It is known, with evidence, whether a real Linux desktop draws the docked discussion and takes Control and the wheel over it
- [x] #2 If it does not, the cause is found and fixed, and the Linux zoom trial checks the docked notch as a requirement again
- [x] #3 Moving the docked discussion straight from one review window to the other (diff to walk and back, without undocking first), and closing the window it left, keeps it drawn, taking mouse and keys, with its conversation and unsent text, at the new window's zoom: checked on the display by a trial
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (4 November 2026): reproduce the docked discussion's blank room on Linux through the X server and OS-level input, and the switch of a docked discussion straight from one review view to another, which Niclas saw lose the discussion; find the causes in the product or the trial environment; fix and add a regression test.

4 November 2026 — cause, fix and what was verified.

Cause: Electron 44.0.0 through 44.7.0 on Linux leave a WebContentsView hidden once it has been moved into another window (removeChildView, then addChildView elsewhere): the page reports document.visibilityState "hidden", paints nothing new and takes no mouse or keys, while the display keeps the last frame it painted in the window it came from. This is electron/electron#54626 (from a Chromium 152 change; fixed in 44.7.1 by electron/electron#54798, a cherry-pick of Chromium e144b4a9a108). DSpatch v0.1.6 runs 44.3.0, and the review discussion is such a view, moved from its own window into the diff or the walk window: docked on Linux it was a frozen picture of how it looked in its own window. Probes of Electron alone (no DSpatch) on GitHub's Ubuntu runner under Xvfb, with openbox and with no window manager, showed it for every order of the move tried (bounds and visibility before or after adding, hidden until placed, added before removal, remove-and-add again, the target hidden first, nothing ever hidden) and for every remedy tried short of forcing paint (focus changes, minimize and restore, resize, page focus, closing the old window); the issue reports the same on X11 and Wayland desktops, so Xvfb is not the cause. Turning background throttling off makes the hidden page paint while it still says hidden; that hides the fault and was not used.

Fix: Electron 44.9.3 (7047c95), the newest 44 release more than two weeks old. No change to DSpatch's code: placePanel's order was not the cause. A fast test (tests/electron-version.test.ts) keeps the pinned and installed Electron equal and out of 44.0.0–44.7.0.

Regression trial: scripts/dock-trial.mjs (7bd504d), its own job in linux-verify. Isolated profile, SIMULATED provider. Each check of the docked discussion asks the page for a mark over itself and requires a screenshot of the display (X root window, or the Windows screen) to show the mark in the room — a hidden page's frozen frame cannot — then saves the real picture; clicks, keys and wheel notches go through the operating system (xdotool, SendInput). It docks in the diff window, zooms with the wheel and keys, resizes, zooms to 2 and -2, asks a question and leaves a draft, moves the discussion straight from the diff window to the walk window (Niclas's case), back to the diff window, to the walk window again and closes the diff window, undocks (own level kept), and docks from its own window.
- Linux runner, Electron 44.3.0: fails at the first dock (the page says hidden; the display shows the frozen frame from its own window, at that window's width and level). Electron 44.9.3: all 54 checks pass.
- Windows (150 % scale), Electron 44.9.3: all 54 checks pass, the mark seen in every room; also all 54 on 44.3.0 before the upgrade.
- The zoom trial's notch over the docked field is required again (with the page saying visible first).
- Tests on 44.9.3, Windows: typecheck; fast 1491 passed, 2 skipped; presentation 288; review 199.

Niclas's case (A docked, then Dock in the other window without undocking): on Linux it is this fault — any move into another window hides the page — and the trial now covers it, with B to A and closing A. On Windows it did not reproduce with operating-system input on either Electron version. The one way it was seen on Windows was the trial's own earlier aid that kept a window always on top for a few seconds: a view moved into a focused window that something keeps covered stays hidden after the cover goes, until the window's focus changes (seen in a probe of Electron alone). DSpatch sets no window always on top, so that is not a DSpatch path; if Niclas saw it on Windows, how is not known yet.

Not verified: a real Linux desktop (only Xvfb on the runner); the fix's effect there rests on the Electron issue's reports, which name desktops. A physical mouse. Linux packaging of a release with 44.9.3 (no release in this task).
<!-- SECTION:NOTES:END -->
