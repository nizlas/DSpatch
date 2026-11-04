---
id: DSP-172
title: >-
  Is the docked discussion drawn on Linux? Under Xvfb its view is hidden and a
  wheel over it reaches nothing
status: To Do
assignee: []
created_date: '2026-11-04 11:39'
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
- [ ] #2 If it does not, the cause is found and fixed, and the Linux zoom trial checks the docked notch as a requirement again
<!-- AC:END -->
