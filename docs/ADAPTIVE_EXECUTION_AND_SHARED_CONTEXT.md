# DSpatch Adaptive Execution and Shared Context

Vision and design direction • Version 0.1 • 13 November 2026

## Purpose and status

DSpatch should carry a task from conversation to execution and back without losing the reasoning that made the task meaningful. Its coordinator should choose the work the task needs, including selective parallel execution, while preserving human control, explicit scope and a coherent result.

This document records the intended direction agreed in discussion with Niclas. It brings together adaptive loops, transitions to interactive chat, continuity of context, structured parallel work and communication between agents. It is a design vision, not a claim that these capabilities are implemented or a mandate to start implementation. Detailed protocols and defaults remain design choices.

The task remains the same when its execution method changes. A loop adds coordination, perspectives and opportunities to correct mistakes; it must not silently enlarge the scope or turn a small request into a compulsory process.

## One task across conversation and execution

Interactive chat is a complete working mode, including for difficult tasks. Autonomous execution is useful when coordinated steps can carry the work forward with less human prompting. Users can move between them without reconstructing the task, repeating instructions or losing completed work.

The entry agent of a loop must receive the relevant context of the interactive conversation, not merely the latest message that starts the run. A message such as “implement that” is meaningful only together with the goal, prior choices, rejected approaches and constraints that preceded it.

Context continuity means access to the information required to continue faithfully. It does not require a shared provider session, an identical transcript in every agent, or transfer of a model’s hidden reasoning. The mechanism must work when the provider or model changes.

## Context carried into the loop

A run starts with an identifiable context snapshot linked to the conversation and the current task. The entry agent should receive the following material where relevant:

- The current goal, scope, acceptance criteria and user mandate.
- User decisions and corrections, including explicit exclusions and superseded decisions.
- Relevant conversation excerpts and a faithful summary of earlier discussion, with source references.
- Current repository and revision state, existing changes and applicable project instructions.
- Earlier attempts, observed results, unresolved questions and blockers.
- Links to relevant artifacts and evidence that can be retrieved when needed.

Mandatory decisions and constraints must be included, not hidden behind optional retrieval. Long histories may be summarized, but the original material must remain reachable. Summaries must distinguish instructions, proposals, assumptions and observations. They must not revive rejected ideas or promote an agent’s guess into a user decision.

DSpatch should make the supplied context inspectable. Missing, inaccessible or truncated material must be explicit. Providers may add their own context; known additions and limitations should be distinguishable from what DSpatch supplied. Content exclusions and access rules apply to every recipient and retrieval path.

Later user messages are changes to an ongoing task, not an invisible mutation of its initial snapshot. The coordinator records the change, identifies affected branches and delivers the update before dependent work proceeds. Existing authorization persists unless the user changes it; agents should not repeatedly ask permission for already authorized steps.

## Adaptive loops

A graph describes possible paths and dependencies. It is not a checklist that every task must traverse. The coordinator chooses whether the task needs research, implementation, independent review, targeted verification, rework or interactive clarification.

The choice should be made within existing planning where possible. A small task should not acquire a separate planning ceremony merely to decide that it is small. Steps may be skipped when they add no value, with a brief recorded reason. Steps protecting a concrete critical contract may remain required.

Skipping is a visible execution outcome, distinct from completion, failure and work that has not started. Routing should use explicit runtime decisions rather than infer control actions from arbitrary prose. The editor and execution view should show the available paths and the path actually taken.

A coordinator may revise the plan when new evidence changes the dependencies. It must preserve the goal and mandate while doing so. If work turns out to require a new user decision, it should surface that decision rather than silently expanding the task.

## Returning to interactive chat

When a task is better handled interactively, the agent should be able to request a recommendation prompt in the UI. The user chooses “Continue interactively” or “Continue in the loop”. Whether this appears as a lightweight popup or an inline prompt is a presentation choice; the explicit choice and retained context are the requirement.

The recommendation gives a short reason and does not repeat after refusal for the same unchanged situation. A handoff continues the already submitted task once. The user should not have to paste it again. The run is recorded as handed over, not successfully delivered or failed.

Before switching, the runtime accounts for active tools and writing agents. It reaches a safe point, preserves edits and evidence, and prevents duplicate execution. An early recommendation should happen before avoidable side effects. A later handoff includes completed work, remaining work and live dependencies.

The interactive agent receives the run’s decisions, results and pending questions alongside the original conversation. Returning to the loop follows the same principle in reverse. Mode changes do not grant additional permissions or erase existing decisions.

## Structured parallel execution

Parallelism is an optional scheduling decision. The planner considers independence, ownership, shared contracts, expected duration and integration effort. It should choose parallel work only when the expected benefit exceeds the coordination overhead. There is no promise of universal speedup or unchanged cost.

Each branch receives a bounded assignment: its result, owned files or components, allowed actions, dependencies, agreed interfaces and the smallest relevant verification. All branches inherit the task’s governing constraints and the applicable verification policy.

Writing agents should normally use separate worktrees based on a known common revision. Shared files and interfaces need explicit ownership. Read-only research can often run concurrently without isolated copies. File ownership reduces collisions, but semantic dependencies still need coordination.

Start with a small bounded number of agents, such as two or three. Concurrency, usage and cancellation limits belong to the runtime. If dependencies become too tight, the coordinator may serialize or combine branches rather than continue costly parallel work.

