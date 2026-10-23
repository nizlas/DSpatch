# Agent behavior and orchestration in DSpatch

Guideline and proposals for further development · 23 October 2026 · Version 1.1

This document defines the boundary between how an agent works, the workflow described by the graph, and Maestro's responsibility for execution. It should help Niclas and the project's agents assess changes without reintroducing hidden instructions or unnecessary routine reading of the project.

The principles below summarize the direction Niclas has endorsed. The proposals for editing instructions in the graph editor and switching to interactive work are recommended designs, not approved or verified product features. This document supplements [VISION.md](VISION.md), particularly [section 7](VISION.md#7-replaceable-working-methods-in-maestro) on interchangeable workflows and [section 8](VISION.md#8-human-direction-and-autonomous-iteration) on continuity between ways of working. [INTERACTION_MODEL.md](INTERACTION_MODEL.md) governs who decides what and what a user's message means; [MAESTRO_ORCHESTRATION.md](MAESTRO_ORCHESTRATION.md) governs the internal concepts and architecture this document's boundary is drawn across. [TASK_MANAGEMENT_AND_WORKING_MEMORY.md](TASK_MANAGEMENT_AND_WORKING_MEMORY.md) sets the intended direction for what persists across the boundary drawn here — the issue as a working memory carrying intent, decisions, results and history through sessions and through a switch between chat and loop — and is intended design rather than built behavior. Where this document and either of those differ on responsibility, they govern and the difference is to be reported rather than settled here.

## 1 Responsibilities and task needs

### Agent instructions define the way of working

Roles, skills, and governing documents describe how the agent interprets the task, chooses a method, seeks information, and assesses the result. The graph describes steps, handoffs, and routes through the work. Maestro executes the process and manages the run.

| Part | Responsibility |
| --- | --- |
| Role and skills | Method, scope, information needs, and quality assessment. |
| Graph | Steps, connections, inputs, results, and declared outcomes. |
| DSpatch and Maestro | Calls, sessions, transfers, tool access, state, interruptions, and history. |
| Provider and model | The underlying agent engine, model behavior, and the provider's own limitations. |

All instructions and controls introduced by DSpatch must be explicit and inspectable. The model and provider also influence behavior, so documents cannot guarantee every individual agent decision. DSpatch must show what it sends and distinguish it from what the provider adds or what remains unknown.

### Say where a behavior is defined

The table above is also a rule for how behavior is described. When explaining or proposing behavior, name which of the four parts defines it: role instructions, a node's configuration, the graph's connections, or Maestro's general execution rules. A reader who cannot tell which one is being discussed cannot tell what would have to change, or who may change it.

Names such as researcher, implementer, and reviewer identify roles in one workflow. They carry no built-in behavior in Maestro. The engine follows explicit configuration only: it must not derive routing from a role's name, nor from the meaning of its prose. A future graph may call the same role anything, use it at several nodes with different contracts, or not use it at all.

Say what is configured, not what a role is like. "In this graph, the node using the researcher role declares no outcomes, so Maestro routes its reply along the configured success edge" identifies the source and the mechanism. "The researcher is permissive" attributes to a role a behavior that belongs to a node's configuration, and hides both where it is set and how to change it.

For a proposed change, separate a change to one role or one graph from a change to the general engine, because they differ in blast radius and in who decides. Separate intended design from verified implementation: where the code has not been read, say that the behavior is intended rather than confirmed. An instruction is not evidence of compliance, and a document is not evidence of what the code does.

### The task determines which process is needed

A loop suits work that benefits from multiple steps and independent checks, such as developing a new AI architecture or writing code for a correct hand grip between a 3D character and a weapon. A targeted search for people's names in a repository can often be handled directly in an interactive conversation.

The distinction is which workflow the task needs. A short question can be difficult, and an extensive search can be simple. Interactive work is a fully supported way of working, including for advanced tasks.

An open repository is available context. This does not mean every task requires a project inventory. Calculating pi requires no repository; a question about existing code requires the relevant files. Research can use external sources and requires project reading when the task actually involves a comparison with the project.

## 2 Visible instructions and clearly identified resources

### The runtime contract must be readable

Maestro needs to tell the agent which step it is performing, which inputs it receives, and how to return the result. This contract must be visible in the graph editor alongside the role instructions. It must not introduce hidden methodological requirements such as always reading the project, producing code, or writing a report file.

The agent performs its assigned step. Maestro handles the transfer to the next step according to the graph and its declared outcomes. If the role requires a report, the result contract must specify how it is delivered and who saves it. A call must never promise a report path or attachment that is missing.

The user's original task and explicit constraints must survive handoffs and rework. A summary must not weaken "do not read the project" into "do not read the entire project." General work routines must depend on the task. Actual permission boundaries apply regardless of the agent's recommendations.

### Three different locations serve different purposes

The loop's resources contain its definition, graph, and roles. The working folders contain material the task may need. Run storage contains Maestro's journals and results. These locations must be described so that the agent does not search an unrelated project for the loop's role files.

When the role text is already included in the message, this must be stated. A path shown as a source reference does not automatically instruct the agent to open that file. Results outside the working folders must be identified as inputs explicitly supplied by the run.

### Observation is also runtime behavior

Automatic hashing reads file contents. It must therefore be covered by a documented policy for observing project changes. Permission for a role to write does not mean that the current task uses the project.

For a task without project access, the journal can correctly state that project changes were not measured. An unchanged snapshot shows unchanged contents, not an absence of reads. The task's resource needs and any technical access restrictions must be kept distinct; an instruction is not itself a sandbox.

How observation is selected for each run needs a separate design. The selection must not become a hidden classification process that starts inventorying the project before assessing the need.

## 3 Documents and presentation in the graph editor

### One source for each instruction

The recommendation is to display the role as formatted Markdown from the same source used during execution. The node's specific task is shown separately from the reusable role. A separately maintained summary must not replace the actual instructions.

The editor should let readers follow references to skills and governing documents and see whether their contents are included, merely referenced, or retrieved when needed. It must also be possible to inspect the call contract added by Maestro and, for an actual call, the assembled message. Known automatic provider context is reported separately, together with its limitations.

### Start with source text and a preview

The initial editing interface should provide Markdown source text with a preview. A form field should exist only if it corresponds to a defined field in the source format. Descriptive prose does not need to be broken into a new schema to be presented well.

Saving in the editor must update the canonical file. If several nodes use the same role, it must be clear that the change affects the shared role. Generated provider files must continue to be derived from the source. An ongoing run must retain the version of the instructions it started with; changes apply to subsequent calls according to an explicit versioning rule.

### Capabilities must be discoverable

An author needs a searchable list of capabilities that can be added and a clear list of those already enabled. These lists must explain what the capabilities do and how to use them. A proposed section of the agent description is "Available capabilities," with a readable explanation and a small example for each enabled capability. It appears in the node panel when needed and does not need to occupy space in the ordinary chat view.

"Suggest interactive work" is one example. Its documentation must explain when a question appears, which answers the user can give, and what those answers do to the run. The author can add the capability and a recommended instruction in the role or an explicitly linked skill. The editor must show the change before saving it.

Enabling a capability allows the agent to use it. The role instructions determine when doing so is appropriate. A sentence in a document does not create a new runtime capability by itself, and the editor must not offer capabilities unsupported by the selected adapter without making that limitation visible.

## 4 Proposal for switching to interactive work

### The agent recommends and the user chooses

The recommendation is a documented, structured request to Maestro. A possible working name is `request_interactive_handoff`. The exact name and technical format need to be established during implementation. The adapter can convey it as a tool call or another explicit control event. The runtime must not try to detect the request by searching ordinary reply text for particular words.

A proposed instruction for an entry agent is: "Assess whether the task benefits from the loop's work steps. If interactive work is a better fit, use the available capability to suggest a switch and give a short reason. Follow the user's choice. Do not suggest the same switch again for the same task after a refusal."

For example, the agent might say: "This can be handled with a targeted search. Would you like to continue interactively?" DSpatch displays two buttons in the same chat: "Continue interactively" and "Continue in the loop." A question within the conversation is recommended over a modal popup because it keeps the context where the user is already working.

### A switch must preserve continuity

1. The agent submits a request with a short reason. The task, original constraints, and existing results are identified from the run; they must not be replaced solely by the agent's paraphrase.
2. Maestro waits for the user's choice at a safe transition point. No subsequent graph step starts while the question is pending.
3. On "Continue interactively," loop mode is deactivated for further work on the task. The same visible conversation is retained. The task and relevant material are transferred, and the loop is recorded as handed over rather than delivered or failed.
4. The interactive agent continues the task already submitted, once. The user does not need to paste or send it again. If the session must change, DSpatch preserves the material without claiming that the model's internal memory transfers with it.
5. On "Continue in the loop," control returns to the step that requested the switch. The request does not count as a completed work result. Without an answer, the run waits; silence does not trigger a switch.

A request at the entry step should be made before work with side effects begins. For later transitions, Maestro must first handle ongoing tools and preserve work already produced. Switching modes must not revert files or start the same work in parallel.

### The next bounded development step

Have the agents investigate how this proposal fits the existing mechanisms for human decisions, control events, and sessions. They should propose the smallest reusable implementation and identify where it requires a new contract. Start with a transition at the entry step; apply the same principles to later transitions when they are introduced.

Keep this guideline as version-controlled Markdown in the repository and use the Word version for reading. A development prompt can refer to this document and scope a concrete increment. The prompt does not replace the lasting definition. Once adopted, Word versions should be exported from the Markdown source to avoid two independently edited sources of truth.

## 5 Orchestration and independent review share the agent connection

This clarification applies the decision in [VISION.md section 3.3](VISION.md#33-review-as-a-standalone-capability). The shared integration responsibilities are owned by [RUNTIME_PLATFORM_ROADMAP.md section 2](RUNTIME_PLATFORM_ROADMAP.md#keep-the-product-common). It does not introduce a second runtime contract or require a package split.

### Three responsibilities

Orchestration decides how work advances: which configured step runs next, what material it receives and how its outcome affects the task. The review capability helps a person understand and assess an identified change: code, walks, findings, review progress and decisions. The shared agent connection carries agent requests and observations through the existing AgentAdapter and provider-specific SDK adapters.

Both orchestration and review use that connection. Review does not call a provider SDK through a separate implementation, and it does not need to start Maestro to ask an agent a question. Shared integration includes authentication, tool control, cancellation and session handling, as specified in the roadmap. It does not mean the callers share one live session, one prompt, credentials across environments or unrestricted tools.

For example, a loop can produce a candidate and ask for review. The review capability receives the identified repository and change, optionally with requirements and evidence. Alternatively, a person can open the same change directly and request the same walkthrough. The agent connection should not require a graph-node identity merely to serve the second case. Specific interface adjustments remain implementation decisions for concrete tasks.

### Keep context useful and review independent

The implementer's explanation can identify design choices and areas of uncertainty. Verification results can show what was checked on a particular candidate. These save reconstruction work, but neither an explanation nor a passing test establishes the absence of defects. The review agent should check relevant claims against the code and distinguish observations from inferences.

Independence is defined by the review's instructions, evidence and assessment, not by duplicating the SDK integration. Reusing adapter code need not reuse the implementer's conversation. A review can start from a separate context and receive a bounded evidence package with provenance. The choice of session and supplied context should be explicit; a shared adapter alone proves no degree of review independence.

### Return findings without silently advancing the workflow

Review produces findings and decisions tied to the content assessed. If a DSpatch loop consumes them, its configured completion rules decide whether work advances, needs correction or waits for a person. An agent's acceptance must not silently become human approval. Outside DSpatch, the review remains useful without a task status or graph transition.

Keep the external development loop separate from the proposed product loop. The specialists currently helping build DSpatch are not evidence that the product already implements Maestro or the standalone review experience.

### Current implementation boundary

At the reported published state `982cb84` on 23 October 2026, DSP-109, DSP-115 and DSP-116 are complete. The Claude path has been exercised in the experiment program, including a live cancellation and a successful follow-up in the same adapter session. DSP-116's lifecycle corrections were verified offline. These results do not establish application restart recovery, cross-process session resume or Linux support.

DSP-117 is the planned connection to the application's chat. Its criteria include ledger records that keep provider work unknown after a stopped or forced end, and UI handling that never shows an unconfirmed stop as an ordinary cancel. Neither the review pilot nor a separate review application is implemented by these completed tasks. Task cards and their evidence remain authoritative for current status; this paragraph is a dated snapshot, not a second task ledger.

### Preserve the option to separate the product later

Review starts in the same repository with shared code. Its input should be usable without orchestration history so that it can retain value if another framework later drives development. Separate applications, packages and releases remain options. No server, plugin framework or broad refactoring is mandated by this boundary.
