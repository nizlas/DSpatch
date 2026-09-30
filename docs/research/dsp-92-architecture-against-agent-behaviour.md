# DSP-92: The architecture measured against the agent-behaviour guideline

Implementation review for DSP-92 part 2 · Reviewer · 22 September 2026

**Standard:** [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](../AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) v1, read in full before any code.
**State reviewed:** the working tree as it stands after DSP-91 landed on 22 September 2026.
**Entry points, not evidence:** `.dspatch-loop/runs/20260920-104500-folders/reports/029-researcher-why-the-agent-read-the-project.md` and `030-implementer-one-step-of-a-running-graph.md`. Every claim of theirs this document relies on was re-read in the code; where it was not, it is labelled.
**Verdict on the material:** **ACCEPT** for DSP-91's seven changes as an answer to what 029 traced. Four departures from the guideline remain, one of which (F13) is older than DSP-91 and outside what that card conditioned. None of them is a reason to rework DSP-91.

**Filed by the coordinator.** The Reviewer role writes no files and delivered this as its final response; the text below is that response, moved to the path DSP-92 named.

## 1 How to read this

Three evidence labels, used on every claim:

- **[code]** — established by reading the source in this tree. I read it myself.
- **[run]** — observed in a real run, in artefacts another role produced. I read the artefact; I did not reproduce the run.
- **[unknown]** — not established either way. Not zero.

Three finding classes, kept apart because the guideline asks for them to be:

- **Breaks a principle** — the behaviour is wrong against the standard.
- **Poor visibility** — the behaviour is right and a reader cannot see it.
- **Proposal not yet built** — §3.3 and §4 of the guideline. **That these are not built is not an architectural fault and is not reported as one.** What is reported is which existing mechanism a design could reuse and which contract is missing.

**The reviewer's own limits, stated rather than left to be inferred.** This role had no shell: the terminal refused every command on this machine for want of a sandbox backend. So it ran no build, no test and no probe, and nothing below is labelled [run] on its own authority. Everything under **[code]** is from reading files. The one bounded check it would otherwise have run — walking a drawing whose every agent step requires `no-file-writes`, to exercise the skip branch in §6 — is left in §8 as unknown.

Every substantial finding carries four things: **the principle**, **a concrete source**, **the practical consequence**, **the smallest reasonable next action**. Findings are numbered F1–F14; things that hold are numbered S1–S17 so they can be cited too.

## 2 Summary

| Guideline area | Standing |
|---|---|
| §1 Agent instructions define the way of working | **Sound.** The runtime contract carries no methodology at all. One role/contract contradiction left (F1). |
| §1 The task determines which process is needed | **Sound in the roles.** All eight role sources now make project reading conditional on the assignment. |
| §2 The runtime contract must be readable | **Right and invisible.** The contract is clean; two of its three constants appear on no screen (F4, F5). |
| §2 Three different locations serve different purposes | **Sound, by construction.** Three separate roots, two refusals, and the agent is told which is which. |
| §2 Observation is also runtime behavior | **Partly.** The loop's snapshot is conditioned and says when it measured nothing. A larger, older automatic read at project-open is outside that (F13). |
| §3 One source for each instruction | **Sound for the role.** The editor shows the same string the prompt sends. The Maestro half is described rather than shown (F4). |
| §3 Capabilities must be discoverable | **Proposal.** Rich machinery exists for restrictions and support; nothing exists for capabilities an author adds. |
| §4 Switching to interactive work | **Proposal.** More of it exists than the guideline assumes; three named contracts are missing. |

## 3 Where an agent's way of working is decided

### What holds

**S1 — The runtime contract contains no methodology. [code]** This is the load-bearing compliance finding of the whole review, so here is the complete set of text DSpatch adds around a role for an agent step, read off `chatPromptFor` (`app/src/shared/loop-chat.ts:763`) and the executor's two appends (`app/src/main/loop-live.ts:1672`):

1. `instructionPreamble` — the person's own words, verbatim, only when a message is pending.
2. `rolePreamble` — the role id, `ROLE_PROVENANCE`, and the role between two markers.
3. `ENGINE_PREAMBLE` — who is driving the run.
4. step identity — run id, step, visit, call, and that there is no history.
5. `describeWorkingRootsForAgent` — the folders, as addresses.
6. the mandate, verbatim.
7. the node's `purpose`.
8. `declarationInstructions` / `outcomeInstructions` — the names this node can be routed on.
9. `describeReceivedResults` / `describeRequiredResult`.

