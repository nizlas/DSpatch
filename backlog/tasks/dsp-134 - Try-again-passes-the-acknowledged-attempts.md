---
id: DSP-134
title: Try again passes the acknowledged attempts
status: To Do
assignee: []
created_date: '2026-10-26 13:04'
labels: []
dependencies: []
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Proposal P-3, carried from DSP-121's review notes on DSP-117. The window's Try again does not pass acknowledgedAttemptIds, which is needed to lift the unconfirmed-end block after the person has acknowledged it. Until then the honest way forward is a new session. Small renderer change with a test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Try again sends the acknowledged attempt IDs and lifts the unconfirmed-end block only for those attempts
- [ ] #2 A test covers acknowledging and retrying after an unconfirmed end
<!-- AC:END -->
