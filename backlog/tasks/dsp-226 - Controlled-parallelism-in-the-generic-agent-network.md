---
id: DSP-226
title: Controlled parallelism in the generic agent network
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, parallelism, graph]
dependencies: [DSP-224, DSP-225]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let the generic agent network's Tech Lead choose, per subtask, between the existing sequential dispatch and a split into independent branches that run in parallel, built on the fan-out engine, worktrees, mailbox and integration the Parallel workflow already uses. Keep the merged roles, model classes and review routes. Each branch carries its own role, model class and review need; the split is validated before start (no overlapping write ownership, no unresolved dependency between branches); an integrating role combines the branches, resolves conflicts, checks shared contracts and sends the combined result to the review route its branches require, never a weaker one. Branches communicate through send_message, check_messages and acknowledge_message. The canvas shows the split, the running branches and the join; each branch shows its task, role, status, class and model, output and messages; a fan-out node with several classes shows a summary, not one class. No release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 tl-dispatch can choose a parallel split; the sequential dispatch is unchanged and stays the default.
- [x] #2 A slice may name its role (an allowed agent node) and its choices (model class, review); the engine validates them, refuses overlapping ownership and dependencies between slices before any branch starts, and runs each branch with its own role, model and choices.
- [x] #3 After the fan-out the strongest review route and class any branch carried go on with the work; the integrator routes the combined result to QA and review by it.
- [x] #4 A failed branch reaches the integrator and is never reported as integrated; cancellation keeps every branch's work.
- [x] #5 Under an adapter cap of one, the same split runs one branch at a time and says so.
- [x] #6 The fan-out node shows a summary of its branches' classes; each branch shows its role, class and model.
- [ ] #7 Verified through the runtime with a simulated adapter; real-provider status reported.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result (18 November 2026). Governing decisions: DSP-209 mission decisions 5 (fan-out within one visit), 6 (one base), 7 (the integrator is a role and merges; the engine never does), 22 (caps Claude 3, Copilot 3, Cursor 1, read from code), 23 (messages delivered only at check_messages), 24-26 (at most six slices, the split and the ownership rule); DSP-224's per-visit choices. Niclas's assignment asked for anything missing to be built generically.

**Where the graph chooses.** `tl-dispatch` gains the outcome `parallel` beside its capabilities; the sequential dispatch is unchanged and stays the default. With `parallel` it writes a `dspatch-slices` block. New nodes: `branches` (the one fan-out node, `fanOut.slicesFrom: tl-dispatch`, `maxConcurrent: 3`, worktree isolation, `branchAs: implementer, researcher, explorer, data-curator`) and `integrator` (new role `generic-integrator`; outcomes `integrated`, which goes to QA or design QA by the joined review route, `rework` back to the branches, `return-to-lead` back to tl-dispatch). Both success and `branch-failed` go to the integrator, so a failed branch reaches it by name.

**Engine, generic.** A slice may give `as` (a node from the fan-out's `branchAs`: the branch runs with its role, purpose, requirements and model policy), `choices` (the graph's choices for that branch only, so its model follows its own class through the agent's Model classes), `acceptance` and `dependsOn` (refused: dependent work goes in a later round or in sequence). Unknown `as` or options are refused before start. A choice may declare `joins: strongest`; after the fan-out the work carries the strongest value the visit or any branch had, so the integration never weakens a thorough review. A refused split still files its reason as the node's result. The node's result lists per branch its role, choices and ending ("not finished" for a failed one) and every message with sent/delivered/acknowledged per recipient. When the agent's cap makes branches wait, the result and each `branch-started` say so. The branch prompt says when to check messages, that delivery happens at a check, that a contract change is a proposal, and to end with an "Open decision" section rather than wait.

**Display.** `branch-started` records `runsAs`, `roleId`, the branch's choices and model. The Branches list and branch output window show each branch's role and class; the fan-out node's tag sums its latest visit's classes (`S·M·L`), its hover lists each branch's class and model, never one class for all.

**Reused unchanged:** fan-out runner, worktree driver, base commit, per-branch sessions, concurrency caps, cancel, mailbox, journal kinds, usage per branch, visit-numbered branch names.

**Verified (simulated only).** `tests/generic-parallel.test.ts` (10): sequential dispatch unchanged; overlapping ownership and dependencies refused before any worktree opens and returned to the lead; each branch's role, class, model and worktree; the joined review route takes design QA and the thorough review; two branches overlap under cap 3 and run one after another, said, under cap 1; a failed branch reaches the integrator by name with both branches closed; a revisit makes new branches with outputs kept apart; cancel closes every branch; and through `runLiveGraph` with a simulated adapter on Claude and Cursor and real git worktrees: per-branch model and role in the session, commits on `dspatch/run/<run>/branches/v1/<slice>`, the working copy untouched, a message delivered at the recipient's check and acknowledged, and the integrator's prompt holding every result, the open proposal and the delivery status. Existing fan-out, mailbox, parallel-loop and generic-network tests pass. Window check (isolated profile, recorded scripted run): the fan-out node's tag `S·M·L`, its line and hover, the Branches list with role, class, model and messages, the integrator's joined class Large. Not tried: a real provider; a merge by a real integrator.
<!-- SECTION:NOTES:END -->
