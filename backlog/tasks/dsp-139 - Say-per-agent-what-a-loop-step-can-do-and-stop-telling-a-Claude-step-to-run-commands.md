---
id: DSP-139
title: >-
  Say per agent what a loop step can do, and stop telling a Claude step to run
  commands
status: To Do
assignee: []
created_date: '2026-10-27 02:33'
labels:
  - loop
  - providers
dependencies: []
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-138 (run 20261027-013000-loop-provider, review R-0 I3, R-1 I4). Loop runs now use the chosen agent, but (1) the requirement answers in the node panel are keyed by the drawing's target (TARGET_CAPABILITIES, LoopTarget), not by the agent a run uses; a table keyed by provider (StoredSessionProvider) is needed, never a Claude row beside the claude-code row, which describes generated agent files. Under Claude's CHAT_PERMISSIONS no-subagent-delegation and tool-restriction would honestly differ from Cursor's. (2) The chat loop's work purpose (docs/loop/graphs/dspatch-chat-loop.graph.json) and docs/loop/roles/project/project-check.role.md tell the agent to run commands, which a Claude step cannot; the run's agent line states it, but the instructions do not. Options for checks under Claude (Niclas's decision, DSP-138 Q2): a DSpatch-run gate in the chat loop, or a narrowly allowlisted command tool. (3) No presentation scenario can leave the agent unchosen, so the no-agent and Claude refusals of a loop run are shown only by unit tests, not on screen.
<!-- SECTION:DESCRIPTION:END -->
