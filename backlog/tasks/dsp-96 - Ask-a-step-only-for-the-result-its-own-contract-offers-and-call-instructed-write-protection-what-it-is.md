---
id: DSP-96
title: >-
  Ask a step only for the result its own contract offers, and call instructed
  write protection what it is
status: Review
assignee: []
created_date: '2026-09-22 17:20'
updated_date: '2026-09-22 18:35'
labels: []
dependencies: []
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the DSP-92 review. A bounded increment correcting the concrete contradictions in the agents' call contract and in what DSpatch says about write protection. Visibility work is DSP-94 and observation policy is DSP-93; neither belongs here. Three parts. First, findings F1, F10 and F2: role text must not unconditionally demand RESULT lines or failure declarations the current step is not offered, since declarationInstructions and outcomeInstructions are now conditional on the node's own declarations while the coordinator role still asks unconditionally; the coordinator-report node in the runnable graph declares neither outcomes nor failures and invented a RESULT line in all four DSP-91 walks, and the runtime's undeclared-product fault means a step that finished its work can stop the run at the last node. Let the role defer to the call's actual result contract instead. Keep the runtime check on undeclared outcomes: do not solve the contradiction by accepting arbitrary outcomes, by reading a failure as success, or by adding graph edges nobody asked for. Remove at the same time the duplicated general description of the run engine from the coordinator role, keeping what is specific to that role and letting the shared runtime instruction carry the shared contract. Second, finding F3: a Cursor project agent's readonly setting is not evidence that DSpatch's SDK call has technical write protection, and the capability table says enforced on the strength of a mechanism the live path does not use. Judge from the adapter and configuration actually used; where the limit exists only in instructions it must read as instructed rather than technically enforced, and every consumer, particularly graph validation and the snapshot decision, must stop treating an instruction as a technical guarantee. This is not a mandate to build a sandbox or to settle observation policy. Preserve the correct statement for the external Cursor flow, where a different mechanism genuinely is used. Third, findings F8 and F9: make precedence explicit in the shared call contract, using the messages and origins that already exist and introducing no semantic reviewer that tries to judge whether an agent's text is right. The wording must make responsibility and precedence understandable to an agent and must be quotable verbatim in DSP-94's visibility work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No role text asks unconditionally for a RESULT line or a failure declaration the step's own message does not offer; the roles and nodes sharing that instruction are checked, including coordinator-report and verifier
- [x] #2 The runtime check on undeclared outcomes still fails loudly; no arbitrary outcome is accepted, no declared failure is read as success, and no graph edge was added to resolve the contradiction
- [x] #3 The duplicated general description of the run engine is gone from the coordinator role, which keeps only what is specific to it
- [x] #4 What DSpatch says about a requirement being enforced follows the adapter and configuration actually used, and a limit expressed only in instructions reads as instructed rather than technically enforced
- [x] #5 Graph validation and the snapshot decision no longer treat an instruction as a technical guarantee, and the external Cursor flow keeps its correct statement where a different mechanism is used
- [x] #6 The shared call contract states that the person's original task and explicit constraints govern over an earlier agent's brief or paraphrase; that a later explicit correction from the person updates the part it concerns without replacing the rest; that a role's general routines may not be used to get around the task's explicit limits; and that actual permission boundaries and runtime limits remain
- [x] #7 Precedence is carried by existing messages and their origins, with no semantic reviewer of agent text introduced
- [x] #8 A later explicit correction from the person can change an earlier limit the task stated; what stands is the rest of the limits it does not touch, and technical permissions and runtime bounds are not changed by it
- [x] #9 TASK_PRECEDENCE and instructionPreamble say the same thing about what a later correction does
- [x] #10 Routing to Delivered is traced for a step that describes an obstacle in prose, and it is established whether a run can be marked as fulfilled while the report describes an obstacle; any concrete path found is reported with the smallest correction to the graph's or the result contract's responsibility, and registered separately if it needs a decision
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Coordinator, before the implementer starts. Two corrections to the DSP-92 analysis were made first and are already in docs/research/dsp-92-architecture-against-agent-behaviour.md.

F9's crediting paragraph was wrong and is corrected in place. It said the original mandate reached later steps only through the coordinator's brief before DSP-91. The run record contradicts that: in chat-loop-2026-09-21T21-01-49-307Z.jsonl the stored prompts for implementer (call 2) and verifier (call 3) each carry the block 'The run was started with this mandate. It is what the whole run is for:' followed by the person's Swedish sentences verbatim, including 'Las inte projektet'. Verified by reading reply.prompt on both lines; no provider call was made. Report 029 section 5 was right. The gap F9 names is therefore older and narrower than first written: both texts have always arrived together and neither says which governs. That is what part three of this card fixes.

F12 gained a clarification: the guideline does not forbid judging a task's resource needs before the project is touched, only a hidden classification that starts inventorying the project before the need is assessed. An agent assessing the need from its own assignment under visible instructions stays open as an option for DSP-93. Not designed here.

Follow-on work registered and not started: DSP-94 visibility, DSP-95 the Researcher's inputs, DSP-93 observation policy.

