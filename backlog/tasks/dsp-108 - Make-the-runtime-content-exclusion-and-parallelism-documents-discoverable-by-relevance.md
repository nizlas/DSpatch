---
id: DSP-108
title: >-
  Make the runtime, content-exclusion and parallelism documents discoverable by
  relevance
status: Review
assignee: []
created_date: '2026-10-21 11:43'
updated_date: '2026-10-21 11:44'
labels:
  - documentation
dependencies: []
type: chore
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas asked on 21 October 2026 that the three new documents under docs/ (RUNTIME_PLATFORM_ROADMAP.md, DSPATCH_CONTENT_EXCLUSION_CONTRACT.md, CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md) become discoverable and mandatory to consult when a task touches their area, without being required reading for every task or session. Scope: a compact relevance index in AGENTS.md and a short addition to docs/loop/COORDINATOR.md so handoffs carry the relevant sections through HANDOFF.md's source-material field. Out of scope: product implementation, backlog replanning, automatic imports in CLAUDE.md, changes to the agent and skill structure. A document reference grants no implementation mandate and is no evidence of runtime support.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AGENTS.md has a relevance index linking the three documents with when to read each, and says relevant sections and cross-references are read before affected planning, implementation or review
- [x] #2 The index states the documents are not full reading at every start, that continuation reads only changed or newly applicable material, and that calling a loop specialist does not by itself trigger the parallelism document
- [x] #3 The index keeps decisions, proposals and verified implementation apart and grants no mandate or runtime-support claim
- [x] #4 COORDINATOR.md tells the coordinator to use the index and to name relevant documents, sections and decisions in affected specialists' source material, Verifier and Reviewer included
- [x] #5 Links and filenames are checked; CLAUDE.md still imports only AGENTS.md
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (21 Oct 2026): started in the main checkout C:\Users\nicla\development\DSpatch on main at 0627be9, no worktree. No suitable open task existed. The three documents are already committed (44a2c31, 0627be9); the content-exclusion contract's actual filename is DSPATCH_CONTENT_EXCLUSION_CONTRACT.md (the upload was named DSATCH_; the typo was corrected when it was added). Next: AGENTS.md index.

Implemented (21 Oct 2026, main checkout, base 0627be9):
- AGENTS.md, 'Read the right material': new item 7 and a 'Relevance index' subsection (anchor #relevance-index) with a table linking docs/RUNTIME_PLATFORM_ROADMAP.md, docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md and docs/CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md with when to read each; relevant sections and needed cross-references before affected planning, implementation or review; several may apply; not full reading at every start, continuation reads only changed or newly applicable material; calling a loop specialist does not by itself trigger the parallelism document; status kept apart (two drafts, one agreed direction without verified implementation); a reference grants no mandate and no runtime-support evidence.
- docs/loop/COORDINATOR.md step 4: use the index; name relevant documents, exact headings and decisions in force in the Source material field of HANDOFF.md for every affected specialist, Verifier and Reviewer included; give a bounded extract because specialists do not inherit the chat.
- Not changed: CLAUDE.md (still only @AGENTS.md, no imports of the three documents), HANDOFF.md (its existing Source material field is used as is), agent and skill structure. No other governance document had a contradiction or broken reference to fix; no file references the DSATCH spelling.

Checks (21 Oct 2026): the three link targets exist under docs/ with these exact names; ../../AGENTS.md#relevance-index resolves from docs/loop and the anchor is unique; git diff touches only AGENTS.md (+15) and COORDINATOR.md (1 line); CLAUDE.md diff empty. No test reads the content of AGENTS.md or COORDINATOR.md (app/tests write their own fixtures), so no test run. Reading-choice walk-through against the index text: a self-contained UI text change touches no row and is named as needing none; a Claude runtime task matches the roadmap row (runtime or provider integration) and the contract row when it affects tool access, hooks, permissions or information flows; a hook or exclusion change matches the contract row; a task on the product's subgraphs or parallelism matches the parallelism row. This checks the instructions only; it is not evidence of future agent behaviour. No agent calibration was run.

Status: Review, awaiting Niclas's assessment.
<!-- SECTION:NOTES:END -->
