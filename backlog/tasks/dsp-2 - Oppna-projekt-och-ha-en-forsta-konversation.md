---
id: DSP-2
title: 'Open a repository, change code and review the result'
status: Review
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-15 10:07'
labels:
  - ui
  - integration
milestone: m-0
dependencies:
  - DSP-1
documentation:
  - docs/VISION.md
  - BACKLOG.md
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Niclas should use DSpatch for a small real development task: select a repository, discuss the task, let the agent change files, review a conventional diff and run a relevant build or test.

### Scope and proposed approach

Use the verified Cursor connection from DSP-1. Provide visible project selection, message input and Send. Show the project, connection, available project context and current activity. Selecting a folder must not imply every file has been read. Keep provider calls in the adapter.

Build small runnable increments: conversation first, file changes and diff second, then a visible build/test action. Niclas can try intermediate results; completion requires the whole workflow. One writing agent run or build/test at a time in the working copy is sufficient initially.

An explicit change request authorises its bounded change in the selected working copy. A reading question can remain read-only. Capture the initial files and attribute changes to the run. Do not attribute existing manual changes to the agent or silently overwrite them. Handle a changed file version before writing again; simple isolation or a pause with a clear explanation is sufficient.

Show affected files and the full conventional text diff of the run's changes, including added and deleted text files. Derive it from actual contents for an identified snapshot. List non-text or unsupported changes with their limitations. The user can request rework in the same chat and review the next version. Advanced semantic diffs and a custom editor come later.

Provide a visible build/test action. The command and working directory must be visible and editable without hand-edited configuration. Show execution, output and exit code. Associate the result with the actual code: base revision and a content-addressed snapshot including relevant uncommitted and new files. An old result must not verify later changes.

Include basic Cancel for the agent and command as established in DSP-1, showing any continuing execution. DSP-3 deepens error handling and DSP-4 persistence. Commit, push, PR handling and a full terminal emulator are outside scope.

### Verification and early use

Make a small change in a repository with a known build/test. Check contents and diff, a follow-up or rework, and both successful and failing commands. Verify an existing manual change survives and new code invalidates earlier test status. Document the tested version and short startup instructions. DSP-5 can start with intermediate results and finish when the whole workflow is available.

### References

[VISION.md, sections 2.1, 3, 9, 13 and 14](../../docs/VISION.md#21-simplicity-with-full-capability).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The workspace starts on the selected platform and the user can select a repository through visible controls.
- [x] #2 Send produces a real streaming agent response; a follow-up or rework uses relevant conversation context.
- [ ] #3 The active project, connection, available project context and current activity are clear without reading a raw log.
- [x] #4 Basic cancellation of the agent and command works as established in DSP-1 and honestly shows continuing execution; late events cannot affect the wrong conversation.
- [x] #5 A verified runnable result, tested version and short startup and trial instructions are ready for Niclas.
- [x] #6 An explicit request produces a real code change in the selected working copy. A reading question can remain read-only; existing manual changes survive and are distinguished from the run's changes.
- [x] #7 Affected files and the full text diff can be reviewed against actual contents for an identified snapshot. Added and deleted text files are included; other changes and limitations are visible.
- [x] #8 A relevant build/test starts through a visible action with a visible, editable command and working directory. Output, exit code and tested snapshot are shown; the result does not automatically apply after another code change.
<!-- AC:END -->
