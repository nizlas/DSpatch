<a id="dspatch-utvecklingsplan"></a>

# DSpatch development plan

Development plan, updated 14 September 2026. Based on [VISION.md](docs/VISION.md). Task files record current progress, criteria and results. TypeScript, React and Electron are the selected stack, with Windows and Linux in the vision. Initial implementation and testing use Cursor on Niclas's Windows computer. DSP-1 verifies the stack and selects and tests the concrete Cursor connection; see [decisions and rationale](docs/VISION.md#91-selected-stack-and-platforms). Value and learning from each increment may change the plan.

<a id="nästa-konkreta-steg"></a>

## Next concrete step

The sequence begins with **DSP-7**, a preparatory [development-loop](docs/DEVELOPMENT_LOOP.md) probe in Cursor: real specialist calls, planning quality and recovery. Its ID was assigned later but it comes first in execution order. Consult its task status rather than repeating a completed calibration.

**DSP-1** follows: verify the selected stack and the Cursor path to an agent response, actual file change and build or test, including a minimal packaged Windows probe. **DSP-2** builds the workspace in small runnable substeps: chat, code change with diff and command execution. Niclas can test intermediate results early; **DSP-5** then assesses the complete change workflow without waiting for deeper error recovery in DSP-3 and persisted history in DSP-4.

Linux support is introduced and verified incrementally, aiming for a consistent workspace; Linux testing is not a Phase 0 requirement. VS Code/Copilot remains in the vision. Technical decisions must leave room for it, but implementation and testing with VS Code/Copilot are not required in Phase 0. Record outstanding compatibility tests in DSP-1.

The goal is a workspace Niclas wants to use for a real development question. The planning tool must provide efficiency and a clear overview; external dashboards, Jira and demonstration value are not requirements for this project.

**Direction agreed on 14 September 2026:** continue through DSP-6 using the existing dependencies and acceptance criteria. Carry forward verified work from DSP-1 when planning later tasks instead of rebuilding it. This agreement does not increase run limits or replace Niclas's required assessments. After DSP-6, take stock, conduct bounded HCI and prior-art research, and agree the next direction for code review and Maestro with Niclas. Later product implementation does not start automatically.

**DSP-6 closed 16 September 2026.** Niclas assessed Phase 0 as a functional test: findability in menus still needs a great deal of iteration, and the window feels like one big debug window. That obstacle is accepted, not fixed here. DSP-5 closed with the same trial. Product work already underway is the graph editor and runner (DSP-18, DSP-21, DSP-22); the debug-window judgement is input to DSP-11, not a reason to rebuild the chat chrome tonight.

<a id="etapp-0--gör-en-verklig-kodändring-med-dspatch"></a>

## Phase 0 – Make a real code change with DSpatch

[Milestone goal and assessment](backlog/milestones/m-0%20-%20forsta-anvandbara-chatten.md)

| Task | Step | Value after the step | Depends on |
| --- | --- | --- | --- |
| [DSP-7](backlog/tasks/dsp-7%20-%20Kalibrera-utvecklingsloopen-i-Cursor.md) | Calibrate the development loop in Cursor | Tested coordination and assessed planning quality before delegating product work. | None |
| [DSP-1](backlog/tasks/dsp-1%20-%20Valj-teknik-och-verifiera-agentanslutningen.md) | Verify the stack and first Cursor connection | A tested path to agent responses, file changes and execution results through Cursor. | DSP-7 |
| [DSP-2](backlog/tasks/dsp-2%20-%20Oppna-projekt-och-ha-en-forsta-konversation.md) | Open a repository, change code and review the result | A runnable workspace for a small code change, normal diff and build/test. | DSP-1 |
| [DSP-3](backlog/tasks/dsp-3%20-%20Avbryt-och-aterhamta-en-chattkorning.md) | Cancel and recover agent and test runs clearly | Lost connections and cancellation leave an understandable state with work preserved. | DSP-2 |
| [DSP-4](backlog/tasks/dsp-4%20-%20Spara-och-fortsatt-en-konversation.md) | Preserve conversation, changes and results across restart | Reasoning, reviewed diffs and execution results remain available next time the app opens. | DSP-2 |
| [DSP-5](backlog/tasks/dsp-5%20-%20Provkor-forsta-chatten-med-Niclas.md) | Test the code-change workflow with Niclas and capture friction | Real use of the complete workflow determines what helps, obstructs or is missing. | DSP-2 |
| [DSP-6](backlog/tasks/dsp-6%20-%20Forbattra-friktionen-och-folj-upp-chattflodet.md) | Improve the main friction and assess the full development workflow | Assess the first milestone from assignment through code change and test, including recovery. | DSP-3, DSP-4, DSP-5 |

This table is an overview of scope and ordering. Task files are the source for current status, details, criteria and results. Update this overview when direction or scope changes; do not maintain a second status ledger here. Dependencies identify required input and do not automatically imply parallel writing agents.

<a id="förbättringar-av-utvecklingsloopen"></a>

