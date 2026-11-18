---
id: DSP-227
title: Reusable model choice and controlled parallelism for graph builders, with a real-agent coordination pilot
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, parallelism, graph, editor]
dependencies: [DSP-222, DSP-223, DSP-224, DSP-225, DSP-226]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make dynamic model class and controlled parallelism reusable graph concepts a graph builder adds and configures through the graph editor and through dialog with DSpatch, without hand-editing JSON. Generate the instructions for choices, allowed options, the split and its answer format from the graph's structured settings, so planning roles need not copy them; keep task-specific criteria. Make clear in the editor and docs that a branch borrows a node's role, purpose, requirements and model policy but does not run its continuations as a subgraph. Make `joins` explicit about order and never apply it to a choice without a meaningful order; a large model in a branch does not by itself mean the integrator's model. Verify with a small independent example graph, and pilot real-agent coordination between parallel branches with and without the mailbox tools in a synthetic repository. No release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 A graph builder adds and configures a model-class choice (classes, criteria, deciding step, default and invalid handling, steps it applies to) in the editor and through the graph dialog tools.
- [x] #2 A graph builder adds and configures a split-run-integrate section (proposing step, allowed roles, model per branch, concurrency, isolation, integrator, continuations, sequential path) in the editor and through the graph dialog tools.
- [x] #3 The choice, option and slice-format instructions are generated from the graph's structured settings; validation, prompts, editor and runtime read one definition; existing graphs still load.
- [x] #4 Editor and docs say what a branch is and is not; joins is explicit and ordered; the integrator's model is an explicit policy.
- [x] #5 An independent example graph built through these paths runs model choice per task and branch, the split, the sequential path and the integration, and is saved, reopened and edited.
- [x] #6 A bounded real-provider pilot compares the same parallel task with and without the mailbox tools, with traceable evidence; simulation is never reported as verified agent collaboration.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 18 November 2026. Governing decisions: DSP-209 mission decisions 5–7, 9, 22–26 (fan-out within one visit, one base, the integrator merges and the engine never does, no wait tool, caps read from code, delivery only at check_messages, at most six slices and the ownership rule); DSP-224's per-visit choices independent of each other; AGENT_BEHAVIOUR_AND_ORCHESTRATION.md §1–3 (every instruction DSpatch adds is explicit and inspectable in the editor's runtime contract); Niclas's assignment of 18 November (no special cases for the generic graph's role names, no nested subgraph execution, no push delivery or new messaging protocol).

Result (18 November 2026).

**Reusable sections, one definition.** `loop-graph-sections.ts` reads and writes two sections from the graph's own fields, used by the editor's forms (`GraphSectionForms.tsx`: *Choices made per task* and *Parallel sections* in the graph panel, *Parallel section* on a fan-out node) and by the chat agent's new `propose_graph_section` tool, which applies a section to the open proposal or the file and proposes the whole graph through `propose_loop_graph`'s path and the loader's check. A choice section: the choice (options with criteria, `modelClass` per option, default, `order`, `joins`, `whenMissing`), the steps that decide it, and the steps whose model follows it with the options each runs. A parallel section: proposer and split outcome, fan-out node and default role, `branchAs`, `sliceChoices`, branch model choice, `maxConcurrent`, isolation, `splitWhen`, integrator with its own explicit model policy, its three outcomes, where integrated work goes (one step or one per option of a choice), where an unresolved decision and a run limit go; the proposer's other outcomes stay as the sequential path, and a section that would leave none is refused. No role or node name is special.

**Format (compatible).** A choice option may name `modelClass` (all or none); a `select` policy `chosenBy` such a choice lists options by id alone (or none), the class written once in the choice; a contradicting class is refused. `order: weakest-first`; `joins: strongest` reads it (an older file without `order` loads with a warning); `whenMissing: strongest` needs it. `fanOut.sliceChoices`, `fanOut.splitWhen`. The generic network now uses them; its class choice no longer joins, so the integrator's model is its own explicit policy (the lead's class, medium when small) and only the review route joins.

**Generated instructions.** The deciding step's CHOICE instructions were already generated (DSP-224) and now say what a missing value gives; the proposing step's slice format, allowed `as` nodes with the classes each runs, slice choices, rules, what a branch is, concurrency, integrator, joins and a valid example block are generated from the fan-out (`loop-split-instructions.ts`) into its prompt and the editor's message panel. The generic tl-dispatch purpose lost its hand-written format.

**Branches.** Editor, docs and the proposer's instructions say a branch borrows a node's role, purpose, requirements and model policy, not its routes, and is not a subgraph. From the pilot: a branch's assignment lists its siblings' tasks and owned paths and says when to send; a branch that ends with messages waiting gets one reminder turn in the same session (delivery still at check_messages). `branchMessaging: false` is an experiment control in the live executor.

**Example.** `docs/loop/examples/workshop` (coordinator, maker, scout, crew, assembler, two checks) built through the chat tools in `tests/graph-sections.test.ts` (8 tests): model per task and branch, the split and the sequential path, integration routed by the joined review route, read back, edited, saved and reopened byte for byte. Window check, isolated profile, no model call, with a scripted recorded run: the sections' forms, the coordinator's generated parts in its message panel, an edit saved to the file, the crew's S·M·L summary, per-branch role, class, model and messages, visits kept apart. Found and fixed there: option rows too narrow, the fan-out panel hidden under Advanced, class letters out of order. Branch live output during a live run was not tried in the window.

**Pilot with real agents** (Claude, DSpatch's login, synthetic repository; see docs/loop/pilots/branch-messaging-pilot.md). Before the fixes the finder did not send and the export was wrong until a rework round. With sibling context the export was right in all runs of both variants; messages were sent but never delivered until the reminder. With the reminder, in both mailbox runs the receiver reversed an explicit decision because of the message, traceably; in both controls it found the rule itself. No better end result was shown; messaging cost 6–51 % more output tokens. The lead was scripted.

Remaining: Niclas's own trial of the editor forms and the dialog; whether the reminder turn and the sibling list are the design he wants (both are small and within the mailbox model, recorded as fixes found by the pilot); a pilot case the receiver cannot reach from its own task.
<!-- SECTION:NOTES:END -->