Every one is derived from the graph, from the run, or from the person. **None of them tells an agent to read the project, to produce code, or to write a report** — the last only appears when the drawing's `produces.form` is `markdown-file` *and* the drawing makes the step responsible for filing it (`describeRequiredResult`, `loop-live.ts:1238`). That is exactly what §2 asks: "It must not introduce hidden methodological requirements such as always reading the project, producing code, or writing a report file."

**S2 — The role reaches the provider whole, and a test says so. [code]** `ROLE_BLOCK_OPEN`/`ROLE_BLOCK_CLOSE` are deliberately fenceless so a Markdown role cannot end its own block early, and `app/tests/loop-chat.test.ts` asserts the markers and the provenance sentence are in the assembled prompt. "The role reached the provider" is therefore a checked property, not a claim.

**S3 — No unanchored resource path reaches an agent. [code]** `ROLE_PROVENANCE` (`loop-chat.ts:506`) replaced `role.sourcePath`, and it is emitted on the no-instructions branch too. The path survives on `RecordedAgentReply.role`, where a person can read it and an agent cannot mistake it for somewhere to go. This is the five-line defect 029 named, closed at the single point that serves every role and every definition.

**S4 — Project routines are conditional on the assignment, in one file per role. [code]** Read first-hand in `docs/loop/roles/dspatch-implementer.role.md` and `docs/loop/roles/run/dspatch-run-coordinator.role.md`. The implementer's Purpose now opens *"Your assignment decides what you read"*, and adds *"An explicit instruction not to read or change the project is part of the assignment and outranks every routine in this role."* The coordinator's Responsibilities open *"Read the mandate first, and let it decide whether the project needs reading at all."* No role was duplicated: the runnable graph's note that there is exactly one place each role is maintained is still true.

**S5 — The provider adds nothing from the project. [code] + [run]** `localOptionsFor` (`app/src/adapter/cursor-sdk-adapter.ts:268`) passes `cwd` and, above one root, `dirs`. It has never passed `settingSources`, and the SDK maps an absent value to every source off. So no working folder's `AGENTS.md`, `.cursor/rules` or `.cursor/skills` is loaded on DSpatch's path — **[code]**, from the option list and the SDK's own mapping. That a model could quote none of five tokens planted in those files is **[run]**, from 030 §1's canary probe, which the reviewer read but did not reproduce. The consequence matters for §1's table: what governs a loop agent is the role and task DSpatch sends it, so role wording is the right lever and DSP-91 pulled the right one.

### F1 — A role file asks for a `RESULT:` line the message does not offer

- **Principle.** §2: a call must not ask for something the graph cannot act on; §1: the graph owns declared outcomes.
- **Source.** `docs/loop/roles/run/dspatch-run-coordinator.role.md`, Delivery: *"Write a whole line, exactly in this form, using one of the names your own message lists"*, followed by an unconditional *"begin your reply with the word SPEC_ERROR … begin your reply with the word BLOCKED."* Meanwhile `declarationInstructions` and `outcomeInstructions` (`loop-chat.ts:568`, `:619`) are now conditional on the node's own declarations, and the `coordinator-report` node in `docs/loop/graphs/dspatch-development-loop-runnable.graph.json` declares neither outcomes nor failures.
- **Consequence.** Two, of different sizes. The observed one: that node invented a `RESULT:` line in all four DSP-91 walks, and not the same one twice **[run]** (030 open item 3). The latent one is worse and is **[code]**: `declaredFailureFrom` stays unconditional by design, `productIsDeclared` (`app/src/shared/loop-run.ts:820`) turns an undeclared failure into the runtime fault `undeclared-product`, and `fail()` stops the run under `stop-and-reconcile`. The check runs *after* the result is filed (`loop-run.ts:1348` then `:1366`). So a `coordinator-report` that finished the run's report and happened to open its reply with `SPEC_ERROR` would have its report filed and then fault the run at the last step. The same shape applies to `verifier`, which declares `blocked` only.
- **Smallest next action.** Make the role's Delivery section defer to the message it is in — one clause, *"and only if your own message lists names"* — extended to the SPEC_ERROR/BLOCKED sentence. Changing the drawing instead would work but adds edges nobody asked for.

### F2 — The engine paragraph is in two places

- **Principle.** §3: "One source for each instruction."
- **Source.** `ENGINE_PREAMBLE` (`loop-chat.ts:691`) now ships the *"you are one step inside a loop DSpatch is already walking"* paragraph to every step. The longer original is still in `dspatch-run-coordinator.role.md`'s Purpose, where it also names `.cursor/skills/dspatch-loop/SKILL.md` as a bare path.
- **Consequence.** Two texts about one fact, and the one that is wrong will be whichever nobody edited. The role's copy is the riskier of the two: it names a DSpatch path to an agent whose shell starts in a foreign project. It is anchored by the words "in the DSpatch repository", and `ROLE_PROVENANCE` now says outright not to look for such a file — so this is a residual risk rather than the 21 September defect. No run has shown it firing.
- **Smallest next action.** Cut the duplicated half of that paragraph from the role, keeping only what is genuinely role-specific: that this coordinator is not the Cursor-chat coordinator.

