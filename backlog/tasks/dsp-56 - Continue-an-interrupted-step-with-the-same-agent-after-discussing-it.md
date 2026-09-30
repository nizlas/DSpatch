---
id: DSP-56
title: Continue an interrupted step with the same agent after discussing it
status: To Do
assignee: []
created_date: '2026-09-19 12:28'
labels: []
dependencies:
  - DSP-53
priority: high
type: feature
ordinal: 15613
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
INTERACTION_MODEL v1.2 section 4.5. Cancel currently ends the work. It should instead hold the loop at the interrupted step, preserving the conversation, the agent session, the work already done, the run position, the graph version and the budget already spent. The user can then discuss with that same agent and clarify the assignment, and only an explicit request to continue resumes it, with the updated instructions and the remaining budget. Discussion alone must never resume. Continuing resumes the assignment rather than the exact instruction where it stopped: the agent establishes what completed before the interruption, a build may need restarting, and completed work must not be repeated. Whether the provider can genuinely resume the same agent session is an open question about our actual integration and must be established, not assumed. If it cannot, report that limitation rather than presenting a new session as the original one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cancel holds the run at the interrupted step and preserves conversation, session, position, graph version and spent budget.
- [ ] #2 The user can discuss with the same agent after cancelling without that discussion resuming the work.
- [ ] #3 An explicit continue resumes the interrupted step with the revised instructions and the remaining budget.
- [ ] #4 Where the same agent session cannot be resumed, the limitation is reported rather than a new session being presented as the original.
<!-- AC:END -->