Implementer, 22 September 2026. All three parts implemented from candidate-48; full report at `.dspatch-loop/runs/20260920-104500-folders/reports/031-implementer-ask-only-for-what-the-contract-offers.md`. Eleven files changed and no graph edge added.

Part one. `docs/loop/roles/run/dspatch-run-coordinator.role.md`: the Delivery section now defers to the message ("How you declare a result is decided by the message you are in, not by this role"), covering both the `RESULT:` line and the two opening words, and saying what to do where the message asks for neither. The duplicated engine paragraph and the bare `.cursor/skills/dspatch-loop/SKILL.md` path are gone from Purpose; what is kept is that this is not the Cursor-chat coordinator. The other seven role sources were read and needed nothing: only this one demanded unconditionally. No runtime change — `productIsDeclared` and `undeclared-product` are untouched.

Part two. `CapabilityPath` splits the capability table by how the agent is started. `no-file-writes` stays `enforced` for a generated Cursor agent file and reads `other-means` for a run DSpatch walks; `background-execution` and `fixed-model-selection` gained the same treatment because their `how` named agent-definition fields too. `capabilityAnswer` now requires the path. Graph validation, the node panel and `describeTargetChange` ask for the walked run; `role-generate.ts` asks for the generated file and its notices are unchanged. `writeReachOf` no longer lets role prose stop the snapshot: with today's table no drawing with an agent step skips hashing, and the branch stays alive for a path that enforces the requirement.

Part three. `TASK_PRECEDENCE` in `loop-chat.ts` is sent to every agent step, entry and revisit included; `instructionPreamble` says a later message governs the part it concerns and no more; `describeReceivedResults` says what a handover is. No semantic reviewer: nothing reads a body for quality.

Checks: `npm run typecheck`, `npm run test:loop` (23 files), `npm run test:fast` (43), `npm run test:live` (2), `npm run build`, `npm run roles:generate` (all five `.cursor/agents/*.md` byte-identical — the external Cursor loop is unchanged). Four existing assertions were updated because the behaviour they pinned was the behaviour being corrected; the report names each. New candidate: candidate-49.

Implementer, 22 September 2026, criteria #8 to #10 from candidate-49. Full report at `.dspatch-loop/runs/20260920-104500-folders/reports/032-implementer-a-later-correction-and-what-delivered-means.md`. Four files changed: `app/src/shared/loop-chat.ts`, `app/src/shared/loop-instruction.ts`, `app/tests/loop-chat.test.ts`, `app/tests/loop-run.test.ts`. No graph and no role file was edited.

#8 and #9. The wording shipped for #6 said a later message leaves "every limit the assignment states" standing, which locked the very limit a correction is most likely to be about: "Läs inte projektet." followed by "Du får läsa README för att kontrollera detta." left README shut. Both writers of the rule now say the same three things — a correction may be about a limit; where it is, the later wording is the limit for exactly what it names and no further; the limits it does not touch stand. `TASK_PRECEDENCE` says it from the assignment's side, `instructionPreamble` from the message's own side, in the same message. The unmovable half was reworded from "does not change what you are permitted to do" to reach and the run's bounds, because a correction that narrows is now allowed and the old blanket contradicted it; `TASK_PRECEDENCE`'s last paragraph now names the person's later message inside it. The README case went into the existing `describe('precedence is stated in the call…')` in `loop-chat.test.ts` as two cases: one on the assembled message, one requiring both writers to carry the rule so an edit to one alone fails. Both establish only that the contract is sent; neither claims a model honours it, and their names say so.

#10. Traced in the code and answered: the distinction is held at every point where DSpatch states an outcome. `coordinator-report` has exactly one inbound edge, `e11` on the reviewer's `accept`, so an obstacle in the work routes to `implementer` (`e12`) or `needs-a-decision` (`e13`, `ending: not-success`) and never to `delivered`. `runOutcomeFrom` never reads `terminalNodeId`, and the runnable loop draws no gate, so every run of it records `verification-not-performed`. The badge reads the outcome, and the sentence beside it says the run says nothing about the project. One narrow path remains: `coordinator-report` declares no failure, so a report step that files a report saying it could not do its own step produces `success`, takes `e14` and reaches `delivered`, which puts a tick on that node in the graph view — the tick only, nothing else changes. The smallest correction is a graph change and it is handed back as a decision, because no existing terminal fits ("the work was accepted and the run could not report on it" is neither `stopped` nor `needs-a-decision`) and `implementation-review` has the same gap. No relabelling of the terminal and no reading of report text was done; both were forbidden and both would have been the wrong fix. Three cases added to `loop-run.test.ts`, walking the shipped runnable graph with the dry-run executor.

Checks: `npm run typecheck`, `npm run test:fast` (43 files, 1013 tests), `npm run test:loop` (23 files, 514 tests), `npm run test:live` (2 files), `npm run build` (identity `d5866e25c9fb8a4f`). `npm run package` not run, as instructed; no loop walk and no provider call. New candidate: candidate-50.
<!-- SECTION:NOTES:END -->
