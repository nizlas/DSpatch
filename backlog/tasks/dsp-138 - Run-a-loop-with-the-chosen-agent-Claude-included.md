---
id: DSP-138
title: 'Run a loop with the chosen agent, Claude included'
status: Review
assignee: []
created_date: '2026-10-27 01:32'
updated_date: '2026-10-27 02:34'
labels:
  - loop
  - providers
dependencies: []
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 27 Oct 2026: his Cursor account is closed; the main chat and review already have an explicit provider choice, but loop runs still require Cursor (DSP-136 P-NEW-1). Make loop runs provider-neutral and runnable through the existing Claude adapter, reusing the shared provider handling (provider-availability, provider-adapters, the agent choice). Keep Cursor as a possible choice. No silent fallback, no installation, no contact with Cursor when another agent is chosen. Keep apart: the agent's tools and permissions; commands DSpatch itself runs for builds and tests; the review discussion's strict text-only mode. No new broad tool rights for Claude to make tests pass. Bind each run and session to its provider; never resume a session through another provider. Preserve cancellation, failure status and double-run guards; keep history without auto-restarting an interrupted loop. Not in scope: remote transport, a separate host process, Copilot, a general UI or architecture rebuild.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new loop run uses the project's explicit agent choice (or an explicit choice in the loop definition where supported), the window shows which agent will run it, and no Cursor adapter is constructed or contacted when another agent is chosen
- [x] #2 A missing, uninstalled or incapable agent is stated plainly before the run starts; nothing falls back, installs or contacts Cursor
- [x] #3 A Claude loop step reuses the existing adapter's session handling, model choice, events and cancellation with permissions no broader than the main chat's; DSpatch's own build/test commands stay separate from the agent's tools
- [x] #4 Each run and step session is bound to its provider and never resumed through another provider; cancellation, failure status and the double-run guard are preserved
- [x] #5 A complete small loop runs offline through the product's real run path with a simulated Claude adapter: right provider, steps in order to the right end status, results and failures on the right step, cancellation without a later step starting, missing Claude support stated without a download; plain install still works without Claude and Cursor loop support is unbroken
- [x] #6 The Linux home trial guide has a short concrete loop trial for a later real Claude run
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 27 Oct 2026 (run 20261027-013000-loop-provider), unattended overnight run. Current focus: map where loop runs construct or require Cursor, then plan.

Plan (run 20261027-013000-loop-provider, Planner call 1): S1 provider-neutral run path (loop purpose in providerAdapters, required adapter in runLiveGraph, provider on sessions/inspection/record, pre-run refusals in a new loop-run-agent.ts); S2 a visible 'runs with' line; S3 offline end-to-end with the real Claude adapter on a substituted SDK, Linux trial Part C. Recommendations proceeding overnight: graph target stays a drawing label (Q1); Claude loop steps get CHAT_PERMISSIONS, no commands, so a check step that needs a run reports could-not-check (Q2); non-Claude fixed model and multiple folders refused before start (Q3, Q4). Current focus: plan review (call 2).

Plan review (call 2): ACCEPT with A1 (authentication preflight beside the factory, nothing constructed), A2 (one prepareLoopRun before the record and beginRun, tested), A3 (display cut to the agent line and policy text; no Claude row in TARGET_CAPABILITIES; provider-keyed requirement table is a follow-up), A4 (stale comments, seeded agent choice in loop kits). Current focus: implementation I-1 (call 3).

I-1 (call 3) implemented, uncommitted, snapshot-i1 sha256:aef2b2ef. Current focus: verification V-1 (call 4).

Result (run 20261027-013000-loop-provider; Implementer calls 3, 6; Verifier 4, 7 PASS; Reviewer 2 ACCEPT with A1-A4, 5 REWORK B1/B2, 8 ACCEPT; coordinator applied R-2 IM1-IM3). A loop run (chat Use loop and the editor's Run) uses the open session's agent, else the explicit stored choice; nothing is assumed; the graph's target is a label of the drawing. One preparation (app/src/main/loop-run-agent.ts prepareLoopRun) runs after the double-run guard and validation and before the run record and beginRun, and refuses plainly ('... Nothing was started.'): no agent chosen; agent unavailable or Claude support not installed (the factory's sentence); the authentication preflight (provider-adapters.ts preflight, constructs nothing); more than one folder under Claude; an entry step fixing a model other than claude-haiku-4-5 under Claude (so the editor's duration drawing, a Cursor fixture, cannot run under Claude). The adapter comes from the shared factory, purpose 'loop': Claude gets CHAT_PERMISSIONS unchanged (Read, Glob, Grep, Edit, Write; no Bash, no MCP), Cursor provider-default; REVIEW_PERMISSIONS unreachable; DSpatch's own gate commands unchanged and separate. The executor opens each step session with the run's provider and fails the step if the handle answers another; provider on the inspection, sessions, run record (optional; old records read as not recorded) and announcement. The product run module imports no Cursor adapter; the CLI (loop-live-cli.ts) stays Cursor-only and says so. The editor shows 'Runs with <agent> (<model>): ...' (Claude: agent steps read and edit files and cannot run commands; a check needing a build is likely to end could-not-establish; a gate's command is run by DSpatch). Evidence: tests/loop-provider.test.ts (18+2 tests) runs prepareLoopRun -> runLiveGraph on dspatch-chat-loop with the real ClaudeAgentSdkAdapter on a substituted SDK: right provider, Cursor built 0 times, work->check->done, step error on its step, cancel during work with check never sent, provider mismatch refused, each refusal with nothing constructed and no record; negative control (hard-coded 'cursor' restored) fails 4 tests. Window (presentation, Cursor): agent line, inspector label sentence, a Use loop run recorded provider cursor; existing loop scenarios pass. Groups: fast 1279, loop 593, live 71, chat 382, review 90, presentation 298. NOT verified: any real Claude loop (simulated only); the no-agent and Claude refusals on screen (presentation scenarios always choose an agent); Linux. Real trial: docs/LINUX_HOME_TRIAL.md Part C. Follow-up: DSP-139.

Questions for Niclas (the run proceeded on each recommendation): Q1 a loop's target is not a provider choice; a provider field in the format is deferred. Q2 Claude loop steps cannot run commands (CHAT_PERMISSIONS), so a check needing a build ends could-not-establish; later either a DSpatch-run gate in the chat loop or a narrowly allowlisted command tool (DSP-139). Q3 an entry step fixing another model is refused under Claude. Q4 more than one folder is refused under Claude.
<!-- SECTION:NOTES:END -->
