---
id: DSP-34
title: 'Make a stopped command actually stop, including its descendants'
status: To Do
assignee: []
created_date: '2026-09-18 06:09'
labels: []
dependencies:
  - DSP-26
priority: medium
type: bug
ordinal: 15900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

DSpatch now puts a deadline on a gate command, which closed a defect where anything that failed to return held a run open forever with nothing on screen. Verification of that fix measured its limit: `taskkill /PID <pid> /T /F` walks parent links, and where an intermediate process has already exited the walk cannot reach what it started. A descendant was observed alive and still working 34 seconds after DSpatch's record said it had been stopped.

This is the shape of every tool that starts a daemon, a file watcher or a compile server and then returns, so it is not exotic.

### What is already handled, and what is not

The truthfulness half is fixed separately and first: the message says what DSpatch asked Windows to do rather than claiming an outcome it cannot observe. That removes the false statement. It does not remove the orphan, and a build process still running against the user's project after DSpatch has moved on can hold file locks, consume the machine and confuse the next run's evidence.

### The shape of the answer

On Windows a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` contains a whole process tree regardless of parent links, which is what `taskkill /T` cannot be made to do. On Linux a process group is the equivalent, and the current `child.kill('SIGKILL')` does not use one, so the same defect is probably wider there and is entirely unmeasured.

Also unmeasured and worth settling here: `killCommandTree` never reads the result of the kill it requests. Whatever mechanism replaces it should be able to say whether it succeeded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When a command is stopped because it passed its deadline, processes it started are stopped with it, including a descendant whose own intermediate parent has already exited.
- [ ] #2 DSpatch can tell whether the stop succeeded, and says so rather than claiming an outcome it did not observe.
- [ ] #3 The Linux path is either given the equivalent containment or is documented as unmeasured, rather than being assumed to behave like the Windows one.
<!-- AC:END -->
