---
id: DSP-4
title: 'Preserve conversations, changes and execution results after restart'
status: Review
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-15 08:45'
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
- [x] #1 The project association and conversation, including message order, survive a normal restart.
- [x] #2 A follow-up after restart receives relevant saved context; any new provider session and its limitations are disclosed.
- [x] #3 An interrupted or unknown run is reconciled before continuing. Previous jobs, file changes and commands are not automatically repeated on restart.
- [x] #4 Storage has a format version and documented export; secrets are excluded from saved history and Git.
- [x] #5 Restart, interruption, external file changes and an unreadable or unsupported storage format have been checked with results tied to the tested version.
- [x] #6 The previously reviewed diff and execution result, including command, working directory, output, exit code and code reference, can be read after restart. A changed working copy is not overwritten; old results do not appear to verify new code.
<!-- AC:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
Implemented across calls 006 and 007 of run `20260914-205132-nt4m` and verified independently in call 008. All six criteria pass on the code in the working copy, and none of the six verdicts rests on a fake adapter.

### What was built

One versioned JSON file per conversation under Electron's `userData`, written by temp-file rename. It holds the messages in order, the attempt records, the command results with their command, working directory, output, exit code and snapshot, and enough of the session baseline to reconstruct the reviewed diff exactly. `app/src/main/conversation-store.ts` is the store; `chat-service.ts` saves at session open, send, run start, run finish, command end, diff read and close.

Restart restores history, never activity. Reopening reports "0 model runs, 0 commands, 0 writes into your project", and there is no composer until the conversation is continued deliberately. An attempt still running when the process died comes back as `outcome-unknown` rather than as an invented ending, and blocks the next message until named. A saved pass is re-checked against the code on disk and comes back as "passed for older code" when the snapshots differ, with both named; the diff is relabelled a record of what was reviewed rather than a description of the code on disk, while its text stays byte-identical.

### The question the task raised, answered by measurement

A Cursor SDK session can be resumed in a new operating-system process. Verifier 008 established this with the control that makes it evidence rather than a plausible-sounding answer: the same resume call was refused in 10 ms with `agent_not_found` once Cursor's store for that path was moved aside, and a fresh agent on the same project answered "NO PASSPHRASE". That store lives at `~/.cursor/projects/<workspace-key>/sdk-agent-store/`, keyed by the working copy's path, outside this repository. Its retention is unknown, so how long a resume keeps working is unknown; both branches state which store they depend on.

When resume succeeds, nothing is resent and `resentContext` is null on disk. When the provider refuses, DSpatch opens a new session, quotes the refusal, states that the model has no memory of the conversation on screen, and shows its recap verbatim. The recap deliberately carries no file content — the code may have changed since those turns and the agent can read the project itself — and says inside itself what it is not. Verifier 008 compared it across three sides: the window's 2 260 characters, DSpatch's stored copy, and Cursor's own transcript of the message received, which begins with exactly those characters.

### Degradation

Eight kinds of unusable file each get their own explanation and their own recovery action, and in every branch the bytes are left exactly as they are, verified unchanged in content, hash and mtime. A leftover `.writing-<pid>` file from a save that never finished is listed and deliberately never deleted, because it is the only evidence that the save was lost. Export writes a byte-for-byte copy and works on the files DSpatch cannot read, which are the ones worth rescuing.

### Verified

Six Electron launches over one saved conversation; the reviewed diff byte-identical across five captures four restarts later; export byte-equality on all seven files; no credential, token or address-shaped string in the stored bytes, including the recap text DSpatch composes itself. `npm run typecheck` exit 0, `npm test` 188 pass 0 fail, `npm run build` exit 0.

### Known and open

Untested: Linux, VS Code/Copilot, concurrent windows on one store, a network path, the storage budgets at their limit, and the export save dialog. The recap reaches the model and is used, which is not the same as being sufficient for a long conversation with a large diff. Acknowledging an unknown outcome lets one message through rather than the conversation — honest, but friction, and a decision for review rather than a defect. A conversation file carries base64 copies of the baseline files, so an export contains project source. Whether any of it reads well is Niclas's judgement and is not recorded as met.
<!-- SECTION:NOTES:END -->
