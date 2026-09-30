# DSpatch's interaction model

Who does what, and how the conversation continues

DSpatch · 19 September 2026 · Version 1.3 · Owner: Niclas Danielsson

This is the governing description of how a person, the agents and Maestro share the work. It describes intended behaviour, not a claim that every feature is implemented or verified.

Keep one maintained version at `docs/INTERACTION_MODEL.md`, referenced from `AGENTS.md`. This revision consolidates version 1.0 and the separate interaction-model draft 0.1, including Niclas's subsequent clarifications. Those earlier versions are background, not competing instructions.

[VISION.md](VISION.md) governs product direction; [MAESTRO_ORCHESTRATION.md](MAESTRO_ORCHESTRATION.md) governs internal concepts and architecture. This document governs responsibility and user interaction. Where older wording conflicts on those subjects, correct it to match the decisions recorded here. Later explicit decisions by Niclas take precedence.

[AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) supplements the division of responsibility in §1 without replacing it: it separates what an agent's own instructions decide from what the graph decides and what Maestro adds to a call, and it holds that a task's needs, not routine, determine whether the project is read. Its proposal for an agent to suggest interactive work and for the user to choose is a design for the mode switching §2 already requires; read it as a proposal, and this document as what governs.

Statements marked **(proposal)** remain suggested details, not agreed requirements. An implementation limitation must be reported as a limitation, rather than silently rewriting the intended interaction.

### Starting point: preserve the working Cursor experience

Niclas's existing interactive development loop in Cursor is the reference for how working with agents should feel: ordinary conversation, follow-up questions, visible reported activity, understandable dispatch and handovers, and the ability to intervene. That interaction already works well for him. DSpatch should reproduce it in its own application, not invent a different conversational workflow or add new approval rituals.

This is a reference for the user experience, not a requirement to copy Cursor's internal implementation or depend on its native subagent orchestration. The external development loop and the Maestro product remain distinct.

DSpatch adds value in four areas:

- **Loop design:** an editor for setting up, understanding and visualising workflows.
- **Reliable execution:** handling empty replies, interrupted work, failed handovers and inconsistent run states without losing the assignment or becoming inexplicably stuck.
- **Visible activity and history:** a coherent view of which agents are active, what they are doing or waiting for, and what happened. Following the work must not require chasing subagents through other windows.
- **Understanding and inspection:** a visual, summarised view of the graph's current state, followed by richer ways to understand results: smart diffs, guided code walks and conceptual explanations of both changes and the code as a whole. Long technical logs are supporting detail, not the primary inspection experience.

**The immediate priority is reliable execution and easy interaction with an ongoing loop.** The next increment should let the user give an assignment, follow the work, intervene and continue without needing to understand or repair internal run states. Richer code-inspection features remain part of the direction, but should not displace this immediate priority.

Reliable execution does not mean every failure must be repaired automatically. Preserve the work, explain the situation in plain language and provide a usable way forward. An empty reply must not silently count as a successful result or leave the user unable to tell whether anything is still running. Recovery stays within the mandate and remaining limits; it must not duplicate actions whose outcomes are still unknown.

## 1 The division of responsibility

**The user** gives the assignment and its boundaries, chooses how much to participate, and intervenes whenever they want.

**The agent** understands the assignment, investigates the project and decides how to carry out the work using its own tools. It can read, build, test, run several commands and change approach as it learns. Its role states its responsibility, such as research, implementation or review. It follows project instructions and the user's mandate; Maestro does not replace its judgement with a prescribed command sequence.

**Maestro** runs the flow: which agent step runs, what assignment and context it receives, where its result is delivered, and how the run waits, continues or stops. Maestro also manages run limits and history.

**The interface** makes the work understandable and lets the user talk, follow progress, review results and steer.

**The history** preserves the assignment, decisions, work performed and available observations for the relevant code version.

An agent called from a loop has the same basic working capability as one addressed directly, within the same role, permissions and mandate. Entering a loop does not silently remove tools or turn the agent into a command-proposal service.

For example, given “Check this C++ project for build errors”, the agent discovers the build instructions and environment, chooses the necessary commands, runs them and assesses their results. The user need not identify a build script first.

Maestro follows the workflow's rules: hand over to review, return for correction or stop at a limit. The agents decide how to perform those assignments. Planning and executive judgement may themselves be agent roles; they do not require project-specific reasoning to be hard-coded into Maestro.

