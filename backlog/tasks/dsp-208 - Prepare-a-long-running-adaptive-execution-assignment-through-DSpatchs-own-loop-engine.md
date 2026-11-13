---
id: DSP-208
title: >-
  Prepare a long-running adaptive-execution assignment through DSpatch's own
  loop engine
status: Review
assignee: []
created_date: '2026-11-13 20:54'
updated_date: '2026-11-13 22:31'
labels: []
dependencies: []
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requested by Niclas on 13 November 2026. Prepare, but do not start, a long-running implementation assignment that will realise the vision document 'DSpatch Adaptive Execution and Shared Context', version 0.1, through DSpatch's own run engine (the app's runnable loop, not the external /dspatch-loop procedure). Anchored in BACKLOG.md's 'Near-term follow-up: adaptive loops and interactive chat' (commit 53ed093); this task is the preparation that note leads to, not a second follow-up.

Scope: establish from the code what the engine, adapters and bundled loops actually support (persisted plan and state, interruption, auth failure, host restart and resume, rework from review findings, limits, pause/correct/continue, context per role, how instructions and the verification policy reach every role); fix only concrete blockers for this run; prepare a runnable loop in the loop editor that maps, researches when needed, plans sub-goals, implements, reviews separately, returns findings for rework, persists working state per sub-goal and assesses the whole; write the start brief; set concrete configurable continue/stop limits. No release, and the main assignment is not started.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A short account separates engine support, what the current graph uses and what is missing, with code references
- [x] #2 Only concrete blockers for this run are fixed, each with a targeted check
- [ ] #3 A named loop is available in DSpatch's loop editor, opens and edits there and starts through the app's normal run flow
- [x] #4 The start brief carries the vision, the relevant governing documents and an explicit summary of the conversation's decisions and limits
- [x] #5 Continue, pause, block and abort conditions and limits are concrete and configurable; skipped is not done; agent review is not Niclas's approval
- [x] #6 Niclas has exact steps to start, pause, follow and resume the run in the app, and a list of what needs his manual help
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mapping by code reading, 13 November 2026, recorded in docs/missions/adaptive-execution/BRIEF.md section 4 with its limits; three read-only code surveys plus direct reading of loop-run.ts, loop-graph.ts, loop-live.ts, main.ts and local-host.ts.

Real obstacles found and how they are met without new engine machinery:
- A run lives in memory and cannot be resumed after a restart, a fault, a cancel or a human node (stop-and-reconcile ends it). Met by batches: the mission's coordinator writes docs/missions/adaptive-execution/STATE.md before every outcome and commits each accepted sub-goal locally, and a new run with the same mandate reconciles the file with Git and continues. Manual continuation, stated as such.
- The mandate is only the composer text, and no runtime loads AGENTS.md. Met by a prepared start brief every step is told to read, and by role text: the mission coordinator role and every node purpose name AGENTS.md and its verification policy.
- No skip state, no sub-goal notion and no report panel in the run view. Met by the coordinator recording skipped steps with their reasons and each sub-goal's status in STATE.md; the run view shows the replies, the hand-off trail and the path taken. A visible skipped state is part of what the mission builds.
- Login failures and provider errors end a run as a runtime fault. Not worked around: the brief tells Niclas to log in again and start a new run.
- Mission edits to DSpatch's own code could change the running engine. Met by running the mission from a separate detached worktree built once (npm run build, npm start: no dev-server reload, host from that checkout's dist), and by forbidding the run to edit its own brief, graph, definition or coordinator role. Engine changes are taken into use between runs.

Fixed: validation said limits and onRuntimeFault were honoured by nothing, so an author editing a limit was told it did nothing. ATTRIBUTE_SUPPORT now marks both honoured with caveats saying what the runner bounds and where it stops (app/src/shared/loop-graph.ts), with tests/loop-graph.test.ts and GRAPH_FORMAT.md updated.

