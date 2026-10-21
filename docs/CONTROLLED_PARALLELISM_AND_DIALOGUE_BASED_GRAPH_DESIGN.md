# DSpatch controlled parallelism and dialogue based graph design

Version 0.1 · 30 September 2026

Status: Product vision and guiding architecture principles. This document records the direction agreed in the project discussion. It describes intended capabilities, not verified implementation. Detailed runtime contracts, storage choices and implementation order remain subject to design and validation.

DSpatch should help users choose how work is organised, construct an explicit workflow from that agreement, and execute suitable parts concurrently with controlled dependencies. The purpose is to shorten the path to a useful, reviewed result while preserving understanding, continuity and predictable behaviour.

The user should be able to discuss goals and trade-offs at a high level, inspect the resulting graph, and edit details when useful. Parallel execution should follow a deliberate decomposition of the work, with shared contracts, defined responsibility and integration checks.

## 1 Purpose and relationship to existing governance

This vision complements the overall [vision](VISION.md), [agent behaviour and orchestration guidance](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md), and [task management and working memory principles](TASK_MANAGEMENT_AND_WORKING_MEMORY.md). The overall vision establishes the product and incremental development approach. The orchestration guidance separates agent practice, graph configuration and engine responsibilities. The working memory document establishes continuity across tasks, runs and sessions. This document develops controlled parallel work and the dialogue through which workflows are constructed and analysed.

A sequential first implementation remains compatible with this direction. A single user can supervise several concurrent subgraphs. A current limit on simultaneous execution must not silently become a permanent product constraint. This document does not require fleet infrastructure or prescribe a particular concurrency mechanism.

The motivation includes the user's practical experience with agentic development of annotation tools. Work was separated into a frontend lane and a tools lane, with agreements at shared interfaces. That experience motivates making decomposition and synchronisation explicit before parallel implementation starts. It does not establish that an automated slicer will always find a better decomposition or eliminate conflicts.

The terms “must”, “should” and “may” respectively express a required principle of this vision, a preferred direction that permits justified alternatives, and an optional possibility. None is a claim that the current application implements the capability. Existing governance continues to apply; any conflict must be resolved explicitly.

## 2 Controlled decomposition before implementation

Parallelism should be chosen for its expected effect on delivery time, quality and coordination effort. Starting more agents is not itself evidence of faster delivery. DSpatch should be able to recommend sequential work, a shared prerequisite followed by parallel work, or several concurrent branches with explicit dependencies.

A workflow may use an agent role provisionally called a slicer. It examines the task and relevant project context within the user's mandate, identifies dependencies, and proposes slices that can be implemented with limited interference. It may propose a preliminary architecture or a small enabling change where this makes separation practical. Proposing that change does not itself authorise implementation or expansion of the task.

The slicer's output should describe a workable division of responsibility, rather than merely a list of smaller tasks. Each proposed slice needs enough information to establish:

- Its intended result, scope, exclusions and acceptance conditions.
- The components, artifacts or interfaces for which it is responsible, including known shared resources.
- The input contracts and versions it relies on, and the output contracts it must satisfy.
- Prerequisites, opportunities for concurrent work and required synchronisation points.
- Relevant review and verification requirements and the result expected at handover.
- Assumptions, unresolved questions and conditions that require reconsidering the split.

Low file overlap is useful, but semantic independence matters more. Two agents can modify different files while making incompatible assumptions about error handling, data ownership or lifecycle. Shared contracts should address the behaviour that connects slices, not only function signatures or file names.

The decomposition should be evaluated before dependent implementation begins. The workflow determines whether this evaluation is performed by the same agent, a separate reviewer, the user, or another configured mechanism. Routine approval by the user is not required when an existing mandate covers the decision. Significant architectural choices must remain within that mandate and be recorded with their rationale.

## 3 Parallel instances of subgraphs

A slice should be assignable to an instance of a subgraph. A subgraph can contain implementation, review, verification and rework, or another process appropriate to the task. Multiple instances may use the same definition while receiving different assignments. A single worker node is a possible special case, not the only unit of parallelism.

The definition and its execution instances must remain distinct. Each instance needs an identifiable parent task or run, slice assignment, definition version, contract versions, inputs, outputs and execution history. Rework in one instance must not be mistaken for a new sibling or overwrite another instance's result.

The runtime should start instances only when their configured prerequisites and resource limits permit. A limit of two active instances may govern a larger set of ready slices. Calls, retries and resource consumption must remain attributable to individual instances and the parent work, without double counting or silently resetting an overall budget when children are created.

A synchronisation point expresses an explicit condition for further work. It may require specified outputs, an agreed contract version, or a recorded decision. It need not wait for unrelated branches. The meaning of collecting child results, including what happens on failure, cancellation or missing output, must be defined by the workflow and visible to the user.