Ordinary agent work needs no mandatory Command field or DSpatch-specific confirmation of each command. A user may give a particular command in conversation; the agent can follow it without DSpatch extracting it into a configuration field. Actual platform permissions still apply.

The external Cursor development loop used to build DSpatch is a separate process. This document governs interaction and Maestro inside the product.

## 2 Autonomy and when a person is needed

Direct conversation is a complete way of working throughout a project: discussion, investigation, implementation and review. Autonomous work is optional. Switching between these ways of working preserves the conversation and relevant context.

Autonomous work continues within its mandate without routine permission questions. Human involvement is required when:

1. The user chose a decision point or asked to participate.
2. Work genuinely cannot proceed within the given mandate without their input.
3. The operating system or provider requires their intervention.

Routine technical decisions belong to the agents. An agent's preference for reassurance is not a reason to stop. When input is genuinely required, explain what is needed and why; continue independent authorised work where possible.

Working interactively does not mean approving every tool operation. Questions and decisions are presented in ordinary, copyable conversation text with their context. Any associated controls must leave that explanation readable in the conversation.

## 3 What a message means

The user writes naturally in the same chat box. Message meaning follows the conversation and the user's intent, not simply whether a run is active.

| Message | Meaning | Effect on the work |
| --- | --- | --- |
| Question | The user wants an explanation or information | Answer in context; do not automatically restart, redirect or advance the assignment. |
| Instruction or clarification | The user adds context or changes the assignment | Acknowledge it, deliver it to the relevant agent at an appropriate opportunity, and show when it takes effect. |
| New assignment | The user asks for additional work | Start the requested work within the mandate, with its relationship to existing work clear. |
| Continue | The user asks to resume held work | Continue the saved run from the appropriate step, with updated instructions and remaining budget. |

An idle, completed, paused or cancelled run does not make every subsequent message a new assignment. “Why did you change this?” remains a question about the existing work. “Continue, but leave that file alone” resumes the assignment with a clarification.

The user should not have to classify every message through a form or a required question/instruction switch. Ask a focused clarification only when genuine ambiguity would materially change the work. Interpreting the user's intent belongs to the conversational agent; Maestro handles delivery and flow. It must not impose a command parser or a fixed work sequence on ordinary conversation.

Discussion by itself is not approval of a pending decision. Make clear when the user is answering a particular decision, whether through an associated control or an unambiguous reply directed to it.

For a new instruction, distinguish **received** from **delivered to the relevant agent**. Only claim it has been applied when that is established. Do not imply that an agent already working has received a message when it has not. An instruction must not silently start a second competing job in the same working copy.

If the current agent cannot receive an instruction during its ongoing work, show it as pending. It can reach the next appropriate handover, or the same agent when its interrupted step is continued. Do not make “always the next agent” a product rule. Provider limitations should be established for the actual integration, not assumed to apply universally.

## 4 Seven situations

All seven situations use the same continuous conversation described in §9. Each preserves enough context to understand which work a message, answer or decision concerns.

### 4.1 The user gives an assignment directly to an agent

The user writes the assignment and sends it. Their message appears in the conversation, followed by activity and the agent's reply. They can ask follow-up questions in the same thread.

The agent investigates and does the work with its own tools. If a build or test is needed, it discovers how to run it. No graph handover is required for direct conversation.

Save the conversation, relevant changes, available tool observations and results. The answer must distinguish what the agent concludes from what was actually checked.

### 4.2 The user gives an assignment through a loop

The user chooses a workflow and submits an assignment in the same chat. They see progress, agent handovers and replies in that thread. The graph shows the corresponding step and path.

Each agent keeps the working capability described in §1. A verification step is an agent assignment: it determines which checks are relevant and runs them. Some assignments require several checks; an explanation may require none.

Maestro supplies context, routes declared outcomes and applies the workflow's limits. Save the conversation, steps, handovers, branches, results and the graph version used for the run.

### 4.3 The user asks a question while work is going on

The user asks in the same box and receives an answer in the same thread. The question does not automatically pause, steer or restart the work.

Answer using available context. If the relevant agent cannot answer until its current work reaches a suitable point, make the wait visible. Do not claim immediate access to that agent's current context unless it exists.

Save the question and answer with the work they concern. A question about a particular step can refer to that step without becoming an instruction to it. There is no separate question-and-answer panel the user must visit.

### 4.4 The user adds or changes an instruction during work

The user writes the clarification in the conversation. Acknowledge it and show which work it affects and whether delivery is pending.