Added: docs/loop/roles/run/dspatch-mission-coordinator.role.md; docs/loop/graphs/dspatch-mission-loop.graph.json (hub coordinator, planner, researcher, implementer, optional verifier asked for by the review, review with rework, whole assessment, final report; seven terminals); .dspatch/loops/dspatch-mission-loop.loop.json; docs/missions/adaptive-execution/BRIEF.md and STATE.md; docs/ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md (the vision, v0.1, unchanged); DSP-209 for the main assignment.

Checks: tests/loop-graph.test.ts 41/41; npm run typecheck:node clean; the mission graph loads against the real role files with no errors or warnings (notices only); scripted dry walks (no provider) reached mission-complete, batch-paused and needs-decision as drawn and stopped at maxReworkRounds on the fifth rework; discovery lists DSpatch mission loop from .dspatch/loops without error. Not tried: a live run, the loop in the editor window, the worktree engine setup; those are Niclas's.

Night run prepared, 13 November 2026 (Niclas: the whole mission in one autonomous run). The graph now allows 180 calls and 60 rework rounds, under the runner's own 200-transition bound. The review gained a stalled verdict, which separates repeated attempts on one problem from ordinary rework. A blocked, stalled or waiting sub-goal no longer ends the run. The brief now separates the mission's own design decisions from those that stop for Niclas. The engine checkout C:\Users\nicla\development\DSpatch-engine is built at 81a5949 with Claude support installed; Electron's install script had to be run by hand. Its window and host were started and recorded as 1.0.0 at 81a59496614a from that checkout, with ownRepo set to the engine checkout. The workspace for the working copy is remembered with the mission loop chosen; the store was backed up first. The app did not open the workspace on its own, so Niclas opens it from the recent list. Not done, and Niclas's to do: the one-time Claude consent in this profile, opening the workspace, keeping the machine awake, and starting the run.

Start blocked, 13 November 2026: 'The sign-in could not start: spawn ...\provider-support\claude\...\claude.exe ENOENT'. The cause was in the code, not the installation. A build from a working copy with its own app/claude-support (npm run claude:install) runs sessions from that folder and never fills <data>/provider-support/claude. The setup dialog still asked that empty fetched folder for the sign-in status and spawned the sign-in from it. The status answered 'not signed in', and the spawn failed. Fixed in c04536b (ProviderSetup.programFolder, given by the host), with a targeted test in tests/provider-setup.test.ts (20/20) and a clean typecheck:node. Checked against the rebuilt engine with the real claude.exe: auth status reports signed in, and the sign-in would spawn the engine's own claude.exe (which exists) with auth login --claudeai. The engine checkout moved to c04536b and was rebuilt between runs, with no run active, and restarted: client and host are 1.0.0 at c04536b0eacb.

Second start block, 13 November 2026: '"DSpatch" could not be opened: CLAUDE_CODE_OAUTH_SCOPES is set.' The cause: the engine had been started from the Claude Code session preparing it, and inherited that session's environment. That environment held about 55 names not in the Windows login environment, among them CLAUDE_CODE_OAUTH_SCOPES and ANTHROPIC_BASE_URL (both refused by assessAuthentication, DSP-109), CLAUDE_CODE_* session variables, USE_STAGING_OAUTH, GIT_ASKPASS and CHROME_CRASHPAD_PIPE_NAME. None is set in the User or Machine environment. The adapter's check stays as it is. docs/missions/adaptive-execution/start-engine.ps1 now starts the engine with an environment built only from the Machine, User and volatile login variables plus Windows' per-process defaults. It refuses to start if a guarded name is set globally, and its console output goes to a file. Checked with the built engine's assessAuthentication over variable names only: the launcher's environment is accepted, and the inherited one is refused with exactly the reported error. Client and host were restarted through the launcher, with no run active: 1.0.0 at c04536b0eacb.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Prepared the adaptive-execution mission (DSP-209) without starting it: the DSpatch mission loop in the loop editor, its coordinator role, the start brief with the conversation's decisions and limits, a working-state file, and a corrected limits notice in graph validation. Continuation across runs is manual by design, through the state file.
<!-- SECTION:FINAL_SUMMARY:END -->