Separate workspaces can reduce concurrent file interference, but they do not resolve incompatible designs. Shared working copies, isolated worktrees and other execution arrangements remain design choices. Whichever mechanism is chosen must protect the applicable ownership and coordination rules through runtime behaviour rather than relying entirely on natural-language instructions.

Completion of individual slices must not automatically establish completion of the parent task. The workflow must identify responsibility for integration and the checks required on the combined result. Reviewing components independently does not establish that they work together, and a clean merge is not evidence of semantic compatibility.

## 4 Contract changes and continuity

Contracts should be established before the implementation that depends on them, while remaining revisable when new information invalidates an assumption. An implementer must have an explicit way to report that a contract is inadequate instead of silently changing a shared agreement.

A proposed contract change should identify its reason, affected slices, compatibility implications and evidence. The configured workflow determines who can accept the change. Accepted changes need an identifiable version and a recorded transition so that affected instances receive consistent instructions.

The system must prevent dependent work from being integrated as if conflicting contract versions were equivalent. A workflow may pause affected instances, allow independent work to continue, or require selected rework. The precise mechanism is open; the decision and its consequences must be visible. Earlier reviews and tests must be reconsidered where their dependencies changed. If validity cannot be established, it must remain unknown rather than silently carrying forward.

The task remains the durable context across slices, attempts and sessions. Shared decisions belong in the working memory with source and authority; an agent's proposal must not become an approved decision through summarisation. Handover should supply or clearly reference the current assignment, applicable constraints, contract versions, relevant evidence and reason for transition.

A failed or interrupted child must leave the parent task and useful completed work intact. Before retrying, recovery must account for known effects and unresolved execution state. A request to cancel is distinct from confirmation that work has stopped. Uncertain state must not lead to blindly starting a duplicate writer.

A user may discuss, take over or return part of the work through the interactive agent. Such a transition must coordinate with active instances and preserve task identity and applicable permissions. Moving between dialogue and autonomous execution does not grant additional authority.

## 5 Dialogue based workflow construction

The normal entry point should be a discussion of the desired working method. A user might ask for larger tasks to be decomposed first, independent parts to run concurrently, and a separate review of the integrated result. The user should not have to construct a slicer node and all downstream components manually to express that preference.

DSpatch should offer understandable workflow concepts, explain their purpose and costs, and help the user choose and combine them. Examples include contract-first decomposition, parallel implementation subgraphs, independent review, integration verification, and a return path for contract revision. These are configurable concepts, not mandatory stages for every task.

For each proposed concept, DSpatch should explain when it helps, what it requires, what it produces, how failures are handled and what additional coordination or agent work it introduces. Estimates of speed, cost or quality must be labelled as estimates with their assumptions; adding parallelism must not be presented as a guaranteed speedup.

The discussion should connect three levels of description:

- Intent: the goal, constraints and preferred trade-offs.
- Work organisation: selected concepts, responsibilities, dependencies and synchronisation.
- Executable graph: concrete nodes, subgraphs, contracts, routes and runtime configuration.

DSpatch should construct a reviewable graph from the agreed organisation and explain how its concrete elements implement that agreement. Proposed changes should be visible before they replace an existing definition. Constructing or saving a graph is distinct from starting a run; execution requires an applicable mandate, which may already have been given.

The user must remain able to inspect and edit the graph directly. A manual edit should become part of the next discussion, with its effects explained where they can be established. DSpatch must not silently regenerate an older graph over manual work. If an edit no longer fits a recognised concept, the system should preserve it and disclose that the higher-level interpretation is partial or uncertain.

This correspondence must not create two independent sources of truth. Intent and rationale may be stored alongside the graph, but the executable definition must be identifiable. The exact representation of concepts and their mappings is an open design choice.

## 6 Reusable concepts and graph analysis

Reusable concepts should compose through explicit contracts. A parallel implementation concept needs to know the structure of its slice assignments and the outputs expected by integration. Connecting two concepts visually must not imply that their inputs, outputs or failure handling are compatible.

A concept may be realised as a subgraph, a parameterised pattern, supporting instructions, or a combination. The representation should remain open until implementation needs are understood. Reuse must preserve inspectability: the user should be able to expand a concept and see the instructions and configuration that would run.

DSpatch should distinguish three kinds of analysis. Structural validation checks properties the system can establish mechanically, such as missing connections, incompatible declared inputs and unsupported capabilities. Agent analysis offers reasoned assessments of responsibility, coupling and likely failure modes. A simulation explores configured paths under stated assumptions. None by itself proves that real agents will interpret the task correctly or that the produced software will work.

Useful questions include what happens when a slice fails, when a contract changes after another slice passed review, when a branch produces no required result, and when a user pauses one part of the workflow. Analysis should identify missing transitions and decisions without inventing new policy on the user's behalf.

