# DSpatch: Runtime, Workspaces and Platform Evolution
**Architecture direction and phased delivery plan**

Version 0.4 | 22 October 2026 | Draft for Niclas Danielsson. v0.3 added section 1.2 (agreed runtime order and the remote-development requirement). v0.4 makes organization-specific references generic; technical requirements and verification status are unchanged.

## 1. Recommended direction

Complete the next persistent-workspace increment, make the existing application usable on the home Linux machine, and establish a minimal direct Copilot SDK integration on synthetic, non-sensitive material. Retain the existing Cursor integration as the reference path. Evaluate Agent Host Protocol (AHP) separately before committing to a Cursor migration or building substantial additional session-host infrastructure.

This is a proposed sequence, not a new implementation mandate. The document preserves the discussion, identifies unresolved decisions and gives each increment an observable completion gate. No repository change, runtime experiment or security verification has been performed as part of producing it.

### Four bounded deliveries

| Delivery / reference | Usable result | Not included now |
| --- | --- | --- |
| 1 / P1: Persistent workspaces | Reopen folders, unfinished changes, the selected graph and relevant history links. | A new storage framework, universal recovery or background execution. |
| 2 / P2: Local Linux | Run the existing DSpatch/Cursor path on the home Linux machine. | Remote/headless operation, every distribution or polished packaging. |
| 3 / P3: Copilot SDK | Complete the same small synthetic task in DSpatch, with a real diff and verified result. | A large custom session server or advanced Copilot orchestration. |
| 4 / P4A: Managed workplace controls | Reuse and verify the managed controls on the selected workplace path. | A replacement policy engine or certification of every provider/host combination. |

P0 is the implementer's initial baseline check, not a separate project. P3a and P3b form one delivery; P5 is real use and evaluation, not another infrastructure phase. P4B is a bounded, conditional AHP investigation, not a migration commitment or a prerequisite for these deliveries. Existing phase labels remain as references in the detailed notes.

### Changed organizational premise

Niclas reports that the responsible tooling team permits an SDK-based application when content exclusion satisfies its rules. A central hook configuration and exclusion-pattern file have been supplied, but script internals and written requirements have not yet been reviewed. Whether an equivalent, more precise implementation is acceptable remains open. [U1]

Standalone DSpatch can therefore be the main direction for both home and work, conditional on the stated requirements. Copilot App remains an option, not an assumed approval prerequisite. Common code does not imply shared credentials, workplace/home data or policy settings.

<!-- pagebreak -->

## 1.1. Delivery discipline — v0.2 clarification

Reduce scope and process overhead, not the reliability of delivered behavior. The four deliveries are usable increments, not four mandatory large pull requests. Detailed phase notes preserve requirements and options; they do not mandate separate research, design, implementation and review projects for every item.

### Small contracts and a clear finish

Give each implementation task a short contract: the user-visible result, explicit exclusions and the observations that establish completion. Reuse the existing branch, stores, adapters and tests. Split work by real dependencies or risk, not by every helper function. No increment may grow into a new framework without an explicit scope decision. Current backlog tasks remain the status authority; do not create another document series or duplicate status ledger.

Normally use one coherent implementation with tests, one independent review and targeted corrections. Let the implementer resolve ordinary code details within the contract. Re-review the findings, new diff and affected behavior rather than reopening the whole architecture. Separate blocking defects from optional improvements; park the latter. Repeated unsuccessful corrections call for diagnosis and a decision, not an unbounded agent loop. This is not a limit on fixing serious defects.

### Test in proportion to the change

**During implementation:** use fast, deterministic tests for storage, state transitions, payload conversion and hook decisions. Use temporary folders, controlled event sequences and substitute scripts for failure paths instead of waiting for live agents to reproduce them.

**Before acceptance:** run relevant regression checks and a small end-to-end test in the actual target environment. Reuse one task and verification fixture across supported combinations. Record the tested revision, environment and outcome; a model reply alone is not evidence.

**For runtime or security changes:** rerun the affected integration and safety scenarios, including applicable failure and recovery paths. Broaden testing when impact is uncertain. A hook-bridge change warrants security checks; an unrelated label edit does not automatically warrant every live-agent test. Substitute-script tests do not certify the actual managed control package. Start with one intended workplace combination rather than claiming all combinations are verified.

