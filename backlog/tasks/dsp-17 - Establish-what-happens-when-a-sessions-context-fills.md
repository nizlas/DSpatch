---
id: DSP-17
title: Establish what happens when a session's context fills
status: Review
assignee: []
created_date: '2026-09-15 17:15'
updated_date: '2026-09-15 22:51'
labels:
  - spike
dependencies: []
ordinal: 13000
---

## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this exists

Raised by Niclas on 15 September 2026 as an interesting aside rather than a blocker. Not urgent.

A conversation has two memories. The provider session is the agent's own, held by Cursor, and DSP-4 measured that it survives DSpatch being closed and reopened. DSpatch's saved conversation on disk is a separate record: messages, diffs, test results and the attempt ledger. The model does not read it, except when a session cannot be resumed and DSpatch puts a recap in front of the next message.

Neither of those covers what happens when the **provider session's own context fills up**. The Cursor SDK documentation says a follow-up `send()` keeps the full conversation, and says nothing about the limit. In the IDE, a long conversation is summarised and continues. Whether the SDK's local runtime does the same is a reasonable assumption and nothing more: we have not observed it.

The project's standard is that an unmeasured behaviour is unknown. This task exists so the assumption is either confirmed or replaced, before DSpatch encourages conversations long enough to reach the limit.

### Scope

Drive a session until its context fills, on a small model so the cost is bounded, in a scratch repository. Observe what DSpatch can see from the outside: whether the stream carries anything that marks a summarisation, whether token counts drop, whether `run.conversation()` changes shape, or whether the run simply fails.

Record the model, date and SDK version. State the limit of the measurement: one model on one day is not a guarantee about another.

Then record what, if anything, DSpatch should do. DSpatch's recap path is not an answer — it fires when a session cannot be resumed, not when memory fills — but it may turn out to be the cheapest starting point. Do not commit to an implementation in this task.

### References

`docs/VISION.md`, and the DSP-4 resumption measurements in `.dspatch-loop/runs/20260914-205132-nt4m/reports/007-implementer-dsp4-s3-s5.md` and `008-verifier-dsp4.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 It is measured, not inferred, whether a Cursor SDK session compacts, degrades or fails when its context window fills, and what DSpatch can observe when it happens.
- [x] #2 The behaviour is stated with the model, date and SDK version it was measured on, and the limits of the measurement are explicit.
- [x] #3 It is recorded whether DSpatch needs to do anything itself, and if so what the cheapest honest option is, without committing to an implementation.
<!-- AC:END -->
