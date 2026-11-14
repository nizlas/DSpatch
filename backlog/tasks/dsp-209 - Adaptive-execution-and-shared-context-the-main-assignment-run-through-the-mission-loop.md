---
id: DSP-209
title: >-
  Adaptive execution and shared context: the main assignment, run through the
  mission loop
status: To Do
assignee: []
created_date: '2026-11-13 21:05'
updated_date: '2026-11-14 16:29'
labels: []
dependencies:
  - DSP-208
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The long-running implementation assignment for docs/ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md (v0.1, 13 November 2026), carried out through DSpatch's own run engine with the loop dspatch-mission-loop. It extends BACKLOG.md's 'Near-term follow-up: adaptive loops and interactive chat' (commit 53ed093) rather than duplicating it.

The start brief is docs/missions/adaptive-execution/BRIEF.md and the working memory is docs/missions/adaptive-execution/STATE.md; this card does not repeat them. The mission's coordinator appends one dated line to this card's notes at the end of each run, and Niclas sets the status. Prepared by DSP-208; not started until Niclas starts the first run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each sub-goal in STATE.md is accepted by agent review, skipped with a recorded reason, blocked or awaiting a decision; none is silently dropped
- [ ] #2 The whole assessment names what is implemented, independently reviewed, verified, skipped or left open, against the vision's success criteria
- [ ] #3 Niclas has assessed the result; agent review is not his approval
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
14 November 2026, run chat-loop-2026-11-14T01-36-57-404Z: S1-S13 implemented and agent-reviewed (S5 and S10 split; S9 research), committed locally 610fa1a..bb7dba1, not pushed; whole assessment next. Agent review is not Niclas's approval; live-provider behaviour untested; questions Q1-Q4 in docs/missions/adaptive-execution/STATE.md.

14 November 2026, run chat-loop-2026-11-14T08-41-01-671Z: S15 added by Niclas (a node rename follows every node-id reference in the drawing; a removed loop recap stays removed after a restart), implemented sequentially (decision 32), agent-reviewed and committed locally; whole assessment requested. Q2 still open. Agent review is not Niclas's approval.

2026-11-14 run chat-loop-2026-11-14T09-54-18-366Z: S16-S28 (R1-R7 extension) implemented and agent-reviewed, committed locally 06b3762..; fifth whole assessment needs-decision (Q6: does R7 cover the whole app; Q1, Q3-Q5; Niclas's trials; engine rebuild + Restart host). Not pushed, not approved. See docs/missions/adaptive-execution/STATE.md.

14 November 2026, between runs (main chat): Niclas answered Q6, R7 applies to the whole app; the rest is DSP-210 and does not block this extension. Apply's missing protection against an older host fixed in 5fe88e4 (host contract changed). The fourth assessment's routing explained from the run record. Reporting corrected: every mission run used real Claude agents through DSpatch's engine; none was a live trial of the features it built, which are Niclas's to try. Q1, Q3, Q4 and Q5 remain his. Not pushed, not approved. See docs/missions/adaptive-execution/STATE.md.

14 November 2026, after Niclas's manual trial in MiniDAWLab (engine ef22440): graph creation in a project without DSpatch roles failed. The SDK transcript showed seven propose_loop_graph calls; the agent did pass roleFiles, but nothing told it the path a proposed role is placed at (.dspatch/loops/roles/<loop>-<role>.role.md), and describe_loop_building_blocks pointed at docs/loop/GRAPH_FORMAT.md, which a project session cannot read. A second fault in the same chain: a proposed role was accepted as free text, while the file Apply writes is read as a role source, so an applied graph would not have loaded. Fixed separately from the composer change: roleFiles entries are whole role sources, checked through the same reading as the file on disk (resolveRoleText); the building blocks show the smallest graph and role source; the tool description and every role finding name the exact reference. Checked by graph-authoring-tools.test.ts on a bare project (propose, Discard, Apply refused while active, Apply, load from disk) and the typecheck. Not in the running engine until it is rebuilt.
<!-- SECTION:NOTES:END -->
