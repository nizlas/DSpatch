<a id="role-catalog"></a>

# Shared roles: the role catalog (DSP-231)

Niclas's assignment of 19 November 2026. A role is a shared, reusable definition that graphs refer to by a **stable identity and an explicit version**. Implementer is one generic role that every graph uses, not a variant per graph under the same name. This document records the model, the format, the inventory of the roles the bundled graphs had and where each went, and what stays compatible. What is verified is in [DSP-231](../../backlog/tasks/dsp-231%20-%20Shared-reusable-versioned-agent-roles-from-one-catalog.md).

## Four things, kept apart

| Part | Holds | Where |
| --- | --- | --- |
| Generic role | Responsibility, base instructions, the role's contract (its requirements) | The role catalog: `docs/loop/roles/catalog/<id>/v<n>.role.md`, or a repository's `.dspatch/roles/` |
| Graph node | Task (`purpose`), inputs and outputs, routes, outcomes and their meaning, model policy, node requirements | The graph file |
| Project additions | Project rules, document references, repository knowledge: **All agent nodes**, **All nodes with this role**, **This node instance only** | `<id>.project.json` (DSP-229, format unchanged) |
| Run | Mandate, visits, sessions, results | The run record |

A shared role is not a shared session: every node keeps its own provider session (`stepSessionId(run, node)`), and each parallel branch its own. "This node instance only" applies to that node on every visit, and to the branches that run as it.

## Identity and versions

- A graph refers to `{"id": "implementer", "version": 1, "source": {"kind": "role-catalog", "path": "<catalog>/implementer/v1.role.md"}}`. A `role-catalog` reference without `version` is refused; no other kind has one.
- **The same identity and version always mean the same text.** Each catalog folder has a `catalog.json` listing every version with the SHA-256 of its file (CRLF read as LF). A copy whose digest differs from the one any readable catalog lists (the one beside it, or the one installed with DSpatch) is an edited copy and is refused (`role-copy-modified`); a file that declares another identity or version is refused (`role-version-mismatch`); a text no catalog lists is a warning (`role-not-in-catalog`).
- A version file is never edited. A changed role is a new version file, listed beside the old one. Graphs keep the version they pin until a person chooses another in the node panel ("Use vN for these nodes").
- A role's front matter adds `version`, `origin` (`dspatch` or `project`) and, for a role made from another, `derivedFrom: <id>@<version>`. `title` is the display name; `role` is the stable identity.
- A run reads every role once when it starts and keeps what it read; `run-started` records each role with its version and digest, and each reply records its `roleVersion`. A later version or an edit changes no run in progress.

## Storage and distribution

- **DSpatch's catalog** is `docs/loop/roles/catalog/`, shipped with DSpatch (the bundled resources include `docs/loop`). DSpatch's own graphs refer to it directly.
- **A repository's catalog** is `.dspatch/roles/`: identified copies of the shared roles its project graphs use (one copy per repository, shared by all its graphs, written only when absent or identical) and the project's own roles (origin `project`). Graphs therefore work offline and on another machine, and travel with Git.
- **A project's own roles** are made in the node panel (*Make a project role from this…*, *New version…*). A new identity starts at v1; a changed one is its next version; a DSpatch identity is refused, so nobody changes a shared definition from a project.
- A reference resolves only where the graph says. There is no silent fallback to another copy.

## What a step is sent, in order

1. The generic role, between `===== role, as written =====` markers, named with its title, identity and version ("role \"Implementer\" (implementer, version 1 from DSpatch's role catalog)").
2. The project additions, between `===== project instructions =====` markers: all agent nodes, all nodes with this role (by stable identity), this node instance.
3. DSpatch's run preamble, the working folders, the context snapshot, the mandate, and the node's task with its outcomes, failures and choices.

The editor's node panel and the run call the same assembly (`chatPromptFor`, `stepProjectText`). The panel shows the role's name, identity, version and origin, the generic text, the node's task, the project additions separately and the whole effective message.

## What the runtime enforces and what is an instruction