## 4 What the graph editor actually shows

### What holds

**S6 — The role a reader sees is the instruction that reaches the agent. [code]** `NodeInspector` resolves through the same `RoleResolver` that builds the prompt and renders `ResolvedRole.instructions` with the window's own Markdown reader (`app/src/renderer/LoopEditor.tsx:3436`, `:3627`). This is §3's recommendation — "display the role as formatted Markdown from the same source used during execution" — already built, not a proposal. The node's own task (`purpose`) is a separate field above it, which is §3's "The node's specific task is shown separately from the reusable role".

**S7 — Carried is separated from pointed-at, and both are named. [code]** `briefParts` (`loop-chat.ts:908`) lives in the same module as the prompt builder for exactly this reason, and every part carries a `carried` boolean the panel renders as *"in the message"* or *"pointed at, not included"*. `BRIEF_EXCLUSIONS` states the standing answer: the files a role text names are files the agent must open itself. That covers §2's "When the role text is already included in the message, this must be stated" and most of §3's "see whether their contents are included, merely referenced, or retrieved when needed".

**S8 — Stated is distinguished from enforced, in three states not two. [code]** The `Unhonoured` badge (`LoopEditor.tsx:3351`) distinguishes *inert*, *limited* and *stated, not enforced*, and its own comment gives the reason: `no-file-writes` is a flag and `no-subagent-delegation` is a sentence in a role file, and the format calls both "required". `requirementStandings` separates inherited from local from in-force. This is the honest register §2 asks for.

### F3 — `no-file-writes` is marked enforced on the strength of a mechanism the run path does not use

- **Principle.** §2: "The task's resource needs and any technical access restrictions must be kept distinct; an instruction is not itself a sandbox."
- **Source.** `TARGET_CAPABILITIES.cursor['no-file-writes'].status === 'enforced'`, with `how` naming *"`readonly: true` in a project agent definition"* (`app/src/shared/loop-graph.ts:150`). Project agent definitions are written by `role-generate.ts:201` for the external Cursor loop. On the live path `CursorSdkAdapter` loads no project settings at all (S5) and passes `tools: []` only under `toolPolicy: 'text-only'`, which `loop-live-run.ts:256` never selects.
- **Consequence.** In a DSpatch-walked run, `no-file-writes` is role prose and nothing else. The editor's badge will read *enforced* for it, and §6's snapshot decision treats it as decisive.
- **Smallest next action.** Split the cell by path: the same requirement is `enforced` for a Cursor project agent and `other-means` for the SDK adapter. `CapabilityAnswer` already carries `status`, `how` and `evidence`, so this is a table edit plus one caller, not a new mechanism.

### F4 — The contract Maestro adds is described in the panel but not shown

- **Principle.** §2: "This contract must be visible in the graph editor alongside the role instructions." §3: "It must also be possible to inspect the call contract added by Maestro."
- **Source.** `ENGINE_PREAMBLE` and `ROLE_PROVENANCE` are referenced nowhere outside `loop-chat.ts` — the whole tree was checked. `briefParts`'s `address` entry describes the run id, the step, the visit and the no-history sentence in prose of its own, and says nothing about the engine paragraph or the provenance sentence.
- **Consequence.** A reader of the node panel cannot learn that DSpatch tells every agent *"the loop is running: it is not something for you to design, build or demonstrate"*, or *"there is no role file, agent file or document about this loop inside those folders, do not look for one."* These are the two strongest instructions DSpatch adds and the two DSP-91 introduced. Worse for the standard: what the panel *does* show is a separately maintained paraphrase, which §3 says must not replace the actual instructions.
- **Smallest next action.** Both are module constants. Add two `BriefPart`s whose `detail` is the constant itself rather than a description of it — then the panel shows the exact string that is sent and cannot drift from it.

### F5 — No surface shows the assembled message for an actual call

- **Principle.** §3: "and, for an actual call, the assembled message."
- **Source.** `RecordedAgentReply.prompt` holds the whole prompt (`app/src/shared/loop-record.ts:295`) and `parseRunRecord` reads it back. The only readers are the scripted-trial harness `app/src/renderer/workflow-script.ts:1037` and the record parser. No user-facing surface reads it.
- **Consequence.** The data that would answer *what was this step actually told* exists, is bound to the step and the run, and is reachable only by opening a JSONL file under `%APPDATA%\DSpatch\loop-runs`. Report 029 could do its work because of this field; a person watching a run cannot.
- **Smallest next action.** A disclosure on the step's own entry in the run view showing the stored prompt verbatim. Read-only, one existing field, no new storage.

