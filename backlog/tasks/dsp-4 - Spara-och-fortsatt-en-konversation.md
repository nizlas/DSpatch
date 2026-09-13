---
id: DSP-4
title: 'Preserve conversations, changes and execution results after restart'
status: To Do
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-13 20:13'
labels:
  - storage
milestone: m-0
dependencies:
  - DSP-2
documentation:
  - docs/VISION.md
  - BACKLOG.md
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Niclas should close DSpatch, reopen it and continue a development task with its project, reasoning, reviewed changes and execution results intact. Saved history must show what actually happened and which code the results concern.

### Scope and proposed approach

Choose simple local storage for conversation ID, project association, messages, run/attempt IDs and change/test version references. Preserve the reviewed diff or enough evidence to reconstruct exactly that diff, plus the file list, command, working directory, output, exit code and status. Version the format and document storage location and export.

Separate saved history from active processes and current working-copy contents. Restart must not automatically restart jobs/commands, reapply patches or restore historical file contents. If the repository changed in the meantime, label historical results and invalidate their verification for the new contents.

Use provider resumption if the connection supports it. If a new session is necessary, show that and explain which saved context is actually restored. A visible old chat is not evidence the model received the same context. Keep authentication secrets out of conversation files and Git.

### Verification

Change code and run a test, close the app, reopen it and follow up. Also test interruption during a run, external file changes while closed, and corrupt or older storage formats. Preserve readable evidence and provide a clear recovery action. Align with DSP-3 run states; reconcile processes with unknown outcomes before continuing.

### References

[VISION.md, sections 8–9, 13 and 14](../../docs/VISION.md#9-architecture-and-project-data).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The project association and conversation, including message order, survive a normal restart.
- [ ] #2 A follow-up after restart receives relevant saved context; any new provider session and its limitations are disclosed.
- [ ] #3 An interrupted or unknown run is reconciled before continuing. Previous jobs, file changes and commands are not automatically repeated on restart.
- [ ] #4 Storage has a format version and documented export; secrets are excluded from saved history and Git.
- [ ] #5 Restart, interruption, external file changes and an unreadable or unsupported storage format have been checked with results tied to the tested version.
- [ ] #6 The previously reviewed diff and execution result, including command, working directory, output, exit code and code reference, can be read after restart. A changed working copy is not overwritten; old results do not appear to verify new code.
<!-- AC:END -->