Graph editing and concept updates must not silently change an active run. A run must be associated with the definitions and contracts it actually uses. Any supported migration of active work needs explicit rules and a visible record of affected instances. The choice of migration mechanism remains open.

Actual run evidence should support later improvements to the graph. Suggestions should explain the observed problem and proposed change. A disappointing run does not authorise autonomous rewriting of the workflow outside the existing mandate, and a successful run does not establish that every path is safe.

## 7 Responsibility and runtime guarantees

The slicer is a role in a configured workflow. Its name must not acquire special meaning in Maestro. The same generic mechanisms should support other forms of decomposition and non-code work such as independent analyses followed by synthesis.

Agents analyse the task, propose decomposition and contracts, perform assigned work, and report results or uncertainty. Node configuration and graph connections define the concrete assignments, instance creation rules, dependencies, routes and collection conditions. Maestro executes these rules, identifies instances, records transitions and enforces supported limits. The user steers goals and authority through dialogue or direct commands.

The authoring assistant may recommend a process, but its prose does not create a runtime capability. DSpatch must show when a proposed concept relies on unavailable provider or engine support. Unsupported behaviour must not be presented as an executable promise.

The graph, task overview and instance views should present consistent state. A user should be able to see which slices are active, what is waiting, which contract version applies, why a synchronisation point is blocked, and what evidence supports an integrated result. Basic controls such as pause and takeover should be discoverable without requiring a particular chat phrase.

Predictability concerns execution rules, authority and reporting. It does not mean that models always choose the same decomposition or implementation. Records must distinguish observations, agent judgments, user decisions and engine-selected behaviour, including unknown origin where appropriate.

## 8 Illustrative workflow and evaluation scenarios

The following example illustrates the vision and is not an implemented graph or a completed test. A user requests an annotation-tool feature spanning frontend behaviour and supporting tools. During dialogue, DSpatch proposes a shared data contract followed by two implementation subgraphs and an integration review. The user adjusts the proposal within the task's scope.

The slicer identifies the shared schema, ownership boundaries and error semantics. Any necessary common groundwork is completed before dependent implementation starts. Two instances then work against the same contract version, each with its configured review and verification steps. A tools-side discovery may trigger a contract-change proposal. Affected frontend work is coordinated before resumption. The final checks examine the integrated feature, with evidence tied to the combined artifact rather than only to the separate branches.

The following scenarios should guide future specification and validation. They are proposed acceptance scenarios, not claims of passing tests:

1. A user describes a working method in dialogue and receives an inspectable graph with explanations of the selected concepts and trade-offs.
2. A slicer identifies a shared prerequisite and prevents dependent implementation from starting before its contract is established.
3. Several instances of one subgraph execute distinct slices within a configured concurrency limit, preserving separate identities and results.
4. A contract changes after one slice has passed review. Affected work and evidence are identified, and uncertain validity is shown explicitly.
5. Independently successful slices fail together. Integration checks prevent an unsupported parent-completion claim.
6. Execution stops after a child makes a change. Recovery preserves the parent and completed work and addresses uncertainty before retrying.
7. A user edits a generated graph manually. Subsequent dialogue respects the edit and explains any loss of correspondence to a reusable concept.
8. A proposed concept requires an unsupported capability. DSpatch exposes the limitation before presenting the graph as runnable.
9. A task is too coupled to benefit from parallel implementation. The proposed workflow uses sequential work or shared groundwork with a stated reason.
10. A simulation appears successful but a live agent misinterprets its assignment. The recorded evidence keeps simulation results distinct from observed execution.

## 9 Open design decisions and development approach

Further design must determine how parameterised subgraphs are represented and instantiated; how concepts expose input, output and compatibility contracts; and how authoring changes are versioned. It must also determine workspace isolation, ownership enforcement, integration responsibility, recovery behaviour and the treatment of active instances when contracts change.

Other decisions include how concurrency and budgets are allocated across nested work, how much concept metadata is retained after manual edits, how evidence is linked to contract and artifact versions, and which provider capabilities are required for each supported mode. No storage product, orchestration framework or external component is selected by this document.

Development should proceed through useful, bounded increments. A first authoring capability may assemble and explain an existing sequential graph from a small concept set. An initial concurrency capability may support one level of parallel subgraphs with explicit contracts and a single integration point. These are candidate increments, not a committed backlog or a requirement to build a general workflow language first.

Evaluation should consider time to a useful verified result, coordination and rework, human effort, resource use and the ability to explain failures and recover. More simultaneous agents and fewer manual interventions are not sufficient measures of success.

The Markdown document is intended as the maintained project source at docs/CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md. The Word version is a reading copy of the same content. Future revisions should preserve one authoritative text and regenerate the reading copy.