### Simplify features, not essential guarantees

A development launch on Linux, manual relocation of a missing root, explicit continuation after interruption and one writer at a time are acceptable initial limits. Silent data loss, accidental duplicate execution, false verification status and missing mandatory workplace controls are not.

Keep the working Cursor route. AHP must demonstrate concrete lifecycle or maintenance benefit before migration; needing a substantial new bridge is a reason to pause and reassess, not to expand the project automatically. App/canvas, Dynamic Workflows and DeepInfra remain separate options or bounded experiments, not new dependencies for the four deliveries.

This clarification changes delivery discipline, not the security requirements. At the time of this delivery-discipline clarification, the companion content-exclusion contract was v0.1. No implementation, runtime test or security acceptance is claimed by this update.

<a id="agreed-runtime-order"></a>

## 1.2. Agreed runtime order and remote development — v0.3, 21 October 2026

Niclas approved this order on 21 October 2026, from the reviewed plan of loop run 20261021-133119-plan-rt. It amends the sequence in section 1 and the P3/P4B notes; where they differ, this section governs. It is a direction, not an implementation or a verified capability.

### Runtime order

1. **Claude first, at home.** Claude is the prioritized home runtime: DSpatch work runs through Claude's own agent harness (tool set, permission rules and modes, sessions), not only Claude models through Cursor. The first step is a thin Claude Agent SDK adapter behind the existing `AgentAdapter`, exercised from the command line on the existing synthetic fixture on Windows (DSP-109); Linux follows later in a separate clone. It is also the diagnostic baseline for later comparisons. Authentication prefers Niclas's Claude subscription where the supported SDK flow permits it; API-key billing is a separate option and must never be fallen back to silently.
2. **AHP early and independently.** A bounded, prompt-free investigation of the VS Code Agent Host on the work computer, in the approved VS Code/Copilot environment (DSP-110), runs alongside step 1 and does not depend on it. A fixture-and-lifecycle comparison through the host (PROP-B1, recorded on DSP-110) follows both. AHP remains an investigation, not a migration commitment or a complete remote development solution, and Claude does not have to run inside VS Code for it.
3. **Copilot stays a separate workplace track.** The Copilot SDK probe and integration (P3) and the content-exclusion integration (P4A) proceed on the work computer under that environment's security and content-exclusion policies. Claude and personal Anthropic credentials are not used there, and a home Copilot account is not a prerequisite for the Claude track.
4. P1 (persistent workspaces) and P2 (local Linux) are unchanged and reuse their existing cards.

### Remote development

DSpatch must support, relatively early, an arrangement like VS Code Remote: the Electron/React UI runs and renders locally on a laptop, while the repository, agents, scripts, Git operations, builds and tests run on a remote development machine. This matters for moving an existing autonomous orchestration project from VS Code to DSpatch.

- File contents, images and other binary files included, can be transferred to the local client and rendered there. SSH may be the transport; graphical forwarding over SSH is slow in the work environment while SCP-style transfer works well, so low SSH bandwidth is not assumed.
- A conversation and its durable task history are reachable from both the laptop and the development machine without manually transferring chat context.
- Three capabilities stay distinct: shared durable conversation and task context; provider-session resumption, used where supported and otherwise replaced by an explicitly new session built from DSpatch's persisted context (section 2); and long-running autonomous Maestro execution without an attached client, which is a further capability.
- Content exclusion and authorization boundaries stay explicit. A person viewing a file or an image locally does not grant an agent or external model access to it.

The first remote milestone demonstrates local rendering, remote repository access and execution, and shared durable conversation context (DSP-111). Until then, runtime work preserves the separation it needs, keeping provider and execution code in the main process behind `AgentAdapter` without assuming that the renderer and the execution share a machine or filesystem, but builds no remote infrastructure.

<!-- pagebreak -->

## 2. Common architecture and persistence

### Keep the product common

DSpatch should retain one graph editor, graph model, task-memory model, result contract and evidence presentation. A direct SDK connection, an AHP connection and an App-hosted canvas are different integrations, not different definitions of a completed task.