The agent receiving the instruction works with the updated assignment. If the current step must be interrupted to change direction, the user can use Cancel as described in §4.5. If the instruction waits for a handover, show which step eventually receives it. If no step receives it before the run ends, say so.

Save the instruction, its timing and its actual delivery. Receipt by the interface is not proof that the agent has already acted on it.

### 4.5 The user pauses or cancels, discusses, and continues

The user initiates a pause or cancellation when they want to inspect progress, ask questions or change direction. These are optional interventions; an autonomous run does not require them between steps. Control names below describe their meaning rather than prescribing final button labels.

**Pause after the current step** lets that agent finish its assignment, then holds before Maestro starts the next step. Show **pause requested** until the run is actually **paused**.

**Cancel current work** attempts to stop the ongoing work now and holds the loop at the interrupted step. Preserve the conversation, agent session, work already done, run position, graph version and budget already spent. Cancellation does not discard the run or automatically undo file changes.

After cancellation, the user can discuss the work and clarify the assignment with the same agent and saved context. Asking a question or adding a clarification does not by itself resume the assignment or advance the loop. An explicit request to continue, expressed in chat or through a control, resumes work with the updated instructions and remaining budget.

Continue from the correct position:

- After a pause at a step boundary, start the next step with the revised context.
- After cancellation during a step, continue that step with the same agent session and relevant conversation.

This resumes the assignment, not necessarily a command at the exact instruction where it stopped. The agent establishes what completed or changed before the interruption. A build may need to restart; completed work should not be repeated unnecessarily.

Show what actually stopped. If the provider's stop is unconfirmed, state that uncertainty and do not silently start overlapping work. If the same agent session cannot be resumed, report that limitation instead of presenting a new session as the original one.

Save the request, observed stop or pause, intervening discussion, revised instructions and continuation on the same run. This complete interaction remains a requirement to verify, not an assumption about today's application.

### 4.6 A human node or a genuine obstacle needs the user

Show the question and supporting context in the conversation. The graph marks the corresponding step as waiting. The user can discuss the evidence before giving their answer.

Maestro holds the dependent work. An ordinary discussion message does not settle the decision. An explicit answer is attached to that run and that visit to the decision point; an old answer must not silently settle a later visit.

If the obstacle is outside the mandate or requires personal action, explain exactly what is needed. If it is a routine technical choice within the assignment, the agent decides.

**(proposal)** A planned human node and an unexpected need for input can use the same visual treatment, with wording explaining why input is needed.

### 4.7 The user opens an earlier run

Opening history displays the assignment, conversation, steps, observed checks, changes and outcome. It starts no execution and repeats no work.

The user can ask follow-up questions about that run in the same conversation. Typing after opening history does not automatically create a new assignment. Continuing a paused, cancelled or waiting run requires an explicit request; a request for new work is handled as new work.

Before continuation, establish what completed, what remains and whether the working files have changed. Uncertain outcomes stay visible and must not be silently retried. Budget already spent stays spent. Earlier verification results remain attached to the version they checked.

Preserve later discussion as part of the conversation. Add resumed work to the same run with its history intact.

## 5 What makes a result understandable

Judge the outcome against the assignment. A reading task can succeed without changes or tests. A verification task may need tests without changing files. Maestro must not substitute “files changed” or “a command ran” for an assessment of whether the assignment was fulfilled.

Separate these sources in the history:

- DSpatch's own observations, such as a comparison of project files before and after.
- Provider-reported tool execution, including the command, exit status and output when supplied.
- The agent's explanation and assessment of what those results mean.

A prose claim alone does not establish that a command ran or a test passed. Collect available evidence from the work; DSpatch does not need to own the command execution to record it. Associate checks and reviews with the code version or saved changes they actually concern.

Record unavailable information as unknown. An unknown cost is not zero. If no command output is supplied, say “no output was reported”, not “the command produced no output”. If output is supplied but its completeness is unknown, preserve it and state that limitation. A failed check, a check that could not start and a check that was unnecessary are different outcomes.

The normal result is a concise explanation of what was achieved, what was checked, what remains and what the user can do next. Technical detail stays available on demand. Missing detail does not automatically require interrupting the user.

## 6 What the user should not have to manage

- A mandatory build or test command field, or an extra DSpatch approval for ordinary agent commands.
- Project-specific execution configuration that the agent can discover from the project and assignment.
- A form classifying every chat message as question, instruction or assignment.
- Separate locations for a question and its reply.
- Repeating an assignment because a view was reopened or current work was cancelled.
- Routine implementation choices such as internal field names, file exclusions or log formatting.

