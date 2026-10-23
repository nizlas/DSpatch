<a id="arbeta-med-dspatch"></a>

# Working on DSpatch

## Project language

Use **English** for maintained repository content: READMEs, vision and technical documents, agent/skill instructions, backlog titles and prose, code comments, product strings, developer messages, saved reports, and new commit/PR descriptions. A Swedish conversation does not change the project language. Chat and executive summaries addressed to Niclas may remain in Swedish; persist their decisions and findings in English.

Preserve stable task/run IDs, API identifiers, commands and data formats. Keep historical raw logs, quotations and verification evidence verbatim and label their original language; add an English explanation when needed. Existing filenames and legacy anchors may remain for link compatibility. This is a language change, not a reason to add a localisation framework or alter product scope.

## Public repository content

Use generic organization names, internal-project examples and configuration filenames in maintained public content. Preserve technical requirements and whether a statement is reported, proposed or verified. Do not copy private endpoints, credentials, centrally supplied policy files or internal discussions into the repository. Clearly label illustrative filenames; keep public provider/product names and API identifiers accurate. A cleanup commit changes the current files, not earlier Git history.

<a id="läs-rätt-underlag"></a>

## Read the right material

1. Read [VISION.md](docs/VISION.md) when starting work on the project. It is the governing source; sections 1–3, 8 and 14–15 describe product direction and initial scope.
2. Read [INTERACTION_MODEL.md](docs/INTERACTION_MODEL.md) before changing anything about how a person, the agents and Maestro share the work. It settles who decides what, and it governs that question over older wording elsewhere.
3. Read [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) before changing what the product's agents are told: role sources, node tasks, prompt building, what the graph editor shows of them, or what the run engine reads of the project on its own account. It draws the line between what an agent instruction decides, what the graph's workflow decides and what Maestro owns in execution, and it requires every instruction DSpatch adds to be visible and inspectable rather than built into the code. Its sections on editing instructions in the editor and on switching to interactive work are proposed designs, not agreed requirements.
4. Read [BACKLOG.md](BACKLOG.md) for development direction and workflow.
5. Read the current task in `backlog/tasks/`, its dependencies and relevant vision sections. When continuing, read changed and task-relevant material; do not routinely reread the entire history.
6. When running or changing the development loop, read [DEVELOPMENT_LOOP.md](docs/DEVELOPMENT_LOOP.md). The coordinator procedure is [docs/loop/COORDINATOR.md](docs/loop/COORDINATOR.md). Enter it from your environment: in Cursor through `.cursor/skills/dspatch-loop/SKILL.md` with the five specialists in `.cursor/agents/`; in Claude Code through `.claude/skills/dspatch-loop/SKILL.md` with the five specialists in `.claude/agents/`. Both sets of specialists are generated from `docs/loop/roles/`; edit the role sources, not the generated files.
7. When the task touches an area in the [relevance index](#relevance-index) below, read that document's relevant sections and the cross-references they depend on before planning, implementing or reviewing the affected work.

<a id="relevance-index"></a>

### Relevance index

| Document | Read when the task touches |
| --- | --- |
| [RUNTIME_PLATFORM_ROADMAP.md](docs/RUNTIME_PLATFORM_ROADMAP.md) | Runtime or provider integration, SDK, AHP or hosting, session handling, persistent workspaces, remote development, or platform and Linux support. |
| [DSPATCH_CONTENT_EXCLUSION_CONTRACT.md](docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md) | Content exclusion, information flows, tool access, hooks, permissions or workplace security requirements, including runtime and transport changes that affect those control points. |
| [REVIEW_COVERAGE_AND_CODE_WALKS.md](docs/REVIEW_COVERAGE_AND_CODE_WALKS.md) | Review coverage, code walks, review status and decisions, review depth or teaching modes, or a review pilot. |
| [CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md](docs/CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md) | The product's parallelism, subgraphs, handover contracts between slices, integration of partial results, and dialogue-based construction and analysis of graphs. |

A task can touch several of these; read each one that applies. A task that touches none, such as a self-contained UI text change, needs none of them. They are not full reading at every start: when continuing, read only material that changed or has newly become applicable, provided the earlier relevant context is still available. Calling a specialist in the external development loop does not by itself make the parallelism document relevant; that document is about the product's parallelism, not about this loop.

Keep their status apart. The roadmap and the content-exclusion contract are drafts proposing a direction and a contract; the parallelism document records an agreed product direction, not a verified implementation; the review-coverage document records proposed concepts, not implemented features. A reference to one of them grants no new implementation mandate and is not evidence that a runtime supports anything.

Niclas's explicit decisions govern the vision. Distinguish agreed principles from technical proposals and open questions in VISION.md. Do not change the vision to fit an implementation; document a proposed departure and its rationale. Routine, reversible choices within the agreed task need no new approval. Record durable decisions and changes of direction in the repository.

<a id="bevara-produktens-riktning"></a>

## Preserve the product direction

- Simplicity with full capability: common actions must be visible and understandable; shortcuts are optional.
- Human-interactive work is a full operating mode for the entire project for as long as the user wants. Autonomy can be enabled or disabled while preserving context and history.
- Code understanding is central. Explanations, review and verification must be traceable to real code and the correct revision; an agent narrative is not evidence.
- DSpatch is both a working tool and an environment for experimenting with development methods. Build small useful increments and let actual use guide the next step.
- Niclas has approved the product direction through DSP-6, subject to existing dependencies, acceptance criteria and run limits. After Phase 0, use the planned [HCI and review discovery](docs/REVIEW_RESEARCH.md) and discuss the next direction with him before implementing later phases. Treat the recorded review concepts as hypotheses; Phase 0's conventional diff does not fix the future review design.
- Start with minimal interactive chat. Phase 0 includes real, bounded code changes, a normal complete text diff and execution of a relevant build or test. Separate provider calls from the UI and persisted data. An advanced code view, custom editor or Maestro is not required for initial value.
- Use the selected TypeScript, React and Electron stack in [VISION.md, section 9.1](docs/VISION.md#91-selected-stack-and-platforms). Windows and Linux are target platforms; build and test on Windows first. Isolate platform-specific parts and aim for consistent layout, styling and workflows. Linux tests are not required in Phase 0 and must not be reported as performed without evidence.
- Start development and testing with Cursor on Niclas's home computer. VS Code/Copilot remains in the vision: consider compatibility in technical decisions and isolate Cursor-specific parts. Implementation and testing with VS Code/Copilot are not required in Phase 0; document outstanding tests without calling compatibility verified.
- Maestro is an internal working name. The reference loop is an example; future workflows may differ.
- Preserve the current colour palette as the visual starting point approved by Niclas. Further UX acceptance depends on the actual workflow and is not implied by approval of the colours.

<a id="genomför-en-avgränsad-uppgift"></a>

## Complete a bounded task

- Check existing changes and respect other work. Once the task, dependencies and mandate are clear, set the selected task or subtask to `In Progress`, record its current focus and confirm that the update was saved **before** planning, research, technical probes, implementation or specialist calls. Follow the [start order in BACKLOG.md](BACKLOG.md#status-and-recovery). State the task ID, intended result and a short plan before substantial code changes. Execution follows the user's mandate.
- Use Backlog's CLI or web interface for task changes when available. Read `backlog instructions overview` and relevant `--help` when needed. Adapt the tool's general workflow guidance to DSpatch's instructions and the user's mandate.
- If Backlog is unavailable, carefully update task files as Markdown. Preserve IDs, YAML fields and section markers; check the format afterwards. Planning must remain possible without MCP or external project systems.
- Preserve decisions, attempts and relevant results in the task. On interruption, record the latest verified state, remaining problems and a concrete next step. Resolve an unknown outcome before repeating the action.
- Present questions and decision material as copyable Markdown in the normal chat report. Use separate question forms only when Niclas explicitly requests them. Collect questions that can wait until the next iteration, stating the recommendation, when an answer is needed and what can continue within the mandate. Deferral or silence is not approval. Follow the loop's reporting rules during a loop run.
- Preserve the user's existing changes. Bind diffs and execution results to actual file content and identified snapshots, including uncommitted code. Cancellation and restart must not silently reset files, reapply changes or launch commands twice.
- Check relevant behaviour with proportionate scope, following [proportionate verification](docs/DEVELOPMENT_LOOP.md#proportionate-verification): concentrate on what changed and on what it can reasonably affect, reuse valid earlier results, and treat full retesting as an exception needing a concrete reason stated in the report. The same section's [keep the suite worth running](docs/DEVELOPMENT_LOOP.md#keep-the-suite-worth-running) governs adding, changing and removing tests, and which group to run. Report what changed, why, the tested revision or snapshot, checks performed and remaining work. Distinguish provider documentation from observed functionality; missing measurements are unknown, not zero.
- Do not mark UX criteria requiring Niclas's testing as accepted based on agent tests. Use `Review` when a reviewable result awaits assessment and follow BACKLOG.md's status rules.

<a id="agentloopen-under-utvecklingen"></a>

## The development agent loop

The external agent loop helping us build DSpatch is separate from the Maestro feature we will later build into the product. It can be run from Cursor or from Claude Code; that Claude Code can run the external loop says nothing about whether DSpatch's own run engine supports Claude Code, which remains unestablished. The initial draft has a coordinator in the main chat and five specialists: Backlog Planner, Researcher, Implementer, Verifier and Reviewer. All specialist calls go directly through the coordinator, sequentially and without further delegation. Planner and Researcher are used when needed.

During a loop run, the coordinator alone owns the backlog, plan overview and run journal. Specialists return reports and may write only within their explicit assignments. A new chat must resume known steps and reconcile unclear outcomes before new calls. Preserve the option to work interactively throughout development. DSP-7 tests collaboration and planning quality in Cursor before DSP-1 is executed through the loop.