Requirements (`no-file-writes`, `no-subagent-delegation`, …) are the union of the role's and the node's (`effectiveRequirements`), answered per provider exactly as before (GRAPH_FORMAT.md, *Requirements are portable*). A shared role carries the requirements common to all its uses; a stricter one stays on the nodes that had it, so every node's effective requirements are unchanged by the migration (checked per node in `tests/role-catalog.test.ts`). Prose in a role is an instruction, never a control.

## The catalog

| Identity | Title | Responsibility |
| --- | --- | --- |
| `backlog-keeper` | Backlog keeper | Maintain the assigned work record when authorized: statuses, decisions and next actions, kept accurate and traceable. |
| `coordinator` | Coordinator | Establish what an assignment means, set its direction and brief the step that does it, reconcile what comes back, and report to the person who started the work. |
| `data-curator` | Data Curator | Inspect or prepare data within the authorized scope, checking provenance, access, quality and reproducibility. |
| `documenter` | Documenter | Record the assigned durable information when authorized: decisions, verified outcomes, uncertainties and a concrete continuation. |
| `experiment-analyst` | Experiment Analyst | Interpret experiment evidence: identify the runs and conditions compared, separate measurements from inference and disclose limitations. |
| `explorer` | Explorer | Locate and describe the existing material and behaviour an assignment needs, with precise references, and trace behaviour and its boundaries when asked. |
| `implementer` | Implementer | Carry out an assigned piece of work in the project, usually a bounded change, check it in proportion to its risk, and report exactly what was done and what was not established. |
| `infrastructure` | Infrastructure | Carry out authorized infrastructure work: establish the target and its actual state, run only authorized operations, and report identifiers and uncertain outcomes. |
| `integrator` | Integrator | Combine the results of work done in parallel branches into one whole in the working copy, resolve conflicts and open proposals, and establish whether the parts work together. |
| `mission-coordinator` | Mission coordinator | Carry a long assignment across many sub-goals and several runs: keep its working state in a file, choose the next step it needs, record each result, and stop at a boundary with the state saved. |
| `plan-reviewer` | Plan reviewer | Independently review a plan before work starts: its value, ordering, dependencies, bounded tasks and assessable criteria, returning concrete findings without rewriting it. |
| `planner` | Planner | Turn a goal into an actionable plan: the next increment, why it comes next, and bounded tasks with assessable criteria and proportionate verification. |
| `researcher` | Researcher | Investigate a question or uncertainty with evidence suited to it, from a focused question to a complex one, and return what the evidence settles and the smallest probe for what it does not. |
| `skeptic` | Skeptic | Challenge claims and conclusions against their evidential basis, from a bounded result to substantive conclusions, and report what is unsupported. |
| `slicer` | Slicer | Decide whether an assignment splits into parts that can be done at the same time by separate agents, and propose those parts, or keep the work as one. |
| `tech-lead` | Tech Lead | Guide the technical direction of the work: assess plans and tradeoffs, select and route bounded slices, judge their acceptance against evidence, and escalate what is outside the mandate. |
| `verifier` | Verifier | Establish independently whether an assigned result meets what was asked, with evidence suited to it, and report what the evidence does and does not show. |
| `walk-planner` | Walk planner | Plan a review's code walks so a reader can follow the change as the program runs: the steps, the one code place each shows, and how each is reached. Derived from docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.2, sections 1 to 3. |
| `walk-reviewer` | Walk reviewer | Judge whether finished code walks let the reader of the chosen profile follow the course and understand what the steps show, checked against the code and docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.2; name concrete shortcomings or accept. |
| `walk-writer` | Walk writer | Explain each step of a planned walk to the reader of the chosen profile, beside the code, from your own reading of it. Derived from docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.2, sections 2 to 4 and 6. |
| `work-reviewer` | Work reviewer | Independently review a result of work — a change, an answer or an analysis — against its assignment, the actual material and the evidence, and return concrete findings without fixing it. |

## Inventory: where each earlier role went

Merged where the responsibility is the same; kept apart where the contract differs. Text that was the node's contract (its outcomes and what they mean, a graph's ledger, a fan-out's slice and message protocol) moved into the task of every node that used the role, verbatim; the role keeps what is true wherever it is used. DSpatch-specific guidance (AGENTS.md, VISION.md, the verification policy, the snapshot script, Niclas's acceptance) moved to the mission loop's project instructions (`.dspatch/loops/dspatch-mission-loop.project.json`), the one bundled graph that works only on DSpatch's repository.