### F6 — The tool policy shapes every call and appears nowhere

- **Principle.** §1's table puts tool access under DSpatch and Maestro; §2 requires every control DSpatch introduces to be explicit and inspectable.
- **Source.** `loop-live-run.ts:256` constructs the adapter with `toolPolicy: 'provider-default'`, hardcoded. The alternative, `'text-only'`, passes `tools: []` and means the agent can only answer with text.
- **Consequence.** Whether a step can touch a file at all is a run-level decision made in one line of the main process, invisible in the editor, in the node panel and in the run record. A reader who wants to know what an agent could do has to read the source.
- **Smallest next action.** Report it as a run-level fact beside the folder list — it is not a per-node field and should not become one until a drawing needs it.

### F7 — "Recorded and not applied" is true of every node except the one where it is not

- **Principle.** §2: DSpatch must show what it sends.
- **Source.** The model fieldset's note reads *"Recorded and not applied. Which model a step runs on comes from the run, not from here"* (`LoopEditor.tsx:3761`). But `main.ts:3689` computes `modelForChatNode(entryNode, session.modelRequested)`, and that single value becomes `options.modelRequested`, which `loop-live.ts:1571` passes to **every** session the run opens. `node.model` is consulted nowhere else on the live path.
- **Consequence.** A `policy: 'fixed'` model on the entry node silently changes the model for all steps of the run, against a panel that says it changes nothing. On any other node it is ignored, as promised. The error direction is the dangerous one: the panel under-promises where the effect is largest.
- **Smallest next action.** Correct the one sentence: the entry node's choice sets the model for the whole run; other nodes' choices are recorded only.

### F8 — A person's mid-run message is carried well and shown nowhere

- **Principle.** §2: "The user's original task and explicit constraints must survive handoffs and rework."
- **Source.** `instructionPreamble` (`app/src/shared/loop-instruction.ts:230`) is sound work: the words are passed through whole between fenceless markers, attributed to the person, and prepended ahead of the role for the same stated reason the role precedes the mandate. But it is not a `BriefPart`, and the preamble does not say how the message ranks against the role or the mandate — it says only that it "may add context, correct a misunderstanding or change what is wanted".
- **Consequence.** The visibility half is small. The precedence half is not a patch: an interjection that contradicts the role has no stated winner, and the agent decides. Worth naming now, before something depends on it.
- **Smallest next action.** Add the `BriefPart`. Leave precedence to a decision — this is Niclas's, not an implementation choice.

## 5 Responsibility for the run and its results

### What holds

**S9 — Three locations, genuinely apart, held by refusals rather than by care. [code]** The loop's resources resolve from the definition's `resourceRoot` inside the main process (`loop-graph-roles.ts:44`); the working folders come from what the person has open (`workingRootsFrom`); run storage is `userData/loop-runs/<run>/results` (`main.ts:995`). `refuseLiveWorkingRoots` refuses a run whose roots are, contain or sit inside DSpatch. `loop-result-store.ts` refuses to write under a definition's `resourceRoot` or, by default, into a working root. And `RESULT_STORAGE_NOTE` (`loop-results.ts:236`) tells the agent which is which from both the reading and the writing side — closing the 21 September contradiction where an engine sent an agent outside the folders the run had named while the role text said to stay inside the project. This is §2's "Three different locations serve different purposes", met in code rather than in prose.

**S10 — What is promised and what is carried are one decision. [code]** `ChatStepIdentity.attachments` plus the executor building both trailing sections before the head (`loop-live.ts:1668`). A caller that says nothing promises nothing. §2's "A call must never promise a report path or attachment that is missing" — met, and pinned by a test that checks both directions.

**S11 — One body, stored once; presence and provenance, never quality. [code]** `loop-results.ts`'s three rules. A result carries run, node, visit and call, so a second Verifier receives the second Implementer's report. The runner never opens a body to judge it.

**S12 — A read-only step cannot be told to file its own report, and a machine says so. [code]** `loop-graph-load.ts:1453` errors on `no-file-writes` plus `report.writtenBy: self`, naming the 15 September 2026 failure it exists to prevent. `describeRequiredResult` emits nothing where another node is the writer, so the agent is not asked for a file it is not responsible for. §2's "If the role requires a report, the result contract must specify how it is delivered and who saves it" — met.