## Development-loop improvements

These tasks concern the workflow used to build DSpatch. They sit outside the product's Phase 0 milestone and add no dependencies to DSP-1–6. Prioritise them by observed value after calibration; DSP-1 remains the next product step after DSP-7.

| Task | Value | Depends on |
| --- | --- | --- |
| [DSP-8](backlog/tasks/dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md) – Test task-aware model selection | Select model and reasoning level for the concrete assignment, with visible rationale, fixed user choice and verified actual selection. | DSP-7 |

DSP-8 starts by testing Cursor's actual controls and comparing against a fixed-model baseline. The [model-selection proposal](docs/MODEL_SELECTION.md) is planned work, not an active feature, and does not change the calibration baseline. DSP-8 has no assigned milestone; DSP-1–7 belong to m-0.

<a id="vad-som-avgör-om-vi-är-klara"></a>

## What determines completion

After **DSP-6**, Niclas must be able to open a repository, discuss a small task, let the agent make a real code change, review affected files and the complete text diff, and run a relevant build or test with results for the correct code version. He must be able to follow up, request rework, cancel and continue after restart. Errors must offer an understandable way forward; preserve earlier changes and execution results without automatic repetition.

The milestone requires technical verification and Niclas's own assessment of this development workflow. His first feedback may begin with simple chat. An advanced diff view, custom editor, autonomous loop or automatic commit/push is not required for the milestone.

The conventional diff is a usable baseline, not the final review interaction or a commitment to its layout, navigation or rendering approach. Keep actual changes and revision-linked evidence accessible to future views without building speculative extension machinery in Phase 0.

Bind feedback, tests and review to the version actually run. For tasks explicitly requiring Niclas's testing, the agent may prepare and technically verify the result, but human acceptance remains open until supplied. Other bounded work may continue within the given mandate while waiting.

<a id="status-och-återupptagning"></a>

## Status and recovery

| Status | Meaning |
| --- | --- |
| To Do | Planned work; check dependencies and mandate before starting. |
| In Progress | Someone is actively working on the task. Record the current focus in the task. |
| Review | A concrete result is ready for assessment. State who or what remains; this does not mean UX acceptance. |
| Blocked | An obstacle prevents meaningful progress. Record the cause, attempts and exactly what is needed. |
| Done | Task criteria and relevant checks are satisfied, including explicitly requested human assessment. |

**Start the card before the work.** First make the brief checks needed to select the correct task and establish repository, dependencies, mandate and any ongoing run. Then set the card to `In Progress`, record its focus and confirm that the status was saved. Deeper planning, research, technical probes, implementation and specialist calls start only after this update; status must not wait until the final report. In the loop, the coordinator owns this action.

If a subtask has its own card, update that card and reflect ongoing execution in the parent task. A numbered substep without its own card is recorded as the current focus in the existing task; do not create cards solely for status accounting. General planning or reading future tasks does not start their implementation.

On rework, move the card back to `In Progress` before resuming. On resume, check the existing status and focus without resetting history or run counters. Use the fallback in AGENTS.md if the CLI fails, and reconcile a failed write's outcome before retrying.

Check only verified criteria and preserve earlier relevant results. On a pause or failure, record the latest verified state, remaining problems and next action. Backlog status describes work; it does not itself prove that an agent process is running or stopped.

<a id="granska-och-arbeta-med-planen"></a>

## Review and work with the plan

On GitHub, read and comment on task files in the pull request. In a local working copy with Backlog.md installed:

```sh
backlog browser
backlog task list --json
backlog task view DSP-1 --plain
```

Use the web interface or CLI for normal task management. If the tool is missing, files can be reviewed and edited through GitHub; preserve YAML fields and Backlog section markers. Every task has a stable ID and its own acceptance criteria. `AGENTS.md` defines working rules; no MCP connection or external planning service is required.

The configuration reads the current working copy without automatic remote calls or collection from other branches. Use Git explicitly to fetch and share changes. We are trying this simple setup first; this development-tool choice does not lock DSpatch's future internal data model.

## Repository maintenance

[DSP-10 — Use English consistently across the project](backlog/tasks/dsp-10%20-%20Use-English-consistently-across-the-project.md) makes repository content English while preserving Swedish conversation, stable IDs and historical evidence. It is separate from Phase 0 and adds no product dependency.

<a id="efter-första-milstolpen"></a>

## After the first milestone

After DSP-6, enter **discovery and a direction review**, using experience from the working product. [Milestone m-1](backlog/milestones/m-1%20-%20Review-and-Maestro-discovery.md) contains five stories. It is not an additional condition for completing Phase 0.

