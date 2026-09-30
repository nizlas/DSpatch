---
id: DSP-70
title: The definition you chose is the definition that runs
status: Review
assignee: []
created_date: '2026-09-20 09:01'
updated_date: '2026-09-20 10:14'
labels: []
dependencies:
  - DSP-68
  - DSP-69
priority: high
type: feature
ordinal: 15702
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Removes the silent switch. Today main.ts loads the chat loop from a constant inside DSpatch's own repo and describeChatLoopBinding refuses any graph whose id is not literally dspatch-chat-loop, so what runs is never what was chosen. The selection carries definition id, graph path and the byte-hash version id run-record-store already computes. The simple chat loop ships as an ordinary named definition through the same mechanism rather than as a special case. A provider fact supports the immutability rule rather than it being DSpatch politeness: dirs is on Agent.create and Agent.resume only, never on send, so a session's roots are fixed for its lifetime.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With Use loop ticked, the graph shown before send is the graph that runs.
- [ ] #2 Its version id is identical before, during and after the run.
- [ ] #3 Selecting a different definition mid-run changes nothing about the run.
- [ ] #4 Editing the running definition's file mid-run changes nothing about the run.
- [ ] #5 The simple chat loop is reachable by name and behaves as today.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, calls 003 and 005. CHAT_LOOP_GRAPH_REL deleted and the dspatch-chat-loop id whitelist gone; DSpatch's own chat loop is now an ordinary declaration at .dspatch/loops/dspatch-chat-loop.loop.json, found because the folder is searched. The window holds a definition key, never a graph; a run resolves once and holds it. The one surviving refusal is the development loop, now applied at the row so it is unselectable rather than looking ready and failing on Send. Verifier confirmed by search that CHAT_LOOP_GRAPH_ID's remaining uses are default-and-label, not a gate. Candidate sha256:b8a0340c. Known gap: the run record names the graph but not the definition id - deferred to DSP-74/DSP-75.
<!-- SECTION:NOTES:END -->
