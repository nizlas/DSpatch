---
id: DSP-139
title: >-
  Say per agent what a loop step can do, and stop telling a Claude step to run
  commands
status: Review
assignee: []
created_date: '2026-10-27 02:33'
updated_date: '2026-10-27 07:53'
labels:
  - loop
  - providers
dependencies: []
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from DSP-138 (run 20261027-013000-loop-provider, review R-0 I3, R-1 I4). Loop runs now use the chosen agent, but (1) the requirement answers in the node panel are keyed by the drawing's target (TARGET_CAPABILITIES, LoopTarget), not by the agent a run uses; a table keyed by provider (StoredSessionProvider) is needed, never a Claude row beside the claude-code row, which describes generated agent files. Under Claude's CHAT_PERMISSIONS no-subagent-delegation and tool-restriction would honestly differ from Cursor's. (2) The chat loop's work purpose (docs/loop/graphs/dspatch-chat-loop.graph.json) and docs/loop/roles/project/project-check.role.md tell the agent to run commands, which a Claude step cannot; the run's agent line states it, but the instructions do not. Options for checks under Claude (Niclas's decision, DSP-138 Q2): a DSpatch-run gate in the chat loop, or a narrowly allowlisted command tool. (3) No presentation scenario can leave the agent unchosen, so the no-agent and Claude refusals of a loop run are shown only by unit tests, not on screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A bundled example (dspatch-duration-check, agent steps inherit) starts from the editor's Run under Claude without refusal; dspatch-live-duration is byte-identical and still refused under Claude
- [x] #2 DSpatch runs the explicitly configured command shown in the editor (gate panel and purpose) through runConfiguredProjectTest; no agent gets a command tool; CHAT_PERMISSIONS unchanged
- [x] #3 The check step's message contains the gate's run id, visit, command, folder, exit code or signal, bounded output with an omission note, and the tested snapshot id
- [x] #4 A failing test ends at a not-success terminal and a missing command at not-established; neither reaches done
- [x] #5 A gate result counts only for the snapshot it tested: if the working copy differs or is unobserved when the receiving step starts or ends, the step is told so, its outcome becomes its whenUndeclared with source verification-stale, the rule is stated in the handover and journal, and the run does not end at success
- [x] #6 Cancel during work or during the gate starts no later agent step
- [x] #7 The project roles and chat-loop purposes no longer tell an agent without command tools to run commands, and still tell one with them to
- [x] #8 Node panel requirement answers are keyed by the run's provider and step kind; a gate step says DSpatch runs its command; the claude-code row is unchanged and no Claude row sits beside it
- [x] #9 Offline evidence: real Claude adapter on a substituted SDK, a real node --test in a generated temporary repository, Cursor constructed 0 times, no installs, no profile reads, no live calls
- [x] #10 Linux trial Part C describes the example run and the outcomes it should show
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Run 20261027-090000-dsp139-gate. Focus: plan - a gate step in which DSpatch runs the configured test command between work and check under Claude; a small editor-runnable example without a Cursor model lock; step instructions and the tool-policy text keyed by provider.

Plan (report 001) accepted with amendments A1-A4 by R-0 (report 002). Decisions taken on recommendation, open for Niclas: Q1 the example's gate command is a code-side binding shown in the editor (a command field in the format waits); Q2 a stale gate result replaces the receiving step's outcome with its whenUndeclared (option A); Q3 a failed test ends at tests-failed, no rework round; Q4 item (3), the on-screen no-agent refusal, is split out. Stated departure (A3): INTERACTION_MODEL.md section 8 superseded choosing a run's branch by comparing file trees. The stale rule compares the tested snapshot with the working copy to decide whether a gate result may stand as evidence; it does not classify the work, but it does change the branch. Consequence for Cursor: a check step that edits files after a gate and then runs its own tests is still recorded as its whenUndeclared outcome. INTERACTION_MODEL.md is not changed. Focus: implementation S1+S2.

R-0 ACCEPT WITH AMENDMENTS; V-1 PASS on mandate items (findings F1-F3); R-1 REWORK (B1 panel brief and gate rule visibility, B2 a non-UTF-8 vacuous test assertion). Departure, further consequence (R-1 I4, I5): a rework step that is handed a gate result and edits as intended is overridden too, and a gate whose command writes into the tree makes its own result unusable; no shipped drawing does either; follow-up DSP-144. Split or recorded: DSP-140 (gate command in the drawing format; chat-loop gate), DSP-141 (item 3, on-screen refusals), DSP-142 (rework after a failed gate), DSP-143 (Cancel stops a running gate command). Linux trial Part C rewritten (steps 13-19). Focus: rework I-1 (B1, B2, I1-I3, I6, I7).

R-2: code rework accepted; guide step 16 made conditional (a real model may still complete the function because the drawing's purpose is the mandate) and the old-Node wording corrected. Recorded improvements, not done here: claude-agent-sdk-adapter.ts describePermissionPolicy still says 'no settings read from disk' (add 'other than managed policy settings', as in loop-graph.ts); the panel's 'What earlier steps left for it' part carries the tag 'pointed at, not included' beside 'reproduced whole inside the message' for stored-result and gate handovers (predates DSP-139; loop-chat.ts received part carried:false); DRAWING_TASK_PRECEDENCE reuses the line 'a later message from the person included' in a run nobody typed into (accurate as shown, inaccurate in context). Verified offline only: V-1 and V-2 PASS; no real Claude run.

Result (offline, Windows): the bundled drawing dspatch-duration-check runs from the editor's Run with Claude chosen through the real adapter on a substituted SDK; DSpatch runs a real node --test in a generated repository; the check receives command, folder, exit code, bounded output and the tested snapshot; failed test ends Tests failed; stale or unobserved results never end at success; cancel during work or the gate starts no later step; Cursor constructed 0 times, no installs. Tests: loop 611, live 86, presentation 298, chat 382, typecheck and build. Not established: any real Claude run, Linux, Node version thresholds, Niclas's UX assessment. Next: Linux trial Part C steps 13-19.
<!-- SECTION:NOTES:END -->
