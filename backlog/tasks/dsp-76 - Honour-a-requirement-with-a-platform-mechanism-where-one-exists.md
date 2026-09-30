---
id: DSP-76
title: Honour a requirement with a platform mechanism where one exists
status: To Do
assignee: []
created_date: '2026-09-20 09:03'
labels: []
dependencies:
  - DSP-74
priority: medium
type: feature
ordinal: 15708
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AgentOptions.disallowedTools accepts task, documented as disallow task to prevent subagents entirely, and combines with tools as deny-wins. Our graph format has the portable requirement no-subagent-delegation, and the capability table currently answers it other-means: stated in the role instructions and honoured by the agent, not by the platform. This is a platform mechanism for exactly that requirement, and unlike the sandbox it is per-requirement rather than all-or-nothing, so it cannot silently take the network away. Also establish whether tool-restriction is answerable, currently unknown with nothing in this repository having set or tested it. Move a capability row ONLY on measured evidence recorded beside it. One operational trap: tools, disallowedTools and systemPrompt are not persisted on the agent and must be re-passed on resume, or a resumed run silently loses its restrictions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A node requiring no-subagent-delegation runs with task denied.
- [ ] #2 A capability row changes only with an observation recorded beside it.
- [ ] #3 A resumed session still has the restriction.
<!-- AC:END -->
