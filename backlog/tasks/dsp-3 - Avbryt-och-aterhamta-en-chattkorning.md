---
id: DSP-3
title: Cancel and recover agent and test runs clearly
status: Review
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-15 08:19'
labels:
  - reliability
  - ui
milestone: m-0
dependencies:
  - DSP-2
documentation:
  - docs/VISION.md
  - BACKLOG.md
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Niclas's earlier loop could stall on failed tool calls. The first workspace must show the actual execution state and an understandable next action, including after an agent has changed files or started a build/test.

### Scope and proposed approach

Deepen Cancel and handle disconnection, denied file/tool access, provider failures and long waits. Distinguish waiting, cancellation requested, confirmed stopped and unknown outcome. Define justified timeouts and bounded retries; normal long processing is not a confirmed failure.

Offer visible actions such as Retry or Reconnect where applicable. Preserve input, received responses, produced file changes and execution logs. Allow review of partial results after cancellation. Never automatically reset and erase user or agent work on cancellation.

Track agent termination and local subprocess termination separately. Stopped or interrupted tests must never appear passed. Show remaining processes or remote requests and a concrete next action.

Give each attempt its own ID. Reconnection first reconciles the previous state, actual file changes and command outcome. It must not automatically duplicate a model job, reapply a change or rerun a command with an unknown outcome. Build only what the first connection needs and document its limitations.

### Verification

Test cancellation during streaming, after a file change and during a build/test; late responses after cancellation; denied access; and disconnection after a tool call. Check that changes and logs survive and ambiguous outcomes do not trigger repetition. Controlled failures may be simulated for reproducibility, but also report real provider cancellation and a real local process. Save observations and the tested version.

### References

[VISION.md, sections 2.1, 13 and 14](../../docs/VISION.md#13-reliability-and-control).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cancel distinguishes a request from confirmed termination for the agent and local subprocesses; remaining processes or remote calls are visible.
- [x] #2 Connection failures, access failures and long waits produce an understandable status and a visible applicable action.
- [x] #3 Input, received responses, existing file changes and execution logs survive errors and retries in the open workspace; partial results remain reviewable.
- [x] #4 Ambiguous previous outcomes are reconciled before repeating an action. No change is automatically reapplied or command double-started; late events cannot complete a different run.
- [x] #5 Failure and cancellation scenarios cover streaming, file changes and builds/tests, clearly distinguishing simulations from actual provider and process execution.
- [x] #6 An interrupted or incomplete build/test is shown as interrupted or uncertain and cannot produce a passed test status.
<!-- AC:END -->
