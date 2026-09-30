---
id: DSP-40
title: Pin the never-started sentences so they cannot drift
status: To Do
assignee: []
created_date: '2026-09-18 09:40'
labels: []
dependencies:
  - DSP-37
priority: low
type: chore
ordinal: 15560
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The two cancellation paths in loop-run.ts share one neverStarted builder so they cannot drift into describing the same event differently. Call 013 measured that the sentences really are byte-identical: reconcile matches across four distinct cancellation paths and the detail template tail matches at 78 bytes.

Nothing in the test suite defends it. Every assertion on those sentences, old and new, is a substring match. Someone can reword reconcile freely or add a clause to detail and all tests still pass.

So the property holds because the code happens to have one builder, not because anything requires it. One assert.equal on the full reconcile string at one call site makes the claim self-enforcing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reworded cancellation sentence fails a test rather than passing silently.
<!-- AC:END -->
