---
id: DSP-120
title: >-
  Do not leave a DSpatch-started command running in the working copy after its
  session changes
status: To Do
assignee: []
created_date: '2026-10-24 00:18'
labels:
  - reliability
dependencies:
  - DSP-4
priority: medium
type: bug
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up of DSP-4's WS-1 work (runs 20261023-200000-ws1 and 20261023-230000-ws1b). When DSpatch stops its own test command on a session change or cancel, `stopWorkspaceTest` in `app/src/main/chat-service.ts` returns early if the shell process has already exited while its stdout is still held open by a grandchild. In that case the leaf process is not killed, the attempt is left `running` on disk until a result or the close retry arrives, and a process that still writes in the working copy can outlive the session (observed offline with a `start /b` grandchild, Verifier report 001 of run 20261023-230000-ws1b; the restart text now names the possibility truthfully). The known orphan gap of the tree kill (DSP-34) is related.

This bears on the per-working-copy rule "one writing run in the working copy" (VISION section 14; WS-1's repeat block) and is therefore a precondition for the planned "Cancel and switch" step (WS-3 in the reviewed runtime plan): a switch must not leave a process writing in the working copy of the conversation the user left. Scope: the early-return case and the orphaned-leaf case of DSpatch-started commands only; no general process redesign, and nothing about agent-run commands (TOOL-2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the shell has exited but a descendant still holds the command's output open, DSpatch kills the remaining process tree on a session change or cancel and records the attempt as interrupted, not running
- [ ] #2 A command whose tree could not be ended is recorded as not confirmed ended, with the pid, and blocks the same kind of work in that working copy until acknowledged
- [ ] #3 Offline tests with a real local substitute process tree (Windows; Linux noted as untested) cover both cases; no change to agent-run commands
- [ ] #4 Precondition recorded: the Cancel and switch step (WS-3) depends on this card
<!-- AC:END -->
