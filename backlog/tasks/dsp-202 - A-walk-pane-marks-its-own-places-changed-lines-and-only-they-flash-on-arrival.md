---
id: DSP-202
title: >-
  A walk pane marks its own place's changed lines, and only they flash on
  arrival
status: Review
assignee: []
created_date: '2026-11-12 14:55'
updated_date: '2026-11-12 21:15'
labels:
  - review
dependencies: []
priority: high
type: bug
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas (12 November 2026): in a walk, the gold arrival flash covers the whole reference including unchanged context, unchanged rows inside the reference get a grey plate, the next pane shows its own code only in faint diff colours until it is active, and the faint green and red are barely visible. Every pane marks the changed lines of its own places: added light green, removed light red, of comparable strength; changed lines outside a place in clearly visible weaker colours; unchanged code on the code view's plain background. Only the active place's changed lines flash on arrival, never context, the whole reference, hunk or pane, and a neighbour never flashes for being rendered. The marking uses the same definition of a place's changed lines as Accept (DSP-201). Marking is not review. Replaces the DSP-175 rule that only the active place is marked. No release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every walk pane marks the changed lines of its own places strongly (added light green, removed light red, comparable strength), before it becomes active
- [x] #2 Changed lines outside a place are clearly visible in weaker green and red; unchanged lines keep the plain dark background with no grey plate
- [x] #3 The arrival flash covers only the arriving place's changed lines, both added and removed; never context, the whole reference, hunk or pane; neighbours and re-renders do not flash
- [x] #4 Marking, flash and Accept share one definition of a place's changed lines; navigation, expansion and Whole file do not change it or any decision or coverage
- [x] #5 Regression cases A-D are covered by tests and a real-window trial with screenshots (current and next pane, persistent colours, neutral context, the flash in progress); the diff window is unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root causes: ReviewTimeline classed every row of the reference (inShown) for the active place, unchanged rows with rv-neutral-focus (the grey plate), all with the amber edge and rv-arrive; strong colours only when isActive; faint tokens 11-12%. Fix: markedChangedRows (review-model) is the one definition, used by markedChangedLines (Accept), each pane's marking, the amber edge and the flash; every pane draws its own places' changed rows rv-old/rv-new, other changed rows faint, unchanged rows plain; only the arriving place's changed rows carry rv-focus-active and rv-arrive. A place's changed rows include the old lines a replacement it lies on replaced, as referenceRows pairs them (DSP-201 took only its own side; corrected). Colours: own red 50% / green 40%, other 24% / 20%, alike in active and inactive panes. VISION 3.4 updated.

Verification: walk-decision-scope.test.ts 8 (A-D at model level); 106 targeted tests pass; typecheck green. walk-marking-trial.mjs 37/37 on Windows and on Linux under Xvfb (CI run 43244158263), screenshots in docs/evaluations/dsp-202/linux-xvfb: current and next pane, the flash caught at 150 ms on worker.js 6-8 only, neutral context, luminance own 0.063/0.059, other 0.026/0.023, plain 0.006, text contrast >= 7.6. Accept trial 32/32 (Windows, Linux), prefs/About 20/20 (Linux). Not run: thread-trial.mjs (expectations updated to the new rule). Niclas's own visual reading on his screen remains.
Thread trial run before release 0.1.24: scripts/thread-trial.mjs in linux-verify's dock job (run 43290904053, c2139e6), 110 of 110 under Xvfb, including one active mark per moment, the flash in the active pane only and settling, and the first occurrence unmarked when the same code returns. Two stale steps since DSP-193 were fixed in the trial only: the keep-recommendation thread is drawn folded and is opened before Accept, and the walk's threads are read in Step's Review section. Same run: walk marking 37/37, walk delegation 23/23, Accept scope 32/32, prefs/About 20/20, dock passed.

Released in 0.1.24 (https://github.com/nizlas/DSpatch/releases/tag/v0.1.24, Linux-only pre-release, tag on cc7c72c; package run 43293936160). Published trial (linux-verify run 43295145703): the published .deb, host package, manifest and SHA256SUMS in clean containers, 14 of 14; the upgrade from v0.1.23 27 of 27: the new client met the 0.1.23 host a closed window left running, offered Restart host, replaced it with 0.1.24-cc7c72c68e6f, and the conversation, agent choice, project, own loop, zoom and a review with a delegated result were kept, also after a restart.
<!-- SECTION:NOTES:END -->
