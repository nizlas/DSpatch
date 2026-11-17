---
id: DSP-219
title: DSpatch's own loops are provider-agnostic; the target is an export format
status: Review
assignee: []
created_date: '2026-11-17 22:00'
updated_date: '2026-11-17 23:30'
labels:
  - loops
  - agents
dependencies:
  - DSP-218
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request of 17 November 2026, building on DSP-218: a loop describes roles, steps, routes, handovers and requirements; the provider and base model are chosen in the chat; the same loop runs with Copilot, Claude or Cursor as long as the chosen integration can meet its concrete requirements.

1. The graph's target and the roles' provider-specific form must not decide whether DSpatch can open, choose, validate or run a loop. Common role instructions are read regardless of provider; checks that a role source exists, can be read and holds instructions stay; provider-specific format checks stay where export or external agent environments need them; existing definitions with a target keep working without migration; the editor must not present an export format as a condition for running.
2. Requirements are checked against the chosen integration, the same way in preview and at start, telling apart enforced, instruction only, not supported and not established. A hard requirement is not silently weakened to a prompt instruction, and ordinary role prose is not made a hard requirement. An incompatibility names the step, the requirement and the limit; no provider or model is switched automatically.
3. Steps inherit the chat's model; explicit step models are kept and checked where the integration allows, unknown availability said honestly. DSpatch's parallel sessions are kept apart from the agent's own subagents; a ban on the agent's own delegation does not block DSpatch's fan-out; real concurrency limits are respected and their consequences shown without provider-specific copies of a graph.

Governing decisions: Niclas's decisions of 17 November 2026 (this request and DSP-218's); DSP-138/139 (a run's provider is the chat's; capability answers come from the run's provider); ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md (the product contract does not depend on one provider's team feature; DSpatch coordinates sessions); loop-graph.ts and GRAPH_FORMAT.md (the target is stored in the file and never migrated); ROLE_FORMAT.md (generation refuses an undeclared target). Superseded by Niclas's decision: DSP-22 #8's "the target drives the warnings shown".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No target or role export form decides opening, choosing, validating or running a loop in DSpatch; role existence, readability and instructions are still checked; older files load unchanged
- [x] #2 Export keeps its format checks; a role whose only problems are with its export form is read for a run, with a notice
- [x] #3 Requirements are answered by the chosen agent in preview and at start, in four named kinds; an unsupported one refuses naming step, requirement and limit; the others are recorded on the run
- [x] #4 DSpatch's fan-out is never stopped by no-subagent-delegation; an adapter's lower concurrency is said
- [x] #5 Editor texts and the Advanced section present the target as an export format only
- [x] #6 Targeted tests over the three providers with simulated adapters; the changed window parts seen
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
State on 17 November 2026:

- Removed target dependencies: `role-does-not-support-target` (an error that refused a loop whose roles had no form for the drawing's target) and `role-target-inferred`; `runnableHere`, `connectedTargets` and `not-runnable-here` (a notice that a graph "cannot be run here" from its target); the target-based requirement comparison in the target-change report (DSP-218 had already moved the requirement check and the workspace decision to the run's agent).
- Kept, and why: the `target` field itself, stored and never migrated, as the export format (`describeTargetChange` now names only roles without an export form); `role-source.ts`'s target checks, which `npm run roles:generate` still enforces: they are marked `exportOnly`, and a source whose only problems are those resolves for a run with its common sections and a `role-export-form` notice (`resolveRoleSource`, `ResolvedRole.exportProblems`); the Claude Code and Cursor rows of `TARGET_CAPABILITIES` for generated agent files; the run-started record's `target` value.
- Instructions: a resolved role that says nothing gives `role-has-no-instructions` (a warning, so no existing loop is refused).
- Requirements: messages start with their kind (Not supported, Not established, Instruction only), and the node panel shows one of four badges (enforced, instruction only, not supported, not established) from the chosen agent. At start, unsupported refuses (DSP-218), and the other answers go on `run-started` as `requirements`, with `agent`.
- Parallelism: `FAN_OUT_ADAPTER_CAPS` moved to `loop-graph.ts`; a fan-out asking for more than its agent runs at once gives `fan-out-limited-by-agent` (Cursor: one after another). No requirement touches DSpatch's own fan-out.
- Models: unchanged from DSP-209 S19/S19b and DSP-218: steps inherit the chat's model, a step's own is kept and checked against a list where one was read, and otherwise said to be unchecked.
- Texts: Advanced reads "export format for agent files"; the node panel says any agent chosen in the chat runs the role and which formats it can be exported for; the chat's graph-authoring tool tells the agent `targets` is for export.
- Docs: GRAPH_FORMAT.md (the target section rewritten as an export format; requirements by the run's agent; fan-out and delegation), ROLE_FORMAT.md, loop-graph.ts's header.
- Checks: new `tests/loop-provider-agnostic.test.ts` (the bundled chat loop, drawn for cursor, run with Cursor, Claude and Copilot through simulated adapters: each completes, each builds only its own adapter, the work step is told its role's own words, run-started records the agent and keeps target cursor; the five bundled runnable loops check out with no error under each; unsupported names step, requirement and limit; Cursor's tool-restriction is "Not established" and Copilot's enforced; no-file-writes is "Instruction only" under all three and never shown as enforced; a fan-out with no-subagent-delegation is never refused, Cursor's one-at-a-time said; a claude-code-drawn loop with Cursor-file roles, refused before, loads; a role with only export problems is read and generation still refuses it). Existing: loop-graph, role-generate, loop-choice, loop-parallel-loop, loop-provider, loop-copilot-run (real Copilot runtime, stand-in model), loop-model-select, loop-node-help, loop-run, graph-authoring-tools, graph-proposal: all pass. Typecheck; build.
- Window (this checkout's build, headless, isolated profile, agent chosen through the chat's own calls, no model call): a cursor-drawn graph under Copilot shows background-execution "instruction only" and no-subagent-delegation "enforced"; switched to Cursor in the chat, both "instruction only" and the line "Runs with Cursor · …"; the parallel loop under Cursor shows the one-at-a-time notice; Advanced reads as an export format. The node panel's reworded role line was not seen after the change.
- Not verified with a real provider: no account was used. Remaining limits per integration, from the tables (documentation unless stated): Cursor — no-file-writes, background-execution and no-subagent-delegation instruction only (observed for the first), tool-restriction not established, one fan-out branch at a time; Claude — no-file-writes and background-execution instruction only, the rest enforced by the SDK options DSpatch passes (checked offline); Copilot — the same as Claude (tried with a stand-in model behind the real runtime). No integration has an unsupported requirement today.
- For the bundled-loop inventory that follows: build on this; the bundled loops need no target change to run with any of the three.
<!-- SECTION:NOTES:END -->
