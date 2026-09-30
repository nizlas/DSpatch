---
id: DSP-79
title: >-
  Make a handover real: one agent per step, and the development loop's own
  requirements
status: Review
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-22 21:14'
labels: []
dependencies:
  - DSP-78
priority: high
type: feature
ordinal: 15711
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is the whole of runnable rather than drawable. Today the runner starts ONE Cursor session and sends every node's prompt into that same session - inspection.sessionId is a single nullable string - so there is no handover at all: the next node is the same agent asked another question. That is not a degraded handover, it is a different thing wearing the word. Give each agent node its own session with its own brief. On top of the general support, this carries the development loop's optional requirements: the candidate as the work version a verifier consumes, review material, backlog. Replace the FORBIDDEN_LIVE_GRAPH_ID id-check with a working-root refusal, so the definition is allowed while DSpatch as a working root is still refused. Remove not-yet-honoured notices only for what is actually honoured. NAMED GAPS that stay, and the card must not imply otherwise: durable reconciliation across a restart; content-identified candidates binding verification and review to one tree; read-only role enforcement; limits declared but not enforced; human nodes answerable in chat. And it is not our loop - it is a loop shaped like ours, running against another project through independent local agents rather than Cursor subagents. Our development loop keeps running in Cursor. One assumption to probe BEFORE scheduling rather than after: that several independent local agents can run concurrently in one process against different working directories. The whole handover rests on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two consecutive agent nodes use two different provider sessions, observable in the record.
- [ ] #2 A node required to write its own report that writes none is not recorded as delivered.
- [ ] #3 A read-only node's report is filed by the runner.
- [ ] #4 The definition runs against a non-DSpatch project.
- [ ] #5 DSpatch's own working copy is still refused as a working root.
- [ ] #6 Every remaining unhonoured attribute still reports itself.
- [ ] #7 The named gaps are stated where a person reads the result, not only in this card.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Revisited by DSP-100. DSP-79 gave every fresh agent the mandate but suppressed it on a revisit, reasoning that the session already holds it. DSP-98 showed what that missed: TASK_PRECEDENCE is sent on every visit and asks the step to rank the person's own words above another step's account of them, and a rework round is precisely where that account arrives. Ranking two texts while only one is in the message is not a judgement anyone can make, and on 22 September it was not made. The mandate now returns on a revisit, framed as repeated unchanged and the same assignment as before rather than as a new one. Tests that asserted the suppression are inverted, with the reversal argued in place.
<!-- SECTION:NOTES:END -->

## Premise corrected, 20 September 2026 â€” read before starting

<!-- SECTION:NOTES:BEGIN -->
This card was written from our Cursor workflow, and Niclas has pointed out that parts of that workflow are **workarounds for Cursor's limited subagent depth** and must not become product requirements for historical reasons. I had been treating our own workaround as the specification.

Candidates for *workaround rather than requirement*, to be judged individually rather than inherited: the report **file** as the delivery mechanism; the handoff written as a markdown file; and the write-your-report-before-you-end rule. All three exist because a subagent's result reaches the coordinator as a chat message that can be lost â€” and a loop where Maestro owns both the call and the return does not have that problem.

Candidates for *survives on merit*: content-identified candidates, one result per node visit, a required result being checkable, and reconciliation of an unknown outcome.

**What replaces the framing:** a coordinator must be able to delegate to an agent **or to a subloop**, await the result and continue with preserved context â€” through Maestro, even where the provider offers no nested subagent call. That is nesting, which this card did not contemplate, and it is being planned as its own step.
<!-- SECTION:NOTES:END -->

## Shrunk again, and the probe restated

<!-- SECTION:NOTES:BEGIN -->
The report-file machinery leaves this card entirely; it is a workaround, judged individually in the planner's table. What remains is the core: **one session per agent node with its own brief**, plus the working-root refusal replacing the graph-id check. The candidate as a consumable work version stays.

**The probe in this card's description is restated, and it is now a much weaker claim.** The sequential walk does not need two agents running at once. It needs several sessions to **coexist in one process, idle and resumable**, so a rework edge can return to a node and continue with the context that node already had. Our adapter already holds a map of sessions. So the probe is *can five local agent sessions coexist and be resumed in order*, not *can five run simultaneously* â€” cheaper, and far likelier to pass.
<!-- SECTION:NOTES:END -->