**S13 — The original mandate reaches every fresh session verbatim. [code]** `chatPromptFor`'s mandate block is repeated to every fresh agent, and only to fresh ones — a revisit continues its own session. So the implementer receives both the person's words and the coordinator's brief, in the same message.

### F9 — Nothing says which governs when a handed-over brief disagrees with the mandate

- **Principle.** §2: "A summary must not weaken *do not read the project* into *do not read the entire project*."
- **Source.** The message to a non-entry step carries the mandate verbatim, then the node's task, then — appended by the executor — the earlier step's whole result (`loop-live.ts:1674`, `describeReceivedResults`). Nothing in either block states precedence, and nothing can notice a weakening: `loop-results.ts` refuses to read a body for quality, by design and for a good reason.
- **Consequence.** 029's W2 is structurally unchanged: the paraphrase and the original travel together with no stated winner.

  **Correction, 22 September 2026 (coordinator).** The first version of this finding credited DSP-91 with putting the original mandate into later steps' messages, saying that on 21 September the softened version was all the implementer could compare against. **That is wrong**, and the run record contradicts it. In `chat-loop-2026-09-21T21-01-49-307Z.jsonl` the prompts for `implementer` (call 2) and `verifier` (call 3) each carry, before DSP-91, the block *"The run was started with this mandate. It is what the whole run is for:"* followed by the person's Swedish sentences verbatim, `Läs inte projektet` included. **[code]**, from the stored `reply.prompt` of both lines, read directly. Report 029 §5 was right and this finding's crediting paragraph was not. DSP-91 changed nothing about whether the original reaches a later step; it already did.

  What DSP-91 did add is the role instruction *"Carry the constraints through, in the words they arrived in"*, which held across two mandates and four walks **[run]** — one model, so it is an observation and not a property. The gap this finding names is therefore older and narrower than first written: both texts have long arrived together, and neither the message nor any role says which governs.
- **Smallest next action.** One sentence in the mandate block saying that where a handed-over result disagrees with this text, this text governs. It costs a line, it is checkable, and it does not require reading anybody's body.

### F10 — A finished step can fault the run by declaring a failure its node does not draw

- **Principle.** §1: the graph owns declared outcomes; §2: the contract must not ask for what cannot be acted on.
- **Source.** `productIsDeclared` → `undeclared-product` → `fail()` (`loop-run.ts:820`, `:1366`), which is deliberate and right — an undeclared refusal must fail loudly rather than pass quietly. The defect is the pairing with F1, which invites the words from a node that cannot route them.
- **Consequence.** As F1. Recorded separately because the runner's half is correct and should not be changed: fixing F1 is the whole fix.
- **Smallest next action.** None here. See F1.

### F11 — The researcher receives a brief written before the question existed

- **Principle.** §1: the graph owns inputs.
- **Source.** The `researcher` node's `consumes: ["coordinator"]`, reached only from `e03` (the implementer's `research-needed`). The drawing's own notes say so plainly and explain why: a node whose `consumes` cannot be satisfied on the path the run takes would stop the run, and the implementer has left nothing on its first visit.
- **Consequence.** The question that stopped the implementation has to be in the coordinator's brief or in the node's purpose, neither of which knew it would be asked. This is a drawing gap, documented, not a code defect — and it is **[unknown]** in effect: `e03` has never been walked, on any run.
- **Smallest next action.** Nothing until it is walked once. Manufacturing a `research-needed` to exercise it would be a run without a question, which is what 030 said and was right to say.

## 6 The task's use of the project

### What holds

**S14 — The snapshot decision reads the drawing and never the mandate. [code]** `writeReachOf` (`loop-graph.ts:801`) asks the only question the format can answer about writing — which steps require `no-file-writes`, with a gate always a writer and an external step a writer because unknown is not none — and `snapshotDecisionFor` (`loop-live-run.ts:225`) calls it once, before the walk, with the same resolver that validated the graph. This directly meets §2's hardest requirement in that section: "The selection must not become a hidden classification process that starts inventorying the project before assessing the need." Nothing in the project is read to decide whether to read the project.

**S15 — A skipped snapshot says it measured nothing, in the right register. [code]** `describeUnobservedOutside`'s `skippedBecause` branch (`working-roots.ts:424`): *"not observed is not the same as none, and nothing here corroborates or contradicts what any step said it did."* The note is written before the walk so the record and the behaviour are one decision. §2's "the journal can correctly state that project changes were not measured" — met.