Separate the responsibilities logically: the workspace identifies working roots; task memory preserves goals and decisions; Maestro owns graph transitions; the agent runtime owns its model–tool loop; the hosting adapter handles sessions and transport; mandatory policy constrains the permitted execution path. These boundaries do not require six new packages or a generic plugin framework. Extend existing interfaces only when a concrete integration requires it. [P1–P3]

The observed repository reference is `f83f476acae4b15f0f87eb5309ee795dfe6f7b83`, dated 30 September 2026. It already contains versioned workspace records in `project-store.ts` and a session-oriented `AgentAdapter`. That snapshot may lag the local branch. Do not interpret the plan as a request to rebuild the stores, restart completed calibration or replace the existing primary-root/conversation relationship. [R1–R3]

### Four different persistence requirements

**Reopen the workspace:** restore roots, chosen workflow and references; preserve the actual working files and unfinished diff. Saving a pointer to a temporary directory is insufficient if that directory is later deleted.

**Continue the task:** recover goals, decisions, artifacts and unresolved questions without requiring the old agent session to exist. This is task memory, not a provider-transcript guarantee. [P2]

**Resume a provider session:** use its saved identity only if the provider supports it and the working context/configuration remain valid. An explicitly new session may continue the task; it must not be described as the old session resuming.

**Continue running while the UI is closed:** a living agent host can support agent execution independently of the UI. Keeping an entire Maestro graph progressing additionally requires the orchestration process to remain alive. Neither implies survival through host failure or machine shutdown. [W1]

P1 must not expand into implementing all four levels at once. Reuse stable existing keys, preserve relationships between workspace, task, attempt, provider session and content version, and add host-specific references only when used.

### Storage and working-location rules

Separate portable definitions from machine-local paths and runtime references. A missing working root should produce an explicit availability/relocation problem, not an empty replacement folder. Unknown prior execution state is neither success nor permission to start a second writer. Preserve uncertain side effects for reconciliation.

A Git worktree can isolate changes but is not a security sandbox. Parallel writers, live-session migration between providers and a general remote-workspace system are not requirements for this first increment.

<!-- pagebreak -->

## 3. P0–P2: Workspace continuity and Linux

### P0 — Reconcile, do not restart

Read the actual local branch, ongoing workspace work and relevant task notes. Identify what already works, what is in flight and the smallest missing behavior. Record the current runnable Windows/Cursor baseline and versions. Link existing cards rather than allocating duplicate tasks from the older remote snapshot.

**Exit gate:** a bounded workspace change with acceptance scenarios and no dependency on AHP, Copilot App or managed control script availability. The project's existing backlog remains the status ledger; this roadmap records direction and dependencies, not a competing live status table.

### P1 — Persistent workspaces, first useful slice

Allow Niclas to close DSpatch, return to the same working context and understand what happened and what is safe to do next. Preserve the selected roots and workflow, the relevant conversation/task links, pending files and result references.

If execution currently uses temporary directories, explicitly distinguish disposable scratch data from a durable working copy. Closing a view must not silently discard the latter. Do not require Git worktrees for a pure discussion or a non-code task.

Use the existing direct Cursor route. Test normal reopen, an unfinished diff, a missing root, corrupt state that must not be overwritten, refusal to rewrite an unknown newer format, and an uncertain prior attempt before a new writer starts. Check the existing relationship between primary working directory and resumed conversation rather than inventing a second pointer.

**Exit gate:** the reopened workspace reflects actual preserved work and evidence. It does not automatically resend the previous task, and it reports interrupted or uncertain execution truthfully. Agent text alone does not prove recovery.

### P2 — Local Linux first

The first target is DSpatch's UI, working files and execution on Niclas's home Linux machine, initially with the existing Cursor integration. It is not yet a Windows UI controlling a remote Linux host, a headless service or enterprise-wide Linux support.

Begin build/start and path checks during P1. Then verify installation, application-data locations, workspace reopen, graph-editor interaction, executable discovery, environment, working directory, command output and child-process cancellation. Exercise spaces/non-ASCII paths, case sensitivity and shell differences where relevant. Keep the Windows regression baseline working.

