---
id: DSP-200
title: >-
  A view preference save in the walk window is refused for key order, and the
  window says the review is not saved; About DSpatch shows the app and host
  versions
status: Review
assignee: []
created_date: '2026-11-12 10:25'
updated_date: '2026-11-12 10:44'
labels:
  - review
dependencies: []
priority: medium
type: bug
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas saw, in 0.1.22 on Linux right after a newly generated walk opened and before he did anything with it: 'Not saved. Your latest changes exist only in this window and are saved again with the next change. Reason: Unknown preference value.' The walk had been generated with instruction version 10 while the client used 12 (an older host; he restarted it). Trace which preference save runs and why it is refused, fix it without accepting arbitrary objects or dropping settings, make the message say what was not saved (view preferences, not the review), add targeted regression tests and a real-window trial. Also add About DSpatch to the menu with the installed app version from the package metadata and a copy action, the version in the start window's title, and the running host's program version when existing information gives it. No release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The cause of 'Unknown preference value.' is traced and reproduced
- [x] #2 Preferences are validated independent of key order; unknown fields and invalid values are still refused and nothing is written
- [x] #3 A save keeps the other stored preferences (panel place, window bounds)
- [x] #4 A view preference failure says what was not saved and not that the review is unsaved; technical detail goes to the log
- [x] #5 Regression tests for key order, refusal and preservation
- [x] #6 Real-window trial: a new walk opens with no message, and a changed width is kept after reopening
- [x] #7 About DSpatch shows the package version and the running host's own version or not known, and copies them; the start window's title carries the version
- [ ] #8 Linux CI's prefs trial passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Trace the preference reads and writes when a walk window opens (renderer, IPC, host, legacy fields). 2. Reproduce the refusal with the product's own function. 3. Order-independent validation in the host; the window sends the canonical order too, so a host from 0.1.15-0.1.21 accepts it before Restart host. 4. A message that says the view preferences were not saved, the reason to the host log. 5. About DSpatch and the version in the start window's title. 6. Targeted tests, typecheck, a real-window trial.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause (established in code, reproduced with the product's ReviewService and in a real window): ReviewService.setPreferences compared JSON.stringify(adoptPreferences(raw)) with JSON.stringify(raw), and JSON text follows key order. The walk window merges its language and widths over the stored preferences ({ ...rest, ...next }), so stored fields keep their place and new ones go last. Preferences from before 0.1.10 (discussionPlace and explanationBounds written by the main process, no widths yet), or a navigationWidth without explanationWidth, give another order than adoptPreferences writes: every save was refused, wrote nothing, and stayed refused. Only view preferences (language, column widths) were affected; review state, walks, notes and decisions are saved through saveState and their own files.

Not established: what started the save in Niclas's run. Only a pointer released on a column divider (a click is enough), the arrow keys on a focused divider and the language choice call it; opening a walk wrote nothing in both window trials. No link to the older host: 0.1.15 to 0.1.22 have the same preference code, and the stored file's shape decides. Niclas's ~/.config/DSpatch/reviews/preferences.json has not been read.

Fix: refusedPreferenceFields checks field by field with nested keys sorted; unknown fields, invalid values and a missing language are still refused and nothing is written; the field names go to the host log. The window sends inPreferenceOrder (nothing dropped), which a host from before the fix accepts too, until Restart host. Message: "This window's language and column widths could not be saved. The review is not affected." (and a variant for a failed read); no reason in the window; IPC failures are logged by the main process.

About DSpatch: in a Help menu; app.getVersion() and the app's commit; the running host's version from RemoteLink.build() (what the host reported in the handshake), otherwise "not known"; Copy version information; the start window's title "DSpatch — <version>", with page-title-updated prevented. No host method or protocol change.

Verification on the working tree over 66c8447 (build identity a0bbfc5a42ddf372): typecheck (node, renderer, tools); about, review-model and review-host tests, plus review-reading-style, presentation-profiles, walk-panes and window-layout: 91 tests, all pass. Window trial scripts/prefs-trial.mjs on Windows: final 21 of 21; a negative control without the fix fails at the first width save, showing the new message, with the host's log line; an old-host control (host check reverted, window ordering kept) passes 21 of 21. Evidence in docs/evaluations/dsp-200/. Linux: the trial is added to linux-verify's dock job (About part left out there).
<!-- SECTION:NOTES:END -->