| Earlier role | Source | Now | Moved to the node task | Why |
| --- | --- | --- | --- | --- |
| `generic-executive` | `roles/generic/executive.role.md` | `coordinator` v1 | moved to the task of every node that used it (52 words) | Same responsibility as the run coordinator: establish the mandate, set direction, choose next steps and report. Merged. |
| `generic-tech-lead` | `roles/generic/tech-lead.role.md` | `tech-lead` v1 | moved to the task of every node that used it (52 words) | Merged with Tech Lead (medium): same tools and requirements; the scope of each step (planning, escalation) is in the node task. |
| `generic-tech-lead-m` | `roles/generic/tech-lead-m.role.md` | `tech-lead` v1 | moved to the task of every node that used it (52 words) | "medium" named no model policy (the nodes inherit the chat model) and no other tool or requirement; selection, dispatch and acceptance are in the node tasks. |
| `generic-planner` | `roles/generic/planner.role.md` | `planner` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-backlog` | `roles/generic/backlog.role.md` | `backlog-keeper` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-documenter` | `roles/generic/documenter.role.md` | `documenter` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-researcher` | `roles/generic/researcher.role.md` | `researcher` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-explorer` | `roles/generic/explorer.role.md` | `explorer` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-data-curator` | `roles/generic/data-curator.role.md` | `data-curator` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-experiment-analyst` | `roles/generic/experiment-analyst.role.md` | `experiment-analyst` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-infra` | `roles/generic/infra.role.md` | `infrastructure` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-implementer` | `roles/generic/implementer.role.md` | `implementer` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-integrator` | `roles/generic/integrator.role.md` | `integrator` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `generic-qa` | `roles/generic/qa.role.md` | `verifier` v1 | moved to the task of every node that used it (52 words) | QA runs proportionate checks against criteria: the Verifier's responsibility. |
| `generic-reviewer` | `roles/generic/reviewer.role.md` | `work-reviewer` v1 (the step reviews a result of work: a change, an answer or an analysis), `plan-reviewer` v1 (the step reviews a plan before the work starts) | moved to the task of every node that used it (52 words) | Split by what is reviewed: a plan and a result of work have different contracts. |
| `generic-skeptic` | `roles/generic/skeptic.role.md` | `skeptic` v1 | moved to the task of every node that used it (52 words) | Same responsibility; merged and reworded. |
| `dspatch-run-coordinator` | `roles/run/dspatch-run-coordinator.role.md` | `coordinator` v1 | moved to the task of every node that used it (231 words) | Its DSpatch-specific history and the description of DSpatch's external loop are dropped; how this step declares a result stays with the node. |
| `dspatch-mission-coordinator` | `roles/run/dspatch-mission-coordinator.role.md` | `mission-coordinator` v1 | moved to the task of every node that used it (145 words) | The mission loop's outcome names move to the node task; "every rule in AGENTS.md applies" moves to the mission loop's project instructions. |
| `dspatch-backlog-planner` | `roles/dspatch-backlog-planner.role.md` | `planner` v1 | — | DSpatch's own documents and product priorities move to the mission loop's project instructions. |
| `dspatch-researcher` | `roles/dspatch-researcher.role.md` | `researcher` v1 | — | Read-only stays a requirement of the nodes that had it. |
| `dspatch-implementer` | `roles/dspatch-implementer.role.md` | `implementer` v1 | — | DSpatch's own documents, verification policy and adapter rule move to the mission loop's project instructions. |
| `dspatch-verifier` | `roles/dspatch-verifier.role.md` | `verifier` v1 | — | The snapshot script and DSpatch's verification policy move to the mission loop's project instructions. |
| `dspatch-reviewer` | `roles/dspatch-reviewer.role.md` | `work-reviewer` v1 (the step reviews a result of work), `plan-reviewer` v1 (the step reviews a plan) | — | Its plan and implementation modes become two roles. |
| `project-work` | `roles/project/project-work.role.md` | `implementer` v1 | moved to the task of every node that used it (446 words) | Its outcomes, the optional skip and the interactive handoff are the node's contract and move to the node task. |
| `project-check` | `roles/project/project-check.role.md` | `verifier` v1 | moved to the task of every node that used it (279 words) | Its verdicts and the rule for a met verdict are the node's contract and move to the node task. |
| `project-slice` | `roles/project/project-slice.role.md` | `slicer` v1 | moved to the task of every node that used it (69 words) | The slice block's fields are written by DSpatch from the fan-out (DSP-227) and are not repeated. |
| `project-branch` | `roles/project/project-branch.role.md` | `implementer` v1 | moved to the task of every node that used it (568 words) | A branch is an Implementer; the slice, owned paths, messages and commit rules are the fan-out node's contract. |
| `project-integrate` | `roles/project/project-integrate.role.md` | `integrator` v1 | moved to the task of every node that used it (121 words) | Same responsibility; merged and reworded. |
| `walk-planner` | `roles/review/walk-planner.role.md` | `walk-planner` v1 | — | Same responsibility; merged and reworded. |
| `walk-writer` | `roles/review/walk-writer.role.md` | `walk-writer` v1 | — | Same responsibility; merged and reworded. |
| `walk-reviewer` | `roles/review/walk-reviewer.role.md` | `walk-reviewer` v1 | — | Reviews a code walk for its reader, a contract of its own; not merged with the plan or work reviewer. |
| `coordinator` | `examples/workshop/.dspatch/loops/roles/workshop-coordinator.role.md` | `coordinator` v1 | — | Same responsibility; merged and reworded. |
| `maker` | `examples/workshop/.dspatch/loops/roles/workshop-maker.role.md` | `implementer` v1 | — | Same responsibility; merged and reworded. |
| `scout` | `examples/workshop/.dspatch/loops/roles/workshop-scout.role.md` | `explorer` v1 | — | Same responsibility; merged and reworded. |
| `checker` | `examples/workshop/.dspatch/loops/roles/workshop-checker.role.md` | `verifier` v1 | — | Same responsibility; merged and reworded. |
| `assembler` | `examples/workshop/.dspatch/loops/roles/workshop-assembler.role.md` | `integrator` v1 | — | Same responsibility; merged and reworded. |

The main judgements:

- **Implementer** joins five earlier roles (the generic one, DSpatch's specialist, the chat loop's work step, the parallel branch and the workshop maker). It takes "the assignment decides what you read", "being used is not being commissioned", proportionate checks, read-before-write, the last check after the last change and the delivery rules. A branch's owned paths, messages and commit rule are the fan-out node's contract.
- **Verifier** joins QA, DSpatch's verifier, the project check and the workshop checker: all establish by their own evidence whether a result meets what was asked. The verdict names stay with the nodes.
- **Reviewers are split by contract, not merged by name.** *Plan reviewer* reviews a plan before work; *Work reviewer* reviews a result of work; *Walk reviewer* reviews a code walk for its reader. The earlier generic and DSpatch reviewers each became the first two, chosen per node.
- **Tech Lead.** The two variants have the same tools and requirements, and neither had a model policy: "(medium)" was a name, and both kinds of node inherit the chat's model. Their scopes (planning and escalation; selection, dispatch and acceptance) are the nodes' tasks, so they are one role. Whether the selection steps should run a medium model class is a model-policy decision left open for Niclas; nothing was changed.
- **Coordinator** joins the run coordinator, the generic Executive and the workshop coordinator: establish the mandate, set direction, brief, reconcile and report. The *Mission coordinator* stays its own role: it carries a working-state file across runs.
- **Infrastructure, Skeptic, Data Curator, Experiment Analyst, Explorer, Documenter, Backlog keeper, Planner, Researcher, Integrator, Slicer** get generic definitions from their earlier text. The Slicer no longer repeats the slice block's fields, which DSpatch writes from the fan-out (DSP-227).
- **Dropped**: dated anecdotes and DSpatch history inside roles, the description of DSpatch's external development loop, "the documents this role names are DSpatch's own" (no generic role names any), and the generic roles' identical boilerplate where a role now says it once.

## Migration of the bundled graphs

Made by `app/scripts/role-upgrade.ts`, the same `planRoleUpgrade` the editor offers. Routes, model policies, limits, outcomes, fan-outs, choices and each node's effective requirements are unchanged; each node's earlier task is kept and moved text is appended.

#### Generic agent network (generic-agent-network)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| executive-intake | generic-executive | coordinator v1 | — | 52 words |
| tl-plan | generic-tech-lead | tech-lead v1 | — | 52 words |
| planner-expand | generic-planner | planner v1 | — | 52 words |
| reviewer-readiness | generic-reviewer | plan-reviewer v1 | — | 52 words |
| tl-plan-accept | generic-tech-lead | tech-lead v1 | — | 52 words |
| backlog-plan | generic-backlog | backlog-keeper v1 | — | 52 words |
| tl-select | generic-tech-lead-m | tech-lead v1 | — | 52 words |
| planner | generic-planner | planner v1 | — | 52 words |
| reviewer-plan-gate | generic-reviewer | plan-reviewer v1 | — | 52 words |
| backlog-start | generic-backlog | backlog-keeper v1 | — | 52 words |
| tl-dispatch | generic-tech-lead-m | tech-lead v1 | — | 52 words |
| tl-escalation | generic-tech-lead | tech-lead v1 | — | 52 words |
| implementer | generic-implementer | implementer v1 | — | 52 words |
| researcher | generic-researcher | researcher v1 | — | 52 words |
| explorer | generic-explorer | explorer v1 | — | 52 words |
| data-curator | generic-data-curator | data-curator v1 | — | 52 words |
| infra | generic-infra | infrastructure v1 | — | 52 words |
| experiment-analyst | generic-experiment-analyst | experiment-analyst v1 | — | 52 words |
| branches | generic-implementer | implementer v1 | — | 52 words |
| integrator | generic-integrator | integrator v1 | — | 52 words |
| qa | generic-qa | verifier v1 | — | 52 words |
| qa-design | generic-qa | verifier v1 | — | 52 words |
| reviewer | generic-reviewer | work-reviewer v1 | — | 52 words |
| reviewer-job-gate | generic-reviewer | plan-reviewer v1 | — | 52 words |
| skeptic | generic-skeptic | skeptic v1 | — | 52 words |
| tl-accept | generic-tech-lead-m | tech-lead v1 | — | 52 words |
| backlog-done | generic-backlog | backlog-keeper v1 | — | 52 words |
| backlog-blocked | generic-backlog | backlog-keeper v1 | — | 52 words |
| executive-continue | generic-executive | coordinator v1 | — | 52 words |
| documenter-wrapup | generic-documenter | documenter v1 | — | 52 words |
| tl-report | generic-tech-lead-m | tech-lead v1 | — | 52 words |
| executive-report | generic-executive | coordinator v1 | — | 52 words |

#### Chat loop (dspatch-chat-loop)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| work | project-work | implementer v1 | no-subagent-delegation | 446 words |
| check | project-check | verifier v1 | no-subagent-delegation | 279 words |

#### Duration change, tested and checked (dspatch-duration-check)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| work | project-work | implementer v1 | no-subagent-delegation | 446 words |
| check | project-check | verifier v1 | no-subagent-delegation | 279 words |

#### Parallel workflow (dspatch-parallel-loop)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| slice | project-slice | slicer v1 | — | 69 words |
| work | project-branch | implementer v1 | no-subagent-delegation | 568 words |
| integrate | project-integrate | integrator v1 | no-subagent-delegation | 121 words |
| review | project-check | verifier v1 | no-subagent-delegation | 279 words |

#### DSpatch mission loop (dspatch-mission-loop)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| coordinator | dspatch-mission-coordinator | mission-coordinator v1 | — | 145 words |
| planner | dspatch-backlog-planner | planner v1 | no-file-writes, no-subagent-delegation | — |
| researcher | dspatch-researcher | researcher v1 | no-file-writes, no-subagent-delegation | — |
| implementer | dspatch-implementer | implementer v1 | no-subagent-delegation | — |
| verifier | dspatch-verifier | verifier v1 | no-subagent-delegation | — |
| review | dspatch-reviewer | work-reviewer v1 | no-file-writes, no-subagent-delegation | — |
| mission-review | dspatch-reviewer | work-reviewer v1 | no-file-writes, no-subagent-delegation | — |
| final-report | dspatch-mission-coordinator | mission-coordinator v1 | — | 145 words |
| slicer | project-slice | slicer v1 | — | 69 words |
| branches | project-branch | implementer v1 | no-subagent-delegation | 568 words |
| integrate | project-integrate | integrator v1 | no-subagent-delegation | 121 words |
| parallel-review | dspatch-reviewer | work-reviewer v1 | no-file-writes, no-subagent-delegation | — |

#### DSpatch development loop (runnable subset) (dspatch-development-loop-runnable)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| coordinator | dspatch-run-coordinator | coordinator v1 | no-subagent-delegation | 231 words |
| implementer | dspatch-implementer | implementer v1 | no-subagent-delegation | — |
| researcher | dspatch-researcher | researcher v1 | no-file-writes, no-subagent-delegation | — |
| verifier | dspatch-verifier | verifier v1 | no-subagent-delegation | — |
| implementation-review | dspatch-reviewer | work-reviewer v1 | no-file-writes, no-subagent-delegation | — |
| coordinator-report | dspatch-run-coordinator | coordinator v1 | no-subagent-delegation | 231 words |

#### Walk loop (dspatch-walk-loop)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| plan | walk-planner | walk-planner v1 | — | — |
| write | walk-writer | walk-writer v1 | — | — |
| review | walk-reviewer | walk-reviewer v1 | — | — |

#### Workshop (workshop)

| Node | Before | After | Requirements moved to the node | Task addition |
| --- | --- | --- | --- | --- |
| coordinator | coordinator | coordinator v1 | — | — |
| maker | maker | implementer v1 | — | — |
| scout | scout | explorer v1 | — | — |
| quick-check | checker | verifier v1 | — | — |
| deep-check | checker | verifier v1 | — | — |
| crew | maker | implementer v1 | — | — |
| assembler | assembler | integrator v1 | — | — |

Not migrated, on purpose: `dspatch-development-loop.graph.json` and `dspatch-live-duration.graph.json` draw DSpatch's **external** development loop, whose agents are generated for Cursor and Claude Code from `docs/loop/roles/dspatch-*.role.md` (ROLE_FORMAT.md). Those sources and the generated `.claude/agents/` and `.cursor/agents/` are unchanged.

## Older and project-local graphs

- Every earlier role file stays where it was, so a graph that references one keeps loading and running as before (`role-source`, `cursor-agent-file`). Nothing rewrites a person's files.
- The graph panel of a workspace graph with legacy roles offers **Upgrade to shared roles…**: per node the mapping (with the alternatives a split role offers, chosen per node), the requirements and task text that move onto the node, how the project additions move, the conflicts, and every file it would write. Applying is explicit and refused if the graph changed since it was shown or the instructions draft has unsaved changes.
- A role whose copy was edited after it was made, or that the catalog does not know, is kept, with the reason.
- **Project additions follow the right role.** Additions under *All nodes with this role* are keyed by the stable identity. On an upgrade, an addition moves to the new identity only when exactly the same nodes use it; when roles merge or split it is placed on each node it reached and named as a conflict, so no node gains or loses an instruction. After a manual role change, additions for a role no node uses any more are shown under Project instructions to move or remove; saving is refused while they remain.

## Format changes, for the ReID adaptation

- **Unchanged:** the project instructions file (`dspatch-project-instructions`, `formatVersion` 1), its three layers and the prompt section. Role additions are keyed by role identity, as before. The scope names in the editor changed, not the file.
- **New:** the `role-catalog` source kind and `version` on a role reference; `version`, `origin`, `derivedFrom` in role front matter; `catalog.json` (`dspatch-role-catalog`, `formatVersion` 1); `.dspatch/roles/`; `version` on `origin.roles[]` of an applied definition; `roleVersion` on a run reply.
- **Role identities to check before upgrading a graph:** the table above. An addition written for an earlier identity (`generic-implementer`, `project-work`, `maker`, …) moves with the upgrade as described; one written for an identity that splits (`generic-reviewer`, `dspatch-reviewer`) or merges (`generic-tech-lead`, `generic-tech-lead-m`, `generic-executive`) is placed per node and shown.
