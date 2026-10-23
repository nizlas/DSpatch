---
id: DSP-4
title: 'Preserve conversations, changes and execution results after restart'
status: Review
assignee: []
created_date: '2026-09-13'
updated_date: '2026-10-23 19:53'
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
- [x] #7 WS-1: A saved with 2 messages and a passing test; open A and send; open B and read B's diff; open A again: A shows 3 messages; A's file keeps all messages, attempts and test runs, contains nothing of B, and A's test status refers to A's own code version; the same holds when a new app run reads the files
- [x] #8 WS-1: a command result is filed under the conversation that started it, even if the session changed before the command finished
- [x] #9 WS-1: attempt identity is unambiguous across conversations opened in one app run: a conversation file never receives another conversation's attempt and never loses its own; no false 'could not be read back' note and no restart wording after a switch; each attempt appears once
- [x] #10 WS-1: the recap and the saved-message count are built from the same merged conversation the window shows, including this app run's turns
- [x] #11 WS-1: an unresolved attempt blocks the same kind of work in its own working copy (same or nested path) after A -> B -> A, does not block other working copies, and can be acknowledged only there
- [x] #12 WS-1: no save removes a message, attempt or test run the window did not deliberately remove (duplicate-turn removal only); any guard never blocks the pre-send save and says what it kept; the baseline is handled as before and never taken from another conversation
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

Rework WS-1 (Niclas, 23 Oct 2026): DSP-4 is back In Progress because its "conversation survives" promise breaks when switching within one app run. Confirmed defect (offline probe V1, 23 Oct 2026, real ChatService and ConversationStore at 4602289, isolated temporary data, repository untouched): open A (saved with 2 messages, 3 attempts, a passing test run), send, open B, read B's diff, open A again -> the save at reopen rewrites A's file with 1 message (3 -> 1), 1 attempt (4 -> 1) and no test runs, and B's reviewed diff and failed test result move into A in memory and on disk; A's baseline was not affected. Cause read in code: opening B releases A's restored records (chat-service.ts:2316-2325; attempt-ledger.ts:273-279); reopening A takes the in-memory branch that neither re-reads A's file nor resets the carried diff and test (:2381-2398). Related defects read in code, not yet observed: attempt IDs numbered per window collide across conversations (restore skips an ID already in the ledger, attempt-ledger.ts:188-195; adoptSaved maps every attempt in the file, chat-service.ts:2328-2330); the recap and saved-message count are built from carried messages only, not this run's turns (:1233, :1244); the repeat block applies window-wide (attempt-ledger.ts:430-436) and to no restored attempt after a switch (:2317); a command result is filed under whichever conversation is current when it finishes (:2097-2105). Earlier criteria #1-#6 stand as verified for restart; they are not re-opened. Plan: run 20261023-200000-ws1 (Implementer, Verifier, Reviewer), offline only, isolated test data, no live call, no change to Niclas's saved conversations.

WS-1 result (23 Oct 2026, run 20261023-200000-ws1, base 4602289, accepted candidate sha256:50d21968da713d4c69d0971c19b87192f5717f5463fa7ad1703a5f54728c8561): Implementer calls 1, 2, 5, 8; Verifier calls 3, 6, 9 (all PASS); Reviewer calls 4, 7, 10 (ACCEPT each; two rework rounds taken by the coordinator for non-blocking findings). Offline only, isolated temporary data, fake adapter, no live call; Niclas's saved conversations untouched.
- Design (general execution in chat-service.ts and attempt-ledger.ts): each conversation opened in an app run is held as its own record (ledger, carried messages, test runs, last test, reviewed diff, baselines, session record, saved-body digest) until the window closes, and every save is built from the named conversation's own record; a held conversation is never re-read in the same run. Attempt IDs: a ledger per conversation plus one shared counter, seeded at the first successful store listing from the highest ID in any readable conversation file (new store-only ConversationStore.listWithAttemptIds; list() and the format unchanged). Repeat block per working copy (same, nested or containing folder; case-insensitive on Windows), per kind as before, acknowledged only within that working copy, held across restarts (unresolved overlapping conversations are read and held at the first open). Recap and saved-message count from the same merged conversation the window shows. A command result is filed under the conversation that started it, with that working copy's snapshot; a command killed by a session change is recorded as interrupted / killed by DSpatch / stopped-confirmed. Execution state panel shows the current conversation's attempts plus unresolved ones from the same, a nested or a containing folder (sentence updated; unique row keys). Memory: carriedBaseline released once the stored baseline exists and the saved body kept as a digest (measured 58.5 MB -> 15.8 MB for three held conversations over 4 MB projects). No adapter, main, bridge or format change (CONVERSATION_FORMAT_VERSION stays 1).
- Regression evidence: app/tests/conversation-switch.test.ts (chat group, heavy) - the six WS-1 tests failed 6/6 on the unchanged code (Implementer, and independently on an exported 4602289 by the Verifier) and pass 6/6; the two attempt-ID tests fail on the base and on candidate-002 and pass; the listing-retry test fails on candidate-003 and passes; tests/working-copy-overlap.test.ts (fast). Inferred defects all reproduced: attempt-ID collision (A's file received B's live attempt), recap without this run's turns, window-wide repeat block, late command result filed under B; plus S1 (duplicate IDs in the panel after a later file read), now observed and fixed. Final checks at candidate-004: typecheck 0; chat 313/313; fast 1135/1135 and presentation 266/266 at candidate-003 (no later change in their scope beyond the chat files). Verifier instruments: 70 checks (call 3), 24 (call 6), 7 (call 9), 0 failures; kill paths compared on base and candidate.
- DSP-4 criteria #1-#6 still covered by passing tests (restart order, recap disclosure, reconciliation, newer/unparsable formats, reviewed diff and result after restart).
Carried, not done (separate notes): S3 cancelRun still records a command DSpatch killed as "ran to the end and exited 1" (failed, completed) - predates WS-1, observed on base and candidate; belongs with NEW-A's truthful cancel endings or a small follow-up. S5 off-screen ledger changes (confirmation timers) are not saved until the next save of that conversation, dispose saves only the current conversation, and a failed off-screen save is only logged. S6 a file that lists one attempt ID twice: the note advises exporting first, but the direct-open path saves immediately; treat like the store's other damaged files. S7 a send that resolves after a switch can clear the next conversation's owed recap and binds run.started to the current ledger - for WS-2b (refuse switching during a run) and WS-3. Residual limits: attempts made before the first successful store listing, IDs in unreadable or newer files, and files written by another process are not counted; older files can already share IDs (shown as two rows; one acknowledgement covers both). Two code comments (chat-service.ts ~:2308-2309, ~:2536) still say the file is a copy of memory - reword later. Not tried: the Electron window, a real provider, git-initialised projects, Linux.
Awaiting Niclas: window check of A -> B -> A on a real project and after restart; the Execution state panel and its sentence (incl. a subfolder workspace); acceptance of "acknowledged only in A" as A's working copy (same or nested folder).
<!-- SECTION:NOTES:END -->
