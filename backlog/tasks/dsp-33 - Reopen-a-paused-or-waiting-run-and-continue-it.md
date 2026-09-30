---
id: DSP-33
title: Reopen a paused or waiting run and continue it
status: To Do
assignee: []
created_date: '2026-09-17 19:44'
labels: []
dependencies:
  - DSP-31
priority: high
type: feature
ordinal: 15800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

A run that waits for a person will often wait longer than the application stays open. If closing the window destroys a waiting question, then pausing and asking are only usable while someone is sitting there — which defeats the purpose of both.

This is the point where the run record from DSP-25 stops being bookkeeping and becomes the product: the thing that lets a person leave, come back, and pick up a decision that is still open.

### The rule that must not bend

**Restoring a view is looking, not deciding.** Reopening a paused or waiting run shows it; it never resumes it. Work continues only after an explicit act by the user. A helpful auto-resume would be a defect here, and an expensive one — it would spend provider budget and change files while nobody was watching.

Resuming grants no new budget. Steps, time and reported usage already consumed stay consumed, under the run's own defined budget rules.

### Unknown outcomes

If it cannot be established whether an earlier call or command actually ran, that must be shown concretely and offered a comprehensible way forward. This project has been through this exact situation in its own development loop more than once, and the lesson each time was the same: resolve an unknown outcome before repeating the action.

Do not report guaranteed resumption where the provider does not support it. What Cursor will and will not resume is a matter for measurement, not for assumption.

### Relationship to DSP-18

Together with DSP-29, DSP-30 and DSP-31 this completes DSP-18 criterion #4, which has stayed open since the criterion was written.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A paused run, or one waiting at a human node, can be opened again with the right question, evidence, history and next step.
- [ ] #2 Restoring the view never resumes work automatically; work continues only after an explicit action by the user, and neither the same answer nor a repeated continue command can start the next step twice.
- [ ] #3 Steps, time and reported usage already consumed are preserved under the runs defined budget rules, and resuming grants no new budget.
- [ ] #4 Unknown outcomes are reconciled before anything is repeated: where it cannot be established whether an earlier call or command was carried out, that is shown concretely with a comprehensible way forward, and guaranteed resumption is not claimed where the provider does not support it.
- [ ] #5 Late events and files changed since the pause are not silently treated as an unchanged state.
<!-- AC:END -->