These expectations do not remove actual platform permissions, required credentials or the user's stated boundaries.

## 7 Open details and proposals

The shared visual treatment for human nodes and unexpected obstacles in §4.6 remains a proposal. Exact control labels, placement and animation are implementation details to assess through use. They must preserve the interaction described here.

Version 1.0 proposed treating every message during work as a question unless a special instruction control was used. That proposal is no longer the prescribed default. A required message-type switch must not replace ordinary conversation. Genuine ambiguity can be resolved in context as described in §3.

## 8 What this document replaces

Between 16 and 18 September 2026 the chat loop acquired a design in which checking a project meant **one shell command that DSpatch itself started**, known before the run, typed into a visible Command field, and confirmed by the user before it could run.

That was a misallocation: the orchestrator took over the project's working method, and the agent — which has its own tools — was reduced to proposing a string for DSpatch to run.

Its cause is worth recording, because the wording that produced it looked correct. The principle *an agent narrative is not evidence* was read as *DSpatch must start the process itself, or it is not evidence*. Owning the spawn was **one way** to obtain evidence and was quietly promoted into the definition of it. The Command field, the proposing step and the confirmation all followed from that single step, and no one ever decided them.

The correct statement is in §5: **a result must be traceable to something that actually happened, and what cannot be seen must be called unknown.** Who started the process is not what the principle was ever about.

Superseded by this document, and being corrected where they are written down: the requirement for a configured command field; any DSpatch-specific confirmation of an ordinary build or test command, recorded as decision D3; and the selection of a run's branch by comparing file trees, which is the same misallocation one level down — the orchestrator deciding what counts as work.

Historical notes and reports from those runs are kept as history. They record what was believed at the time and are not to be read as current instruction.

## 9 One conversation, with a separate graph view

**Use a familiar chat conversation: user messages and agent replies belong in one continuous thread in the same window.** A question, its answer and the follow-up must remain readable together. The user must not have to find an answer in a separate output panel, report area or window.

Each submitted message appears in that thread. The related activity and response appear with it; streaming text grows in the reply's place and remains as history when complete. Subsequent exchanges extend the conversation instead of replacing earlier questions and answers.

An agent handover is marked in the same thread, with the role or agent clearly identified and a short explanation of the handover. Multiple agents behind the scenes do not require separate conversations for the user to follow the work.

Enter sends; Shift+Enter inserts a line break. **Niclas's decision, 19 September 2026: there is no Send button.** Enter is the send, so a button beside it is furniture that says what the composer already says. What the composer must keep is that the keystroke is discoverable — its own placeholder names it — and that the user's text is preserved if sending fails or is refused. This supersedes the earlier sentence in this section requiring a visible Send control.

Show brief reported activity while work is underway. Temporary status can disappear or collapse when the reply is ready; keep the actual messages, handovers and results. Expand tool details alongside the relevant work. Do not invent thinking text or require the user to understand internal call mechanics.

Keep the established colour palette. Give the conversation the main space. Remove the large project/model/connection summary card. Project folders belong in the left explorer as that part of the application is developed; until then, keep project identity and access compact rather than requiring a new explorer before the chat can be improved.

Put session details, internal identifiers, full paths and diagnostics behind a conventional top application menu, like the menu bar in the Cursor reference. Exact menu grouping is an implementation choice. Long explanations of session restoration, provider mechanics or how results were verified do not belong above the conversation. Keep them available as details.

Put model selection beside the message composer, following the Cursor reference, and make clear which work a selection affects. Do not use a large informational card to display it. Normal connection details can stay in the details view; an actual connection problem affecting work must remain visible and understandable in context.

**The chat explains what is happening; the graph shows where the workflow is.** Open the graph editor in a separate window so the user can continue the conversation and follow a run while it is open.

During execution, show the running graph version locked for editing. Mark the active node clearly; a restrained pulse may help convey activity, but the state must also be understandable without animation. Opening, closing or reopening the graph window does not start, stop or reset the run.

Graph, diff and detail views complement the conversation. Reading and continuing the dialogue must remain possible entirely within the chat window.

At a glance, the conversation and graph should answer: **who is working, on what, what are they waiting for, and what happens next?** Distinguish active work, waiting for the user, a requested stop, an actual stop and an uncertain execution state. Do not present a running animation as proof of activity when activity is not known. Summarise the current step and relevant recent handovers; make detailed history available without forcing the user to read raw logs.

### 9.1 Readable messages and stable scrolling

