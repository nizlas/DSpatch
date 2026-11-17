---
id: DSP-221
title: Describe DSpatch as agent execution graphs with agent loops as a special case
status: In Progress
assignee: []
created_date: '2026-11-17'
labels: [documentation, ui-text]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update DSpatch's terminology and introductions to the general working model: agents orchestrated through executable graphs with conditional routing, feedback cycles and controlled parallel execution, with agent loops as a natural special case. "Agent execution graph" is the full term, "execution graph" or "graph" where the context is clear, and "agent workflow" for the way of working itself. "Loop" stays where it means repetition or a cyclic path. A terminology and explanation change only: saved graphs, file formats, paths, identifiers, APIs and commands are unchanged, and internal names containing "loop" stay.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The README and the tutorial explain the graph model early, with agent loops as a natural special case, and claim only what is implemented.
- [ ] #2 Choosing, editing and running use the same terms in the visible UI; remaining user-visible uses of "loop" are intentional.
- [ ] #3 The instructions DSpatch uses to explain and build graphs use the same terms.
- [ ] #4 "Dynamic" is used only for choosing a path through a defined graph, not for changing its structure during a run.
- [ ] #5 Existing graphs and definitions load unchanged; targeted checks pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (17 November 2026): survey of user-visible "loop" wording done; next the README and tutorial introductions, then the chat, editor, run and dialog texts, the graph-authoring instructions and bundled display names. No release in this task (Niclas).
<!-- SECTION:NOTES:END -->
