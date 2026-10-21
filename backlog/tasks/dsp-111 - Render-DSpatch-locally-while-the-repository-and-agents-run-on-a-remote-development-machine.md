---
id: DSP-111
title: >-
  Render DSpatch locally while the repository and agents run on a remote
  development machine
status: To Do
assignee: []
created_date: '2026-10-21 15:09'
labels:
  - integration
dependencies: []
priority: high
type: feature
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas (21 Oct 2026): DSpatch must relatively early support a VS Code Remote-like arrangement. The Electron/React UI runs and renders locally on a laptop; the repository, agents, scripts, Git operations, builds and tests run on a remote development machine. This matters for moving an existing autonomous orchestration project from VS Code to DSpatch. Not started; it is recorded now so that DSP-109 and later runtime work keep the separation it needs without building it early. Direction: docs/RUNTIME_PLATFORM_ROADMAP.md, section 1.2.

Requirements as stated:
- File contents, including images and other binary files, can be transferred to the local client and rendered there.
- SSH may be the transport. Graphical forwarding over SSH is slow in the work environment, while SCP-style file transfer works well; do not assume generally low SSH bandwidth.
- A DSpatch conversation and its durable task history are reachable from both the laptop and the development machine without manually transferring chat context.
- Provider-session resumption is a separate capability: used where the provider supports it, otherwise DSpatch continues explicitly in a new session from its persisted context, and says so.
- Long-running autonomous Maestro execution without an attached client is a further, distinct capability, not part of the first milestone.
- Content exclusion and authorization boundaries stay explicit: a human viewing a file or image locally does not grant an agent or external model access to it.

First milestone (this card): demonstrate local rendering, remote repository access and execution, and shared durable conversation context. Out of scope: unattended Maestro execution, AHP migration, host-loss recovery, multi-user access, a general remote-workspace system.

Reuse, do not duplicate: workspace and root records (DSP-71, DSP-72), conversation continuity (DSP-4), kept runs (DSP-25), the AgentAdapter boundary. Dependencies to settle at planning time: DSP-109 (first non-Cursor provider) and DSP-110 (what an agent host offers) inform the design; the work-environment content-exclusion contract applies to any work use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the UI on a local laptop and the repository on a remote development machine, a person opens the remote workspace, reads text and binary files including an image rendered locally, and sees an agent's change and its diff, with all Git, agent, build and test execution observed on the remote machine
- [ ] #2 A conversation and its durable task history started from the laptop are available on the development machine (and back) without manual transfer; when the provider session cannot be resumed, the continuation is explicitly a new session built from DSpatch's persisted context
- [ ] #3 Transferring a file for local viewing grants no agent or external model access to it; the access path for agents and the viewing path for the person are stated and checked separately
- [ ] #4 The transport and its measured behaviour (including file transfer over SSH) are recorded on the tested machines; unattended execution without an attached client is stated as not covered
<!-- AC:END -->
