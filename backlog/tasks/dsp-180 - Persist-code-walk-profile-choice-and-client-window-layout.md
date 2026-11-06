---
id: DSP-180
title: >-
  Persist code-walk profile choice per review and restore client window layout
  locally
status: In Progress
assignee: []
created_date: '2026-11-06 13:55'
updated_date: '2026-11-06 13:55'
labels:
  - ux
  - review
  - desktop
dependencies:
  - DSP-178
  - DSP-179
  - DSP-167
ordinal: 98300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 6 November 2026: finish the next review UX step before release by (1) making presentation-profile choice persist for each walk and remain stable while navigating/restarting, with navigation-triggered lazy generation of missing alternatives, and (2) restoring client-local window geometry/layout (position, size, maximized state, docking place and panel geometry) for main/editor/review windows.

The change must preserve existing code-place/profile fixes, keep review semantics untouched (coverage, decisions, findings, threads), avoid automatic model calls on app reopen, and keep layout storage on the client (not host/project synced).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Profile chosen before generation is kept per walk and used consistently while navigating
- [ ] #2 Profile choice persists across restart and remembers last choice as default for new walks
- [ ] #3 Navigation-triggered generation waits for settle (~500 ms), runs one at a time per walk, and latest-step-wins with no backlog
- [ ] #4 Late answers and failures remain bound to correct step/profile without stealing focus or replacing other steps
- [ ] #5 Main/editor/review/diff/panel window geometry and maximized state restore from client-local storage
- [ ] #6 Panel place (window/diff/walk), docked width and floating geometry restore per review identity without cross-review overwrite
- [ ] #7 Geometry is clamped to available displays when monitors/resolution/scaling changed
- [ ] #8 Relevant tests and Linux/Xvfb trials are run with simulated provider and isolated profile; verified results and limits are documented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 6 November 2026 on Linux.

Implemented so far:
- Added `main/window-layout.ts`: client-local `window-layout.json` store for window geometry/maximized state and review-panel place/docked widths, with display clamping and atomic writes.
- Wired layout persistence into `main.ts` for main/editor/host-browse windows and into `review-windows.ts` for walk/diff windows and review panel.
- Added per-review layout keys to avoid cross-review overwrites and added fallback migration from legacy host-side `explanationBounds` / `discussionPlace`.
- Added `ui.presentationProfile` in review state validation (`review-model.ts`) and tests.
- Reworked presentation profile selection in `presentation-choice.ts` to be walk-scoped in local storage with last-choice default for new walks.
- Updated `ReviewView.tsx` to persist chosen profile in walk state and added navigation-triggered, debounced, one-at-a-time lazy generation for missing profile alternatives (latest-step-wins, no auto on reopen).
- Added `window-layout.test.ts` and grouped it under host tests.

Verification run:
- ✅ `npm run typecheck`
- ✅ `npm run test:review`
- ✅ `npm run test:host`
- ⚠️ `node scripts/profile-trial.mjs /tmp/...` failed in preflight because required Linux desktop tools (`xdotool`, ImageMagick `import`) are not installed in this runtime.
- ⚠️ `npm run build` renderer step is blocked in this runtime by pre-existing root-owned files under `dist/renderer` and cannot be fully cleaned without elevated permissions.
<!-- SECTION:NOTES:END -->

