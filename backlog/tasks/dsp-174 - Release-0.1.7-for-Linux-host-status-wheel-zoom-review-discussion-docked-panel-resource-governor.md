---
id: DSP-174
title: >-
  Release 0.1.7 for Linux: the host status, wheel zoom, the review discussion's
  reading, the docked panel on Linux, the resource governor and the DSP-163
  follow-ups
status: In Progress
assignee: []
created_date: '2026-11-04 19:30'
updated_date: '2026-11-04 19:30'
labels:
  - release
dependencies: []
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 4 November 2026, run from the Linux machine. Integrate the two DSP-163 follow-up commits (a Stop while a step reads the folders starts no agent; unticking Use loop while the connection is away does not show the run as stopped; the held-process diagnostic and the remote loop trial) onto the current origin/main without bringing back the older local snapshot code, which origin/main replaced; keep `backup/linux-dsp163`. Then release the next free patch version after 0.1.6 for Linux with DSP-169 (host status and Restart host), DSP-170 (Ctrl and the wheel), DSP-171 (the review discussion's reading), DSP-172 (Electron 44.9.3, the docked discussion drawn on Linux, a direct move A → B), DSP-173 (the resource governor, observe by default) and the follow-ups. Build from a clean tagged commit through the existing package workflow; publish the .deb, the Linux host package, host-manifest.json and SHA256SUMS. No Windows release, no heavy stress test. Observe measures and logs without limiting a run; the colleague's earlier slowness is not described as solved, its cause is not established. Tasks awaiting Niclas's acceptance stay in Review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Local main is origin/main plus the two follow-up commits, with backup/linux-dsp163 and dsp-163-linux-followups kept
- [ ] #2 The relevant test groups, the typecheck and the release checks pass on Linux, and remaining failures are compared by their output on the same base
- [ ] #3 The package of the release commit is tried on Linux: install and start, upgrade from 0.1.6 keeping conversations, settings, project and own loop, meeting the older host and switching to the new one, the docked discussion drawn and taking input after A → B, redocking and zoom, Ctrl and the wheel with saved levels, and a light loop in observe reading real Linux signals with time-stamped records
- [ ] #4 The release is published from the tagged commit with the .deb, the Linux host package, the manifest and SHA256SUMS, and their checksums and build identities match that commit
- [ ] #5 Release notes state the user-visible changes and the verification limits honestly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (4 November 2026): integration done (main = origin/main 75eaa74 + 84ce8d8, eb0ab50; backup/linux-dsp163 at 26b89d8 kept). Verifying on Linux before the version commit.
<!-- SECTION:NOTES:END -->
