---
id: DSP-189
title: >-
  Generate new code walks through a planner, writer and reviewer loop on the run
  engine (first evaluation version)
status: In Progress
assignee: []
created_date: '2026-11-10 01:37'
labels:
  - review
  - loop
dependencies:
  - DSP-188
priority: medium
type: enhancement
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 10 November 2026: a first, bounded agent loop for generating new code walks inside the product, as an optional evaluation mode beside today's single-call generation, so that what the loop adds can be seen. DSP-188 keeps its own status and its pending human judgment.

**Governing decisions.** docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md governs the pedagogy (sections 1–4 for what a walk and a step are, 6 for how instructions are derived, 9–10 for state, 11 for verification); docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 1 (the role decides the method, the graph the steps and routes, the engine the execution; everything DSpatch adds is explicit and inspectable) and section 5 (orchestration and review share the agent connection; an agent's acceptance never becomes human approval); docs/MAESTRO_ORCHESTRATION.md sections 3, 6 and 8 (Maestro owns the flow, registers work before starting it, records cost per step with unknown as unknown); docs/INTERACTION_MODEL.md section 1 and 4.5 (cancel preserves what was done); VISION.md section 3.4 (a walk is never an approval; the agent does not change code; reviews are instances; step explanations belong to Step) and 3.3 (review uses the same agent connection).

**What is built.** Three roles, planner, writer and reviewer, as agent nodes of a DSpatch loop graph (`docs/loop/graphs/dspatch-walk-loop.graph.json`, roles in `docs/loop/roles/review/`), walked by the existing run engine (`runLoopGraph`: routing on declared outcomes, the rework bound, the journal) with a step executor for review work: one read-only analysis session per role over the two revisions, through the provider and model the person chose for walk preparation. The planner reads the revision and plans the walks (purpose, steps, places, transitions); the writer explains each step in the chosen profile, with the whole plan and its own reading of the code, one step at a time in its own session; the reviewer judges the finished walk against the code and the reference's criteria and either accepts it or names concrete shortcomings. One targeted correction round at most: structural findings go to the planner (and the affected steps are rewritten), explanation findings to the writer (only the named steps); the reviewer then gives a final assessment that starts no further round and reports what remains. Today's generation stays as the default and the comparison path; both write the same walk definition format, so the walks open and read the same.

**Traceability and state.** The run's plan, draft, findings, corrections and final assessment are kept as run artefacts of the review (a run record in the loop's record format, and the engine's result store), with provider, model, graph version, role versions, every prompt and answer, times and the usage the provider reported (unknown where it reported none). The job line shows what the loop is doing and can stop it; a provider failure or an interruption ends the job without any automatic retry; a late answer never reaches another review or recreates a deleted one; Step and Discussion are untouched. The trace is readable on request and never in the normal reading flow. The reviewer's assessment approves no code, changes no human decision and resolves no finding.

**Verification.** Routing, the bound, the prompts, the readers, cancellation, failure and state with automated tests and a real window trial with the simulated provider; a comparison of today's generation and the loop on the same code, profile and model over varied generic cases, judged on understanding rather than counts; the comparison through the real product path with a real provider where one is available, or the exact statement of why it was not possible. Simulated trials and subagents outside DSpatch are not evidence of the product path's model quality; Niclas's judgment on real code remains open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Walk preparation can be started in an optional evaluation mode that runs a planner, a writer and a reviewer as agent nodes of a DSpatch loop graph through the run engine, with the chosen provider and model and read-only analysis access to the two revisions; at most one targeted correction round (structural findings to the planner, explanation findings to the writer, only affected steps rewritten) and a final assessment that starts no further round; today's single-call generation stays as the default and the comparison path, and both produce the same walk definition format
- [ ] #2 The three roles are short, coherent instructions derived from the reference: the shared explanation task and the profile's reader, no sentence or identifier quotas and no mandatory disposition; the reviewer judges against the code and the same reference version, can accept without rewriting, reports concrete significant shortcomings with the affected steps and reasons, and its assessment never approves the code, changes a human review decision or marks a finding resolved
- [ ] #3 The first plan, the draft, the reviewer's findings, the corrections and the final result are stored as traceable run artefacts of the review with provider, model, graph and role versions, every prompt and answer, times and reported usage (unknown where the provider reports none); the person sees that generation is running and can stop it; provider failures and interruptions end the job without automatic retries; a late answer never lands in another review or recreates a deleted one; Step and Discussion receive nothing from the loop; the trace is readable on request and absent from the normal reading of the walk
- [ ] #4 Automated tests cover the routing (accept, rework to the planner, rework to the writer, the spent bound, a planner that cannot plan), the prompts and readers, state, cancellation and failure; a real window trial with the simulated provider covers the new user flow, and the relevant regression trials still pass
- [ ] #5 Today's generation and the loop are compared on the same code, profile and model over generic cases (a simple setting, several significant calls with alternative branches, a worker with waiting, notification and retries, a shared snapshot with readers and a writer, and external code context at its revision), with the texts, the extra wait and the available usage kept for judgment; the comparison is judged on understanding, the profiles' different help and the walk's coherence, not on counts; whether the reviewer improves the draft, misses shortcomings or asks for needless rewrites is examined; the trial through the real product path with a real provider is done where one is available, otherwise its absence is stated exactly and the criterion stays open for Niclas's judgment on real code
- [ ] #6 The governing documents and this task describe the result consistently as a first evaluation version with implemented, verified and humanly judged kept apart; the work is pushed to origin/main, CI is green, and a Linux pre-release with .deb, host package, manifest and checksums is published and verified with the existing published-package and upgrade trials, with any need to restart the host stated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Graph `dspatch-walk-loop` with nodes plan, write, review and terminals delivered, delivered-with-objections, stopped; roles walk-planner, walk-writer, walk-reviewer in `docs/loop/roles/review/`.
2. `src/shared/walk-loop.ts`: prompt builders (plan-walks, write-step, review-walks), answer readers, the trace summary type; reuses the explanation task, the profile readers and the walk rules.
3. `src/host/walk-loop-run.ts`: the step executor over the analysis session (one per role), `runLoopGraph` with the rework outcomes and the limit route, the run record and result store under the review's generated folder, the final definition through `definitionFrom`; `ReviewAgentJobs` starts it for `method: 'loop'`.
4. Request and record fields (`method`, the loop trace), the picker's choice, the job line's activity, the trace on request; the simulated provider's three task branches with a rework variant.
5. Tests, the window trial, the synthetic cases, the evaluation run with its materials, docs, release 0.1.14.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- SECTION:NOTES:END -->
