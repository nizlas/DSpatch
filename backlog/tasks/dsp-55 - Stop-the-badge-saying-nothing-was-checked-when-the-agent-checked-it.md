---
id: DSP-55
title: Stop the badge saying nothing was checked when the agent checked it
status: Review
assignee: []
created_date: '2026-09-19 09:30'
updated_date: '2026-09-19 09:47'
labels: []
dependencies:
  - DSP-26
priority: high
type: bug
ordinal: 15612
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Measured by the Verifier on a real run: the checking agent configured CMake and ran ctest to a green result, and the badge over that run reads 'nothing was checked'. RUN_OUTCOME_BADGE_TEXT keys the word 'checked' on whether DSpatch spawned a process, which is precisely the misallocation INTERACTION_MODEL.md section 8 exists to correct, surviving in the one string a user cannot avoid reading. The same phrase is drawn over all five chat-loop endings, so where the sentence beside it distinguishes met, not met, could not establish and stopped, the badge flattens them into one phrase that describes none of them. Smaller than DSP-26's full revision of the outcome vocabulary and worth doing first, because it tells the user the opposite of what the run achieved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run whose checking agent ran the project's checks is never badged as unchecked.
- [ ] #2 The chat loop's endings are distinguishable from one another in the badge.
<!-- AC:END -->