**S16 — The folders are named as addresses, and the product says outright they are not a boundary. [code]** `describeWorkingRootsForAgent` names one folder as well as several and adds *"This is an address, not an instruction: whether this assignment needs anything in there read or changed at all is decided by the task below."* `WORKING_ROOTS_ISOLATION_NOTE` says Cursor's local agent runs with no filesystem confinement by default and that DSpatch has measured an agent reading and writing outside the folder it was given. §2's "an instruction is not itself a sandbox" is stated in the product, to the person, in the one place the wording lives.

**S17 — The three things §2 asks to be kept distinct are distinct in the code.** Permitted tools are `toolPolicy`; the task's actual need is the mandate plus the role's conditional; technical restriction is documented as absent. The distinction is real. Only the first is invisible (F6).

### F12 — The snapshot condition answers a different question from the one the guideline asks

This is the tension the assignment asked the reviewer to assess honestly, and to propose nothing about.

- **Principle.** §2: "Permission for a role to write does not mean that the current task uses the project."
- **Source.** DSP-91 conditioned hashing on `writeReachOf` — *may any step in this drawing write* — not on *does this task use the project*. `loop-graph.ts:773` states the choice and its reason in place.
- **Assessment, four parts.**
  1. **The guideline and the code are talking about different objects, and the code knows it.** The guideline's sentence is about a task. `writeReachOf` cannot see a task; it sees a drawing. DSP-91's own open item 2 says exactly this: "the card asked for the snapshot to stop on a run that does not use the project, and what is built stops it on a *drawing* that cannot use it, which is the only property available before the run." That is an accurate self-report, not a claim of compliance.
  2. **What DSP-91 got right is the part that is easy to get wrong.** The alternative — reading the mandate for words like *pi* or *demo*, or classifying the task before deciding — is precisely what §2's last paragraph forbids: "The selection must not become a hidden classification process that starts inventorying the project before assessing the need." A run whose observation behaviour turned on the text a person typed would be a worse breach than the one it fixed.
  3. **The saving is currently unreachable in practice.** `mayWrite` is true for every drawing in the repository, and `app/tests/loop-graph.test.ts:954` asserts that the runnable loop keeps its snapshots. So for real runs the measured cost 029 reported is unchanged, and the mechanism is exercised only by unit tests **[code]** and never live **[unknown]**.
  4. **There is a second-order risk pointing the other way.** The one drawing that *would* skip is one where every agent step requires `no-file-writes` — which on the live path is role prose and nothing else (F3). So the skip would fire exactly where the read-only guarantee is weakest, and would remove the only thing in the product that can contradict an agent claiming it changed nothing. That is not an argument for hashing always; it is an argument that the skip needs to be paired with something that makes read-only true.
- **Consequence.** The guideline's sentence is not yet satisfied, the code does not claim it is, and the gap is design work the guideline itself defers: "How observation is selected for each run needs a separate design."
- **Clarification, 22 September 2026 (coordinator), because point 2 above reads more narrowly than the guideline does.** §2 does not forbid judging a task's resource needs before the project is touched. What it forbids is a *hidden* classification that begins inventorying the project before the need has been assessed. Those are different things, and the difference matters for what DSP-93 may consider. Reading the mandate's words inside the engine to guess at a category is one design and a poor one. An agent that assesses the need from its own assignment, under instructions a person can read in the editor, is a different design and is not excluded by this principle — the judgement is visible, it is the agent's own, and it happens before anything in the project is opened. Both remain open for DSP-93. **Neither is designed here, and this clarification is not a recommendation between them.**
- **Smallest next action.** Record the tension where the decision lives. `writeReachOf`'s comment already explains the drawing-versus-mandate choice; add the guideline's sentence and the F3 caveat to it, and open a card for the selection design. Introduce no new mechanism inside this review.

### F13 — Opening a project reads and retains its bytes, before any task exists

- **Principle.** §2: "Automatic hashing reads file contents. It must therefore be covered by a documented policy for observing project changes."
- **Source.** `app/src/main/chat-service.ts:1052` calls `readGitWorkingCopyState`, and `:1075` calls `snapshotWorkspace(workspacePath, DEFAULT_SNAPSHOT_LIMITS, DEFAULT_RETENTION_LIMITS)`. The retention argument is the load-bearing part: `contents` becomes a map of **file bytes held in the main process**, bounded at 1 MB per file and 64 MB in total (`workspace-baseline.ts:79`). The comment beside the call says why, and the reason is good — a content diff has to be against the bytes the session started from.
- **Consequence.** A chat-window loop run happens inside an already-open project, so the project has already been fully hashed and partly retained before the run exists. `writeReachOf`'s skip therefore cannot deliver the property the guideline asks about on the path a person actually uses: even a drawing that could not write would run against a project DSpatch had already read in full. This is the older and larger of the two automatic observations, and DSP-91's record note does not mention it at all. It is not a DSP-91 regression; it is a gap in what DSP-91's condition can reach.
- **Smallest next action.** Bring it into the same policy and the same register — one sentence where the baseline is taken, saying what was read and retained, and name it in whatever card takes on the selection design. Do not change the behaviour in this step: the retained bytes are what the chat's own diff is built on.