| Story | Result | Depends on |
| --- | --- | --- |
| [DSP-11 — Understand review needs](backlog/tasks/dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md) | A needs brief and comparison tasks grounded in Phase 0 feedback and Niclas's walkthrough. | DSP-6 |
| [DSP-12 — Survey smart tools and interaction designs](backlog/tasks/dsp-12%20-%20Survey-smart-tools-and-interaction-designs.md) | A concrete interaction gallery/comparison of existing tools, older approaches and research prototypes. | DSP-6 |
| [DSP-13 — Review HCI and UI research](backlog/tasks/dsp-13%20-%20Review-HCI-and-UI-research-for-code-understanding.md) | A primary-source evidence synthesis, including relevant UI/information-visualisation research outside programming. | DSP-6 |
| [DSP-14 — Compare and try concepts](backlog/tasks/dsp-14%20-%20Compare-and-try-code-review-concepts.md) | All five seeds compared with the research and alternatives; one or two small experiments assessed with Niclas. | DSP-11, DSP-12, DSP-13 |
| [DSP-15 — Agree the next direction](backlog/tasks/dsp-15%20-%20Agree-the-next-direction-for-review-and-Maestro.md) | A joint direction decision for review features and Maestro, with bounded follow-up proposals and explicit deferrals. | DSP-14 |

**Niclas chose the next direction on 15 September 2026, ahead of DSP-15**: build a rudimentary agent loop, edit it in a graph editor shaped like [the reference figure](docs/assets/agentloop_generisk.png), realise its rules in code, run it on something small and iterate. Three cards carry it, all outside m-1 because m-1 is discovery and these build something: [DSP-21](backlog/tasks/dsp-21%20-%20Define-the-agent-loop-graph-format.md) settles the graph format, which is the contract and the only shared prerequisite; [DSP-22](backlog/tasks/dsp-22%20-%20Build-a-graph-editor-for-agent-loops.md) builds the editor; and [DSP-18](backlog/tasks/dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md) runs a graph for real. The editor and the runner may proceed in parallel after the format, because the editor is unaffected by how runtime faults are handled — declared failures are drawn as edges, a hung or undelivered call is the runner's business and is deliberately undrawable. Review features are deferred, not dropped, and DSP-15 records the decision and its rationale.

[DSP-18](backlog/tasks/dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md) was split out of DSP-15 on 15 September 2026 and sits **outside** this milestone, because m-1 is discovery and DSP-18 builds something. It depends on DSP-6 alone: defining and running an agent loop does not need the HCI review, and leaving it behind DSP-14 was an invented dependency. Its written starting point is [DSP-9](backlog/tasks/dsp-9%20-%20Dokumentera-Maestros-egen-orkestrering.md)'s [orchestration vision](docs/MAESTRO_ORCHESTRATION.md), already delivered and in Review — DSP-9 writes the design, DSP-18 builds and runs one bounded instance of it. DSP-15 keeps the choice between review features and orchestration; DSP-18 is what gets built if orchestration wins, and Niclas may prioritise it earlier, in which case that priority *is* the decision. The inspectability obligation is not split — it is an acceptance criterion in DSP-18.

The two surveys are independent deliverables. Search broadly before selecting concepts: current and older tools, research prototypes, HCI/UI studies and useful interaction ideas outside IDEs. Collect concrete examples and evidence, including negative or context-dependent findings. Research must be able to change our direction, not just support the initial ideas. A competitor list or feature checklist is insufficient.

DSP-12 and DSP-13 need not wait for DSP-11's human walkthrough. Dependencies permit independent progress; they do not authorise parallel writing agents or expand run limits. DSP-14 combines all three inputs before selecting experiments, and DSP-15 records Niclas's direction decision.

The [research brief](docs/REVIEW_RESEARCH.md) preserves all five concept seeds: guided code flow with tree highlights, essential diffs, conceptual differences, visual explanations of benefits/risks, and a zoomable minimap or another overview. These are hypotheses, not committed features or evidence of novelty.

Phases 1–4 in the [vision](docs/VISION.md#14-implementation-phases) remain candidate directions: task/run history, deeper code understanding, Maestro and additional working methods. Their order and concrete implementation are reconsidered at this point. Finishing DSP-6 does not select a permanent review design, editor or agent topology.

<a id="format-och-verifieringsläge"></a>

## Format and verification status

Backlog files follow the project's documented configuration, task format and milestone format. They were checked against [Backlog.md source](https://github.com/MrLesk/Backlog.md/tree/c0ec546a3b519c0c7b83070fe936f6bf49e14357), package version 1.52.0.

Historical verification on 13 September 2026: Backlog.md 1.52.0 was installed locally and tested against the DSpatch plan. `backlog task list --plain` displayed the then-existing seven tasks with correct AC counts; `backlog milestone list --plain` displayed `m-0` with the correct completed count; `backlog task view DSP-1 --plain` rendered the description, acceptance criteria and implementation plan. Niclas used the web interface. That probe did not exercise `backlog board`, an interactive TUI, or writing CLI commands; its five status columns were not checked by an agent.

During DSP-7, task files were also edited manually as Markdown using the AGENTS.md fallback. The CLI read them successfully, confirming that the fallback preserved the format. Later verification belongs in the relevant task notes rather than overwriting this historical observation.
