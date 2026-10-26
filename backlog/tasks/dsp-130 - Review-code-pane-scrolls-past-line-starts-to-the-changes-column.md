---
id: DSP-130
title: Review code pane scrolls past line starts to the change's column
status: To Do
assignee: []
created_date: '2026-10-26 10:40'
updated_date: '2026-10-26 10:51'
labels: []
dependencies: []
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed by the Verifier in run 20261026-160000-example-review (DSP-129, report 002 item 2) on the bundled DSP-116 example; pre-existing review-view behaviour, not caused by DSP-129. The code pane scrolls sideways to the column where the change starts (changeLeft in ReviewTimeline.tsx; measured scrollLeft 271-330 px), so lines shorter than that look empty and the start of each line is cut off; at about 1000 px the middle diff column is about 500 px wide and cuts code on the right. Recorded before a second reviewer assesses the code view, so it is not reported as an example defect. Decide after that assessment whether and how to change it.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Related, from the DSP-129 re-review (run 20261026-160000-example-review, report 006), to fold in at the next touch of the review window: (a) a failed review's opened Details <pre> does not wrap and runs past the window edge (white-space: pre-wrap; overflow-wrap: anywhere, with a rendering check); (b) when Open review falls back to the chooser for a remembered review whose history is missing, it shows the plain note without the Details element (carry detail through the kind 'none' outcome); (c) the 'not a git repository' recognition matches English git output only (run git with LC_ALL=C).
<!-- SECTION:NOTES:END -->
