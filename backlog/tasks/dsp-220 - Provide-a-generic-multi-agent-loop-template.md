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
- [ ] #1 A bundled loop definition, graph and role sources cover the generic planning, execution, review, verification, reporting and specialist workflow without project-specific references.
- [ ] #2 The graph loads with all role references resolved and is included in the packaged resources; it does not start work when discovered.
- [ ] #3 Generic instructions defer project-specific rules and paths to the open project's own instructions, preserve explicit approval boundaries and do not claim unsupported permissions or provider capabilities.
- [ ] #4 Automated checks cover graph validity, packaged resource resolution and public-content screening; limitations and unverified runtime behavior are stated in the PR.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (17 November 2026): prepare a sanitized generic graph and role sources in a separate branch based on origin/main for Claude to integrate by pull request. The source project and its project-specific instructions remain unchanged. Preserve current workspace changes and existing default-selection behavior; no live agent run or model call is authorized by this task.

Result: a provider-neutral, bundled and selectable agent-network template with 36 agent steps, 21 generic role variants and 140 routes. It preserves planning, execution, QA, independent review, claim challenge, wrap-up and explicit report delivery. Blocked starts do not dispatch work; infrastructure requiring a job gate is reviewed as a plan and stops before acceptance. Roles refer to the open project's applicable instructions without embedding project-specific material. The existing preselected loop remains unchanged; selecting this template and any change to the default are for integration review.

Verification on the candidate based on `0e8bb5e`: 30 scripted generic-network tests plus the graph layout and edge-routing tests pass, 70 tests together. They include role resolution, bundled resource copying, public-content screening, blocked and job-gate routes, explicit evidence handoffs, multi-slice continuation, limit behavior and saved drawing layout. All Node, renderer and tools typechecks pass with the lockfile's dependencies in the isolated worktree. Independent read-only reviews drove fixes to evidence handoffs, safe stops, layout selection and the explicit disclosure that host snapshots can read the working folders. No live provider or actual packaged window was run.

Limitations for integration: a carry-forward ledger relies on agents following the supplied instructions; the runner does not verify its content. A configured call limit can allow reporting calls after the limit is routed, or stop before the final report if first reached at a reporting node. `stored-result` carries handoffs during a run and is not by itself proof of durable files; chat and editor recording paths differ. The editor's live Run binding does not run this template. The host can observe working folders for snapshots regardless of role instructions, so this template must not be used for a mandate forbidding all project access or observation. The node variants inherit the person's model choice rather than selecting distinct models. Existing project-specific rules, approvals, data and durable reporting remain in each project's repository.
<!-- SECTION:NOTES:END -->