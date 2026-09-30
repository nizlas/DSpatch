---
id: DSP-54
title: Record the tool calls an agent actually made
status: To Do
assignee: []
created_date: '2026-09-19 08:48'
labels: []
dependencies:
  - DSP-25
priority: high
type: feature
ordinal: 15611
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The provider already streams tool_call events with args, result and a truncated flag. DSpatch's adapter keeps only call id, name and status; the loop executor does not subscribe to tool events at all. Measured on this machine: a shell call reports the command line, exit code, stdout, stderr and duration. Large output can arrive as an empty string with truncated still null, so the record must say output was not reported rather than that there was none. This is the evidence half of the agency correction: once agents run their own checks, the history has to show what they ran. Do not invent a parser for commands in ordinary chat.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A loop step that ran a shell command records the command line and the exit code when the provider sent them.
- [ ] #2 When no output was reported the history says so, and does not say there was no output.
- [ ] #3 What the provider did not expose is recorded as unknown, never as zero.
<!-- AC:END -->
