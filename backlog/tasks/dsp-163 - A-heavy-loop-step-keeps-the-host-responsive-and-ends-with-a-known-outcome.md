---
id: DSP-163
title: A heavy loop step keeps the host responsive and ends with a known outcome
status: In Progress
assignee: []
created_date: '2026-11-02'
labels: [loop, remote, reliability]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A loop run on a large multi-folder workspace must not stall the project host. On 1 November 2026 (DSpatch 0.1.1, host `0.1.1-a99d1e9d35aa`) attempt `dsp-attempt-0028`, run `chat-loop-2026-11-01T22-41-15-166Z` of `reid-iteration` (`graph-1a1b1ff6af23cf26`), never got past its first step: the remote client was dropped three times, the Copilot runtime was declared gone after about 34 minutes, and the attempt was left with an unknown outcome. Read-only investigation found that the loop hashes every file of every working root synchronously before the step and at every tool start and end (`snapshotTree`, `main/experiment-repo.ts`), on a workspace of three repositories of about 137 GB, while ordinary chat uses a bounded `git ls-files` snapshot. The host's event loop was blocked, so its own silence check dropped the client and its own ping timer declared the runtime dead.

The result: snapshot work that is bounded, off the event loop, coalesced and cancellable, with a stated policy for tracked, untracked and ignored files and a record that never presents a partial snapshot as complete; health checks that do not mistake the host's own delay for a dead client or runtime; an attempt left unknown by a runtime fault reconciled from evidence where the evidence suffices; and recovery messages a person can act on without reading internal state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A loop step does not hash whole working roots at every tool call; inventory follows a stated policy for tracked, untracked and ignored files, reuses the chat snapshot where its meaning fits, runs off the host's event loop, is coalesced across parallel tool calls and is cancellable
- [ ] #2 A bounded or incomplete snapshot is recorded as such, and no record or message says "no changes" from one unconditionally; writes to other working roots are still observed within the policy
- [ ] #3 The host's own event-loop delay alone does not drop a client or declare a runtime dead; a really dead runtime or silent client is still detected; diagnostics separate transport loss, provider failure and host overload
- [ ] #4 A real network loss during a run leaves the run going on the host; the client reattaches to the same run, catches up and shows the correct end, with nothing sent or started twice
- [ ] #5 An attempt left unknown after a runtime fault is reconciled from records, provider events, process information and snapshots where they suffice, keeping its history and any remaining uncertainty; dsp-attempt-0028 is reconciled after a backup
- [ ] #6 Recovery messages say what happened, whether anything is still running and what the person can do, without pointing at a panel that is not shown and without internal ids in the normal flow; the guard against a second start stays
- [ ] #7 Timestamped diagnostics record snapshot duration, file count, bytes and scope, event-loop delay, heartbeat and ping failures, reconnection, and attempt reconciliation, without tokens or project content
- [ ] #8 Regression tests cover several roots and large ignored folders without real datasets; verification covers loop start with parallel tool calls, Stop during snapshot work, reconnection, a run ending during an outage, a real provider failure, ordinary chat and local use, and the messages in a real window
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (2 November 2026): started. Local clone fast-forwarded from `b183001` to `origin/main` `3a6b99a`; the installed host is `a99d1e9`, and `a99d1e9..3a6b99a` changes documentation only, so `app/src` here is the code that ran.

Progress (2 November 2026, continuation):
- `app/src/main/loop-live.ts` integration continued to use the new async `LoopSnapshotter` path end-to-end (step snapshots, gate snapshots, command event snapshots), replacing remaining synchronous call sites.
- Incomplete or aborted snapshot reads now consistently downgrade root identities to "not established" (`null`) instead of producing a success-shaped unchanged verdict.
- Added bounded post-stop snapshot window constant (`AFTER_STOP_SNAPSHOT_MS`) and missing helpers (`rootPathsOf`, `unobservedRoots`, `isAbortError`) to complete wiring.
- `runChangeAccountOf` now reports `not-measured` when snapshot coverage was incomplete (`snapshotIncomplete`) to avoid "nothing changed" claims from partial observation.
- `formatLiveInspection` now prints snapshot scope and incomplete-coverage reason for diagnosis.
- Verification: Node is under `~/.nvm/versions/node/v24.22.2/bin` (not on PATH). With it, the first version of the fix failed 7 snapshot tests that HEAD passed: an asynchronous snapshot begun at a command event could see what the agent did after the command.
- Fix, Claude: the adapter holds the agent at its PreToolUse/PostToolUse hooks until the listener's snapshot settles (`emitAndHold`, at most `COMMAND_OBSERVATION_HOLD_MS`); `AgentEventListener` may return a promise.
- Fix, Copilot/Cursor (only `tool.*` events, cannot hold the agent): at the event a synchronous metadata fingerprint of each root's last listing is taken (`fingerprintRoots`, no hashing, ~0.2 s on ~50k files), and the scan that follows is trusted for that moment only if `changedSince` finds nothing differing; otherwise the moment is not established. Departs from criterion 1 by that bounded synchronous read.
- New files the earlier listing missed count as changed when their ctime is within `RACY_MS` before the moment, because kernel file times lag the wall clock.
- `typecheck:node` passes; `loop-snapshot`, `loop-live`, `loop-agent-commands`, `loop-gate-check`, `gate-command-reality`, `loop-instruction-wiring`, `loop-activity` tests: 124, 0 failing (6 Windows-only skipped). Host test group not run.
<!-- SECTION:NOTES:END -->