User messages appear in distinct, compact containers with a subtle background and border, following the Cursor reference. Agent replies remain clearly distinguishable below them in the same thread. Do not present the user's message as a faint quotation embedded in the agent's answer. Keep role labels readable at handovers without surrounding every reply with diagnostic text.

Render agent responses as formatted Markdown: headings, emphasis, lists, links, inline code and fenced code blocks. Ordinary headings and emphasis must not display their literal `###` and `**` markers. Preserve literal characters within code and code-like content rather than removing markers from the text. Formatting must work during streaming and when saved replies are reopened.

Sending a message must not jump the application to the top, including on the first message of a session. Keep the composer accessible and use one primary vertical scroll area for the conversation instead of competing page and message scroll areas. Code blocks may scroll horizontally where needed.

When the user is following the latest messages, keep new messages and streaming replies in view. When they scroll back to read earlier messages, preserve their reading position as new content arrives and offer an unobtrusive way to return to the latest message. Status updates and agent handovers must not reset the scroll position.

**(proposal)** Keep the control row compact and show actions relevant to the current state. Avoid simultaneously presenting a full set of idle, running and paused controls with repeated explanatory paragraphs. Preserve easy access to stopping active work.

## 10 Assessing the application against this model

Record each behaviour as **working**, **needs correction**, **not yet built** or **needs a product decision**, with a short observation and next step. Use existing backlog tasks where possible. This document itself does not establish that the current build passes these checks.

Practical trials should cover:

1. An unfamiliar small project: the agent discovers its build procedure without a required command field or routine command approval.
2. A reading or explanation task that succeeds without code changes or unnecessary tests.
3. Verification of existing code, including checks when no files changed.
4. A question and a changed instruction during work, with their handling and delivery visible.
5. User-requested pause after a step, discussion and continuation at the next step.
6. Cancellation during a step, discussion with the same agent and continuation of that step with revised instructions. Check that discussion alone does not restart the work and that completed work is not duplicated.
7. A human decision point where discussion is distinguishable from an answer to the pending decision.
8. Reopening a saved conversation after restart, asking about the previous result and explicitly continuing held work without resetting history or budget.
9. Matching progress in the conversation and graph, including when the graph window is reopened.
10. A multi-turn conversation with an agent handover: messages, activity and replies remain in one thread, with Enter/Shift+Enter behaving as specified.
11. Empty replies, interrupted calls and failed handovers: the assignment and history survive, no false success is reported, the user can understand whether work is active or waiting, and recovery offers a concrete next action within the remaining limits.
12. Returning to a run whose execution state is uncertain: explain what is known, establish what can safely continue, and avoid silently repeating possibly completed actions.
13. First and subsequent sends, streaming replies and agent handovers: no jump to the top; the composer stays accessible; scrolling back to read is respected. Repeat with a long conversation and after reopening it.
14. User messages are clearly distinguishable from agent replies. Markdown headings, emphasis, lists and code render correctly both live and after restart. Session details are available through the top menu and the large project/model/connection card is absent.

For the next increment, prioritise the ongoing-interaction and recovery trials above. Compare the experience with Niclas's working Cursor loop: the user should be able to converse, understand handovers and intervene just as naturally, while DSpatch makes the run easier to follow and recover. Passing technical tests alone does not establish that this interaction is usable.

Identify the build and provider used for each trial. Report untested behaviour and limitations explicitly, including inability to confirm cancellation or resume an agent session. Record the user's judgement separately where usability needs it.

### Revision 1.3

Records Niclas's feedback from trying the packaged window and comparing it with Cursor: stable scrolling, visually distinct user messages, rendered Markdown, session details in a top menu, removal of the large project/model/connection card, and model selection near the composer. Adds actual-window checks for these behaviours. The reported scroll jump needs diagnosis; this document does not assume its implementation cause.

### Revision 1.2

Records Niclas's clarification that the existing Cursor loop is the interaction reference, not the behaviour being redesigned. Identifies DSpatch's added value in loop editing, reliability, activity/history and visual code understanding. Prioritises robustness and easy interaction during ongoing work, with explicit recovery and at-a-glance inspection checks.

### Revision 1.1

Consolidates the repository's version 1.0 with draft 0.1 and Niclas's clarifications on 19 September 2026. Corrects the idle-message rule; adds continuation after cancellation with the same agent; requires a single conversation thread; carries in the chat and graph UI requirements; and distinguishes intended behaviour from verified implementation. The responsibility correction and its historical explanation remain in place.
