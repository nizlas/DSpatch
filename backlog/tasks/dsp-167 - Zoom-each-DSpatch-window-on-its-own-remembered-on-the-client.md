---
id: DSP-167
title: 'Zoom each DSpatch window on its own, remembered on the client'
status: Review
assignee: []
created_date: '2026-11-03 23:25'
updated_date: '2026-11-04 08:38'
labels:
  - ui
  - windows
dependencies: []
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 4 November 2026: enlarge and shrink every DSpatch window individually with VS Code's feel and shortcuts (Ctrl+plus, Ctrl+minus, Ctrl+0), text and the rest of the interface scaled together, one VS Code step per press. The level is kept in the client's local settings per window identity and restored when that window opens again, after a restart too; never in the project, on a host or in a provider session. All user windows: the main window, the loop editor, review and code-walk windows, the review panel in its own window, and the host chooser. A docked review panel follows the window it is docked in; undocked it has its own remembered level.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ctrl+plus, Ctrl+minus and Ctrl+0 change the focused window by one VS Code step (zoom level ±1, factor 1.2^level), on US and Swedish layouts and the numeric keypad, with focus in a text field or code view, with no double handling
- [x] #2 View menus of every window carry Zoom In, Zoom Out and Reset Zoom with their shortcuts
- [x] #3 Each window identity's level is saved in the client's user data and applied before the window's page is shown; two open windows can differ; a new window starts at normal size; saved values are validated and bounded
- [x] #4 The docked review panel follows its code window; its own window keeps a separate level that survives dock, undock and reopening
- [x] #5 Verified in real Windows windows: shortcuts and menu, two windows, close and reopen, restart, project and host change, reset saved, focus in chat and review, layout at both ends; Linux stated as verified or not
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Inventory (4 November 2026). Windows: the main chat window (main.ts createWindow; also carries #editor in scripted runs), the loop editor window (openLoopEditorWindow), the host chooser (pickOnHost, modal, no menu), review code windows for a walk and for a diff (review-windows.ts, view walk|diff, own View menu), and the review panel: a WebContentsView docked into a code window or shown in a frame window of its own (place window|walk|diff). Geometry: only the panel frame's bounds are kept, in the review preferences on the host side (explanationBounds, discussionPlace); no client-local geometry store exists. Zoom today: Electron's zoomIn/zoomOut/resetZoom roles in the main and review View menus, which step 0.5 and share the level per origin. VS Code (microsoft/vscode main, read 4 November 2026): window.zoomLevel 'Each increment above 0 (e.g. 1) or below (e.g. -1) represents zooming 20% larger or smaller', zoomLevelToZoomFactor = 1.2 ** level, MIN -8 / MAX 8, zoomPerWindow default true; keys Ctrl+= (secondary Ctrl+Shift+=, Ctrl+NumpadAdd), Ctrl+- (Ctrl+Shift+-, Ctrl+NumpadSubtract), reset Ctrl+Numpad0 (Ctrl+0 focuses the side bar in VS Code; Niclas asked for Ctrl+0 here). Electron 44.3.0 probe: webContents.setZoomLevel is shared per origin across windows; setZoomMode('isolated') makes it per WebContents, kept over reload and navigation, and a WebContentsView keeps its level when moved between windows; a level set before the first load is lost; webFrame.setZoomLevel from a preload is per window too.

Result (4 November 2026, Windows 11, run from the repository).

Design: `src/shared/window-zoom.ts` (the scale, the keys, what is saved) and `src/main/window-zoom.ts` (the store, the windows and the pages in them, the menu items). A window identity is what the window is for: main, editor, host-browse, review-walk, review-diff, review-panel. Each page's preload asks the main process for its window's level on `dspatch:window-zoom-level` as the document starts and applies it with `webFrame.setZoomLevel`, so a reopened window is at its size before it is shown; every page is set to Electron's isolated zoom mode so its level is its own and survives reloads; later changes come from the main process. Keys are read in `before-input-event`, before the page's own handlers and before menu accelerators, and the event is consumed, so a press in the chat field, a code view or the review's discussion field changes the window and types nothing. The three View menu items (Zoom In Ctrl+=, Zoom Out Ctrl+-, Reset Zoom Ctrl+0) are in the main window's menu and in every review window's menu, in place of Electron's roles. The level is saved in the client's user data, `window-zoom.json` (`{ "version": 1, "levels": { "<identity>": <integer -8..8> } }`), written on every change, with normal size left out; unknown identities, non-integers and values outside -8..8 are dropped on reading. Two open windows of one identity each keep their own live level; the last change is what is saved. A docked review panel is attached to its code window and follows its level; in its own window it has that window's remembered level, which docking neither changes nor forgets.

Verified in real windows (isolated profile through `--isolated-profile`, a disposable project, Electron 44.3.0, Windows 11, display scale 150 %), keys injected with Electron's own `webContents.sendInputEvent` (which takes the same path as a physical key through `before-input-event`; DevTools' `Input.dispatchKeyEvent` does not reach it, so it could not be used), menu items clicked through `Menu.getMenuItemById(...).click(...)` with the window as the focused one, and the page's `devicePixelRatio` and `innerWidth` read over DevTools (1.5 → 1.8 → 2.16 at levels 0, 1, 2; 1.0417 at -2, 0.868 at -3):
1. With the focus in the chat's text field: `=`, Shift and `=` (`+`), `-`, keypad `+`, keypad `-`, `0`: each press one step, nothing typed into the field; the menu items zoom the window they were used in, and are labelled Zoom In, Zoom Out, Reset Zoom with CommandOrControl+=, +-, +0.
2. The chat at 2, the loop editor at 1 and a review window at -2 at the same time, each unaffected by the others; the file held main 2, editor 1, review-diff -2.
3. The loop editor closed and opened again came back at 1 ("window editor opens at zoom level 1" in the log, the page at that scale); after a restart the review window came back at its saved -3.
4. The client quit (the standalone host left running) and started again: the chat opened at 2 before any project was open; the file was unchanged by the quit.
5. The project opened again (the page reloads): still 2. End host, which ends the host and starts another with the window reloaded: still 2, the file unchanged.
6. Ctrl+0 saved: the file no longer carries the identity (normal size is not written).
7. Focus in the chat field (1), in the review window, and in the docked discussion field: Ctrl+= there zoomed the review window and the panel together and typed nothing.
8. Screenshots at the chat's level 2 and 4 and the editor's -3: everything scales together and stays usable; at 4 in a 1040 px wide window the composer is cramped and the project name breaks per letter, as in any application at 207 %, so a wider window or a lower level is the answer there.
Panel: in its own window three steps up to 3 (saved review-panel 3); docked into the diff window: -2 with it; a key pressed in the docked panel took the diff window and the panel to -3 and left review-panel at 3; undocked: back to 3; docked and undocked again: -3 then 3; after the restart the panel came back docked where it was left, at the diff window's level, with review-panel still 3, and undocking restored 3.
Tests: `tests/window-zoom.test.ts` (16: the scale and bounds, US and Swedish keys and the keypad, AltGr, the Windows key and key-up ignored, the saved file's parsing and writing, two windows of one identity, a key in a page, a docked page, closed windows, the menu items); fast 1486 + the boundary test after its allowlist gained the two client files, review 199, presentation 288, typecheck.

Limits: no physical keyboard was pressed; the Swedish layout's `key` values are covered by the unit tests and the mapping is by the character Windows reports, so a press on a real Swedish keyboard is Niclas's check. The menu's accelerator text is drawn by Windows from the layout in use and was not seen. The host chooser (host-browse) is adopted but was not opened: it appears only in a remote session. The Windows key with + is left to Windows (Magnifier). Linux: the same code paths, nothing run there (no Linux environment on this machine).

Linux (4 November 2026, DSP-168): the zoom trial, scripts/zoom-trial.mjs, ran on GitHub's Ubuntu 24.04 runner in real Electron windows on Xvfb with openbox, the keys pressed through the X server (xdotool): the US layout (Ctrl+=, Ctrl+Shift+=, Ctrl+-, Ctrl+0), the Swedish layout (Ctrl and its + key, Ctrl and its - key, Ctrl+0), the keypad (+, -, 0 with Num Lock on), each press one level with nothing typed; the View menu items, drawn by GTK as Ctrl+=, Ctrl+- and Ctrl+0 (screenshot in the run's evidence); the chat at 2, the loop editor at 1 and the review at -2 at once, the file holding the three; the discussion in its own window at 3, docked at the review's level with 3 kept, a key in the docked field moving both to -1 and typing nothing, undock, dock, undock; a restart with the chat at 2 before any project is open and drawn at that ratio, the editor at 1, the review at -1, the panel docked at -1 and at 3 when undocked; Ctrl+0 leaving main out of the file. 55 checks, run 41792402401 of the linux-verify workflow. Observed there, not a zoom matter: under Xvfb a hidden window's renderer draws no first frame until one is asked for, so Electron's ready-to-show waits; the trial asks for one through a page capture. A real Linux desktop and a physical keyboard remain Niclas's checks.

Linux, found by the 0.1.5 tag's installed trial (DSP-168, 4 November 2026): a window is shown when its page reports ready from its first animation frame, and on Linux a zoom level set on the page before that frame, by adopt() at window creation or by the preload for normal size, left the hidden renderer drawing nothing: the chat window appeared only when something else asked for a frame. Fixed in a5d1a9d: a page seen for the first time is left to its preload, which sets only a level other than normal size; a page moved between windows is still set at once. The zoom trial checks that the first window and a restored window at level 2 are shown on their own, and passed its 57 checks on the release commit (run 41799972433). Released in v0.1.6.
<!-- SECTION:NOTES:END -->
