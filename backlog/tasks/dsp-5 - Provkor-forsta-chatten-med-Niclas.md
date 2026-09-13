---
id: DSP-5
title: Try the code-change workflow with Niclas and capture friction
status: To Do
assignee:
  - '@nizlas'
created_date: '2026-09-13'
updated_date: '2026-09-13 20:13'
labels:
  - ux
milestone: m-0
dependencies:
  - DSP-2
documentation:
  - docs/VISION.md
  - BACKLOG.md
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Technically working chat and code changes do not automatically provide the intended experience. Niclas should try the first runnable version early, before a larger workspace is built around untested assumptions.

### Scope and proposed approach

Prepare short instructions and a runnable result. Niclas selects a small real task and tries opening the repository, discussing the task, asking for a code change, reviewing affected files and the diff, running a relevant build/test and following up. Include a follow-up or rework and a cancellation.

Observe where he has to search, guess or ask for an explanation. Assess whether the agent's changes, the command's purpose and the code covered by the result are understandable. Clickable controls alone do not establish usability.

Niclas may give early feedback on DSP-2 as soon as chat runs. DSP-5's full trial then covers code changes, diff and build/test. DSP-3 and DSP-4 need not be complete yet. Record available functionality in the tested version; deeper error recovery and restart are followed up in DSP-6.

### Results and next step

Save brief observations and Niclas's comments with environment and version, separating observations from agent interpretations. Prioritise at most three friction points and propose a small improvement for DSP-6. Agents may check the GUI themselves but cannot attribute an assessment to Niclas that he has not made. A significant new finding may justify changing the plan.

### References

[VISION.md, sections 1.1, 2.1, 3.1 and 15](../../docs/VISION.md#21-simplicity-with-full-capability).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A concrete runnable result and short trial covering code change, diff and build/test are available to Niclas.
- [ ] #2 Niclas has personally made a real bounded code change through chat, reviewed the diff, run a relevant build/test and followed up. Environment, tested version and available functionality are recorded.
- [ ] #3 Observations about clarity, code understanding, the connection between code and test results, and unnecessary steps are separated from agent assumptions.
- [ ] #4 At most three prioritised friction points and a bounded next improvement are documented, or an explicit finding that no blocking friction was found.
<!-- AC:END -->
