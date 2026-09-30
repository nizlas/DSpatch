---
id: DSP-91
title: >-
  An agent does the step it was given, and reads the project only if the task
  needs it
status: Review
assignee: []
created_date: '2026-09-22 05:40'
updated_date: '2026-09-22 07:21'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHAT NICLAS SAW, 22 September. He asked the runnable development loop not to read the project, only to make a very short demonstration pass through the steps to Delivered. The coordinator agent investigated MiniDAWLab anyway: read README and PROJECT_BRIEF, ran Git commands, hunted for DSpatch files, and went on into the user's .cursor directory. It then restated 'do not read the project' as 'not reading/understanding the full project' and carried on reading. It also judged the assignment possibly mistaken because DSpatch's role file was not present in MiniDAWLab - confusing the LOOP'S OWN RESOURCES with the PROJECT the task is performed in, and appearing to believe it should build a demonstration rather than take part in the one already running. WANTED. An open repository is available context; the assignment decides whether it is used. The same loop must be able to answer a question unconnected to the repository and carry the result through execution, verification, review and delivery without reading or changing it - his example is 'compute pi to 600 decimal places, do not read or change the project', with calculation tools allowed in a separate temporary working environment. Roles choose their method from the task: the coordinator interprets the assignment and PRESERVES ITS CONSTRAINTS IN THE HANDOVER; the implementer produces what was asked, which may be an answer, a calculation, an analysis or a code change; the verifier checks by means that suit the task; the reviewer judges whether the assignment is met; the researcher picks sources, needing external ones for a general question and relevant parts of the repository when comparing against our implementation. No step does project inventory, Git checks, backlog work or builds by routine. An explicit constraint must not be weakened when the assignment is summarised or handed on. THE FIX IS GENERAL. Make plain to every agent that it is executing ONE STEP IN AN ALREADY RUNNING GRAPH: Maestro handles the calls, the passing of results and the move to the next node; the agent solves its step and hands back the result. Keep three things apart - the loop definition's resources, the task's working folders, and the run's result storage - and a role already supplied from the definition's resources must not be hunted for again in the target project. Adapt the product's roles and prompt building so general working routines apply when they are relevant, and keep applicable project rules when project work is actually being done. If the provider's automatic context loading needs a different session configuration for repository-free tasks, handle that explicitly. Review the run engine's own repository access too: a task that does not use the repository must not trigger content reading for snapshots or diffs by routine, while the loop's own definitions, roles and journal may still be read and stored where they belong. Preserve the user's assignment and its constraints through the whole chain, including correction rounds. Do NOT solve this with special cases for words like pi, demo or liveness, and not with yet another user mode that must be chosen for the instruction to be obeyed. Do not alter our external Cursor development flow by accident; if the product loop needs different instructions from the Cursor specialists, make the difference explicit in the role sources.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A repository-free task with an explicit no-reading constraint reaches delivery with no project inventory and no change to the repository.
- [x] #2 The constraint survives every handover, summary and correction round without being weakened.
- [x] #3 Every agent is told it is executing one step of an already running graph, and that Maestro handles calls, results and the move to the next node.
- [x] #4 The loop definition's resources, the task's working folders and the run's result storage are kept apart, and a role supplied from the definition is not hunted for in the target project.
- [x] #5 A project task can still read the code it needs.
- [ ] #6 The researcher can use external sources for a general question and the repository when comparing against our implementation.
- [ ] #7 The run engine does not read repository content for snapshots or diffs when the task does not use the repository.
- [x] #8 No special case for particular words, and no new user mode that must be chosen for the instruction to be obeyed.
- [x] #9 The external Cursor development flow is unchanged, and any difference from the product loop is explicit in the role sources.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as the seven changes named in §9 of `.dspatch-loop/runs/20260920-104500-folders/reports/029-researcher-why-the-agent-read-the-project.md`. Full account, with the prompt an agent now receives quoted: `.dspatch-loop/runs/20260920-104500-folders/reports/030-implementer-one-step-of-a-running-graph.md`. Candidate `candidate-47.json` in the same run folder, whose content ID that report quotes.

**The canary probe settled §11's open question: the provider injects nothing from the project.** `Agent.create`/`prewarmLocalWorkspace` with the options `localOptionsFor` actually builds reads 4 paths under the root — the root and `.git` — and opens no planted skill, rule or `AGENTS.md`; the same call with `settingSources: ['project']` reads 30 and opens them. A provider turn asked for five tokens planted in five places and replied `NONE` four times. The SDK maps an absent `settingSources` to every source off, and DSpatch has never passed it. So the reading came from our own prompt text, and role wording can fix it. This corrects the DSP-72 measurement in `working-roots.ts`, which was real but measured a configuration the product does not use.

**The seven.** (1) `rolePreamble` emits no resource path at all; it says the text between the markers is the role, that it came from the loop definition's resources, and that there is no such file in the working folders and its absence there is not a fault. (2) One working folder is named as well as several, framed as an address the assignment may or may not need, and a result path is named as DSpatch's run storage. (3) `ENGINE_PREAMBLE` gives every step the Maestro paragraph that previously existed in one role file for one node. (4) One role file each, conditional, no copies: the first branch of every conditional is the previous instruction verbatim. (5) The executor decides what it is appending before it announces it, so no step is promised a section the message does not carry. (6) `declarationInstructions` is conditional on the node's own declared failures, `outcomeInstructions` names declared failures too, and the runnable graph's `coordinator` now declares `spec-error`/`blocked` with edges `e01a`/`e01b` to `stopped` — a coordinator that correctly refuses was previously routed as success. (7) `writeReachOf` asks the drawing whether any step can write; if none can, no file under any root is hashed, and `describeUnobservedOutside` says the snapshot was skipped and that not observed is not the same as none.

A scratch working directory was considered for the repository-free case and **not** used: the probe removed its stated benefit, and it would have cost the run its only measurement of the project it was told not to touch. Both repository-free walks ran on the real scratch project and left it byte-identical, which is the stronger evidence.

**Four live walks** of `dspatch-development-loop-runnable.graph.json` on a throwaway project in `%TEMP%`, `composer-2`, all reaching Delivered in 5 calls. Repository-free (pi to 600 decimals, with an explicit prohibition): the constraint reached every step in the words it arrived in, the digits were independently recomputed by the verifier and matched, and `snapshotBefore == snapshotAfter` with `git status` empty. Project task (`mean([])` must throw): the code was read and changed as asked. Two defects were found by these walks and fixed — an agent with no declared outcomes was being told that finishing meant writing a failure name, and implementer/verifier were building `.dspatch-loop/` inside the project when the assignment named no report path.

**Checks.** `npm run typecheck`; `run-tests loop` 501/501, `heavy` 153/153, `all` 1153/1153, 0 fail; `npm run build` (identity `dc9aaec318aba518`); `npm run roles:generate` — 0 written, 0 refused, 0 differing. `npm run package` not run.

**For the coordinator's assessment, not ticked here.** AC #9: the five `.cursor/agents/*.md` files did change — each conditional preserves its previous branch verbatim, but "unchanged" is not literally true; the diff is at `logs/030-implementer/cursor-agents.diff`. AC #6: the researcher path was not exercised by a live run, since `e03` is only reached from an implementer declaring `research-needed` and none did. AC #7: the skip is conditioned on the drawing, which is the only property available before the run, so a repository-free mandate on a drawing that *can* write is still hashed — and the walks show why that is the right trade. `candidate-46.json` did not match the tree this work started from.
<!-- SECTION:NOTES:END -->
