---
id: DSP-62
title: A scripted run reports in seconds but the process lingers for minutes
status: Review
assignee: []
created_date: '2026-09-19 14:46'
updated_date: '2026-09-19 18:56'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 15619
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while driving the window in run 20260919-142600-converse. The record and the scripted run finished line are written promptly, but exitNow disposes the adapter before app.exit and after a cancelled loop run that wait is long: one run wrote its record and exited about six and a half minutes later, another was still alive twenty minutes after reporting and had to be stopped, and a third exited somewhere between five and nine minutes after its record. So a caller using Start-Process -Wait is waiting for the adapter rather than for the scenario, and an automated trial that keys off the process exit looks hung when it is finished. The exit path is shared with the smoke test and the probe, which is why it was not changed inside the call that found it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scripted run's process exit follows its report within a predictable time, or the wait is explained where a caller sees it.
- [ ] #2 The smoke and probe modes keep their current exit-code meanings.
<!-- AC:END -->

## A second instance, 19 September

<!-- SECTION:NOTES:BEGIN -->
The same shape appeared in the **test** runner, not only in a scripted run. `node --test` on `chat-service.test.ts` finished its work in under three seconds and then held the process open for over five minutes with nothing left to report, which reads exactly like a hung test suite and cost real time before it was diagnosed.

Two contributors, both worth knowing. A test that fails before its `await service.dispose()` leaves the service holding whatever it holds. And the DSP-61 fixture deliberately locks a directory with a live child process, which the `after` hook kills, but the removal of the temp directory then races that kill and raises `EPERM`.

`node --test --test-force-exit` makes the run terminate when the tests do, and with it the same three tests report in 3.1 s. Worth adopting in the documented invocation regardless of how this card is resolved, because a suite that cannot say it has finished is indistinguishable from one that is stuck.
<!-- SECTION:NOTES:END -->
