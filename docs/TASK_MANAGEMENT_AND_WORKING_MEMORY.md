# DSpatch governance document for working memory and agent flows

Version 0.3 · 23 October 2026

Status: Intended product vision and governing architectural principles, with clarifications made after comparison with the existing governance documents. The document describes the desired construction and is to be the basis for continued design and implementation. It is not a verification of today's codebase. Open technical choices and recommended acceptance scenarios are set out separately.

## 1 Purpose and goals

DSpatch is to make it possible to solve development tasks with high precision and quality, at a chosen degree of autonomy. The user is to be able to understand what changed, why the change was made, what the final code does, and what evidence supports the task being solved.

Robustness, predictability and reviewability are to govern the product's design. Parallelisation is a means of solving tasks efficiently. Value is measured in useful and verified deliveries, and in the human effort required to reach them.

The integrated issue tracking system has two connected purposes: to be a persistent working memory for the agents, and to give the human an intelligible window into the work. The same issue is to be workable interactively in chat, through an agent loop, or by switching between these working methods.

The document complements [VISION.md](VISION.md), particularly sections [2](VISION.md#2-the-workspace-starts-from-the-task), [7](VISION.md#7-replaceable-working-methods-in-maestro)–[9](VISION.md#9-architecture-and-project-data) and [13](VISION.md#13-reliability-and-control), and [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md), particularly the division of responsibility, the runtime contract and transitions between working methods. The vision describes the whole, the orchestration document describes responsibility and handovers, and this document describes issues and persistent working memory over time. The documents are to be applied together; conflicts are to be resolved explicitly.

## 2 Governing product principles

- The issue persists. Identity, goal, decisions, history and results follow the task through agent sessions, restarts and changes of working method.

- The agents handle the ongoing issue work. They create, clarify, break down and update tasks within their mandates. Work is to be able to proceed without the human moving cards between columns by hand.

- The human directs through dialogue and explicit commands. The user can refine goals, reprioritise, pause, take over and hand work back. Such direction is to become visible in the issue's history.

- The visualisation shows the system's actual state. The board, the issue view and the workflow view are to build on the same persistent information the agents use.

- Quality requirements follow the task. Switching between chat and loop is to preserve applicable review requirements, verification requirements and permissions.

- The engine follows explicit configuration. A role name and the contents of a prompt must not by themselves decide routing, rights or state transitions.

The principles state the product's direction. Details such as storage, status names and graph representation need to be decided through separate design.

## 3 The issue as persistent working memory

An issue is to contain, or refer to, sufficient information for the work to be resumed without a particular chat session still existing. It is to be possible to understand the task's current meaning, the choices made earlier and the possible next steps.

The logical model needs to cover at least the following information. The exact data model is an open design choice.

- Intent: goal, scope, requirements and the conditions for the task to count as solved.

- Relationships: dependencies, subtasks and relations to other issues.

- Working state: the active run, the responsible agent, the step performed, the next step and any blockers.

- Decisions and judgements: the user's instructions and decisions, the agent's proposals and assumptions, the solutions chosen and the uncertainty that remains, with a clear distinction between them.

- Results: code changes, artefacts, review findings and verification evidence, with references to what was assessed.

- History: attempts, handovers, errors, resumptions and the reasons for significant changes.

The issue needs to be kept distinct from a run and from an agent session. The same issue may have several attempts and sessions. An interrupted session must not delete the task or hide what the attempt managed to do.

The states of the issue, the run and the individual step are separate. A stopped attempt may leave the issue open, and a finished run may have left evidence without the task being solved. A missing result declaration does not automatically mean the issue is blocked. How a run's result affects the issue's status is to be governed by explicit rules or by authorised decisions, and is to be traceable in the history.

The chat is to be able to carry decisions into the working memory. Long transcripts may exist as reference, but necessary decisions and blockers must also be reachable as persistent issue information. Summaries need to keep their connection to the material they came from. The working memory is to distinguish the user's instructions and decisions from the agent's proposals, assumptions and judgements, from observed results, and from the engine's recorded events. Source, context and which information has been superseded by later information are to be traceable. An unknown origin is to be stated as unknown. A summary must not turn an assumption into a fact or weaken the task's original constraints.

## 4 Responsibility for behaviour and state

The agents own the operational issue work. The engine is responsible for state changes being carried out according to explicit rules. An agent's statement that something is "done" is to be treated according to the configured workflow's conditions for completion.

| Part | Responsibility |
| --- | --- |
| The human and the interactive dialogue | Formulates goals, gives clarifications, sets the mandate and makes the decisions that require the human's involvement. |
| The agent's instructions | State how the agent is to work, reason about the task and report results within its mandate. |
| Graph and configuration | State steps, dependencies, routing, conditions, the intended tool access within the applicable permission limits, and when the human needs to be involved. |
| The general engine and working memory | Stores information and history, drives runs, and carries out configured transitions and checks. |
| Visualisation | Renders the working state and makes decisions, results, blockers and evidence possible to examine. |

Names such as planner, implementer, reviewer and verifier are labels in a particular workflow. Every behaviour is to be traceable to an instruction, a configuration or a general engine function. A proposal is to state which part needs to change.

The workflow states the intended tool access within the user's mandate, the project's access rules and the environment's technically permitted rights. A role text or a graph cannot extend those limits on its own. Switching between chat and loop does not grant extended permissions; a changed mandate requires authorised direction and cannot override the environment's actual constraints.

## 5 Chat and loop with shared continuity

The user is to be able to discuss a task with the interactive agent, let the agent register it, and then choose how the work is driven. The task may be solved together in the chat, handed to a loop, or switched between these working methods as the work proceeds.

Interactive work is a full working method even without a registered issue. Open discussion need not automatically create an issue or start work. Registering an issue, starting a run and granting a mandate are separate acts. Agents may handle registration and starting within a mandate already given; a saved idea is not in itself a commission to carry it out.

A change of working method is to preserve the issue's identity, current requirements, decisions and relevant working state, including any state of the code, artefacts and valid review results. The difference lies in how the work is driven forward and when the human takes part. Applicable quality requirements are to continue to apply.

An example of the intended user flow:

1. The user discusses a problem. The interactive agent records the goal, the scope and what still needs clarifying.

2. The issue continues in a configured loop that investigates and works on the task.

3. The user opens the issue in the overview and asks to reason about a choice. The system coordinates the transition so that conflicting changes are not made at the same time.

4. A decision from the dialogue is carried into the same issue. Further work is done interactively or handed back to the loop.

5. The final result is assessed against the task's requirements, with traceable review and verification evidence.

At a handover DSpatch is to provide, or clearly refer to, the material the handover contract requires. That covers the current task and the target version, the user's constraints and any later corrections, the relevant results, and the reason for the transition. The agent is responsible for using the material and, where needed, fetching further relevant working memory. That information has been saved is not enough if the next step has no access to it or continues on out-of-date assumptions. The handover is to be bounded as needed; the whole history need not be sent to every agent.

## 6 Robustness and predictable behaviour

Predictability is to concern the system's rules, limits and reporting. Models may propose different solutions to the same task. DSpatch is nevertheless to be able to report what information was used, which steps were performed, and why the work went on or stopped.

- Controlled handover: The system is to keep track of who, or which run, may change a shared working state. Simultaneous chat and loop must be coordinated explicitly.

- Resumption: After an interruption the system is to be able to identify the last known state and the effects already carried out. Unclear states are to be made visible before the work continues.

- Clear errors: Being blocked, being interrupted and failing are to be distinguishable from success. Retries, and the limits on them, are to follow the configuration.

- Visible mandates: Which changes and tool calls an agent may make is to be defined. A change of working method is to keep the mandate or change it explicitly.

The exact mechanism for coordination, recovery and persistence needs to be designed and verified. It must not rest solely on agents following instructions in natural language.

## 7 Quality and review of the delivery

DSpatch is to make it possible to review both the change and its consequences in the surrounding code. The user needs to be able to follow the connection between requirement, solution, code and the evidence for approval.

An issue's result may also be an analysis, a decision, a calculation or a piece of research without code changes. The checks are to follow the task's requirements and the chosen workflow. A change of working method preserves the applicable requirements but does not by itself impose mandatory code, test or review steps on every issue.

Review and verification are to be bound to an unambiguously identified version of what was assessed. Where the workflow allows work that is not yet committed, the actual content must be identifiable too. A reference to a mutable working directory state is insufficient.

Governing requirements for this binding:

- A review result is to state what was reviewed, which version it concerned, and which findings or limitations remain.

- A verification result is to state what was run, against what content, and with what outcome. The relevant environment and configuration need to be traceable.

- After a change, the validity of earlier evidence is to be tested against its dependencies. Approval of old content must not automatically carry over to new content. Where the available dependencies and evidence are not enough to determine continued validity, it is to be stated as unknown or as needing reassessment. The system must not assume that it automatically understands every consequence of a change.

- Where work is done in parallel, the integrated delivery is to be covered by the checks its workflow requires. Evidence for separate parts needs to be assessed in relation to the combination.

- The conditions for marking a task as complete are to be explicit and tied to the applicable requirements and evidence.

Tests and agent review provide evidence for a judgement. The documentation is to distinguish observed results, the agent's conclusions, and what is still unknown. Independent review is to be expressible in the workflow; its degree of independence needs to be defined.

## 8 The visualisation as a window into the work

The overview may use familiar forms such as cards, columns and issue views. The user is to be able to follow the work without having to maintain the board. The statuses and groupings shown are to be consistent with the configured workflow.

From the overview the user is to be able to examine:

- What is in progress, what is waiting, and what is blocking further work?

- Which agent or run is working on the task, and which step is being performed?

- Which requirements and decisions govern the current solution?

- What changes have been made, how do they affect behaviour, and what evidence supports the description?

- What has been reviewed and verified, and do those results still hold for the current delivery?

An issue is to be openable in dialogue with the interactive agent. Direction through dialogue and direction through direct commands are to go through the same rules and become traceable in the same history. Detailed views may show runs and individual events; the overview needs to help the human understand what requires attention. Basic direction such as pausing and taking over is also to have visible commands in the interface. The user should not have to guess the right chat phrasing or maintain the board's statuses by hand.

## 9 Recommended acceptance scenarios

The following scenarios are proposed as a basis for a future specification and verification. They are not a report of tests performed.

1. Chat to loop and back: A task changes working method and keeps its identity, clarifications, state of the code and remaining requirements. No manual copying is needed.

2. A new agent session: A replacement agent can find the relevant working state, the remaining work and the important decisions without the previous session being active.

3. Interactive direction during a run: The user changes a requirement while the loop is working. The change is recorded and coordinated so that further work uses the right premises.

4. A change after review: Code or other reviewed material is changed after approval. The system shows which judgements still hold where that can be established, and which are out of date, unknown or in need of reassessment.

5. Interruption and restart: A run is interrupted after an actual effect. The restart detects the state and avoids blindly performing the same effect again.

6. A joint delivery: Two subtasks work separately but produce a fault together. The configured workflow reviews and verifies the integration result as well.

7. A consistent overview: A blocked issue is shown with the same reason and state the agent is using. The user can go from the card to the evidence and on into dialogue.

8. Separated states and sources of information: An attempt stops without a result declaration. The issue gets no unfounded complete or blocked status. The agent's assumptions, the user's decisions and the engine's observations keep their sources through summarising and handover. At the same time, an open discussion is to be able to continue without an issue or a run being created automatically.

The evaluation should cover the correctness of the final result, the faults remaining, the human review and repair time, recovery after interruption, and the time and model cost per accepted delivery. Failures that are detected and reported correctly need to be distinguished from faults the system wrongly approves.

## 10 Open design choices and further application

The following questions remain to be settled in separate design decisions:

- The storage model, and any reuse of Beads or another component.

- The schema for issues, runs, events, decisions and verification evidence.

- How the workflow's state is rendered in an intelligible overview.

- Coordination between concurrent runs and interactive work.

- The identification of code versions, and the rules for evidence that has become out of date.

- What independent review means, and which checks each workflow requires.

- Provider integrations, permissions and traceability across different execution environments.

Gas Town, Gas City and Beads are relevant references when components are evaluated. This vision selects none of them as a dependency and makes no claim that their current implementation lacks corresponding features. Such judgements require review of an identified version and practical trials.

On adoption in the project, the document is to be compared with the current versions of the existing governance documents, and conflicts resolved explicitly. The Markdown version is to be the canonical, version-controlled source in the project. The Word version is to render the same content for reading and discussion, and on future updates is to be derived from the Markdown source. Every future change proposal is to state the part affected, the intended effect, and how the behaviour can be verified.

## 11 Review records without an orchestration dependency

The standalone-review decision in [VISION.md section 3.3](VISION.md#33-review-as-a-standalone-capability) also applies to persistent information. A repository and a selected diff or revision are sufficient to begin a review. A task ID, agent run or Maestro graph is optional context, not a prerequisite. This extends the intended design; it does not claim that persistent review records already exist.

### Preserve the assessment and its provenance

A proposed review record identifies the repository and exact content assessed, the reviewed ranges, findings, decisions and unresolved questions. For uncommitted work it needs a stable identification of actual content, not just a directory path. It distinguishes human review, agent review and an explicit decision to skip review. It records whose decision it was and the reason where relevant.

Walkthrough progress, acceptance and test evidence are separate information. A completed walk is not automatically an approved change. A teaching conversation is not a correctness verdict. The coverage proposal is described in [VISION.md section 3.4](VISION.md#34-walkthrough-coverage-and-levels-of-engagement); its exact schema remains open.

### Connect to task memory when available

When DSpatch supplies the change, the task can reference its review and the review can reference the relevant requirements, implementation rationale and verification results. Preserve sources and revisions so the reviewer can check each claim. Do not copy an entire conversation into every review by default. If another tool produced the change, the same review record can exist without DSpatch's task history.

After a code change, prior findings and coverage remain historical records about the previous content. Reuse requires an explicit validity assessment; uncertainty must remain visible. A first pilot can hold the candidate fixed and leave automatic transfer across revisions for later design.

### Reopen review separately from resuming an agent

Restoring the selected change, walks and recorded decisions does not require a live provider session. A new agent session can use the saved material while being described honestly as new. Conversely, a provider session ID alone is not a durable review record. This follows the [roadmap's distinction](RUNTIME_PLATFORM_ROADMAP.md#four-different-persistence-requirements) between reopening a workspace, continuing a task and resuming a provider session.

An early review pilot can proceed alongside runtime work when it uses an agreed input boundary and an isolated branch and worktree. Its integration must still preserve the shared adapter contract and revision binding. Parallel development grants no automatic acceptance of the combined result.