### F14 — The loop still uses the crude snapshot, and the better one is already written

- **Principle.** §2: observation is runtime behaviour and has to be proportionate to what it is for.
- **Source.** `snapshotEveryRoot` (`loop-live.ts:487`) calls `snapshotTree` (`app/src/main/experiment-repo.ts:59`), which walks every directory, reads every file's bytes and skips only `.git`, `node_modules` and `artifacts`. `workspace-baseline.ts`'s own header says that is "right for a generated eight-file repository and wrong for somebody's actual project: it would hash `dist/`, `release/`, virtual environments and build output, which can be gigabytes, and it would block the main process while doing it." `snapshotWorkspace` is that answer, and takes its file list from `git ls-files` plus unignored untracked files. `loop-live.ts` imports only `snapshotIdFor` from that module.
- **Consequence.** For every drawing DSpatch ships — all of which may write — each agent step reads the whole tree twice, on the main process, including build output. 029 measured six such reads of a 4,734-file project **[run]**. DSP-91 made the read conditional and did not change what the read is.
- **Smallest next action.** Have `snapshotEveryRoot` use `snapshotWorkspace`'s file list. It is written, bounded, tested, and reports truncation rather than implying no further changes. The stated consequence — a change to a git-ignored file becomes invisible — has to be accepted deliberately, and the note the run record already carries is the place to say so.

## 7 What exists for the proposed features

**Nothing in this section is a fault.** §3.3 and §4 of the guideline are recommended designs. What follows is which existing mechanism a design could reuse and which contract is missing.

### Describing and exposing an agent's capabilities (§3.3)

**What is already there. [code]** More than the guideline's wording assumes, but pointed the other way. `REQUIREMENTS` with `REQUIREMENT_HELP` gives each one a readable name, a detail sentence and a `whenEmpty` sentence (`loop-node-help.ts:165`) — the guideline's "explain what the capabilities do" shape, applied to restrictions. `requirementStandings` answers *ticked here*, *stated by the role*, *in force*, which is the inherited-versus-local problem already solved. `TARGET_CAPABILITIES` is a requirement × target table whose cells carry `status`, `how` and `evidence`, with two of three targets deliberately `unknown` rather than guessed. `capabilityAnswer` and `loop-graph-load.ts:1435` already produce the finding *"`cursor` does not enforce it"* as a notice rather than a refusal. `ATTRIBUTE_SUPPORT` plus the three-state `Unhonoured` badge distinguish inert, limited and stated-not-enforced. And the adapter's own `CapabilityReport` is rendered in `App.tsx:6215`.

**What is missing.** Every mechanism above describes a **restriction** or **support for one**. Nothing describes a **capability an author can add** to an agent. There is no per-node capability list, no searchable catalogue, no "Available capabilities" section, and no small example per capability. Three concrete contract gaps: `REQUIREMENTS` is a closed five-member union in shared code, so a capability set would need to be open and described rather than enumerated; `CapabilityReport` is per-adapter and per-session, not per-node, so the guideline's "must not offer capabilities unsupported by the selected adapter" has no node-level place to be answered; and there is no field on `LoopNode` for an enabled capability at all. `TARGET_CAPABILITIES`' shape — thing × target → status, how, evidence — is the natural home for the adapter half, and is the reuse worth starting from.

### Human decisions, and moving between loop and interactive work (§4)

**What is already there, and it is substantial. [code]** `app/src/shared/loop-control.ts` is close to the mechanism §4 describes, built for a different reason. `LoopControlState` carries `mode: autonomous | interactive`, a pause request, what is in flight, what is held, and one spent release. `decideNextStep` orders its tests deliberately: bookkeeping never waits, a human node always waits in either mode before pause or mode are even consulted, a pause outranks a release, and a release is spent on one step. `controlPhase` cannot return `paused` while a step is in flight — which is §4's "safe transition point", already implemented and already defended by a comment about not claiming a stop you have not reached. The journal has `run-held`, `run-released`, `waiting-for-person` and `person-answered`, and `formatChatLiveLogLine` passes a waiting question through whole rather than summarising it. `awaiting-human` is a first-class `StepProduct`. And §4's continuity property is held by construction: `set-mode` touches `mode` and nothing else, with the comment stating why — "the mandate, the graph version, the history, the results and the budgets are not in this state at all, so switching mode has nothing to reset even by mistake." `instructionPreamble` is a working, verbatim, marked channel from the person into a running loop.

