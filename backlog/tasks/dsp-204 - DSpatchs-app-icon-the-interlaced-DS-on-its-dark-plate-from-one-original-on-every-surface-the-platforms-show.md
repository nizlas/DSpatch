---
id: DSP-204
title: >-
  DSpatch's app icon: the interlaced DS on its dark plate, from one original, on
  every surface the platforms show
status: In Progress
assignee: []
created_date: '2026-11-12 20:56'
updated_date: '2026-11-12 21:31'
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
- [x] #1 The original is kept in the repository and every icon resource is derived from it by a script
- [x] #2 The Linux .deb installs the icon set and its desktop entry, WM_CLASS and window icons give the right icon in dock, taskbar and window switcher
- [x] #3 Every client window (main, review, walk, loop editor) carries the icon on Linux; Windows takes it from the executable
- [x] #4 About DSpatch and the start page show the icon discreetly
- [x] #5 The icon is inspected at 16, 24, 32, 48, 128 and 256 px on light and dark, with transparency outside the plate
- [x] #6 Verified in a built and an installed Linux package; Windows resources checked in a Windows build
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Save the original (app/build/icon-source/dspatch-icon.webp) and derive the resources with scripts/generate-icons.mjs. 2. Point electron-builder at build/icons and build/icon.ico; set the window icon on Linux; About and start page. 3. Inspect sizes; Windows dir build. 4. icon-trial.mjs in linux-verify on the build and on the installed .deb. 5. Release as a Linux pre-release with the published and upgrade trials.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Original app/build/icon-source/dspatch-icon.webp (as supplied; alpha already transparent outside the plate, an ~8% transparent margin cut away by the script). npm run icons (scripts/generate-icons.mjs, Electron decode, Lanczos-3 over premultiplied alpha, deterministic) writes build/icons/16..512 (Linux hicolor), build/icon.ico 16..256 (Windows exe, installer, shortcuts), src/renderer/public/icons/dspatch-64/128/256 (window icon on Linux, About, start page). Old build/icon.png removed. Every BrowserWindow gets windowIcon() on Linux; Windows uses the exe icon. Found and fixed: windows' WM_CLASS was dspatch while the entry's StartupWMClass was DSpatch; package.json desktopName dspatch.desktop makes them match (file name, appId and user data unchanged).

Verification: scripts/icon-trial.mjs in linux-verify's icons job (run 43309807897): build 29/29, installed .deb 42/42 (entry, hicolor bytes, WM_CLASS = StartupWMClass, _NET_WM_ICON 256 px with the icon's pixels on main, review, walk and loop editor windows; start page icon 56 px; About, panel and Alt+Tab screenshots). Windows: exe and NSIS installer built locally carry 16..256 with transparent corners. Typecheck and project-host-boundary pass. Evidence docs/evaluations/dsp-204/. Not seen: GNOME/KDE docks and Wayland, Windows taskbar/shortcuts of an installed app.
<!-- SECTION:NOTES:END -->
