---
id: DSP-229
title: Apply a bundled graph to a repository as a project graph with its own instructions
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, graph, editor, instructions]
dependencies: [DSP-227]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
"Apply to repository…" beside the graph chooser copies a bundled graph into a repository of the open workspace as an ordinary runnable project graph under `.dspatch/loops/`, with its role sources copied, its template and version recorded, and the project's own instructions kept apart: common, per role and per agent node, each with free text and document references (purpose, when to read). The chooser groups Project workflows and Built-in workflows. A customization window edits the instructions, picks documents, asks the workspace's agent for recommendations (all, role, step) as reviewable proposals, previews what a node will be sent, and shows the files before saving. At run time a step's prompt carries the generic role, then the common, role and node additions, then its task; document references are pointed at, never attached. "Project instructions…" reopens the window for a project graph. No new graph type or engine, no automatic template updates, no release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 Applying creates a self-contained project graph (definition, graph, copied roles, instructions, origin) in the chosen repository; the template is unchanged; nothing is overwritten silently and a failed save leaves no runnable half-graph.
- [x] #2 The chooser groups project and built-in workflows, a project graph appears only with its repository open and names its owner, and an applied graph becomes this workspace's choice without starting a run.
- [x] #3 The customization window edits common, role and node instructions with document references chosen by a file picker, shows inherited instructions and a per-node preview, and lists the files before saving; it reopens as "Project instructions…".
- [x] #4 Steps and parallel branches receive role, common, role and node additions through one assembly that the preview also uses; references are not attached; a run keeps the instructions it started with.
- [x] #5 Recommendations (all, role, step) use the workspace's chosen agent read-only, reuse one inventory, and are applied only item by item without losing manual edits.
- [x] #6 Verified on a synthetic project including moving the repository and changing the template; existing graphs behave as before; the tutorial describes the flow.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result (18 November 2026). Governing: AGENT_BEHAVIOUR_AND_ORCHESTRATION.md §2–3 (every instruction DSpatch adds is visible and inspectable; one source per instruction; role and node task apart), the existing definition discovery and per-workspace choice (DSP-71, DSP-85), graph proposals' save rules (DSP-209 S23b), the analysis permission for read-only agent work. No new graph type or engine.

**Format.** A project graph is an ordinary definition in the repository's `.dspatch/loops/` with two optional fields, `projectInstructions` (the `<id>.project.json` beside it) and `origin` (template id, name, graph id, app version, graph and role hashes, applied time). Roles are copied to `roles/<id>/`; `resourceRoot` is the repository, so nothing absolute is stored. `dspatch-project-instructions` v1: common, roles, nodes; each text plus documents (path, purpose, when, external).

**Runtime.** One assembly (`projectInstructionsText`, `stepProjectText` in shared/project-instructions.ts) places the project's section after the generic role and before the task: common, role, node text; documents listed, never attached, paths relative to the step's repository root (a branch's own worktree; a branch takes its `as` node's additions). The run reads the file once with the graph (`ChosenLoop.projectInstructions`), so a save does not change a run in progress. Graphs without the field are sent exactly what they were. The editor's node panel and the window's preview call the same function.

**Apply and save.** `main/project-graph.ts`: plan (files listed first), write (temporary file and rename, definition last, everything this call wrote removed on failure, no file replaced), read, save (refused when the file changed since read or names a step or role not in the graph), reference checks named by step and role. Host `loop.projectGraph` (one bridge method) with options, describe, plan, apply (makes the graph this workspace's choice, starts nothing), save, check, recommend, cancel; main `pickProjectDocument` through the existing pickers (host browser in a remote session).

**Chooser.** Rows carry group (project / built-in), owner and whether they have project instructions; the editor groups them and names the owner when several are open. Found and fixed: a workspace without its own choice inherited the previous workspace's, and a remembered or hand-picked definition in a closed repository's `.dspatch/loops/` stayed listed; both now follow the open folders.

**Recommendations.** `shared/project-recommendations.ts` prompt and parser; `main/project-recommend-run.ts` one read-only turn with the workspace's chosen agent and model (analysis purpose; Cursor refused with the existing reason; manual editing needs no agent). "For all" inventories; the window keeps the inventory and hands it to later requests. Proposals are taken item by item (append, replace, add reference); a stop or failure changes nothing. Presentation adapter: a SIMULATED answer from the repository's file names.

**Verified.** tests/project-graph.test.ts (8; simulated adapter, real git worktrees): self-contained apply, template untouched, no overwrite, failed write leaves no definition, template change does not reach the copy, a moved repository still resolves, reference problems named, external change refused, steps and branches get the right layers once with documents not attached and the preview text inside the prompt, a graph without instructions unchanged, host apply/choose/save and inventory reuse. Related suites pass; project-host-boundary fails on HEAD as before (run-record-store), not from this change. Window trial `app/scripts/project-graph-trial.mjs` (headless, isolated profile, presentation adapter, file chooser answered in main): 20 checks pass, including file choice, external marking, role users, recommendations kept apart from manual text, preview order, files before save, nothing written before save, chooser group and selection, node panel, restart, maintenance save, and another workspace not listing it. Real provider: `app/scripts/project-recommend-probe.ts` with Claude (DSpatch's login, analysis permissions) on a synthetic repository: "for all" in 31 s (inventory, governing/history split, the till-v1 rule as common, role additions, conflicts named), "for this step" in 17 s reusing the inventory; the repository unchanged afterwards.

Not done or not verified: no automatic template comparison or update; recommendations not tried with Copilot; the window not tried on Windows or with a remote host; the Copilot session's context and the ReID repository are not migrated (out of scope).
<!-- SECTION:NOTES:END -->
