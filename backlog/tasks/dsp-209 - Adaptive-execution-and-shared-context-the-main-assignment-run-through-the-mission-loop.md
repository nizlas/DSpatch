---
id: DSP-209
title: >-
  Adaptive execution and shared context: the main assignment, run through the
  mission loop
status: To Do
assignee: []
created_date: '2026-11-13 21:05'
updated_date: '2026-11-14 18:49'
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

14 November 2026, after Niclas's manual trials on small-task-loop (MiniDAWLab-spike01), main chat, not a loop run. Built in separate commits: 5b8e8d6 a node's hover is a short, whole description (short purpose, else the role's summary, else a fallback sentence), its full instruction in a growing node-panel field; ecce7ab Preview of a stored proposal in the editor before Apply (roles from the proposal's own text, nothing saved, chosen or run; graph-proposal-preview.ts shared with propose_loop_graph); 98f067f the proposal card opens with the loop's name, its purpose's first sentence and the change in one sentence, with files, change lines and notices under Details and earlier proposals in a folded, numbered history; 63e8e57 side paths (declared failures and a node's whenUndeclared outcome) drawn fainter, unrelated connections dimmed on selection, and Arrange choosing between side endings beside the flow and all endings in the last row by route crossings; a832738 Help line. Saved layouts are routed as before. Investigated, unchanged: small-task-loop's a-unclear (assess -> not-established) is taken when the step declares RESULT: unclear, which DSpatch's own call contract offers because unclear is in the node's outcomes, or when the reply has no single readable RESULT among single/parallel/unclear (whenUndeclared). The saved assess role never mentions unclear and says to choose single when unsure; no contradiction with parallelisation was found. Design question, deferred by Niclas on 14 November 2026: the format documents a node's purpose as one sentence, while every graph uses it as the step's full instruction to the agent; a dedicated short description field would be a format change. The role's summary in the hover is enough for his manual trial. The engine copy was rebuilt at 70d8bd1 the same evening.

14 November 2026, evening, after Niclas's trial of small-task-loop, main chat, not a loop run: the layout engine now reserves room for edge labels and keeps alternative paths apart (da383de). Labels are measured as drawn (a Segoe UI width table, wrapped past 100 px), placed beside their own line clear of nodes and other labels, and Arrange widens the side column or the gaps while one still has no room; main-flow edges that span rows get placeholders, and a least-squares fit keeps a path's own steps in its column until the paths join, side paths and rework edges taking no part in that grouping. 307e36c: a proposal's positions are DSpatch's; a node the loop already has keeps its saved place, the rest are laid out (the MiniDAWLab proposals carried agent-written positions that bypassed the layout). Saved graphs change only on Arrange; stored proposals keep the positions they were made with. After Arrange, main-flow crossings drop or stay equal in every bundled graph, while side-path crossings rise in the larger ones (mission loop 285 to 468 in all). Not verified in the UI; Niclas tries it.

15 November 2026, after Niclas's sequential run of "Analysera repot" (chat-loop-2026-11-14T22-17-29-444Z), main chat, not a loop run. 2476ca7: a graph proposal is drawn at the turn that made it; the cards had been one block after the whole transcript although each proposal is kept on its turn's message, so the applied Proposal 3 showed below the newer run. 2fc4dc8: the node panel's Step output section opens any agent step's visit, live while it works and saved (reply and commands from the run record) once done; S20's window had needed a fan-out slice and was reachable only from Branches. The chat-loop announcement now names its conversation and a recorded reply its slice. Limitation: a graph window opened after the run ended, or after a restart, has no run to open; the chat's step reports keep the saved reply, tools and prompt. Not verified in the UI; Niclas tries it. Not verified in the UI; Niclas tries the presentation.
<!-- SECTION:NOTES:END -->
