---
id: DSP-220
title: Provide a generic multi-agent loop template
status: Review
assignee: []
created_date: '2026-11-17'
labels: [integration]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Provide a bundled, inspectable generic agent-network loop derived from the workflow shape used in a project-specific loop. Project-specific instructions, data, infrastructure, history, credentials and policy remain in the project using the template. The open project's instructions supplement the generic roles; the template must not assume a particular project or runtime provider.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 A bundled loop definition, graph and role sources cover the generic planning, execution, review, verification, reporting and specialist workflow without project-specific references.
- [x] #2 The graph loads with all role references resolved and is included in the packaged resources; it does not start work when discovered.
- [x] #3 Generic instructions defer project-specific rules and paths to the open project's own instructions, preserve explicit approval boundaries and do not claim unsupported permissions or provider capabilities.
- [x] #4 Automated checks cover graph validity, packaged resource resolution and public-content screening; limitations and unverified runtime behavior are stated in the PR.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (17 November 2026): prepare a sanitized generic graph and role sources in a separate branch based on origin/main for Claude to integrate by pull request. The source project and its project-specific instructions remain unchanged. Preserve current workspace changes and existing default-selection behavior; no live agent run or model call is authorized by this task.

Result: a provider-neutral, bundled and selectable agent-network template with 36 agent steps, 21 generic role variants and 140 routes. It preserves planning, execution, QA, independent review, claim challenge, wrap-up and explicit report delivery. Blocked starts do not dispatch work; infrastructure requiring a job gate is reviewed as a plan and stops before acceptance. Roles refer to the open project's applicable instructions without embedding project-specific material. The existing preselected loop remains unchanged; selecting this template and any change to the default are for integration review.

Verification on the candidate based on `0e8bb5e`: 30 scripted generic-network tests plus the graph layout and edge-routing tests pass, 70 tests together. They include role resolution, bundled resource copying, public-content screening, blocked and job-gate routes, explicit evidence handoffs, multi-slice continuation, limit behavior and saved drawing layout. All Node, renderer and tools typechecks pass with the lockfile's dependencies in the isolated worktree. Independent read-only reviews drove fixes to evidence handoffs, safe stops, layout selection and the explicit disclosure that host snapshots can read the working folders. No live provider or actual packaged window was run.

Limitations for integration: a carry-forward ledger relies on agents following the supplied instructions; the runner does not verify its content. A configured call limit can allow reporting calls after the limit is routed, or stop before the final report if first reached at a reporting node. `stored-result` carries handoffs during a run and is not by itself proof of durable files; chat and editor recording paths differ. The editor's live Run binding does not run this template. The host can observe working folders for snapshots regardless of role instructions, so this template must not be used for a mandate forbidding all project access or observation. The node variants inherit the person's model choice rather than selecting distinct models. Existing project-specific rules, approvals, data and durable reporting remain in each project's repository.

Integration (17 November 2026, Claude, by Niclas's mandate to review, integrate and merge `generic-agent-network` into main and publish it in the next ordinary release). Reviewed against DSP-218/219 (the chat chooses provider and base model; requirements are judged against the run's integration; the target is an export format) and the shared context handling of DSP-209 S2. The graph, its 21 roles including Infrastructure, its routes and its layout change are kept as delivered; no separate instruction mechanism was added. Added: a test that runs the network from a copy outside the repository on the chat-loop path with simulated Cursor, Claude and Copilot adapters (every step opens in the open project's folder, roles resolve from the copy, the entry step is told the project's `AGENTS.md`), the graph in the three-provider requirement check, and exact bundled-graph counts. The README and the tutorial now say where it is chosen and which parts of the orchestration the engine does not provide: one model for the small, medium and large variants, no pause for job authorization (the run reports instead), one slice at a time, an unverified ledger, limits as routing bounds.

Checked in the packaged Linux build (`linux-unpacked` of ae971b6, copied outside the repository, isolated profile, no model call) with a separate git repository holding only `AGENTS.md` and `README.md`: the loop list shows "Generic agent network · comes with DSpatch" beside the four other bundled loops, not preselected; it opens from the installed `bundled/` folder with 37 nodes, 140 edges and 0 errors; Infrastructure's and Tech Lead's role text is read from `bundled/docs/loop/roles/generic/`; the workspace is the separate repository; the toolbar says the run would use the chat's agent. Layout at 40% and 85%: no box overlaps and the main flow reads top to bottom; the 36 limit-reached routes to the Documenter and the 13-way dispatch make the overview dense, and selecting a node shows its own routes with labels. Not tried: a run with a real provider; Windows. Niclas's own trial of choosing and running it remains.
<!-- SECTION:NOTES:END -->