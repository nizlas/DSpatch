---
id: DSP-221
title: Describe DSpatch as agent execution graphs with agent loops as a special case
status: Review
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
- [x] #1 The README and the tutorial explain the graph model early, with agent loops as a natural special case, and claim only what is implemented.
- [x] #2 Choosing, editing and running use the same terms in the visible UI; remaining user-visible uses of "loop" are intentional.
- [x] #3 The instructions DSpatch uses to explain and build graphs use the same terms.
- [x] #4 "Dynamic" is used only for choosing a path through a defined graph, not for changing its structure during a run.
- [x] #5 Existing graphs and definitions load unchanged; targeted checks pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (17 November 2026): survey of user-visible "loop" wording done; next the README and tutorial introductions, then the chat, editor, run and dialog texts, the graph-authoring instructions and bundled display names. No release in this task (Niclas).

Result (17 November 2026). README and TUTORIAL open with the graph model (Niclas's wording), with agent loops as a recurring path; the tutorial states what is available now: the path is chosen during a run while the graph's structure is not changed by it, a step opens to its role, task, routes and live output, and nested graphs are planned. Visible names: **Graph editor** (was Edit agent loops / Loop editor), the **Graph** chooser, **Open graph…**, **Use workflow** (was Use loop), graph run, Run log, Continue the run; dialogs, refusals, the chat's run status, proposal cards and definition errors follow. The graph-authoring tool descriptions and building blocks explain agent execution graphs and when to say loop; their tool names (`list_loops`, `propose_loop_graph`, …) are identifiers and stay. Bundled names: "Parallel loop" became "Parallel workflow"; Simple chat loop, the development loop and the mission loop keep "loop" because each is built around a recurring path. GRAPH_FORMAT.md has a terminology note; app/README.md and the Linux trial use the new UI names.

Kept on purpose: file formats and identifiers (`dspatch-loop-graph`, `dspatch-loop-definition`, `.loop.json`, `.dspatch/loops/`, `docs/loop/`), internal names, data-ev hooks, log lines, the step prompts sent to agents, historical reports, release notes, backlog history and VISION.md (the governing document, left for Niclas).

Checks: the type check; the 53 test files that mention the changed phrases were run, the expectations pinned to old wording updated, and all pass except three that fail identically on main without these changes (`loop-run-audience`, `project-host-boundary`, `walk-loop-jobs`). The graph-proposal test's bundled count is corrected to nine (missed in DSP-220). In this checkout's build, headless with an isolated profile: the graph editor shows the new heading, chooser, button and status line and the renamed Parallel workflow, with old graphs loading unchanged. The chat's Graph editor button and Use workflow toggle were checked in code only: without a signed-in agent the isolated profile shows only the start page.
<!-- SECTION:NOTES:END -->
