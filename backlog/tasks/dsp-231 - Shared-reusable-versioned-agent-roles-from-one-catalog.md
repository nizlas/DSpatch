---
id: DSP-231
title: Shared, reusable and versioned agent roles from one catalog
status: Review
assignee: []
created_date: '2026-11-19'
labels: [loops, graph, roles, instructions, editor]
dependencies: [DSP-229, DSP-230]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 19 November 2026. Agent roles become shared, reusable definitions in one catalog that graphs reference by a stable identity and an explicit version, so Implementer is one generic role every graph refers to rather than a variant per graph under the same identity. The model separates four things: the generic role (responsibility, base instructions, the role's contract), the graph node (task, inputs and outputs, routes, model policy), the project additions (DSP-229's common, per-role and per-node layers) and the run (assignment, visits, sessions, results). A shared role is not a shared session.

Scope: inventory and harmonise the roles of every bundled graph and the workshop example into a catalog with a traceable before/after table; a role reference with identity and version, where the same identity and version always means the same text (checked by digest) and local copies are identified, never silently edited variants; user-made reusable roles that never change an existing shared definition; one assembly order (generic role → project additions → node task and run input) for preview and calls; the node panel showing the role's name, identity, version and origin, its generic text, the node's task, the project additions and the effective instruction; the Project instructions scopes renamed to "All agent nodes", "All nodes with this role" and "This node instance only", with role additions keyed by stable identity and a role change handled explicitly; migration of the bundled graphs preserving flows, model policies, parallelism, requirements and sessions; a reviewable upgrade for older and project-local graphs that never rewrites a file unasked; Apply to repository and the chat's graph tools using the catalog. No release. ReID material is not read or copied; the ReID adaptation keeps using the existing project instructions format, which stays compatible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 A traceable inventory maps every bundled role to a catalog role, with what moved to node tasks or project additions and what was kept, reworded or dropped and why.
- [x] #2 Graphs reference catalog roles by identity and version; the same identity and version always resolve to the same text, and an edited copy is refused; user-made roles never change an existing definition.
- [x] #3 Preview and calls use one documented assembly order; runtime-enforced requirements are kept apart from instruction-only ones.
- [x] #4 The node panel shows the role's identity, version and origin, its generic text, the node task, the project additions and the effective instruction; the three scopes are renamed; a role change shows and handles affected additions.
- [x] #5 The bundled graphs are migrated with a documented mapping; flows, model policies, parallelism, requirements and sessions are preserved; older graphs still run; an upgrade is offered for review and never applied unasked, with role additions following the right role and conflicts shown.
- [x] #6 Apply to repository and the chat's graph tools use the catalog roles.
- [x] #7 Verified with targeted tests on synthetic projects and a UI check; documentation and tutorial updated.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result (19 November 2026). Governing: AGENT_BEHAVIOUR_AND_ORCHESTRATION.md §1–3 (role, node, engine and provider kept apart; one source per instruction; an explicit versioning rule; a run keeps what it started with), DSP-229/230's project instructions model and single assembly (format unchanged), GRAPH_FORMAT's portable requirements. The full record — model, format, inventory table, per-graph mapping, compatibility — is [docs/loop/ROLE_CATALOG.md](../../docs/loop/ROLE_CATALOG.md).

**Catalog.** `docs/loop/roles/catalog/`: 21 roles at v1 (coordinator, mission-coordinator, tech-lead, planner, backlog-keeper, documenter, researcher, explorer, data-curator, experiment-analyst, infrastructure, implementer, integrator, slicer, verifier, plan-reviewer, work-reviewer, skeptic, walk-planner, walk-writer, walk-reviewer) and `catalog.json` with each file's SHA-256 and the `legacy` mapping of 36 earlier roles. Reference kind `role-catalog` with a required `version`; digest checked against the catalog beside the file and the installed one (`role-copy-modified`, `role-version-mismatch`, `role-not-in-catalog`). Prompts name the role's title, identity and version; replies record `roleVersion`, run-started records each role's digest.

**Migration.** Seven bundled graphs and the workshop example via `planRoleUpgrade` (`app/scripts/role-upgrade.ts`): routes, model policies, limits, outcomes, fan-outs, choices and every node's effective requirements unchanged (stricter requirements moved onto the nodes); node contract text moved from roles into node tasks verbatim; DSpatch-specific guidance moved into the mission loop's new project instructions. Earlier role files kept; the external loop's `dspatch-*` sources and its two drawings unchanged.

**Editor and tools.** Node panel: role identity line (title · id vN · origin), sharing and session note, Change role…, Make a project role from this…, New version…, newer-version offer. Project instructions scopes renamed (All agent nodes / All nodes with this role / This node instance only), role titles shown, additions reaching no node shown with Move/Remove (save refused while they remain). Graph panel: Upgrade to shared roles… with per-node mapping and alternatives, moved requirements and task text, addition moves and conflicts, files; applied only explicitly, refused on a changed graph or unsaved draft. Apply to repository copies shared roles to `.dspatch/roles/` once per repository. Chat graph tools list the catalog, copy referenced shared roles into the proposal and refuse a new role under a shared identity.

**Verified** (simulated agents, synthetic projects, no provider call): `tests/role-catalog.test.ts` 19 new tests (catalog integrity and digests; same id/version/text in two graphs; edited copy and version mismatch refused; role → project additions → task order in the prompt; role additions reach all nodes with the role once and no other, branches by the node they run as; separate sessions; per-graph migration invariants against 1737fca; legacy graph still loads; upgrade keeps every node's additions on split and merge, honours choices, keeps edited roles; pinned versions and a running resolver unchanged by a new version or an edit; two project graphs share one copy; host upgrade end to end). Updated suites pass: project-graph, generic-agent-network, generic-parallel, loop-chat, loop-definition, loop-graph-open, loop-provider-agnostic, loop-node-help, loop-mission-parallel, graph-authoring-tools, graph-proposal, loop-graph, loop-choice, loop-handoff, role-generate, walk-loop, walk-loop-follow; typecheck and build. Window trial `app/scripts/project-draft-trial.mjs` (headless, isolated profile): ALL PASSED 56, of which 16 new for DSP-231. `walk-loop-jobs` has one failure that is the same on HEAD without this change.

**Open for Niclas.** (1) Whether Tech Lead's selection/dispatch/acceptance steps should run a medium model class: "(medium)" was only a name, nodes inherit the chat model, nothing changed. (2) The runnable development loop (the default for any workspace) no longer carries the DSpatch-only conditional text of the dspatch-* roles; the mission loop has it as project instructions. (3) Joint check of the role mapping with the ReID adaptation before its graph is upgraded. Not tried on Windows or with a real provider.
<!-- SECTION:NOTES:END -->
