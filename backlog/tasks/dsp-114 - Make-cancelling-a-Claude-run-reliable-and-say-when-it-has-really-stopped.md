---
id: DSP-114
title: Make cancelling a Claude run reliable and say when it has really stopped
status: To Do
assignee: []
created_date: '2026-10-22 20:08'
labels:
  - integration
  - reliability
dependencies:
  - DSP-109
priority: high
type: spike
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-109 (Niclas, 22 Oct 2026). In the live cancel-reply run of DSP-109 (loop run 20261022-203000-dsp109live, record .dspatch-loop/runs/20261022-203000-dsp109live/logs/cancel-reply-subscription.json, report 001 in the same run directory; local and Git-ignored), ClaudeAgentSdkAdapter.cancel() (AbortController) resolved 1 ms after it was called, but Claude Code kept working: seven read-only tool calls (Glob at 3056 ms, Read x6 between 5966 and 7646 ms after send) started after cancel() resolved, the provider transcript shows a further model request about 5 s after the cancel (api-request entries at 20:04:00.525, 20:04:02.902 and 20:04:07.452 UTC), and the terminal 'cancelled' event arrived 7032 ms after the cancel call. No file changed, but usage accrued after the cancel, and no result message arrived, so that run's usage is unknown. DSP-109's AC #5 accepted that this behaviour was tested and recorded, not that it is acceptable product behaviour.

Goal: investigate and propose a clear cancellation contract for Claude runs in DSpatch, then (in a later, separately authorized step) implement it. Scope of the proposal:
- distinguish a requested cancellation from a confirmed end of the run, in the adapter's API, events and records;
- prevent new tool operations after a cancellation request wherever DSpatch can control it;
- handle work already in progress, including a possible forced termination of the provider process, and what that means for the session's later use;
- state the limits honestly: provider work and usage already started cannot be undone, and DSpatch may not see all of it;
- verify both the time to a confirmed end and any operations or file changes after the request.

Do not lock the solution to a particular SDK mechanism (for example Query.interrupt(), Query.close(), AbortController, a permission callback, or process termination) before its documented and observed behaviour has been examined for the installed SDK and Claude Code versions. Consider how the same contract applies to the Cursor adapter, without changing it in this task unless the proposal says so and Niclas agrees.

Relevance index: docs/RUNTIME_PLATFORM_ROADMAP.md (runtime and session handling); docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md section 2 "Enforcement follows execution" (where a control must sit to be effective).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A written proposal for a cancellation contract that separates a requested cancellation from a confirmed end of the run, and says how each appears in the adapter's API, events and run records
- [ ] #2 The documented and observed behaviour of each candidate SDK or process mechanism for stopping a run is recorded for the installed SDK and Claude Code versions, with documentation separated from observation, before one is chosen
- [ ] #3 The proposal states how new tool operations are prevented after a cancellation request where DSpatch can control it, how work already in progress and forced termination are handled, and what DSpatch cannot prevent (provider work and usage already started)
- [ ] #4 The proposal defines how verification measures time to a confirmed end and any tool operations, model requests or file changes after the request, and reuses the DSP-109 cancel-reply record as the baseline
- [ ] #5 No implementation and no live provider call happen under this card unless Niclas authorizes them separately
<!-- AC:END -->
