---
id: DSP-126
title: Open review from the main window as a separate window
status: Review
assignee: []
created_date: '2026-10-25 23:49'
updated_date: '2026-10-28 21:10'
labels: []
dependencies: []
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 26 Oct 2026: integrate the review/code-walk module (review/code-perf, aed23e6, newest on the linear review line from 4602289) with the runtime candidate (4ec41f3). The chat is the main window; review opens as a separate window from it, like the loop editor, and stays a standalone module that can also be opened directly for a repository and an identified change with no chat, loop or coordinator. The main app hands review an explicit input (repository, identified change/revision, any existing review definition); review owns presentation, walks, coverage, review decisions and discussion and reads no main-chat UI state and needs no loop identity. Opening or closing review, or an agent answer, never approves code or continues a loop. Step 1 of 2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Open review in the main window opens a separate review window through the existing separate-window pattern; repeated opens of the same review focus the existing window
- [x] #2 The review window opens the right repository and review input: an identified change or an existing review when there is one, otherwise the user chooses with the existing review controls; never a hard-coded demo or a silently chosen revision
- [x] #3 The main chat keeps its session, draft and work in progress when review opens or closes
- [x] #4 An open review window keeps its repository and revision when the main chat switches project, and shows enough identity to make that clear
- [x] #5 Closing and reopening keeps the review and its navigation, through the existing storage
- [x] #6 Review can still be opened directly for a repository and an identified change without a chat; the module boundary is documented briefly in the existing architecture documentation
- [x] #7 Verified offline through real windows, IPC and services with the presentation adapter; runtime and review regression tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (26 Oct 2026, run 20261026-090000-review-plan, base main 4ec41f3 + review/code-perf aed23e6 fetched into refs/heads/review/code-perf from the DSpatch-review-perf clone; merge-tree shows no conflicts; no acceptance record of the review line exists in the repository, so the newest commit of the linear review line is taken as its candidate): planning both steps.

Plan: the main app has no identified revision pair today (the chat diff compares the working copy with a content baseline; loop results are files; nothing produces a review definition). Explicit input main hands review: the open session's repository (start folder and recent lookup only; the review's repository is the one the chosen definition names) and the last review definition opened for that repository (userData/reviews/recent.json); otherwise the existing chooser. Per-window ReviewService (kept alive until a pending save settles), a separate review preload, a View-only menu in review windows (zoom kept).

Result (26 Oct 2026, run 20261026-100000-review-window, base a418585 = the merge of review/code-perf aed23e6; accepted candidate 001 sha256:f6bf2fcf0fac926e4714711caede38b9871eed989ba8200966504d61b2483f0f): Open review in the main window opens a separate review window on the loop-editor pattern; per-window ReviewService registry (review-windows.ts) refusing unregistered senders; a separate review preload (the chat preload no longer carries the review bridge, the review window has no chat bridge); renderer/main.tsx mounts only ReviewView for ?window=review (the chat window's #review route is removed); input = the open session's folder (chooser start and userData/reviews/recent.json lookup only) - the last review for that repository opens directly, otherwise the chooser naming the folder; identity repo · base→target in header and title; focus on repeat; save before close (bounded flush); View-only menu in review windows with chat commands routed to the chat window; direct open (npm run review -- <definition>) with no chat window; an existing fault fixed: a late save is matched to its record by base, target and definition path. Review language defaults to English; a stored choice wins. Verified offline (presentation mode, fresh userData): typecheck, fast 1208, review 37, presentation 289; review-window scenario a-h exit 0; review-direct built and packaged exit 0; presentation and resume-choice unchanged; npm run package 1416/1416, the archive contains dist/preload/review-preload.js. Honesty note: the Implementer's packaged startup smoke ran outside presentation mode and very probably read the stored Cursor login status (Cursor.auth.status via getConnection) - not a model call, but outside 'presentation mode only'. Not exercised: quitting with a review window open (code reading only), the native open dialog, the identity path of focus-on-repeat (only the chooser path), Linux. Reviewer ACCEPT; suggestions S1 (scenario press on an opened review), S2 (serialize choose()) carried into DSP-127's run. HUMAN_PENDING: Niclas's look at the button, the header identity and the window behaviour.

28 Oct 2026 (DSP-150): Open review no longer opens the last walk or a definition chooser. By Niclas's decision it opens a diff window that chooses a repository and a revision pair; walks open from that window's Code walks, over the same pair. One window per walk still holds. The review-window scenario was adapted to this way in, and its walk-window checks still pass.
<!-- SECTION:NOTES:END -->