A development launch is an acceptable first delivery; a reproducible distributable can follow. Do not disable Electron or operating-system safety features merely to make startup succeed.

**Exit gate:** on the named Linux environment, open a small fixture, discuss and edit it using Cursor, inspect the real diff, run the specified test, stop work and reopen the workspace. Record the tested distribution and runtime versions rather than claiming all Linux environments are supported.

<!-- pagebreak -->

## 4. P3: Minimal direct Copilot runtime

### P3a — SDK/account compatibility probe

Use a small isolated probe to authenticate, start a Copilot session and perform a trivial tool-using task on synthetic material. This distinguishes basic SDK/account/runtime compatibility from AHP, workflow orchestration, UI and security questions.

A suitable fixture is a small folder tree with a text-transform function, sample text and a known test. Ask the agent to read the instructions and change only the implementation. Independently run verification and retain the actual diff, command, exit status and runtime version.

The probe does not implement DSpatch content exclusion and makes no security-readiness claim. It must not disable existing mandatory hooks. A harmless current directory is not a sandbox: choose a permitted test environment, avoid unrelated automatic context and integrations, and offer only the tools needed for the fixture.

This probe may run before P1/P2 finish if kept short and separate. It must not displace the main workspace increment.

### P3b — Thin integration in DSpatch

Connect the verified SDK path through the existing adapter boundary. The workspace, graph, chat and evidence presentation should work with Cursor or Copilot without duplicate product logic. Exercise streaming, tool activity, success, failure and cancellation.

Test session resume as a distinct capability. Reapply required configuration, and use an explicitly new session when the previous one is unavailable or invalid. Preserve task continuity without inventing provider continuity. Missing usage data is unknown, not zero.

**Exit gate:** the same synthetic task works through DSpatch with both providers, has truthful state and an independently verified result. A final agent message or a completed API call is not sufficient evidence of a correct file change.

### Why direct SDK before a broad AHP migration?

The small direct path provides a diagnostic baseline. If an AHP experiment fails later, it becomes possible to distinguish a host/adapter issue from a basic Copilot issue. This does not justify building an extensive replacement session server first.

Run the AHP comparison before investing substantially in custom reconnect, shared sessions or background-host infrastructure. Keep each probe bounded: a short compatibility baseline now is useful; a large direct-only architecture built immediately before reconsidering it is not.

### Shared test fixture

Use the same task and verification contract across Windows/Linux, Cursor/Copilot and direct/AHP trials where available. Save the tested combination and actual result. Reusing tests does not mean every combination is supported, nor that one combination's success certifies the others.

<!-- pagebreak -->

## 5. P4: Policy and hosting are separate decisions

### P4A — Required content-exclusion integration

Start requirements/script review when material becomes available. Use the companion security document for the implementation boundary and verification matrix. [S1]

First test whether the selected runtime already loads the centrally distributed hooks correctly. Prefer that native route when it meets the requirement. Otherwise implement a thin SDK-callback-to-script bridge. Establish exactly one intended pre/post invocation; do not duplicate rule matching in DSpatch or accidentally run the same managed script twice. GitHub distinguishes user hooks from machine-wide Policy Hooks and documents command-hook failure semantics. [W4]

Integration success and security acceptance are separate gates. A stricter timeout response is an intentional change to agree, not a claim of identical wrapper behavior. Real workplace use requires the evidence and verification expected by the responsible tooling team; no additional approval bureaucracy is presumed.

### P4B — AHP suitability probe, Copilot first

Connect a minimal client to an identified Agent Host and repeat the Copilot fixture. Test activity, permissions, cancellation, client disconnect/reconnect and host-loss reporting. Record the host and protocol/runtime versions.

AHP coordinates clients around hosted sessions. ACP or an agent-specific SDK can sit below the host; therefore a protocol-level possibility is not proof that the selected host has the required provider adapter. [W2]

Check where required policy executes. A control that lives only in a connected client cannot be assumed to protect an unattended host. Either enforce it at execution or make that unattended mode unavailable.

**Decision gate:** choose direct SDK, AHP for Copilot only, or a broader AHP direction based on demonstrated lifecycle benefit, policy coverage, diagnostics and maintenance cost. A negative result leaves the working direct path intact.

