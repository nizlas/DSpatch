---
id: DSP-204
title: >-
  DSpatch's app icon: the interlaced DS on its dark plate, from one original, on
  every surface the platforms show
status: In Progress
assignee: []
created_date: '2026-11-12 20:56'
updated_date: '2026-11-12 20:56'
labels:
  - release
dependencies: []
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas chose the blue-turquoise interlaced DS symbol with a glowing sphere in the middle on a dark rounded plate as DSpatch's official app icon (12 November 2026). The supplied image is the original: no reinterpretation, no change of proportions, colours or shape; the plate is part of the icon and everything outside it is transparent. Replace the old green D and generic Electron icons where the platforms show an app icon (launcher, dock/taskbar, window switcher, the app's windows, the Linux desktop entry and installed icons, the Windows executable, shortcuts and installer, About, a discreet mark on the start page), with every resource derived reproducibly from the one original. Functional icons stay. App identity, user data, updates and host behaviour are unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The original is kept in the repository and every icon resource is derived from it by a script
- [ ] #2 The Linux .deb installs the icon set and its desktop entry, WM_CLASS and window icons give the right icon in dock, taskbar and window switcher
- [ ] #3 Every client window (main, review, walk, loop editor) carries the icon on Linux; Windows takes it from the executable
- [ ] #4 About DSpatch and the start page show the icon discreetly
- [ ] #5 The icon is inspected at 16, 24, 32, 48, 128 and 256 px on light and dark, with transparency outside the plate
- [ ] #6 Verified in a built and an installed Linux package; Windows resources checked in a Windows build
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Save the original (app/build/icon-source/dspatch-icon.webp) and derive the resources with scripts/generate-icons.mjs. 2. Point electron-builder at build/icons and build/icon.ico; set the window icon on Linux; About and start page. 3. Inspect sizes; Windows dir build. 4. icon-trial.mjs in linux-verify on the build and on the installed .deb. 5. Release as a Linux pre-release with the published and upgrade trials.
<!-- SECTION:PLAN:END -->