For example, syntax colouring, a clipped report header and a growing chat input may be separable after shared CSS ownership is established. Changes to walk highlighting, Accept, delegation and coverage first require one agreed definition of the affected lines. Parallel implementation must not create several competing versions of that definition.

## Communication during execution

Agents should exchange information while work is in progress when it changes another agent’s next action. Useful messages include a blocking question, a discovered conflict, an invalid assumption, a proposed interface change or a result that unlocks a dependency. Routine narration and constant broadcasting are unnecessary.

DSpatch should expose communication as an explicit capability. A message names its run, sender, recipient, relevant task or contract and purpose. The runtime records and routes it through a mailbox. Delivery occurs at supported model or tool boundaries; agents do not share hidden reasoning or instantly observe changes in another agent’s context.

Message delivery and the recipient’s acknowledgment are different events. Critical updates need acknowledgment before dependent work proceeds. A proposed contract change does not become binding merely because one agent sent it; the coordinator resolves it and informs affected branches.

Agents can communicate directly while the coordinator retains visibility. If a recipient is busy or unavailable, messages are queued or the dependency is marked blocked. The runtime must prevent indefinite mutual waiting and must not restart a completed branch merely because an obsolete message arrives.

A shared filesystem is not a notification mechanism. A changed file does not prove another agent has reread it. Messages and results need revision references so recipients can distinguish current evidence from stale assumptions.

## Integration and ownership of the result

One designated integrator owns the combined delivery. It checks that branch results respect the shared contracts, resolves conflicts and reviews the interactions introduced by the combination. A clean Git merge proves only that textual changes can be combined.

Verification should target the integration risk. Do not multiply test suites by the number of agents or repeat the same checks at every role boundary. Existing evidence may be reused when its assumptions and revision remain applicable. Independent review means an independent assessment of code and evidence, not automatic execution of more tests.

Human decisions remain human decisions. An agent’s favorable assessment is not user acceptance. Integration, completion and user approval are separate states. A run’s report should identify what was implemented, independently reviewed, tested, skipped or left for Niclas to examine.

## Runtime and provider responsibilities

The DSpatch runtime should own task identity, context versions, routing, branch lifecycles, message delivery, mandates, integration checkpoints and recovery records. Agents propose plans and produce work within those boundaries. Provider adapters execute sessions and expose supported tools and events.

Provider-native subagents or messaging can be used where available, but the product contract should not depend on one provider’s team feature. A portable route is multiple sessions coordinated by DSpatch with explicit message tools and queued follow-up input. Installed SDK versions, adapter permissions and actual delivery behaviour must be checked before claiming support.

If a provider cannot receive messages during an active turn, deliver them at the next safe boundary and show that limitation. Do not imply immediate delivery. Cross-provider collaboration must preserve the same access restrictions and account boundaries as ordinary execution.

Persist enough state to distinguish running, waiting, completed, failed, cancelled and handed-over work. Recovery should reconcile existing tool effects and saved changes before resuming, rather than blindly replay actions. Cancellation must stop further dispatch and account for tools already in flight.

## Working policy and user experience

The default verification policy adopted on 13 November 2026 applies to every role and branch. Niclas normally performs manual product and UI testing. Agents use minimal targeted checks. Broad suites, platform matrices and repeated window trials require a concrete risk or an explicit request; adding parallel agents does not change this policy.

The UI should explain why a method was chosen, what each active branch owns and what is waiting on a decision. Detailed messages and journals remain available without overwhelming the main conversation. The user can pause, redirect or take over without losing the task’s history.

For future graph construction, these behaviours should be reusable concepts that DSpatch can explain and assemble through dialogue. Users should not need to manually construct every branch, mailbox and integration step, while retaining the ability to inspect and edit the resulting graph.

## Relationship to existing work and next increment

This vision extends VISION.md, AGENT_BEHAVIOUR_AND_ORCHESTRATION.md and TASK_MANAGEMENT_AND_WORKING_MEMORY.md. The attached document snapshots already describe continuity between modes, context provenance and isolated parallel writing. Their statements of implementation status may be older than this discussion.

The existing backlog entry “Near-term follow-up: adaptive loops and interactive chat”, recorded in commit 53ed0930297ff5f7586996cf0ecde395647696b4, is the planning anchor. Extend that follow-up rather than create a duplicate. Reconcile any earlier controlled-parallelism or dialogue-based graph-design document before establishing a new canonical specification.

The reported session-log audit found the last complete external development loop on 27 October 2026 for DSP-145. DSP-206 and DSP-207 were performed directly in the main chat. This establishes a difference between available instructions and actual use; it does not establish a limitation in DSpatch’s runtime.

The next increment should first map this vision to current engine, adapter and UI capabilities through code reading. Identify what already works, what requires wiring and what is missing. Then choose the smallest useful implementation: faithful context transfer, explicit method selection and, where supported, a bounded parallel split with integration. Do not require a broad provider benchmark or implement every part of this vision at once.

Success means that “implement that” preserves the preceding decisions; a small task can continue in chat without resubmission; independent branches can exchange a relevant finding before completion; and the combined result retains exact scope and understandable provenance. Speed should be assessed from useful delivery time, integration rework and human effort, with cost visible. Quality must be judged from the result, not inferred from agent count.