### Cursor migration is conditional

Cursor documents ACP through `agent acp`. An AHP host may bridge ACP, or integrate an agent SDK through its own adapter. A ready Cursor bridge with the needed behavior has not been established by this plan. [W2–W3]

Only migrate after identifying the concrete implementation and comparing model/configuration control, context, permissions, streaming, tools, cancellation, recovery and usage with the direct Cursor baseline. Retain the direct integration until parity or explicit acceptable limitations are verified. A common DSpatch UI does not require every runtime to use AHP.

P4A and P4B can proceed independently after the minimal runtime baseline. Mandatory workplace controls must be verified again for affected behavior if hosting or transport changes.

<!-- pagebreak -->

## 6. Pilots, preserved options and document ownership

### P5 — Useful work, without unnecessary dependencies

**Home pilot:** after workspace continuity and the relevant runtime/platform checks, try a bounded real DAL bug or feature. Preserve a baseline, inspect the diff and independently verify it. This does not need to wait for workplace policy acceptance or AHP migration.

**Work pilot:** use a real workplace task only after the selected runtime/platform/information flows satisfy P4A. A successful synthetic home test does not establish that assurance.

**DeepInfra:** keep a separate, bounded quality/cost experiment. Assess reuse of a suitable existing agent harness or provider adapter before commissioning a new agent engine. Do not assume a lower cost without measuring the chosen model on accepted results, including retries, verification and human repair time. AHP is not a prerequisite for that comparison.

### Deferred, not forgotten

**Dynamic Workflows:** retain as a candidate for bounded Copilot sub-processes or generated execution code. Before adoption, revalidate journaling/replay, nesting, schema validation, missing results, isolation and status mapping. DSpatch's graph and evidence rules remain authoritative at the agreed boundary.

**Copilot App/canvas:** preserve the possibility of sharing the frontend through another host adapter. Previously discussed UI reuse is not verified parity and is not needed for the next standalone increment.

**Controlled parallelism and dialogue-based graph design:** preserve explicit subgraphs, handover contracts, one editable graph model and verification of the integrated result. A sequential first delivery must not silently become a permanent limitation. [P4]

**Remote/headless execution:** make Windows-client/Linux-runtime operation, unattended Maestro and recovery after host restart separate later milestones. Since v0.3 a first remote milestone (local rendering, remote execution, shared durable conversation context) is brought forward; see [section 1.2](#agreed-runtime-order). Unattended Maestro and recovery after host restart remain later milestones.

### Two documents, not another competing vision

Maintain this roadmap and the companion content-exclusion contract as Markdown sources with generated Word reading copies. Add concise links/direction changes to existing governance. Put exact storage migrations in the existing workspace design/task; create a further document only if that detail warrants one. Current task files remain the implementation-status authority.

**Next handover:** reconcile the actual workspace branch; implement the smallest missing persistence behavior with the present stores and Cursor path; retain Windows checks and add a Linux smoke test. Do not bundle AHP migration, a provider change, content exclusion or a frontend redesign into that change. Apply section 1.1: a short task contract, targeted verification and one focused review cycle with necessary corrections, not a new multi-phase subproject.

### Sources and provenance

**U1:** Niclas's statements/configuration in this conversation; organizational requirements and scripts remain pending review. **P1–P4:** existing DSpatch overall vision, working-memory principles, agent-behavior guidance, and controlled-parallelism/dialogue-based graph design (30 September 2026). These describe intended behavior.

**R1–R3:** repository reference in section 2; `app/src/main/project-store.ts`, `app/src/adapter/agent-adapter.ts`, and `BACKLOG.md`. Local state must be reconciled. **S1:** companion [*Content-Exclusion Integration and Verification*](DSPATCH_CONTENT_EXCLUSION_CONTRACT.md), v0.2.

**W1:** [VS Code Agent Host](https://code.visualstudio.com/docs/agents/concepts/agent-host). **W2:** [AHP and ACP](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp.html). **W3:** [Cursor ACP](https://cursor.com/docs/cli/acp). **W4:** [Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference). Pin versions and recheck applicable contracts before implementation.