**Three missing contracts, named.**

1. **No channel from the agent to Maestro.** `AgentAdapter.send` takes a prompt and returns a run reference. The only inbound structured event is `approval.requested`, and the adapter reports `approvals: 'unsupported'` with no response path (`cursor-sdk-adapter.ts:115`). No custom tool is ever registered — `tools` is only ever `[]`. So `request_interactive_handoff` has no transport today. Worth flagging for whoever designs it: §4 forbids detecting the request by searching reply text, and the nearest existing compliant mechanism is a **declared outcome on a whole `RESULT:` line with an edge drawn for it** — which is not text-searching, but which makes the request part of the workflow the graph draws rather than a capability the role decides to use. The guideline puts it under capabilities. That tension belongs in the design card.
2. **`awaiting-human` ends a run rather than suspending it.** `loop-live.ts:1331` returns it for a human node, and `loop-control.ts`'s own header says collecting the answer is DSP-31 and is not built. §4 step 2 needs a *resumable* wait. What exists is a hold (resumable, but only for a step Maestro itself proposed) and an ending (not resumable). Those are the two halves; nothing joins them.
3. **There is no "handed over" ending.** `TerminalEnding` is `'success' | 'not-success'` (`loop-graph.ts:382`). §4 step 3 asks for a third that is neither delivered nor failed. That is a small, real format gap, and `formatVersion` exists for exactly this kind of addition.

**A boundary to hold, recorded by the coordinator on Niclas's instruction, 22 September 2026.** Releasing a held loop step by hand and moving the work to ordinary interactive chat are two different functions, and the overlap in `loop-control.ts` should not be allowed to merge them. A manual release says *run the next step now*: the loop continues, the graph still decides what follows, and the person has done nothing except lift a hold. A handover to interactive work says *this task stops being a walk through the graph*: the run ends as handed over, no further step is chosen, and the person is talking to one agent. That the second can reuse the first's safe-point machinery — `controlPhase` refusing to report paused while a step is in flight, the release spent on exactly one step — is a reason to share mechanism, not a reason to share a control or a concept. Whoever designs §4 should be able to state which of the two a given button does without qualification.

## 8 What is still unknown

Stated because missing measurements are unknown, not zero.

- **One model, one machine.** Everything labelled [run] is `composer-2` on Windows, four walks. The walk-1 invented-name defect is exactly the kind of thing that varies between models, so nothing here establishes that another model reads these prompts the same way.
- **The skip branch has never run live.** `writeReachOf`'s `mayWrite: false` path is unit-tested both ways and unreachable from any shipped drawing. This is the one bounded check the reviewer would have run; the role had no shell.
- **`e03` has never been walked.** The researcher's place in the loop, and F11's consequence, are unmeasured.
- **What reaches the model's context beyond the prompt.** 030's canary probe establishes that DSpatch's options read almost nothing off disk and that the model quoted none of five planted tokens **[run]**. That is one probe with one model, and `usageReporting` is `unknown` on this account, so there is no token accounting to cross-check it against.
- **Cost.** `readUsage` failed identically on all four DSP-91 walks with `feature_unavailable`, so the cost of those 20 provider turns is unmeasured.
- **The reviewer's own reading.** It read the code and the saved artefacts. It ran nothing.

## 9 Three prioritised next steps

1. **Make the coordinator role's Delivery section conditional on the message it arrives in (F1).** One clause in one role file. It removes an invented `RESULT:` line observed in every DSP-91 walk and closes the path by which a step that finished its work can fault the run at the last node. Cheapest fix in this document and the only one with an observed failure behind it.
2. **Show the contract, do not describe it (F4, and F5 behind it).** Turn `ENGINE_PREAMBLE` and `ROLE_PROVENANCE` into `BriefPart`s carrying their own literal text, and put the stored `RecordedAgentReply.prompt` behind a disclosure on the step. Both are existing values. Together they are the difference between a reader believing the panel and a reader being able to check it, which is what §2 and §3 are for. While there, correct the model note (F7) — one sentence, and it currently under-promises where the effect is largest.
3. **Open one card for observation policy, covering F12, F13 and F14 together.** They are the same subject and splitting them would produce three partial answers: what the loop hashes and when (F12's drawing-versus-task gap, left open deliberately), what opening a project already read and retained before any task existed (F13), and which snapshot function the loop should use (F14, where the better implementation is already written and tested). The guideline says this selection needs a separate design; this is what that design has to account for.

**This analysis is not a mandate to implement any of it.** Step 3 in particular is a decision for Niclas, not a patch.
