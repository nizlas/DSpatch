# Adaptive execution and shared context: working state

The mission's working memory ([BRIEF.md](BRIEF.md), section 6). The mission coordinator writes it before every outcome it names. Niclas may correct it between runs. A run reconciles this file with Git before it chooses anything.

## Where the mission stands

- **Status:** in progress. Night run `chat-loop-2026-11-14T01-36-57-404Z` began 14 November 2026. Mapping and plan done (planner, call 2); S1 reviewed and committed (calls 4–6); S2 reviewed and committed (calls 7–9); S3 reviewed and committed (calls 10–12); S4 reviewed and committed (calls 13–15); S5a reviewed and committed (calls 16–18); S5b reviewed and committed (calls 19–21); S6 reviewed and committed (calls 22–24); S7 reviewed and committed (calls 25–27); S9 researched and recorded (calls 28–29); S8 reviewed and committed (calls 30–32); S10 split into S10a–S10c; S10a reviewed and committed (calls 33–35); S10b reviewed and committed (calls 36–38); S10c reviewed after one rework round and committed (calls 39–43); S11 reviewed and committed (calls 44–46); S12 reviewed after one rework round and committed (calls 47–51); S13 reviewed and committed (calls 52–54); every planned sub-goal is reviewed; whole assessment (call 55) found two gaps; S14 reviewed and committed (calls 57–59); second whole assessment (call 60) returned `needs-decision`: everything required is reviewed except Q2, which only Niclas can settle; the run ends `needs-decision` (coordinator visit 21, call 61). Status then: **paused — needs Niclas's decision** (Q2); not reported complete, not approved.
- **Run `chat-loop-2026-11-14T08-41-01-671Z`** (started 14 November 2026): Niclas added **S15** to the scope in its mandate (BACKLOG proposals S3-rename and S7-restart; Q2 stays open and does not block it). Coordinator visit 1 of this run (call 1): reconciled, chose `implement` for S15 (decision 32); implemented (call 2), review `accept` (call 3); recorded and committed on coordinator visit 2 (call 4), then sent to a third whole assessment, since S15 was added after the second. Third assessment (mission-review, call 5): `needs-decision`, only Q2 open. The run ends `needs-decision` (coordinator visit 3, call 6). Status: **paused — needs Niclas's decision** (Q2); not reported complete, not approved.
- **Run `chat-loop-2026-11-14T09-03-54-467Z`** (started 14 November 2026): Niclas **extends the mission** in its mandate. He puts **Q2 (dialogue-based graph construction) in scope** explicitly, and adds a product scope of six requirement areas, R1–R6 (see *Extension of 14 November 2026* below). Completed work, S15 included, stays as it is. Coordinator visit 1 (call 1): reconciled with Git (below) and recorded the extension. There is no plan for R1–R6 yet, so the visit chose `plan` (decision 34). Status: **in progress**.
- **Run `chat-loop-2026-11-14T09-54-18-366Z`** (started 14 November 2026): Niclas's mandate continues the mission. The engine runs at `9fe95a9`, which holds S24 (`4c6e14f`). S16 is implemented and not reviewed; it goes through the implementer only for the account the review needs, then to independent review, and is committed only once review accepts it. The rest of the plan follows, S25 included, choosing the method under decision 39. He also restates the hover-text requirement (R7, below) as part of the approved scope. Status: **in progress**.
- **Reconciled on run `chat-loop-2026-11-14T09-54-18-366Z`, visit 1 (call 1):** HEAD `9fe95a9` on `main`. After `63890bd` (this file's plan commit), the only commits are `4c6e14f` (S24) and `9fe95a9` (this file, between runs). Both are recorded; nothing is unrecorded. The engine checkout `DSpatch-engine` is detached at `9fe95a9`, matching the mandate. Working copy: the one tracked change is S16's line in `app/scripts/run-tests.mjs` (`run-presentation.test.ts` added to the `loop` group). Untracked: S16's `app/src/shared/run-presentation.ts` (588 lines) and `app/tests/run-presentation.test.ts` (195 lines), both last written at 10:24 on 14 November, which fits call 7 of the earlier run. The rest is the known non-mission files. The kept branches `dspatch/run/chat-loop-2026-11-14T09-03-54-467Z/branches/v1/s16` and `.../s17` are still there. The stash is empty, and there are only the main and engine worktrees. Under `userData/loop-runs/chat-loop-2026-11-14T09-03-54-467Z/worktrees/branches/v1/` there are only empty folders, left by the failed fan-out. They are user data and are left alone. **S16's earlier checks are still valid:** none of the four modules S16 imports (`loop-activity`, `loop-run`, `loop-graph`, `loop-slices`) changed in `63890bd..9fe95a9`, which touched only `run-worktrees.ts`, `loop-live-run.ts`, their tests, GRAPH_FORMAT and this file. The implementer's account from call 7 is in that run's record (reply 6, node `implementer`).
- **Reconciled on run `chat-loop-2026-11-14T09-03-54-467Z`, visit 1:** HEAD `fa1854f` on `main`, which is this file's commit at the end of the previous run, after `9ec6902` (S15). There is nothing unrecorded since then. Working copy: only the untracked non-mission files named below; no tracked change. No `dspatch/*` branches, an empty stash, and only the main worktree and `DSpatch-engine` (detached at `2e22eb2`, the recorded engine commit).
- **Engine commit the runs use:** `9fe95a9` from run `chat-loop-2026-11-14T09-54-18-366Z` on, which includes S24 (`4c6e14f`). It was moved between runs by Niclas, and `DSpatch-engine` is detached there. Before that it was `2e22eb2`, from `C:\Users\nicla\development\DSpatch-engine` (moved from `c04536b` on 14 November 2026 between runs, at Niclas's request, after the first run had ended; client and host started through `start-engine.ps1` and recorded as `1.0.0 at 2e22eb205d1b`, host contract `a93c7907a2d9ebd5`). The engine checkout lags this working copy by the documentation commits that follow it; that is expected. Every run checks the engine commit and records a change here.
- **Working copy at the start of the first run:** HEAD `59bd24e` (DSP-208's last preparation commit). No mission commits. Untracked and **not mission work, leave alone and never commit with a sub-goal**: `_all.txt`, `_groups.csv`, `_live.txt`, `_loop.txt`, `_pack.txt`, `_status.txt`, `_tree.csv`, `_vision.diff` (dated 30 September 2026) and `docs/research/agent-framework-comparison/` (dated 1–15 October 2026). Sub-goal commits stage named paths only.
- **Last recorded commit of mission work:** `610fa1a` (S1), `5c3c1ae` (S2), `3fb6574` (S3), `b07ce40` (S4), `7797e94` (S5a), `7724c35` (S5b), `3fc547e` (S6), `0cc65a5` (S7), `3ec3639` (S9 record), `d516ceb` (S8), `af09a3f` (S10a), `812a42c` (S10b), `a8e49a9` (S10c), `6de7fd6` (S11), `0b50fd3` (S12), `bb7dba1` (S13), then the S14 commit made on coordinator visit 20 (`9ba0d86`), and S15 `9ec6902` (run `chat-loop-2026-11-14T08-41-01-671Z`), followed by this file's own commit at that run's end.
- **Reconciled on run `chat-loop-2026-11-14T08-41-01-671Z`, visit 1:** HEAD `3af3975` on `main`. After `9ba0d86` (S14): `e1d8ce2` (STATE, end of the night run), `b5e4185` (between-run fixes, run log line 2; it also fixed both wording nits — "a agent step" and the BACKLOG "(then)" line — so they are no longer open), `2e22eb2` (the mission loop's parallel path, run log line 3), `3af3975` (BRIEF and STATE: engine at `2e22eb2`). All are recorded in the run log; nothing unrecorded. Working copy: only the untracked non-mission files named above; no tracked change. No `dspatch/*` branches, empty stash, worktrees only main and `DSpatch-engine` (detached at `2e22eb2`, matching the recorded engine commit).
- **Sub-goal in progress:** none. The whole assessment was asked for on call 51 of run `chat-loop-2026-11-14T09-54-18-366Z`. S16, S17, S18a, S18b, S19, S19b, S20, S21, S21b, S22, S23a, S23b, S25 and S25b are reviewed and committed.
- **For Niclas's next engine transition:** host code changed in S19, S19b, S20, S21, S21b, S22, S23a and S23b. Rebuild `DSpatch-engine` at the commit this run ends on, then use **Restart host**. No host method was added, so the host contract is unchanged. Never do this during a run.
- **Engine transition of 14 November 2026:** the host contract changed (S5a's `answerLoopHandoff`), so the old client was closed and the old host ended the way End host does (after checking that no loop run was active), and the new build was started through `start-engine.ps1`.
- **Waiting on Niclas:** nothing blocks work. Q2 was answered on 14 November 2026: it is in scope. Q1, Q3, Q4 have recommendations and block nothing; Q4's condition is met. Decision 30 (manual continuation) is his to correct if he meant otherwise. His trials are listed per sub-goal.

## Extension of 14 November 2026: understandable workflows (R1–R6)

These are Niclas's requirements, given in run `chat-loop-2026-11-14T09-03-54-467Z`'s mandate (in English). They are condensed here so later runs keep them; the run record holds the full wording. They are **product requirements, not a prescribed breakdown**. Ordinary design choices within them are the mission's to make. Every requirement starts as **pending**.

**Goal.** Make DSpatch's workflows understandable to create, edit and follow. Niclas should be able to discuss a workflow in chat, get a real editable and executable graph, and follow its execution without reading interleaved streams from several agents. The user flow to support is: discuss a workflow → create and refine its graph → open and edit it → start it explicitly → follow progress and any parallel branches → inspect an unmistakable final report and the details behind it.

- **R1 — Create and revise graphs through conversation (Q2, now in scope).**
  - Use the existing graph format and runtime capabilities.
  - The result is a real loop in the loop editor: editable, saveable and executable through the normal app flow.
  - Later conversation revises the same graph.
  - Edits made in the editor are reconciled, never silently overwritten.
  - Changes are validated and their effect is shown.
  - A proposal is distinct from an applied change.
  - Creating or changing a graph never runs it.
  - Reuse the parallelism and dialogue-construction design document (§5, §6, §10); do not write a competing specification.
- **R2 — Readable graph layout.**
  - A clear main flow, with alternative paths and related stages arranged coherently.
  - Edges routed around unrelated nodes, with clear arrowheads and connections.
  - Rework and return paths distinct from the main flow.
  - Fewer crossings and less wasted space, with labels kept readable.
  - Works for small graphs and for graphs of about 25 nodes.
  - Positions stay stable during execution.
  - Manual layout is kept where supported, and automatic layout never silently destroys it.
  - Navigation, zoom, selection and editing stay usable.
  - Choose a maintainable approach after reading the code and dependencies; no hardcoded positions for one graph. A crossing-free layout is not required for arbitrary graphs.
- **R3 — Parallel execution visible without hover.**
  - A fan-out node shows a compact summary: branch count, and how many are working, finished, blocked or failed.
  - An obvious action opens the branches. Each branch shows its task, status and agent/model.
  - A branch's live output opens in a persistent detail view, with a separate window available to follow it beside the main view.
  - Hover may add detail, but never carries essential status or navigation.
  - Repeated visits and rework attempts are distinguished, so old branches never look current.
  - Reuse run events and mailbox data. Never imply a sent message was received or acknowledged when it was not.
- **R4 — A readable main chat during a loop run.**
  - Concise step reports with prominent headings: the node, the sub-goal where known, and the visit or rework attempt.
  - Labelled as step reports, not as the run's final report.
  - Progress and completed reports without a flood of tool calls or every intermediate utterance. Full text, tool activity and live output stay reachable through the node or branch detail view.
  - Parallel branch reports are grouped under their step or sub-goal, and the integrator's combined report is shown clearly.
  - Failures, questions and required user actions are visible in the main flow.
  - No extra model calls just for display summaries.
  - **Presentation is not agent context:**
    - every output and its provenance is kept;
    - collapsing, hiding or opening never changes what is saved or passed on;
    - the graph's context-delivery contracts hold;
    - full stored results are never replaced by UI summaries;
    - branch tool logs are not injected into every prompt.
- **R5 — An unmistakable end-of-run card, owned by the runtime.**
  - Every ended run gets one distinct final card: completed, waiting for a decision, blocked, limit spent, cancelled, runtime failure.
  - It never depends on an agent or a reporting node, and needs no extra model call. An agent's narrative may supplement it.
  - It shows:
    - overall status and why the run ended;
    - the assignment and the sub-goals this run addressed;
    - what was completed, what remains and what is blocked;
    - counts of agent steps, parallel branches and rework rounds, and elapsed time;
    - usage, without invented cost;
    - commits, and whether they are local or pushed, when known;
    - the user's next action, or "none required".
  - The counters are defined clearly. Sub-goals, node visits, branch invocations, provider API calls and tool calls are never conflated, and parallel work is never double-counted.
  - Status and counters come from the journal. Implementation claims are attributed to agent reports, and anything not available reads "unknown".
  - It keeps apart: this run's result and the mission's cumulative status; agent-reviewed and user-approved work; an ended run and an in-memory pause that can still continue.
  - After an app or host restart, an interrupted run reads as interrupted, never as complete or automatically resumable.
  - One authoritative card per run, with no duplicate on reopening; the full reports and journal stay behind links or expansion.
- **R6 — One logical implementer with a model-selection policy.**
  - Where small, medium and large implementer nodes differ only in model, one node with a policy replaces them. Role, assignment and downstream flow stay the same.
  - The policy is inspectable and editable.
  - Each invocation records the chosen provider/model and the reason, and the actual choice is shown during execution.
  - Configured provider availability, account boundaries, permissions and user choices are respected. No new paid service or extra billing.
  - Fixed-model graphs keep working.
  - Nodes whose responsibilities, tools or routing differ are not merged.
- **R7 — Hover text is short; full instructions live in a persistent, readable detail view** (Niclas, run `chat-loop-2026-11-14T09-54-18-366Z`'s mandate: "Preserve the full approved scope of the previous run, including the tooltip requirement: short user-facing hover text, with full instructions in a persistent readable detail view. Record it if it is missing from STATE.md"). It was missing here. The earlier run's recorded mandate does not use the word "tooltip": its R3 says "Hover may provide supplementary detail, but essential status and navigation must be visible without it." Niclas states R7 as part of that run's approved scope, so it is recorded as his requirement. It applies to every hover text that S18a–S23b and S25 add or change, in the graph editor, on the canvas, in the run view and in chat: a short label for the user, never the only place a status, an action or an instruction appears, with the full text in a detail view that stays open and can be read and selected. Existing long hover texts that these sub-goals touch are shortened the same way. Status: **pending**. Every UI brief repeats it.
- **Integration and ownership.** Define the shared interfaces first, before dependent changes diverge: graph editing, node visits, branches, reports, live output, final run status and model selection. Keep graph semantics, visual layout and execution presentation distinct.
- **Verification and operation (this mandate):**
  - AGENTS.md's verification policy, with minimal targeted checks. They matter most for changed saved formats, graph references, terminal-state reporting, and the preservation of execution and context behaviour. Valid results are reused.
  - No broad suites, Xvfb matrices, repeated verification packages or extra CI.
  - Niclas judges visual quality and usability himself. Automated checks never establish that a graph is visually clear. Leave him concise trial instructions.
  - Do not change or restart the running `DSpatch-engine` checkout. Record any engine rebuild or host restart for after the run.
  - Keep unrelated working-copy changes and user data. Commit reviewed increments locally; no release.
  - Keep implemented, reviewed, manually untested and blocked requirements apart.

## Mapping (planner, run `chat-loop-2026-11-14T01-36-57-404Z`, call 2)

Read from code by the planner; no files written by it. The planner's `RESULT:` line said `planned`, which is not a name its node declares, so the engine routed it as not-established; the content was complete and the coordinator accepted it as the plan. BRIEF.md §4 holds, with these additions:

- **Context.** The mandate is `request.mandate` alone (`host/project-host.ts`, about line 3065); the record stores `conversationId` but nothing reads it back. Reusable: `buildResendContext` (`main/chat-service.ts:580`, DSP-121 recap, speaker-labelled, no file contents); `RunRecordStore.listForConversation` (`main/run-record-store.ts:405`, display only); each step's whole prompt is on `agent-reply.prompt` and shown in the chat column. The loop uses the open chat session's provider (`resolveLoopProvider`, `main/loop-run-agent.ts:91`).
- **Routing.** `selectEdge` (`shared/loop-run.ts:891`); `declaredOutcomeFrom` (`shared/loop-chat.ts:564`) reads only the first word after `RESULT:`. A router taking its first outcome is done by the executor (`main/loop-live.ts:1649`). No skipped state in `JOURNAL_KINDS`, `RunStatus` or `NodeRunState` (`shared/loop-run-view.ts:46`).
- **Returning to chat.** No handoff, no `handed-over` status. DSpatch app tools (`AppTool`, `adapter/types.ts:167`) reach all three adapters; only chat sessions get them (`project-host.ts:607`), `loop-live.ts` passes none. `waiting-for-person` / `person-answered` journal kinds have no producer. The chat does not learn what a loop did.
- **Parallelism.** One walk, one node at a time; one loop run per host (`activeLoopRunRefusal`); worktree code only for review snapshots (`host/revision-snapshots.ts`); per-node provider sessions; steering into a running turn exists for Claude (`streamInput`) and Cursor (`Run.steer`) (DSP-147). No mailbox, no integrator.
- **Project instructions.** Claude's `settingSources: []` confirmed (`claude-agent-sdk-adapter.ts:196,221`); Copilot and Cursor equivalents not re-verified.

## Plan

Order: S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8, S9 (independent; may go earlier) → S10 → S11 → S12 → S13. Every sub-goal follows AGENTS.md, its verification policy included: targeted tests and the type check only.

| Id | Sub-goal | Depends on | Status | Attempts | Commit |
| --- | --- | --- | --- | --- | --- |
| S1 | Context snapshot builder (pure shared code) | — | reviewed | 1 | `610fa1a` |
| S2 | Carry the snapshot into the chat loop run | S1 | reviewed | 1 | `5c3c1ae` |
| S3 | "Skipped" as a visible state (engine, graph format, run view, editor) | — | reviewed | 1 | `3fb6574` |
| S4 | Adaptive route in the bundled chat loop (check skippable) | S3 | reviewed | 1 | `b07ce40` |
| S5a | Handoff request in the engine: node capability, app tool on loop steps, hold, explicit answer, `handed-over` | — | reviewed | 1 | `7797e94` |
| S5b | Handoff in the window: inline prompt and buttons; chat loop's work node enables it; role text; AGENT_BEHAVIOUR §4 status | S5a | reviewed | 1 | `7724c35` |
| S6 | Continue interactively without resubmitting | S5a, S5b, S1 | reviewed | 1 | `3fc547e` |
| S7 | The chat knows what a loop did (one-time run recap) | S1 | reviewed | 1 | `0cc65a5` |
| S8 | Reconcile the parallelism document; spec `fanOut` in GRAPH_FORMAT | — | reviewed | 1 | `d516ceb` |
| S9 | Research: installed SDK support for concurrency, mid-turn input, tools, cancel | — | done (research, recorded) | 1 | — (no files) |
| S10a | Fan-out format: `fanOut` field, `dspatch-slices` block parsing and validation, worktree and temporary-branch manager (pure and unit-tested; not yet run by the engine) | S8, S9 | reviewed | 1 | `af09a3f` |
| S10b | Fan-out in the engine: concurrent instances within one visit, session per instance, per-instance folder, journal kinds, cancel all, usage per branch, run view | S10a | reviewed | 1 | `812a42c` |
| S10c | Bundled parallel graph: slicer → fan-out implementer → integrator → review, with slicer and integrator roles | S10b | reviewed | 1 (one rework round) | `a8e49a9` |
| S11 | Mailbox between running branches | S10b, S9 | reviewed | 1 | `6de7fd6` |
| S12 | Run report with exact scope and provenance | S3 (S5, S10 add parts) | reviewed | 1 (one rework round) | `0b50fd3` |
| S13 | Documents and backlog (BACKLOG near-term follow-up line, AGENT_BEHAVIOUR §4 status) | those described | reviewed | 1 | `bb7dba1` |
| S14 | Run report completion: steps not reached (from the drawing the run used) and a "left for Niclas to examine" section built from recorded facts; one integrated run of the `loop` test group | S12 | reviewed | 1 | `9ba0d86` |
| S15 | Niclas's addition (14 November 2026): (a) renaming a node renames its id everywhere the drawing refers to it; (b) a removed loop recap stays removed after a restart; each with a targeted test | S3, S7 (both reviewed) | reviewed (sequential, decision 32) | 1 | `(DSP-209 S15)` in `git log`, after `3af3975` |

**Extension plan (planner, run `chat-loop-2026-11-14T09-03-54-467Z`, call 2; accepted on coordinator visit 2).** The planner wrote no files. Its full map is in that call's result in the run record. The key facts it read from code:
- the whole run uses one model, from the entry step (`loop-run-agent.ts:137-142`);
- edges are one quadratic curve between node centres with no obstacle avoidance (`GraphCanvas.tsx:171-202`);
- branch instances emit no live activity (`loop-live.ts:1822-1946`);
- `loop.saveGraph` writes with no check against disk (`project-host.ts:2160-2176`);
- chat sessions already get app tools (`project-host.ts:614`);
- no bundled graph has small, medium and large implementer nodes;
- there is no layout library in `app/package.json`.

Order: S16 ‖ S17 → S18a → S19, S22 → S20 → S21 → S18b → S23a → S23b.

| Id | Sub-goal | Req | Depends on | Status | Attempts | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| S16 | Shared run-presentation model, pure, in `shared/run-presentation.ts`: `VisitIdentity`, `BranchView`, `StepReport`, `LiveOutputAddress`, `RunCounters`, `ModelSelectionRecord`, journal folds | R3–R6 | — | **reviewed** (run `chat-loop-2026-11-14T09-54-18-366Z`, calls 2–4; see its record), committed as `(DSP-209 S16)` after `9fe95a9`. Earlier history: Attempt 1 (parallel) failed before any work, see *S16/S17 parallel attempt*; attempt 2 (sequential, decision 38) ended `done` on call 7 of run `chat-loop-2026-11-14T09-03-54-467Z`, and the run was paused before its review started. Its work is uncommitted: `app/src/shared/run-presentation.ts`, `app/tests/run-presentation.test.ts` and one line in `app/scripts/run-tests.mjs`. **Run `chat-loop-2026-11-14T09-54-18-366Z`, call 1:** sent to the implementer for the account the review needs only, with no reimplementation (decision 40). Then review, then commit | 2 | — |
| S17 | Graph-edit proposal model, pure, in `shared/graph-proposal.ts`: `GraphEditProposal`, `describeGraphChange`, `reconcileDisk`, `manualEditsSince` | R1 | — | **reviewed** (parallel, decision 41; see *S17 and S18a, parallel*) | 2 | `9d48c02`, merged `fdd2156`, test line `d6b2a3b` |
| S24 | Fan-out worktrees on Windows: each slice's worktree in a short folder (`w` + ten hex digits of a SHA-256 over run, node, visit and slice) under `%LOCALAPPDATA%\DSpatch\wt`, an owner file `<folder>.json` beside it, and `core.longpaths=true` on DSpatch's own git commands for that command only (`app/src/main/run-worktrees.ts`, `app/src/main/loop-live-run.ts`). A defect in S10a/S10b found by the S16/S17 attempt | — | — | **done between runs**, in the main chat at Niclas's request, commit `4c6e14f`; in the engine from the transition recorded under *Where the mission stands*. Checked by `app/tests/run-worktrees.test.ts` (a tracked path over 260 characters checks out, commits and is removed; the folder and owner file) and on DSpatch's own twelve failing files in a throwaway clone (all check out, longest full path 235; Node, Git Bash and PowerShell read them; `git status` clean without `core.longpaths`). Not yet run by a live fan-out | 1 | — |
| S25 | The loop control bar keeps the old *Pause requested* note after the run is paused: `LoopControlBar.tsx` holds the note `requestPause` returned (`main/loop-control-runtime.ts`) in its own state and clears it only on another action, so "Pause requested … still running" stays beside "Paused · No work step is running". Replace the note when the phase changes, or mark it as what was said when the pause was asked for. Found by Niclas on 14 November 2026. Two more observations of his from the same pause, for the same sub-goal: (b) **Cancel run** was greyed out in the loop editor while the run was paused, while **Stop** in the chat could end it; every control that shows a run should offer the same way to end it. (c) The graph should show where the run is paused and which step comes next: a finished step keeps its done state, the next step shows as waiting, not active, and when the next step is not yet decided the graph says so. Not to be built during an engine transition | R3, R7 | — | **reviewed** (see its record; (b) for chat runs only, the rest in S25b) | 1 | `(DSP-209 S25)` after `9a0205c` |
| S25b | S25's follow-up from its review. (N1, R7) the editor's compact control bar shows its phase explanation and its last note only in hover text, so they get a visible place and the mode hover is shortened. (N3) **Cancel run** for a `walk-loop` run the editor only watches. (N2) the chat marks a cancel from the editor as "stop requested" | R3, R7 | S25 | **reviewed** (see its record) | 1 | `(DSP-209 S25b)` after `3726249` |
| S18a | Edge routing around nodes; back and rework edges styled; node size by kind (`shared/loop-edge-routing.ts`, `GraphCanvas.tsx`) | R2, R7 | — | **reviewed** (parallel, decision 41; see *S17 and S18a, parallel*) | 1 | `52bc9c4`, merged `88a49dc`, test line `d6b2a3b` |
| S18b | Layered layout and an explicit **Arrange** action; places nodes that have no position (`shared/loop-layout.ts`) | R2, R7 | S18a (reviewed) | **reviewed** (see its record) | 1 | `(DSP-209 S18b)` after `77d2d37` |
| S19 | Per-step model selection: `fixed` honoured per step, `policy: "select"`, edge `selectsModel`, the choice recorded and shown | R6 | S16 | **reviewed** (parallel with S22, round 2; see *S19 and S22, parallel*) | 1 | `a9ea3dc`/`2798903`, `bcd8a8b`, `8323a90`, `fac761a`/`87b09ba`, `dbb2025` |
| S19b | S19's open review points: (1) Cursor and Copilot are not checked against a model list before a run, so the "never fall back silently" rule is unverified for them: add the check where the adapter offers a list, or record that it cannot be checked and say so in the refusal or node help; (2) `entryFromQuery` in `project-host.ts` leaves a `select` entry step out of the "Runs with …" line; (3) **a red test from S19**, found by S20's implementer and confirmed by its reviewer by reading: `modelOfStep` (`main/loop-live.ts`, l.1721 at `a3c7813`) reads `context.graph.edges` whenever `arrivedBy !== null`, so `tests/loop-activity.test.ts` "reports what happens while the turn runs…" throws (18 pass, 1 fail). Real runs set `arrivedBy`. S19's check list did not include that file | R6 | S19 | **reviewed** (see its record) | 1 | `(DSP-209 S19b)` after `a63e6a6` |
| S20 | Branches visible without hover: node summary, **Branches** panel, branch live output, a separate window | R3, R7 | S16, S18a, S19 (all reviewed) | **reviewed** (see its record) | 1 | `(DSP-209 S20)` after `a3c7813` |
| S21 | Step-report cards in chat, branches grouped, integrator's combined report, opt-in `SUBGOAL:` line | R4, R7 | S16, S20 (both reviewed) | **reviewed** after one rework round (see its record) | 1 | `(DSP-209 S21)` after `2fb244d` |
| S22 | Final run card owned by the runtime (`shared/loop-final-card.ts`); commits and upstream recorded in the ending; interrupted versus running | R5, R7 | S16 | **reviewed** (parallel with S19; see *S19 and S22, parallel*) | 1 | `4bce22c`/`a40d3b8`, `bcd8a8b` (test line), `151612c`/`0b0fb3d` |
| S23a | Graph tools on chat sessions (list, read, building blocks, propose); proposals stored on the conversation; never written to graph files, never run | R1 | S17, S18b (both reviewed) | **reviewed** (see its record) | 1 | `(DSP-209 S23a)` after `9f5caa6` |
| S23b | Proposal card with **Apply**, **Open in editor** and **Discard**; `expectedContentHash` on save; the editor reconciles with disk | R1, R7 | S17, S23a (both reviewed) | **reviewed** after one rework round (see its record) | 1 | `(DSP-209 S23b)` after `144624d` |
| S21b | S21's open S-a: read a `SUBGOAL:` line only from nodes that declare `subgoal`, as the S21 brief said. The reader is `subGoalClaimFrom` in `shared/run-presentation.ts` (l.412, used at l.554 and l.571), not `step-report-cards.ts` as first written here | R4 | S21 | **reviewed** (see its record) | 1 | `(DSP-209 S21b)` after `976df7d` |

The acceptance criteria and checks for each sub-goal are the planner's, from call 2. Each brief repeats the ones it needs. Section 3 of that result defines the R5 counters: sub-goal, agent step (node visit), branch invocation, rework round, calls, provider turns, tool calls, elapsed time and usage. S16 implements those definitions.

**After this run:** host code changes in S19, S20, S22, S23a and S23b. They need an engine rebuild and a **Restart host** at Niclas's next engine transition, never during this run. No new host method is planned (`remote-build.ts:25` hashes method names only).

Statuses:
- **pending**;
- **in progress**;
- **reviewed** (accepted by agent review; not Niclas's approval);
- **skipped** (with the reason; not met);
- **blocked**;
- **awaiting decision**.

### Sub-goal specifications

**S1 — Context snapshot builder.** New `app/src/shared/context-snapshot.ts` (reusing or extracting clipping from `buildResendContext`). From the conversation's saved messages, its earlier run records, repository state and the mandate, build a snapshot with an id (`ctx-<hash>`), its parts, and an account of what it holds and what was cut. The person's messages verbatim under a generous bound; agent answers clipped and labelled "the agent's words, not decisions"; earlier runs in the conversation (mandate, ending, terminal, skipped/handed-over steps); repository HEAD, branch, uncommitted changes; project instruction files present (references only); cuts named with conversation file and message numbers; no file contents. *Acceptance:* a later correction and the original both appear, in order, attributed to the person; agent text never under a decision label; a cut names what was left out and where; same input → same id; empty conversation → `null`. *Checks:* new unit test, type check.

**S2 — Carry the snapshot into the chat loop run.** Host builds the snapshot on *Use loop* (public accessor in `chat-service.ts`, `listForConversation`, git state). `chatPromptFor` gets a `context` option: the entry step gets the whole snapshot; later steps get the person's-words part. Record header gets optional `contextSnapshot` (id, conversation id, message numbers, cut flag); text saved as `loop-runs/<runId>/context.md`. Node panel's brief description lists the part. *Acceptance:* "implement that" entry prompt contains earlier decisions verbatim; shown in *prompt sent*, marked as supplied by DSpatch; no conversation → prompts byte-identical to before; old records parse, new field round-trips; a later run in the same conversation carries the earlier run's ending. *Areas:* `host/project-host.ts`, `shared/loop-chat.ts`, `shared/loop-record.ts`, `main/run-record-store.ts`, `main/chat-service.ts`. *Checks:* `loop-chat` tests, `loop-record` parse/round-trip, type check. *Niclas tries:* discuss, reject an approach, *Use loop* "implement that", open *prompt sent*.

**S3 — Skipped as a visible state.** Edge field `skips: [nodeId…]`, node field `required: true`; validation refuses skipping a required node, a terminal or the edge's own target. Additive journal kind `node-skipped` with the reason from the text after the outcome word on `RESULT:` (or "no reason given"); `RunResult.skipped`. Run view state `skipped` distinct from not-reached/finished/failed; editor edge panel shows `skips`; `loop-node-help.ts` explains. Outcome instruction asks for a reason where skipping edges exist. *Acceptance:* dry run journals `node-skipped` with reason; view marks it; skipping a required node refused; graphs without the fields unchanged. *Areas:* `shared/loop-graph.ts`, `loop-graph-load.ts`, `loop-run.ts`, `loop-run-view.ts`, `loop-chat.ts`, `renderer/GraphCanvas.tsx` + CSS, `docs/loop/GRAPH_FORMAT.md`. *Checks:* targeted validation, dry-run runner, view-folding tests; type check.

**S4 — Adaptive route in the bundled chat loop.** `work` gets an outcome such as `done-unchecked` along an edge with `skips: ["check"]` to a terminal saying check was skipped and why; work role says when skipping is right and that the reason is required. Development loop unchanged; mission loop is fixed and untouched. *Acceptance:* validates; dry run along it ends with check skipped and reason shown; transcript never says checked/met; ordinary path unchanged. *Areas:* `docs/loop/graphs/dspatch-chat-loop.graph.json`, its work role source, `shared/loop-transcript.ts`. *Niclas tries:* a one-line documentation question through *Use loop*.

**S5 — Recommend interactive work.** Node field `capabilities: ["suggest-interactive"]` shown in the node panel; `loop-live.ts` passes app tools to steps; tool `request_interactive_handoff(reason)` only for enabled nodes. Engine result kind `handoff-requested` after the turn settles; run holds through the control port; inline chat prompt with reason and "Continue interactively" / "Continue in the loop". Loop: same node revisited in the same session, tool refuses for the rest of the run. Interactive: new `RunStatus` `handed-over`, journal kind, record ending; transcript says handed over. Silence never switches; cancel still works. Chat loop's work node enables it; role gets AGENT_BEHAVIOUR §4 wording; §4 status line updated to say which decision it records. *Acceptance:* scripted adapter covers hold, prompt, revisit, refused second request, `handed-over`; not counted as a work result; permission policy unchanged. *Checks:* scripted runner tests, session-config test, record round-trip, type check.

**S6 — Continue interactively.** On `handed-over`, one chat turn into the conversation's session, idempotent by run id, with the mandate verbatim, snapshot reference, the run's decisions/results/questions/changed files and the reason; shown as DSpatch's handover, not the person's message; *Use loop* unticked; same tool policy. *Acceptance:* exactly one turn; contains mandate and account; nothing typed; no resend after restart; stored apart from person's text as `resentContext` is. *Checks:* `chat-service` test, `conversation-store` parse test, type check.

**S7 — The chat knows what a loop did.** Also carries S2's open review findings (i) and (ii) and S3's finding (iii): move `conversationMessages` off `mergedMessages`'s doc comment in `chat-service.ts`; move `SkippingRoute` / `skippingRoutesOf` off `outcomeInstructions`'s doc comment in `loop-chat.ts`; move the handoff code off `stepSessionId`'s doc comment in `loop-live.ts` (S5a finding i); make `chatLoopContextSnapshot` fall back to `null` with the failure recorded; S6 findings (i) the handover refused when the chat's current conversation is not the run's, and (ii) a handover send failing after the pre-check shown as one line in the chat. After any loop run in a conversation, the next chat turn is prefixed once with a disclosed, removable run recap (S1 builder, DSP-121 mechanism). *Acceptance:* first turn carries it, second not; visible and discardable; no run → no change. *Checks:* `chat-service` tests, type check.

**S8 — Reconcile parallelism.** Also (from S9): correct the Copilot app-tool caveat in `shared/loop-graph.ts` (~1004-1005) and GRAPH_FORMAT (decision 21); state the fan-out bounds and delivery choice (decisions 22, 23); read `docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md` and state whether branch-to-branch messages within one provider need any filtering — if the contract would need changing, that is a question for Niclas, not a change. Reconciliation section in `CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md` saying which §9 open decisions the vision settles (2–3 agents, worktrees for writers, single integrator, mailbox, slicer as a role), naming the first increment (one-level fan-out of one node with one integration point); GRAPH_FORMAT spec for `fanOut`, the slice block and S5's capability. Documentation only.

**S9 — SDK support research.** Table for installed Claude Agent SDK, Cursor SDK and Copilot SDK: concurrent sessions in one process, input during a turn, custom tools on the loop surface, cancel isolation; each row read-from-code / documented / observed / unknown. Every later support claim cites it.

**S10 — Fan-out node.** `fanOut: { slicesFrom, maxConcurrent ≤ 3, isolation: "worktree" | "shared-read-only" }`; fenced JSON slice block validated, overlapping write ownership refused; worktree per writer from a recorded base (HEAD or `git stash create`); concurrent instances with own sessions, `branch-started`/`branch-ended` kinds, per-instance usage; cancel aborts all; temporary branches `dspatch/run/<runId>/<slice>`; success or declared `branch-failed`; integrator role merges and checks contracts; worktrees removed at the end; run view instance states; new bundled graph slicer → fan-out implementer → integrator → review. *Acceptance:* two-slice dry run, separate journals, no double-counted calls; overlap refused; `maxConcurrent` honoured; cancel ends all; working copy untouched until integration; base recorded. If S9 shows concurrency is unsafe, shrink to `maxConcurrent: 1` with the finding stated.

**S11 — Mailbox.** `send_message`, `check_messages`, `acknowledge_message` for fan-out instances; one mailbox per run, additive kinds for sent/delivered/acknowledged; delivery at the next safe boundary (into a running turn where S9 shows it works, otherwise at `check_messages`), with non-immediate delivery stated; no blocking wait; messages to ended branches recorded undelivered; `contract-change` is a non-binding proposal for the integrator; person's instructions reach every instance. *Acceptance:* scripted two-instance run where A's message reaches B before B ends; delivery and acknowledgement separate; nothing waits without bound.

**S12 — Run report.** Also carries S11 findings (i) messages listed under the finished run, readable after it ends, and (ii) a person's instruction reported as delivered per branch from the journal, not when the mailbox takes it. Also carries S10c finding (ii): a fan-out stopped for too few calls must not read as "A branch failed" — say it was a bound. Also carries S4's finding (i): when a run ends at "Done, check skipped" and DSpatch's own before-and-after snapshots show changed files, the ending says so, as corroboration only, never routing. Ending summary from journal and record: path, skipped steps with reasons, handover, per-branch ownership and changed files, integrator, usage and cost per step and branch, what was reviewed and checked, what to try, "agent review is not your approval". Nothing inferred from prose; unknown says unknown.

**S13 — Documents and backlog.** Also proposes, as backlog candidates only, S7's open limitations: the recap rereads every run record on each run-state refresh and send (cache or track the last ended run); a recap removal is kept in memory until the next send, so a restart before sending offers it again. Dated line in BACKLOG.md's near-term follow-up pointing at this file (no duplicate entry); AGENT_BEHAVIOUR §4 status if S5 did not; INTERACTION_MODEL only where skipped / handed-over need naming. Backlog: note for DSP-31 that S5 builds the shared explicit-choice mechanism it should reuse (as a field-change proposal; the coordinator changes no other card).

**S15 — Rename follows references; recap removal survives a restart** (added by Niclas, 14 November 2026, in run `chat-loop-2026-11-14T08-41-01-671Z`'s mandate, from BACKLOG.md's *Proposal (S3)* and second *Proposal (S7)*). (a) `replaceNode` in `app/src/shared/loop-graph-editing.ts` today follows a rename into edges' `from`/`to`, the graph's `entry` and other nodes' `report.writtenBy`; it must also follow it into every edge's `skips` and `delivers`, every node's `consumes` and `fanOut.slicesFrom`, and any other field holding a node id. (b) `ChatService.removedLoopRecaps` (`app/src/main/chat-service.ts:1566`) is memory only; a removal must be stored so a restart before the next send does not offer that recap again. *Checks:* a targeted test for each in existing test files, the files' own runs, `npm run typecheck`. Brief: coordinator visit 1 of that run.

## Sub-goal records

### S1 — Context snapshot builder — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 2 (call 3); implemented (call 4, `done`); review `accept` (call 5); committed on coordinator visit 3 (call 6).
- **What was done.** New `app/src/shared/context-snapshot.ts`: `buildContextSnapshot(input)` returns `null` for no messages and no earlier runs, else `{ id: ctx-<16 hex>, conversationId, parts, message numbers, cut, cuts[], text, personWordsText }`. Person's messages verbatim as "Message N, the person wrote:" (8,000 chars per message, 60,000 total, oldest dropped first and named); agent answers under a heading saying they are not decisions or instructions, 6 most recent at 600 chars, every line quoted with `| `; every cut names message numbers, characters and "message N of conversation X"; instruction files as names only; repository as HEAD, branch and uncommitted paths (up to 100 named). A leading resent DSP-121 recap in a prompt is stripped. No Node built-ins (shared code is also type-checked for the renderer); id from a small in-module hash. `personWordsText` (mandate plus person's words) added for S2. New `app/tests/context-snapshot.test.ts` (one test per criterion) and one line in `app/scripts/run-tests.mjs` adding it to the `loop` group (the runner refuses unlisted test files). `chat-service.ts` untouched, so the DSP-121 recap is byte-identical.
- **Review verdict: accept.** All six criteria met by reading the code. Departures accepted: own `clipQuote` instead of extracting `clip` (it counts characters cut; keeps the recap untouched); `personWordsText` and the runner line. Non-blocking suggestions, carried into S2's brief: (a) record fields written bare (`ending`, `terminal`, skip `reason`, `handedOverFrom`, run ids, paths, instruction names) — a reason with a line break and `--- …` could look like a heading; put them on one line or quote them; (b) the id's fingerprint skips mandates of left-out earlier runs and uncommitted paths beyond the 100 named, so "same id" means "same shown content" — S2 decides and states which meaning holds; (c) limits untested on real conversations.
- **Checked, by the implementer only** (the reviewer read the code and did not rerun): `node --import ./scripts/ts-resolve.mjs --import ./scripts/test-offline-guard.mjs --test --test-timeout=30000 tests/context-snapshot.test.ts` in `app/` — 6/6 pass; `npm run typecheck` in `app/` — exit 0. No independent verification requested.
- **Niclas tries:** nothing yet; nothing in the product calls the builder until S2.
- **Steps skipped:** research (code settled it); independent verification (not asked for by the reviewer).

- **Correction found in S2 (14 November 2026):** S1's id hashed a template string of an object, so it covered "[object Object]" plus the message fingerprints and never the snapshot text. S1's tests passed by accident and S1's review missed it (the S2 reviewer says so). Criterion 4 was only partly met in `610fa1a`; fixed in the S2 commit.

### S2 — Carry the snapshot into the chat loop run — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 3 (call 6); implemented (call 7, `done`); review `accept` (call 8); committed on coordinator visit 4 (call 9).
- **What was done.** `context-snapshot.ts`: record fields put on one line (`withRecordFieldsOnOneLine`, all JavaScript line breaks); id covers every input (decision 11); `earlierRunFromRecord()` maps a run record (no ending gives "interrupted"); unknown git status says so. `loop-chat.ts`: `chatPromptFor` option `context` — entry step gets the whole snapshot, later steps `personWordsText`, after role, preamble and folders, before the mandate; absent gives byte-identical prompts; node panel part "The conversation the run was started from". `loop-record.ts`: optional header `contextSnapshot { id, conversationId, messageNumbers, cut }`, malformed ignored. `run-record-store.ts`: `writeContext(text)` to `loop-runs/<runId>/context.md`, a failed write recorded among failures. `chat-service.ts`: read-only `conversationMessages(conversationId)`. `project-host.ts`: `chatLoopContextSnapshot()` builds the snapshot before the run's record opens (own run filtered out), from the conversation's messages, `listForConversation`, `readGitWorkingCopyState`, and `fs.existsSync` for `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`; an empty conversation builds nothing and starts no git process.
- **Review verdict: accept.** Criteria 1, 2, 4, 5 met and tested; 3 and 6 met by reading, untested end to end; 7 met by construction. S1 review points (a) and (b) settled. Non-blocking findings, **open and carried into S7** (same files): (i) `chat-service.ts:4786–4798` — `conversationMessages` sits between `mergedMessages` and its doc comment; (ii) `chatLoopContextSnapshot` runs synchronously at run start with a synchronous git call — a throw should fall back to `null` and be recorded, since the snapshot is optional; (iii) the mandate appears twice per prompt, as briefed; harmless.
- **Checked, by the implementer only** (from `app/`, single files with `node --import ./scripts/ts-resolve.mjs --import ./scripts/test-offline-guard.mjs --test --test-timeout=30000`): `context-snapshot` 8/8, `loop-chat` 80/80 (existing unchanged), `run-record-store` 10/10, `loop-node-help` 28/28, `loop-record` 40/40; `npm run typecheck` exit 0. `chat-service` tests not run. The reviewer read the code and did not rerun. No independent verification requested.
- **Untested:** the host path end to end; *prompt sent* showing the block (by reading: it is the saved `agent-reply.prompt`); limits on real conversations; skipped and handed-over steps in earlier runs (not in records until S3/S5).
- **Niclas tries:** discuss a change in chat and reject one approach; tick **Use loop**, send "implement that"; open *prompt sent* for the first step (DSpatch context block with the rejection quoted) and a later step (only the person's words); check `context.md` in the run's folder under `loop-runs`; start a second run in the same conversation and check the first is listed.
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S3 — Skipped as a visible state — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 4 (call 9); implemented (call 10, `done`); review `accept` (call 11); committed on coordinator visit 5 (call 12).
- **What was done.** `loop-graph.ts`: optional `LoopEdge.skips` and `LoopNode.required` (empty `skips` read as none). `loop-graph-load.ts` refuses, each with its own finding: `skips-a-missing-node`, `skips-its-own-target`, `skips-its-own-source`, `skips-a-terminal`, `skips-a-required-node`, `bad-required`. `loop-graph-write.ts`: fixed key places; drawings without the fields save byte-identically. `loop-run.ts`: `node-skipped` appended to `JOURNAL_KINDS`; after `edge-taken`, one entry per skipped node with edge, deciding node and reason (one line, "no reason given" fallback); `RunResult.skipped`; reason travels as an optional `reason` on the step's result (the runner reads no prose). `loop-chat.ts`: `declaredReasonFrom()` (text after the outcome word; `declaredOutcomeFrom` unchanged); conversation line `“<label>” skipped: <reason>.`; prompt for a node with a skipping outcome names which outcome skips which steps and asks for a reason after the name ("starting with one of these names" for that node only); `skippingRoutesOf()` used by both prompt builders (`host/project-host.ts`, `main/loop-live-run.ts`). `main/loop-live.ts` passes the reason only when the step's own declared outcome is recorded. `loop-run-view.ts`: `skipped` state and mark; CSS in `loop-editor.css`. `LoopEditor.tsx`: edge field "Steps this connection skips", node box "Required — never skipped", texts from new `loop-node-help.ts` entries. `docs/loop/GRAPH_FORMAT.md`: section "Skipping a step on purpose". New `app/tests/loop-skips.test.ts` (9 tests, in the `loop` group); `loop-graph.test.ts` lists `required`.
- **Implementer's design choices:** reason on the step's result, not read by the engine from reply text; only outcome edges carry a reason (`success` and declared-failure edges may skip with "no reason given", stated in GRAPH_FORMAT); a skipped node reached later by another route is visited and shows its later state, while `RunResult.skipped` keeps the skip.
- **Review verdict: accept.** All six criteria met by reading; `selectEdge` untouched. Non-blocking findings: (i) the prompt says "that step is not run", but the engine only records the skip and validation does not check that the edge goes around the skipped step — **carried into S4** (draw the edge around it, and add a validation warning or soften the sentence); (ii) `declaredReasonFrom`'s comment says a `:` after the outcome word is dropped, but both readers take the first space-separated word, so `RESULT: quick: docs only` is not recognised — **carried into S4** (fix the comment or decide on a trailing `:`); (iii) `SkippingRoute` and `skippingRoutesOf` sit between `outcomeInstructions` and its doc comment in `loop-chat.ts` — **carried into S7** with S2's similar finding; (iv) renaming a node does not rename ids in `skips` (as for `delivers`); validation then reports `skips-a-missing-node` — open, stated limitation.
- **Checked, by the implementer only** (from `app/`, single files): `loop-skips` 9/9, `loop-graph` 41/41, `loop-graph-write` 5/5, `loop-graph-open` 12/12, `loop-run` 36/36, `loop-run-view` 32/32, `loop-chat` 80/80, `loop-node-help` 28/28, `loop-record` 40/40, `loop-transcript` 48/48, `loop-live` 67/67; `npm run typecheck` exit 0. The reviewer read the code and did not rerun. Line endings: the implementer restored CRLF in `project-host.ts` and `loop-live-run.ts` after a `sed -i`; the coordinator's `git diff --stat` showed only the real changes (397 insertions, 12 deletions over 15 files).
- **Untested:** the look of the editor panels and the skipped mark; the reason passing through the live executor in a real run.
- **Niclas tries:** in the loop editor, set an edge's "Steps this connection skips" to its own target and see the refusal; tick "Required — never skipped" on a node another edge skips and see that refusal; after S4, a one-line documentation question through **Use loop** showing check as **skipped** with the reason.
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S4 — Adaptive route in the bundled chat loop — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 5 (call 12); implemented (call 13, `done`); review `accept` (call 14); committed on coordinator visit 6 (call 15).
- **What was done.** `docs/loop/graphs/dspatch-chat-loop.graph.json`: `work` gains outcome `done-unchecked`; edge `e-unchecked` `work` → new terminal `check-skipped` ("Done, check skipped", `ending: "not-success"`) with `skips: ["check"]`, going around check; purpose and notes say `succeeded` always reaches check and name decision 12; `check` not required; limits unchanged. `project-work.role.md`: skip only when no file changed and the mandate was a question, reading or explanation; never after a change to code, build files, configuration or tests, or when unsure; reason required on the `RESULT:` line; wording conditional on the step offering `done-unchecked`. `loop-record.ts`: `CHECK_SKIPPED_TERMINAL` with its own ending sentences ("Nothing reviewed the work"). `loop-chat.ts`: window lookup has the new terminal and edge; shared `resultToken()` for both readers, removing one trailing `:` (decision 14). `loop-graph-load.ts`: warning `skipped-node-still-reachable` (settles S3 finding i). Tests: `loop-skips.test.ts` +5; four `loop-chat` tests that pinned the old node and outcome lists updated on purpose, plus an assertion that the only skipping edge goes around check.
- **Review verdict: accept.** Six criteria met by reading. Caveat: the ending-sentence test feeds outcome kind `verification-not-performed`; the reviewer did not confirm that a real host run at this terminal hands that kind — Niclas's trial. Non-blocking findings: (i) the rule against skipping after a change lives only in the role text; an agent that edits code and declares `done-unchecked` ends at "Done, check skipped" with nothing flagging it — **carried into S12** (an ending line when DSpatch's snapshots show changed files, as corroboration only, never routing); (ii) the packaged app's copies under `app/build/bundled/` and `app/release/` are git-ignored build output and hold the old graph until a rebuild — stated limitation.
- **Checked, by the implementer only** (from `app/`, single files): `loop-skips` 14/14, `loop-chat` 80/80, `loop-record` 40/40, `loop-transcript` 48/48, `loop-graph` 41/41, `loop-node-help` 28/28; `npm run typecheck` exit 0; before the last wording edits also `loop-activity`, `loop-agent-commands`, `loop-choice`, `loop-definition`, `loop-gate-check`, `loop-graph-open`, `loop-live`, `loop-provider`, `loop-run-audience`, `run-record-store`. The reviewer read the code and did not rerun.
- **Untested:** whether a real model picks `done-unchecked` as intended; the joined-up host path; the new terminal's position in the editor.
- **Niclas tries:** a one-line documentation question through **Use loop** — should end at "Done, check skipped" with check marked skipped and the reason shown; a small code change — should still go through "Check the work".
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S5a — Handoff request in the engine

- **Split (coordinator visit 6):** S5 split into S5a (engine, tool, hold, answer, status, record, transcript, host IPC) and S5b (renderer prompt, enabling it in the chat loop, role text, AGENT_BEHAVIOUR §4 status), so each part stays reviewable in one round. S6 depends on S5a and S5b.
- **Status: reviewed** (agent review, not Niclas's approval). Attempt 1: briefed on coordinator visit 6 (call 15); implemented (call 16, `done`); review `accept` (call 17); committed on coordinator visit 7 (call 18).
- **What was done.** Agent-node field `capabilities: ["suggest-interactive"]` (`loop-graph.ts`, support row says Copilot does not get the tool on loop steps; `loop-graph-load.ts` refusals `bad-capabilities`, `unknown-capability`, `capabilities-on-a-non-agent`; fixed writer key; help text; editor checkbox). `main/loop-live.ts`: `createHandoffTool()` / `offersHandoff()` — only an enabled node's session config gets `appTools`; empty reason refused; after the person chose the loop the tool returns an error and notes nothing; request read after the turn settles; the revisit gets one engine line appended to the prompt. `loop-run.ts`: appended kinds `handoff-requested`, `handoff-answered`; status `handed-over`; `StepExecution.handoff`, `RunResult.handedOver`, optional `RunControlPort.awaitHandoffAnswer`; handoff handled before the product is read (no `node-produced`, no edge, no result, not rework); "loop" revisits the same node as one more call (`limit-reached` if none left); "interactive" finishes `handed-over`; cancel during the hold ends as an ordinary cancel (`no-outcome-delivered`). `loop-control.ts`: `PendingHandoff`, `HandoffAnswerAction`, `handoffAnswerFrom()`, `StepHold` `'handoff'` (unused, see findings). `loop-control-runtime.ts`: `awaitHandoffAnswer()` with no timer; `answerHandoff()` refuses another run, another visit, nothing pending, a second answer. `resource-governor-control.ts` passes it through. Record reads `handed-over` as unresolved; transcript badge "handed over to interactive work"; run view shows waiting during the hold, stopped after a handover; conversation lines in `loop-chat.ts`. Host and bridge: `answerLoopHandoff()` in bridge, preload, `main.ts`, host contract and handler. With no control port (dry runs) the run continues in the loop and says so. Tests: new `loop-handoff.test.ts` (8), 3 end-to-end cases in `loop-live.test.ts`, `loop-graph.test.ts` field list.
- **Finding against S3 and S4 (and their reviews):** `tests/loop-control-run.test.ts` pins the journal-kind list and failed from S3's `node-skipped` onward; neither S3 nor S4 ran it, so `3fb6574` and `b07ce40` were committed with that test failing. Fixed in S5a (old kinds keep positions; appended kinds listed after `resource-governor`). Lesson for briefs: any change to `JOURNAL_KINDS` runs `loop-control-run`.
- **Review verdict: accept.** Six criteria met. Non-blocking findings: (i) third misplaced doc comment — `loop-live.ts:~1004`, `stepSessionId`'s comment now above `HANDOFF_TOOL_NAME` — **carried into S7**; (ii) the "loop" revisit sets `arrival = null`, so it takes inputs from the node's `consumes` rather than what its arriving edge delivered — **carried into S5b** (keep `arrival`); (iii) `StepHold` `'handoff'` is produced by nothing — **carried into S5b** (use it or drop it); (iv) host contract change — recorded under *Where the mission stands*. Coordinator's own finding: `capabilities` is not documented in `docs/loop/GRAPH_FORMAT.md` — **carried into S5b**.
- **Checked, by the implementer only** (from `app/`, single files): `loop-handoff` 8/8, `loop-live` 70/70, `loop-graph` 41/41, `loop-graph-write` 5/5, `loop-graph-open` 12/12, `loop-run` 36/36, `loop-run-view` 32/32, `loop-chat` 80/80, `loop-node-help` 28/28, `loop-record` 40/40, `loop-transcript` 48/48, `loop-control` 26/26, `loop-control-run` 15/15, `loop-skips` 14/14, `resource-governor-run` 7/7, `run-record-store` 10/10, `project-host-boundary` 2/2; `npm run typecheck` exit 0. The reviewer read the code and did not rerun.
- **Untested:** host startup's contract check; a real provider calling the tool; the checkbox's look. Copilot loop steps never get the tool.
- **Niclas tries:** nothing until S5b.
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S5b — Handoff in the window — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 7 (call 18); implemented (call 19, `done`); review `accept` (call 20); committed on coordinator visit 8 (call 21).
- **What was done.** New `app/src/renderer/handoff-prompt.ts` (pure view model: nothing for another run or no controlled run; answers carry `runId` and `visit`); `HandoffPrompt` in `LoopControlBar.tsx` (buttons disabled while sending; a refusal shows its note and re-enables; disappears with the request; opens nothing); placed under the control bar in `App.tsx`; styles in `styles.css`. `describeControl` takes the report's `handoff` and says "Waiting for you — … recommends continuing interactively…". Chat loop `work` gets `capabilities: ["suggest-interactive"]` with a note naming the decision. `project-work.role.md`: a conditional paragraph (call the tool with a reason and end the turn, preferably before changing files; follow the choice; never as the outcome). AGENT_BEHAVIOUR §4: status paragraph — decided by Niclas's 13 November authorisation (mission decision 4), built by S5a/S5b; steps 3–4 (continuing the task once) are S6. S5a finding (ii): the "loop" revisit keeps `arrival` (tested with a `delivers` edge). Finding (iii): `StepHold` `'handoff'` removed (decision 16). GRAPH_FORMAT: `capabilities` documented, section "What a step may do beyond its role". Tests: new `handoff-prompt.test.ts` (3), `loop-handoff.test.ts` +3.
- **Review verdict: accept.** Five criteria met by reading. Non-blocking findings: (i) the *Continue interactively* button's title promises "continue the work with the agent in this chat", true only once S6 lands — **carried into S6**; (ii) the React component itself is never rendered in a test (the renderer is tested through pure modules), so its button wiring rests on reading and the type check — stated limitation.
- **Checked, by the implementer only** (from `app/`, single files): `handoff-prompt` 3/3, `loop-handoff` 11/11, `loop-chat` 80/80, `loop-graph` 41/41, `loop-skips` 14/14, `loop-run` 36/36, `loop-control` 26/26, `loop-control-run` 15/15, `loop-node-help` 28/28, `loop-live` 70/70, `loop-transcript` 48/48; `npm run typecheck` exit 0. The reviewer read the code and did not rerun.
- **Untested:** the prompt's look and placement; a real Claude or Cursor step calling the tool (Copilot loop steps are never offered it); the packaged app's old graph until rebuilt; host contract change from S5a.
- **Niclas tries:** through **Use loop**, a task suited to conversation (a choice only he can make) — prompt with the reason, bar reads "Waiting for you"; **Continue in the loop** — same step carries on, no second prompt; in a new run, **Continue interactively** — run ends as handed over (continuing in the chat without resending comes with S6).
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S6 — Continue interactively without resubmitting — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 8 (call 21); implemented (call 22, `done`); review `accept` (call 23); committed on coordinator visit 9 (call 24).
- **What was done.** New `app/src/shared/handover-turn.ts`: `buildHandoverTurn()` (mandate verbatim, snapshot id as reference, steps and endings from the journal via `handoverStepsFrom()`, reason and last reply quoted as the agent's words, reply cut at 2,000 characters with the cut stated, changed files as names or "not known"/"none observed", supplied-by-DSpatch line, fields on one line) and `handoverLabel()`. `chat-service.ts`: `sendPrompt` and new `sendHandover()` share one `sendTurn` body (same session, provider, model, tool policy); `handoverRefusal()` refuses already-handed-over (this process or saved messages), no open session, a running chat turn; saved prompt `''`. `bridge.ts`: optional `StoredMessage.handover { runId, fromStep, text }` (decision 17); `conversation-store.ts` reads only this shape, older files as absent, damaged dropped. `project-host.ts`: records each step's reply by visit; on a not-cancelled `handed-over` ending builds the text and pre-checks; a refusal comes back as `handoverNote`, shown by `loop-transcript.ts` as "The task was not continued in the chat: …"; the send starts last in `finally`, after the working-copy lock is released. `context-snapshot.ts`: a handover never counts as the person's words; listed under "Turns DSpatch sent itself: not the person's words"; ids unchanged without one. DSP-121 recap labels it "DSpatch sent this, not the person"; output unchanged otherwise. Renderer: `turn-routing.ts` gives a handover's `run.started` an empty prompt; `HandoverMessage` label in `App.tsx` with the exact text behind a closed disclosure on saved messages; *Use loop* unticked after a handed-over ending (`loopStaysTickedAfter()`, decision 18); *Continue interactively* title corrected (S5b finding i). AGENT_BEHAVIOUR §4 status "decided and built". Tests: new `handover-turn.test.ts` (3); cases in `chat-service`, `conversation-store`, `context-snapshot`, `handoff-prompt`.
- **Review verdict: accept.** Six criteria met by reading. Non-blocking findings, **carried into S7** (same files): (i) `handoverRefusal`/`sendHandover` do not check that the chat service's current conversation is the run's `session.conversationId`; if the person switched conversation during the run the handover could land in another one — add the run's conversation id to the refusal; (ii) a send that fails after the pre-check (provider refusal, a chat turn starting in the gap) goes only to the host log and ledger — show one line in the chat column. Stated limitation: (iii) `pendingHandover` relies on the adapter emitting `run.started` inside `send`, the same assumption as the DSP-121 recap.
- **Checked, by the implementer only** (from `app/`, single files): `chat-service` whole file 72/72 (60 s timeout), `handover-turn` 3/3, `context-snapshot` 9/9, `conversation-store` 24/24, `handoff-prompt` 4/4, `loop-transcript` 48/48, `loop-handoff` 11/11, `run-record-store` 10/10, `loop-chat` 80/80; `npm run typecheck` exit 0. `JOURNAL_KINDS` unchanged. The reviewer read the code and did not rerun.
- **Untested:** the host path from a handed-over ending to the send; the label's look; a real provider; Copilot (never offered the tool on loop steps).
- **Niclas tries:** in a run that recommends interactive work, press **Continue interactively** — run ends handed over, *Use loop* unticks, the chat continues by itself with "Continued from the loop run — handed over by …", nothing typed; restart DSpatch and reopen — still shown as DSpatch's, no second send.
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S7 — The chat knows what a loop did — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 9 (call 24); implemented (call 25, `done`); review `accept` (call 26); committed on coordinator visit 10 (call 27).
- **What was done (Part A).** New `app/src/shared/loop-recap.ts`: `loopRecapRuns()` offers runs ended after the conversation's last saved message and not yet accounted for (a message carrying their recap, recording their removal, or being their handover turn); `buildLoopRecap()` quotes each mandate, the ending, skipped steps with reasons, any handover, changed file names, and says it is DSpatch's. A handed-over run whose handover turn never went out is recapped. `earlierRunFromRecord` (S1) now reads skipped steps and handovers from the journal (its "not recorded by this build" note was stale since S3/S5a); snapshot ids change for such runs, as decision 11 intends. `chat-service.ts`: `loopRecapFor` option supplied by the host from run records; computed at send; order DSP-121 recap, loop recap, person's words; a handover turn carries none; no run → unchanged text, saved shape and run state. Offered through `getRunState().pendingLoopRecap`: one line beside the composer, **Remove**, exact text behind a closed disclosure; Remove reuses DSP-121's `discardPendingRecap` with argument `'loop-recap'` (not a contract change — the contract counts method names). Stored in `StoredMessage.loopRecap { runIds, text }`, `text: null` records a removal (decision 19); `conversation-store.ts` reads only this shape. Labelled as DSpatch's in sent messages (`renderer/loop-recap-view.ts`, `App.tsx`), the snapshot and the DSP-121 recap.
- **What was done (Part B).** (1) The three doc comments are above their functions again (`chat-service.ts`, `loop-chat.ts`, `loop-live.ts`; existing mojibake left alone). (2) `contextSnapshotOrFailure()` turns a throw into no snapshot plus a sentence; the host logs it and records it through new `RunRecordWriter.noteFailure()`. (3) `handoverRefusal`/`sendHandover` take the run's conversation id and refuse another. (4) New `handover-not-sent` kind on the existing loop-instruction channel: one line "The task was not continued in the chat: <reason> Send a message to continue it yourself.", cleared on the next send. This closes S2 findings (i)(ii), S3 (iii), S5a (i), S6 (i)(ii).
- **Review verdict: accept.** Criteria 1–6 met by reading. Stated gap under criterion 2: a removal is kept in memory until a message is sent, so a restart between **Remove** and sending offers the recap again (still shown before sending). Non-blocking findings: (i) `pendingLoopRecap()` rereads and parses every run record on each `getRunState()` and send — may slow the window with many runs; (ii) the recap is rebuilt at send, so a run ending between display and send could be included unseen (unlikely: the working-copy lock separates loop runs and chat sends). Both, with the restart gap, **proposed as backlog candidates in S13**; open, not met.
- **Checked, by the implementer only** (from `app/`, single files): `chat-service` whole file 76/76 (60 s), `loop-recap` 2/2, `context-snapshot` 12/12, `conversation-store` 25/25, `loop-chat` 80/80, `loop-live` 70/70, `handover-turn` 3/3, `handoff-prompt` 4/4, `loop-transcript` 48/48, `run-record-store` 10/10, `loop-handoff` 11/11; `npm run typecheck` exit 0. `JOURNAL_KINDS` unchanged. The reviewer read the code and did not rerun.
- **Untested:** the host's recap source over the real run-record store; the snapshot failure path in the host; the `handover-not-sent` event; every window part.
- **Niclas tries:** after a loop run, the recap line beside the composer and its exact text; ask "what did the loop change?" — the answer knows the run; a second message carries no recap; after another run, **Remove** and send — nothing sent with it and not offered again.
- **Steps skipped:** research (code settled it); independent verification (not asked for).

### S8 — Reconcile parallelism — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 11 (call 29); implemented (call 30, `done`); review `accept` (call 31); committed on coordinator visit 12 (call 32).
- **What was done.** `docs/CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md`: new §10 "Reconciliation with adaptive execution, 14 November 2026" (§1–§9 unchanged) — settled by the vision, each quoting it: optional and bounded (2–3), worktrees for writers from a known base, bounded assignments with refused write overlap, one integrator (a role; it merges), a mailbox with delivery apart from acknowledgement and non-binding contract changes, no blocking wait, slicer only a role, no provider team feature, verification targets integration risk, cancel stops dispatch. Open: subgraph representation beyond one node, authoring versioning, contract changes with active instances, nested budgets, ownership enforcement beyond the worktree, branch recovery and per-branch cancel, Q3, Q2. First increment: fan-out of one agent node within one visit, one integration point, caps 3/3/1 (read from code), delivery at `check_messages`, cancel all. `docs/loop/GRAPH_FORMAT.md`: new section *Fan-out*, "Specified, not yet implemented (DSP-209 S10)" — field, `dspatch-slices` block and validation, per-adapter cap, base commit and worktree rule, what each branch receives, result (success / `branch-failed`), journal kinds `branch-started`/`branch-ended` and S11's message kinds, cancel, integrator role, five refusals with finding names. Copilot caveat corrected in `loop-graph.ts` and GRAPH_FORMAT (decision 21).
- **Content exclusion:** no filtering needed and no contract change — branches are sessions of the run's one provider and account with the same tool policy and file-read hooks; messages are agent-written text, the kind the contract's §6 already lists as unfiltered. Question raised for Niclas: Q4.
- **Review verdict: accept.** Four criteria met; every quoted vision passage found. Findings: (i) the implementer's own specification choices recorded as decision 24 (coordinator, this visit); (ii) branch session ids `stepSessionId(runId, nodeId + '#' + sliceId)` pass through `safe()`, which turns `#` into `-`, so node `work` slice `a` could collide with a node `work-a` — **carried into S10b**.
- **Checked, by the implementer only:** `loop-graph` 41/41, `loop-node-help` 28/28, `loop-handoff` 11/11, `npm run typecheck` exit 0. The reviewer checked the quotes and links by reading.
- **Niclas tries:** read §10 of the parallelism document and GRAPH_FORMAT's *Fan-out*.
- **Steps skipped:** independent verification (documents).

### S10 — split (coordinator visit 12)

S10 split into S10a (format, slice validation, worktree manager — pure and unit-tested), S10b (engine concurrency) and S10c (bundled graph and roles), decision 25. S11 depends on S10b; S12's branch parts on S10b.

### S10a — Fan-out format and worktree manager — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 12 (call 32); implemented (call 33, `done`); review `accept` (call 34); committed on coordinator visit 13 (call 35).
- **What was done.** `loop-graph.ts`: `fanOut` on agent nodes (`FanOutPolicy`, `FAN_OUT_MAX_CONCURRENT` 3, `BRANCH_FAILED`), support row `honoured: false`. `loop-graph-load.ts`: refusals `fan-out-on-a-non-agent`, `bad-fan-out`, `fan-out-slices-from-unusable`, `fan-out-with-handoff`, `fan-out-without-branch-failed`. `loop-graph-write.ts`: fixed key place after `capabilities`, one line. `loop-node-help.ts`: `FAN_OUT_HELP` (no editor control yet). `loop-run.ts`: runner guard refuses a fan-out node at its visit with the existing "never started" fault naming S10b; no journal kinds added. New `shared/loop-slices.ts`: `readSlices(resultText, { isolation })`, `MAX_SLICES` 6, `pathsOverlap`, `normaliseOwnedPath`, `isSafeSliceId`. New `main/run-worktrees.ts` with an injected `GitRunner` (argument lists, 30 s timeout, no shell): `baseCommit` (HEAD or `git stash create`, counts `untrackedNotIncluded`), `createWorktree` (refuses a root inside the repository; `check-ref-format`), `commitLeftovers` (author `DSpatch <dspatch@localhost>`, decision 26), `removeWorktree` (`--force`, keeps the branch), `listRunBranches`, `sliceBranch`, `runBranchPrefix`. GRAPH_FORMAT: status note, overlap rule (decision 26), the untracked-files gap of `git stash create`. Tests: new `loop-fan-out` (4), `loop-slices` (6), `run-worktrees` (4, heavy, on a temporary repository), `loop-graph` field list.
- **Review verdict: accept.** Five criteria met by reading. The reviewer confirmed with read-only git that the DSpatch working copy has no `dspatch/*` branches, no stash entries and only the main and engine worktrees (the coordinator confirmed the same on visit 13). Findings, **carried into S10b**: (i) a repository requiring signed commits could make `commitLeftovers` wait until the timeout — report it as a refused commit in its own words and keep the worktree; (ii) DSpatch's commit author is a choice that a hook's author policy could refuse — recorded as decision 26, failure reported as in (i); (iii) refuse `.git` as a first segment in `normaliseOwnedPath`; (iv) `removeWorktree --force` discards uncommitted work, so S10b must call `commitLeftovers` first on every ending, including cancel and faults.
- **Checked, by the implementer only** (from `app/`, single files): `loop-fan-out` 4/4, `loop-slices` 6/6, `run-worktrees` 4/4 (60 s), `loop-graph` 41/41, `loop-graph-write` 5/5, `loop-graph-open` 12/12, `loop-node-help` 28/28, `loop-run` 36/36, `loop-skips` 14/14, `loop-handoff` 11/11, `loop-chat` 80/80; `npm run typecheck` exit 0. The reviewer read the code and did not rerun.
- **Untested:** Windows long paths, paths with spaces, worktrees on another drive, hooks and signing; no editor control for `fanOut`.
- **Niclas tries:** nothing yet.
- **Steps skipped:** research (S9 and the spec settled it); independent verification (not asked for).

### S10b — Fan-out in the engine — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 13 (call 35); implemented (call 36, `done`); review `accept` (call 37); committed on coordinator visit 14 (call 38).
- **What was done.** `loop-run.ts`: `runFanOutVisit` replaces S10a's refusal — reads slices from the newest result `slicesFrom` filed; before any branch starts, invalid slices, too few calls, no project or no base end the node `branch-failed` with the reason and no worktree; one base for all branches; a pool of `min(effective, slices)` workers, `effective = min(maxConcurrent, FAN_OUT_ADAPTER_CAPS[provider])` (Claude 3, Copilot 3, Cursor 1); one call per instance, none for the node; after every instance, leftovers committed then worktree removed, a refused commit keeps the worktree with git's reason; success only when every branch finished; cancel ends as cancelled with every branch through the commit step. `StepContext.instance` (`FanOutInstance`), `FanOutDriver` interface, `instanceSessionId` (`…--node+visit+slice`, `+` never in a step id — S8 finding ii), appended kinds `branch-started`/`branch-ended`. `run-worktrees.ts`: `createWorktreeDriver`. `loop-live.ts`: contained `runInstance` path — own session and folder, no app tools, no handoff, no steering, no snapshots, only two appends to the shared record (decision 27); `describeBranchAssignment`; replies carry `sliceId`. `loop-live-run.ts` wires driver (worktrees beside the run's results) and cap. Host labels branch replies "‹step› · ‹slice›". `loop-run-view.ts`: `branchInstanceStates`, `describeBranchInstances`; canvas hover text and data attribute. Conversation lines "Branch “a” started./finished its turn./ended: ‹reason›.". `.git` first segment refused (S10a finding iii). Support row honoured; help and GRAPH_FORMAT status updated. Tests: new `loop-fan-out-run.test.ts` (7, heavy), a `loop-live` case, `loop-control-run` pins the kinds, `loop-fan-out` updated on purpose, a `.git` case.
- **Review verdict: accept.** Eight criteria met by reading. The reviewer and the coordinator confirmed by read-only git: no `dspatch/*` branches, empty stash, only main and engine worktrees. **Defect outside the criteria, carried into S10c (must be fixed before the drawing loops back to the fan-out):** branch name `dspatch/run/<runId>/<sliceId>` and worktree path `<worktreesRoot>/<sliceId>` omit the visit; since branches are kept and `createWorktree` refuses an existing branch, a second visit to a fan-out node fails every branch (`no-worktree`) and ends `branch-failed` — fails safely, untested. Non-blocking: (i) the node's `maxMinutes` is one deadline for the whole visit, so a late-starting branch has less time — state it in help, or per-branch deadlines; (ii) `shared-read-only` is read-only by instruction only — S10c's drawing should use `worktree`; (iii) branch replies are clipped in the node's stored result — the integrator must read the commits.
- **Checked, by the implementer only** (from `app/`, single files, 60 s): `loop-fan-out-run` 7/7, `loop-live` 71/71, `loop-fan-out` 4/4, `loop-slices` 6/6, `run-worktrees` 4/4, `loop-control-run` 15/15, `loop-run` 36/36, `loop-run-view` 32/32, `loop-chat` 80/80, `loop-transcript` 48/48, `loop-graph` 41/41, `loop-node-help` 28/28, `loop-graph-write` 5/5, `loop-skips` 14/14, `loop-handoff` 11/11, `loop-record` 40/40; `npm run typecheck` exit 0. The reviewer read the code and did not rerun.
- **Untested:** concurrent turns with any real provider; the Cursor cap through `runLiveGraph`; the hover text and chat labels; branches have no per-branch snapshot; a slow repository hook delays the visit.
- **Niclas tries:** nothing until S10c.
- **Steps skipped:** research (S9 settled it); independent verification (not asked for).

### S10c — Bundled parallel graph and roles — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 14 (call 38); implemented (call 39); review with one blocking finding, rework (call 40); reworked (call 41, `done`); review `accept` (call 42); committed on coordinator visit 15 (call 43). **Gap in the coordinator's evidence:** only the rework round's implementer and review accounts were handed to this visit; the first round's accounts were not. This record is reconstructed from the working copy, the rework accounts and read-only inspection; the first round's checks and its non-blocking suggestions are not known here beyond what the rework accounts quote.
- **What was done (from the working copy).** Second-visit fix: `sliceBranch(runId, nodeId, visit, sliceId)` → `dspatch/run/<runId>/<node>/v<visit>/<slice>` (node and visit in branch and worktree path), in `run-worktrees.ts`, `loop-run.ts`, `loop-live.ts`, GRAPH_FORMAT, tests `run-worktrees`, `loop-fan-out-run`. Fan-out help says `maxMinutes` bounds the whole visit (finding i). New `docs/loop/graphs/dspatch-parallel-loop.graph.json`: `slice` → `work` (fan-out) → `integrate` → `review`; terminals `done`, `not-met`, `not-established`, `branches-failed`, `stopped`; `integrate` outcomes `integrated`, `rework` (back to `work`, a second visit), `not-integrated`; `review` outcomes `met`, `rework` (back to `integrate`), `not-met`, `could-not-check`; limits `maxCalls` 14, `maxReworkRounds` 2, `maxMinutes` 60, recorded as guesses. New `.dspatch/loops/dspatch-parallel-loop.loop.json` (choosable like the others). New roles `project-slice.role.md`, `project-branch.role.md`, `project-integrate.role.md`. New `app/tests/loop-parallel-loop.test.ts` (6, including a test pinning the integrator's protective sentences).
- **Review verdict: accept after one rework round.** Blocking finding (round 1): the integrator role did not protect the person's uncommitted work — fixed: run `git status` first; never stash, commit, reset, check out, discard or move aside the person's changes; compare a branch with its base commit to see the slice's own changes; when `git merge` refuses, stop with `BLOCKED` and name the files. Clarification fixed: on a rework visit merge only the new visit's branches; never revert a merge without saying so. Open, non-blocking: (i) with uncommitted changes to tracked files, every branch's base holds them (decision 6), so `git merge` will refuse and the integrator stops `BLOCKED` — safe, but the loop only reaches a merge on a clean working copy (or untracked-only changes); **say so in GRAPH_FORMAT and the loop's description — carried into S11**; (ii) a fan-out with too few calls left ends at the `branches-failed` terminal ("A branch failed"), which reads as a branch failing rather than a bound — marked for later by the reviewer; **carried into S12**.
- **Checked, by the implementer only (rework round):** `loop-parallel-loop` 6/6, `role-generate` 27/27, `loop-choice` 36/36 (single files from `app/`). First-round checks: not handed to the coordinator. The coordinator confirmed by read-only git: no `dspatch/*` branches, empty stash, only main and engine worktrees.
- **Untested:** any live run; whether a model follows the integrator's rules when a merge meets uncommitted changes.
- **Niclas tries:** in an isolated profile (`npm run dev -- --isolated-profile <folder>`) on a throwaway git repository, choose **Parallel loop** and give a small two-part change: the slicer splits it, two branches run with their states on the fan-out node, the integrator merges and names what it merged, review checks; afterwards the temporary branches `dspatch/run/<runId>/work/v1/<slice>` are listed and kept. Then once with an uncommitted change: the integrator should stop with `BLOCKED` and name the files. A billed run; concurrency caps are not observed.
- **Steps skipped:** research (S9 settled it); independent verification (not asked for).

### S11 — Mailbox between running branches — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 15 (call 43); implemented (call 44, `done`); review `accept` (call 45); committed on coordinator visit 16 (call 46).
- **What was done.** New `app/src/shared/run-mailbox.ts`: one mailbox per fan-out visit; message `{ id, from, to (slice | "all" | "integrator"), purpose (finding | question | contract-change | instruction), body, contractRef?, critical?, base, branch }`; bounds 4,000 characters per body and 20 messages per branch per visit (decision 28); `openProposals()`. `loop-run.ts`: appended kinds `message-sent`, `message-delivered`, `message-acknowledged`, `message-undelivered`; each branch gets a port bound to its slice; run option `takeInstructions`; a branch is marked ended before its commit so late messages are refused; messages and open proposals go into the fan-out node's stored result. `loop-live.ts`: `createMailboxTools` — `send_message`, `check_messages`, `acknowledge_message` — the only app tools a branch gets, each returning at once; no wait tool; delivery only at `check_messages`. Host: branch prompts no longer take from the instruction queue; `takeInstructions` turns queued instructions into one message from "the person" to every branch not yet ended (including waiting slices) at the first `check_messages`, and appends them to `chatLoopGiven` so later steps still see them (decision 29). Conversation lines for the four kinds (sender, recipient, purpose, body quoted as the sender's words, the delivery limit). Run view: message counts on the fan-out node's hover. Roles: branch role says when to check, what to send, to acknowledge, never to wait; integrator role resolves or rejects open proposals by name. Docs: GRAPH_FORMAT covers the mailbox and limits; S10c finding (i) — a clean working copy is needed for a merge — stated in GRAPH_FORMAT, the parallel loop's definition and graph notes. Tests: new `run-mailbox` (5), `loop-mailbox-run` (4); `loop-live` (branches get exactly the three tools); `loop-control-run` pins the four kinds.
- **Review verdict: accept.** Seven criteria met by reading. Non-blocking findings: (i) messages are readable in the chat column only while the fan-out runs; afterwards they remain in the fan-out node's stored result and the journal but not under the run's entry in the chat — the brief's point 7 falls short; **carried into S12** (the run report lists them); (ii) the chat posts "delivered" for a person's instruction when the mailbox takes it, though a branch that never checks gets it recorded undelivered in the journal — **carried into S12** (report delivery per branch from the journal); (iii) messages to `"integrator"` have no live recipient; the integrator learns of them from the stored result — by design.
- **Checked, by the implementer only** (from `app/`, single files, 60 s): `run-mailbox` 5/5, `loop-mailbox-run` 4/4, `loop-fan-out-run` 7/7, `loop-fan-out` 4/4, `loop-live` 71/71, `loop-control-run` 15/15, `loop-chat` 80/80, `loop-transcript` 48/48, `loop-run-view` 32/32, `loop-parallel-loop` 6/6, `role-generate` 27/27, `loop-run` 36/36, `loop-graph` 41/41, `loop-node-help` 28/28, `loop-handoff` 11/11; `npm run typecheck` exit 0. The reviewer and coordinator confirmed by read-only git: no `dspatch/*` branches, empty stash, only main and engine worktrees.
- **Untested:** a real model using the three tools; the window path for an instruction (`takeInstructions` by reading and type check only); the hover counts.
- **Niclas tries:** in the parallel loop, on a clean throwaway repository, a two-part change where one part's finding matters to the other; read the messages (sent, delivered, acknowledged) and the hover counts; send an instruction during the fan-out and see it reach both branches. A billed run; concurrency caps not observed.
- **Steps skipped:** research (S9 settled it); independent verification (not asked for).

### S12 — Run report — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 16 (call 46); implemented (call 47); review with one blocking finding, rework (call 48); reworked (call 49, `done`); review `accept` (call 50); committed on coordinator visit 17 (call 51). **Gap in the coordinator's evidence:** as with S10c, only the rework round's accounts were handed to this visit; this record is reconstructed from the working copy and those accounts.
- **What was done (from the working copy).** New `app/src/shared/loop-run-report.ts`: `buildRunReport(input)` and `runReportText(report)`, with sections for path, skipped steps, handover (`handoverLines`), fan-outs (`fanOutLines`: base and per-branch slice, owned paths, ending, branch, commit or kept worktree), messages (`messageLines`, bodies via `quoteBody`, per-recipient delivery from the journal), integration and open proposals (`integrationLines`), usage and cost per step and branch (`usageLines`), what was reviewed and checked (`reviewedLines`), changed files (`fileLines`), `checkSkippedCorroboration` (S4 finding i), and the closing "Agent review is not your approval." Changes in `loop-run.ts`, `loop-record.ts` (ending fields such as `sessions`, `handover`), `run-mailbox.ts`, `loop-instruction.ts` (S11 finding ii, the live line), `loop-transcript.ts`, `bridge.ts`, `project-host.ts` and `renderer/App.tsx` (report under the run's ending). New `app/tests/loop-run-report.test.ts` (7).
- **Review verdict: accept after one rework round.** Blocking finding (round 1): the report decided which steps reviewed anything by matching words in step names (`CHECK_WORDS`) — inference from names, not records. Fixed: "What was reviewed and checked" lists every visit that declared an outcome as "its own verdict, not checked by DSpatch", gates marked from the drawing's configuration, commands DSpatch ran itself, skipped steps by label, the check-skipped-while-files-changed line, and otherwise "No step declared a verdict, and DSpatch ran no check of its own." Also taken: skipped steps named by label; damaged `sessions`/`handover` ending fields read "not recorded". Open: steps not reached are not listed (the record does not hold the graph's steps). The reviewer read the `handover` shape check only through the implementer's account and test.
- **Checked, by the implementer only (rework round):** `loop-run-report` 7/7, `loop-transcript` 48/48, `npm run typecheck` exit 0. First-round checks were not handed to the coordinator. The coordinator confirmed by read-only git: no `dspatch/*` branches, empty stash.
- **Untested:** the folded report's look in the window; the host writing `sessions` and `handover` into a live record; per-branch costs from a real provider.
- **Niclas tries:** after any loop run, open the report under its ending; after a parallel-loop run, check branches, commits, messages and costs against what happened; restart DSpatch and check the report is still there.
- **Steps skipped:** research; independent verification (not asked for).

### S13 — Documents and backlog — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 17 (call 51); implemented (call 52, `done`); review `accept` (call 53); committed on coordinator visit 18 (call 54).
- **What was done.** `BACKLOG.md`, under the existing *Near-term follow-up: adaptive loops and interactive chat* (no new section): a dated 14 November 2026 entry "DSP-209's night run" listing S1–S12 by outcome, pointing to this file, saying all is agent-reviewed and not approved; seven follow-up candidates marked *Proposal* with sources (S7 ×3, S3 rename, S10a/b per-branch cancel, deadlines, snapshots and Windows/signing cases, S12 steps not reached, the DSP-31 note). No card under `backlog/tasks/` changed. `docs/INTERACTION_MODEL.md` §9: three new states — skipped (S3), waiting for the person's choice (S5a/S5b), handed over (S5a) — introduced as authorised on 13 November 2026 (BRIEF §3). Consistency fixes (wording): AGENT_BEHAVIOUR's opening paragraph no longer calls §4 unapproved; GRAPH_FORMAT's fan-out status note (S10c, S11, S12 built; only the editor control missing), journal kinds "appended", mailbox paragraph "sent, not delivered"; `loop-graph.ts` `fanOut` support-row string (wording only).
- **Review verdict: accept.** Five criteria met; no remaining wrong Copilot caveat outside the mission's records. Suggestion (not blocking): the 13 November BACKLOG line saying the mission "has not started yet" is left as history; one word such as "(then)" would avoid misreading — left open as a wording nit.
- **Checked, by the implementer only:** `loop-graph` 41/41, `loop-node-help` 28/28, `npm run typecheck` exit 0.
- **Niclas tries:** read BACKLOG.md's new entry.
- **Steps skipped:** independent verification (documents).

### S16 — Shared run-presentation model — reviewed (agent review, not Niclas's approval)

- **Attempts.** Attempt 1, in run `chat-loop-2026-11-14T09-03-54-467Z`, went parallel and failed before any work (`no-worktree`, see below). Attempt 2 was sequential (decision 38): implemented on call 7 of that run (`done`), and that run was paused before review. In run `chat-loop-2026-11-14T09-54-18-366Z`, the coordinator sent it to the implementer for an account only on call 1 (decision 40). The account came back on call 2 (`done`): no code changed and nothing was rerun. Review returned `accept` on call 3, in round 1 with no rework. It was recorded and committed on coordinator visit 2 (call 4).
- **What was done.** There is a new pure module, `app/src/shared/run-presentation.ts` (588 lines, no Node built-ins), and a new test, `app/tests/run-presentation.test.ts` (6 tests). One line in `app/scripts/run-tests.mjs` puts the test in the `loop` group.
  - **Types:** `VisitIdentity`, `BranchView`, `StepReport`, `LiveOutputAddress` (the existing `StepAddress` plus an optional `sliceId`), `RunCounters` (each counter defined in a doc comment) and `ModelSelectionRecord` (type only).
  - **Folds:** `visitsFromJournal`, `branchViewsFromJournal`, `stepReportsFrom` and `runCountersFrom`. They only read existing journal entries.
  - **Nothing else changed:** no journal kind, record format, prompt, `loop-chat.ts`, existing export or `branchInstanceStates`.
- **The contract S19–S22 build on, beyond the brief** (review suggestion S3, recorded here):
  - `StepReport.sliceId: string | null`, set only on `branch` reports;
  - the exports `liveOutputAddressFor`, `TASK_NOT_RECORDED`, `JournalVisit`, `PresentationReply`, `SliceSource` and `BranchState`.
- **Interpretations the review accepted:**
  - **Integrator:** found by structure, as a step whose arriving edge `delivers` a node that has branch lines.
  - **Branch states:** `finished` reads finished, `not-started` reads cancelled, and every other ending reads failed. `queued` appears only before the run ends, for the open latest visit.
  - **`attention`:** failure, then question, then action.
  - **Messages:** assigned to the latest visit of their node.
  - **Not yet filled:** `model` stays `null` until S19 and `subGoal` until S21. `toolCalls` reads "not recorded" and `providerApiCalls` reads `'unknown'`.
- **Review verdict: accept.** All five criteria were met by reading the code, and the journal field names were checked against `loop-run.ts`'s writes. The implementer's open question about a resolved `awaiting-human` was settled: it is written only just before the run ends, so it can never be resolved later in the same run. Non-blocking suggestions, **open and carried forward**:
  - **S1:** any step whose arriving edge delivers a fan-out's result is labelled `integrator`, a reviewer included. S21 or S22 decides this before the label reaches the UI.
  - **S2:** the test for criterion 3 asserts the total step count, not the fan-out's own count.
  - **S3:** name the contract additions. Done in this record and in the commit message.
  - **S4:** a branch that never got a worktree reads `failed`. The UI (S20) should show its `ending` word as well.
- **Checked:** `run-presentation.test.ts` 6 of 6, `loop-run-view.test.ts` 32 of 32 and `npm run typecheck` exit 0, all from call 7 of the earlier run. They were reused, not rerun: none of S16's imports changed in `63890bd..9fe95a9`, and neither the account nor the review changed any code. The reviewer reran nothing. No independent verification was asked for.
- **Untested:** S16 has never run on a real runtime journal (the field names were matched by reading); overlapping visits; a fan-out that wrote no branch lines (`fanOutBound`).
- **Niclas tries:** nothing. S16 has no UI until S20–S22.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S21b — The sub-goal line only from declaring nodes — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 12 (call 48, decision 53). Implemented on call 49 (`done`). Review `accept` on call 50, round 1. Recorded and committed on coordinator visit 13 (call 51). `git status` showed exactly the seven files the implementer named.
- **What was done:**
  - `stepReportsFrom` in `run-presentation.ts` takes an optional `subGoalNodes` set and reads a claim only for those nodes. A branch reads one only when its fan-out node is in the set, and no set means no claims.
  - The host (`project-host.ts`) sets an optional `declaresSubGoal: true` on the live chat-loop reply event when the walked drawing declares `subgoal` on that node. This touches `bridge.ts`.
  - `App.tsx` keeps the flag, and `loop-transcript.ts` builds the set from flagged replies.
  - Two tests were updated to the new rule.
  - Unchanged: prompts, `SUBGOAL_ASK`, the graph format, stored records, delivery, the integrator rule and the host contract (no new method).
- **Behaviour change and known limit:** a run read back from its record shows **no** sub-goal claims, even from a declaring node, because records do not hold `declares`. S21 showed them by reading every reply.
  - Showing them again needs an additive `declares` data field on `node-entered`, of the same kind S19 and S20 added.
  - That is within the mission's authority, since the ban on changing stored records came from the coordinator's S21b brief, not from Niclas. It is left open, and the whole assessment may brief it.
- **Review verdict: accept.** All three criteria are met. Open points:
  - It is not checked whether a branch's own prompt asks for the `SUBGOAL:` line. If it does not, branches of a declaring fan-out will usually show no claim. That is harmless.
- **Checked by the implementer** (the reviewer reused these): `run-presentation` 7/7, `step-report-cards` 4/4, `loop-transcript` 48/48, `npm run typecheck` exit 0.
- **Niclas tries,** within S21's trial after the transition: a step whose node does not declare `subgoal` never shows a sub-goal in its heading.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S23b — Proposal card, Apply, and reconciling with the editor — reviewed (agent review, not Niclas's approval)

- **Attempt 1.** Run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 11 (call 43, decision 52) and implemented on call 44 (`done`). The round-1 review (call 45) asked for rework on one blocking finding, B1. The implementer reworked it on call 46 (`done`), and the round-2 review accepted it on call 47. Recorded and committed on coordinator visit 12 (call 48). `git status` showed 11 modified and 3 new files, as the implementer listed.
- **What was done:**
  - **Proposal card.** The new `renderer/GraphProposalCard.tsx`, in the chat, reads **Proposal — not applied** until applied. It shows as visible text:
    - the full paths it writes;
    - the change summary;
    - the findings;
    - the agent's words, labelled as such;
    - the status.
    
    Its actions are **Apply**, **Open in editor** and **Discard**. A superseded or discarded proposal offers no Apply. Hover labels are short (R7).
  - **Apply.** The new `host/graph-save.ts` and the `loop.saveGraph` handler in `project-host.ts` take an optional `expectedContentHash`. Apply refuses, writing nothing, when:
    - the disk content is stale, in which case the status becomes `conflict` (S17's `applyProposal`);
    - any target is outside the open project folders, checked with `path.relative` for the graph, the definition and each role file;
    - a chat or editor run of that graph is active in this host.
    
    A new-loop Apply writes only absent files. Apply never starts a run. `chat-service.ts` saves the proposal's status.
  - **The editor.**
    - Its saves send their base hash, so a stale save is refused as `stale-base` and the editor offers **Reload**.
    - On focus it uses `reconcileDisk`. A clean editor reloads; a dirty one gets the existing question.
    - New loops appear in the list.
  - **Departures from the brief, accepted by review and recorded here:**
    - an extra optional `proposal` field on the save request;
    - a `refused` save outcome;
    - a `dspatch:graph-proposals` push event;
    - `openLoopEditor(graphPath?)`;
    - from the rework, `UnsavedDrawing.baseContentHash`.
    
    All are optional, and none is a host method. **Restart host** is enough.
  - **Parallelism document.** A dated addendum to §10 of `docs/CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md` records Niclas's 14 November decision and what S17, S23a and S23b built. §5 and §6 are unchanged.
  - **Tests.** New `tests/graph-save.test.ts` (7 tests), in the `loop` group.
- **Round-1 finding B1, fixed.** The unsaved-drawing question's Save sent only `{ path, text }`, so a stale editor could replace an applied proposal unchecked.
  - The editor now registers its drawing with its base hash.
  - `drawingSaveRequest` (in `graph-proposal.ts`) turns that hash into `expectedContentHash`.
  - `writeUnsavedDrawing` in `main.ts` returns the host's refusal note and keeps the drawing registered.
  - Tested.
- **Review verdict: accept** (round 2). All six criteria are met and tested.
  - The reviewer took two things on the implementer's word: that the question's four callers stop on a note, and that main passes the registration on unchanged.
  - **Open, and important (A1):** in this workspace DSpatch is the open project, so Apply can write the mission graph and definition, which are BRIEF §5's fixed files. This host's active-run check cannot see the run in `DSpatch-engine`. The running engine reads its own checkout, so the running mission is not affected, but a careless Apply would change the mission's own drawing in the working copy. Decision 52 leaves protection of BRIEF §5's files to the mission's rules, not to the product. **Niclas: never apply a proposal against the mission loop in this workspace while the mission is in use.**
  - **Other open points:**
    - a failed write can leave a new loop half written, with the status still `proposed`;
    - a change between the check and the write is not caught;
    - Discard comes back as `refused`, reason `discarded`;
    - cards are drawn together after the transcript, not beside their message;
    - the card, the focus reconcile and the question path have no tests of their own.
- **Checked:**
  - rerun in round 2: `graph-save` 7/7, `graph-proposal` 51/51, `npm run typecheck` exit 0;
  - from round 1: `graph-authoring-tools` 6/6, `conversation-store` 27/27, `chat-service` 77/77, plus `window-zoom` 18/18, `project-host-boundary` 2/2, `review-model` 36/36 and `review-discussion` 18/18.
- **Untested:** the whole flow in a real window. Host code needs the engine transition and **Restart host**.
- **Niclas tries,** after the transition, preferably in a throwaway project rather than this repository (A1):
  1. Discuss a workflow in chat and get a proposal card. Read its paths and changes, and **Apply**. No run should start.
  2. Change it in the editor and save, then ask the chat to revise. An older proposal's Apply should show the conflict.
  3. **Discard** a proposal: nothing should change.
  4. With the editor dirty on an older version, apply from the chat, then trigger the unsaved-drawing question and choose Save. It should say it did not save.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S23a — Graph tools on the chat session — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 10 (call 40, decision 50). Implemented on call 41 (`done`). Review returned `accept` on call 42, round 1. Recorded and committed on coordinator visit 11 (call 43). `git status` showed exactly the five modified and two new files the implementer named.
- **What was done:**
  - **New `host/graph-authoring-tools.ts`, with four chat-session app tools:**
    - **`list_loops`** lists project and DSpatch loops, each with its id, name, source and files.
    - **`read_loop_graph`** returns the disk text plus any manual edits since the last applied proposal in this conversation (S17's `manualEditsSince`).
    - **`describe_loop_building_blocks`** draws on node kinds, the panel's help texts, every `ATTRIBUTE_SUPPORT` row with its caveat, and `RUN_PROVIDER_CAPABILITIES`, `unmet` included.
    - **`propose_loop_graph`** works as follows:
      - Its target is a loop id or `new:<id>`, placed by decision 50's paths.
      - Ids and role names must match `^[a-z0-9][a-z0-9-]{0,62}$`.
      - An id or role file that already exists is refused.
      - Unplaced nodes are laid out with `layOutMissingViews`.
      - S17's `createProposal` validates it. A draft with errors is **not stored**; its errors go back word for word.
  - **`project-host.ts`.** `chatWorkspaceTools()` adds these four. Only chat sessions get them, and loop steps' tools come only from `loop-live.ts`.
  - **`chat-service.ts`.**
    - `graphProposals` sits on each turn record.
    - `workingConversationId()` and `graphProposals(id)` are new.
    - `recordGraphProposal` saves at once and marks earlier open proposals for the same graph file `superseded`, in live and stored messages, through S17's `supersedeWith`.
  - **`bridge.ts` and `conversation-store.ts`.** `StoredMessage.graphProposals` (decision 51), parsed defensively; an older file reads as having none.
  - **Tests.** New `tests/graph-authoring-tools.test.ts` (6 tests, `loop` group) and one round-trip test in `conversation-store.test.ts`.
  - **Never writes, never runs.** No tool writes a file or starts a run. The tests compare a full file snapshot before and after.
- **Review verdict: accept.** All five criteria are met. Criterion 5 is met by reading and by a source-level test, not on a live step. Open, not blocking:
  - **A1, carried into S23b.** Proposals can target DSpatch's own bundled loops, and this workspace's project loops include the mission loop itself (BRIEF §5's fixed files). S23b's Apply must refuse what it should not write and say where it writes.
  - **A2.** `propose_loop_graph` is `readOnly: false`. Whether the chat's tool policy prompts for it is not checked; this is Niclas's trial.
  - **A3.** `recordGraphProposal` has no test of its own.
  - **A4.** Proposed role files are stand-ins during validation.
  - **A5.** An older build that rewrites a conversation drops `graphProposals`, the same as decisions 17, 19 and 33.
- **Checked, by the implementer** (reused by the reviewer): `graph-authoring-tools` 6/6, `conversation-store` 27/27, `chat-service` 77/77, `graph-proposal` 51/51, `workspace-tools` 5/5, `project-host-boundary` 2/2, `npm run typecheck` exit 0.
- **Untested:** the tools with a real agent. They need the engine transition and **Restart host**.
- **Niclas tries,** after the transition:
  1. Describe a small workflow in chat and ask for a proposal.
  2. The agent should list loops and building blocks.
  3. An invalid draft should get its findings back.
  4. Nothing should appear under `.dspatch/loops/` until S23b's Apply.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S18b — Layered layout and Arrange — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 9 (call 37, decision 49); implemented (call 38, `done`); review `accept` (call 39, round 1); recorded and committed on coordinator visit 10 (call 40). `git status` showed exactly the four modified and two new files the implementer named.
- **What was done:**
  - **New `shared/loop-layout.ts`, with `layeredLayout(graph)`.** Pure, deterministic, no dependency, laid out top to bottom like the bundled drawings.
    - Back edges are set aside with S18a's `findBackEdges`.
    - Layers come from the longest path. The entry is always layer 0, and all terminals share the last layer.
    - Four barycentre sweeps run, with ties kept in file order.
    - Row height is the tallest box plus 76 px. Boxes are 56 px apart, and each row is centred on the widest.
  - **`loop-graph-editing.ts`.**
    - `layOutMissingViews` places unpositioned nodes with the layout instead of the old grid.
    - A fully placed graph is returned as the same object.
    - In a partly placed graph, the new nodes are laid out with the whole drawing, then moved as one block below every placed node.
    - The new `arrangeGraph` rewrites only `view`.
  - **`LoopEditor.tsx`.**
    - An **Arrange** button. It is an ordinary unsaved edit, never runs on its own, and is disabled while a run holds the drawing.
    - A visible note: "Save to keep it, Reload to go back", which also says Reload drops every unsaved change.
    - **The brief's premise was wrong:** the editor had no Reload. The implementer added one, through the existing `open`. It is shown after Arrange while the drawing has unsaved changes.
    - Hovers are short labels (R7).
  - **`loop-edge-routing.ts`.** A diagnostic `RouteOptions.report`, which changes no route.
  - **Tests.** New `tests/loop-layout.test.ts` (6 tests), in the `loop` group.
- **S18a suggestion 2, settled.** No arranged drawing (8 bundled plus a synthetic 25-node one) takes the narrowed second pass or a dog-leg.
- **Review verdict: accept.** All six criteria met and tested. Open, not blocking:
  - All terminals go in the bottom row rather than a band for early exits.
  - Rows are centred, not aligned to their neighbours, so wide layers can leave long horizontal edges.
  - Reload drops every unsaved change. Whether `open` asks first is not checked.
  - The unused `LAYOUT_STEP` and `LAYOUT_MAX_COLUMNS` remain, with the grid still described in a comment.
  - A node no edge reaches stays in the first row.
- **Checked, by the implementer** (the reviewer reused these):
  - `loop-layout` 6/6, `loop-edge-routing` 20/20, `loop-graph-write` 6/6, `loop-graph-open` 15/15;
  - `npm run typecheck` exit 0.
- **Untested:** how arranged drawings look and read, and the buttons in a real window. Automated checks never establish visual clarity.
- **Niclas tries.** This is renderer and shared code only, so run it from the working copy with `npm run dev -- --isolated-profile <folder>`.
  1. Open the mission loop, press **Arrange**, read the note and judge the layout. **Reload** should bring back the saved positions.
  2. In a copy of a drawing, remove one node's `view`. It should be placed sensibly below the rest.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S21 — Step reports in the main chat — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`.
  - Briefed on coordinator visit 8 (call 32, decision 47) and implemented (call 33, `done`).
  - The round-1 review (call 34) asked for rework on one blocking finding, R1. The implementer reworked it (call 35, `done`), and the round-2 review accepted (call 36).
  - Recorded and committed on coordinator visit 9 (call 37).
  - `git status` showed 17 modified and 3 new files, as the implementer listed.
- **What was done:**
  - **Card model.** The new `shared/step-report-cards.ts` builds one card per visit from S16's `stepReportsFrom`.
    - The heading is the node label, the sub-goal when one is claimed, and "visit n" or "rework attempt n".
    - Every card is labelled **Step report**.
    - The body is the reply's first block plus its `RESULT:` line, cut at 600 characters. **Full report** expands the whole reply.
  - **Window.** The new `renderer/StepReportCard.tsx` is mounted from `App.tsx`.
    - Tool calls and the prompt stay behind the existing details.
    - The running step shows one status line and **Show live output**.
    - Branch replies are grouped under their fan-out step. Live replies carry `sliceId` as an optional field on an existing host reply event; replies read back are matched through `branch-started`'s `sessionId`.
  - **Combined report.** Decision 47's rule: the step entered right after a fan-out's `success` edge, whose recorded role is in `INTEGRATOR_ROLE_IDS`, gets the heading **Combined report**. S16's integrator rule in `run-presentation.ts` was narrowed to match, and its test updated (7 tests). This settles S16 suggestion S1.
  - **Attention.** Failures, questions, handoffs and `awaiting-human` stand out visibly, through S16's `attention`.
  - **`declares: ["subgoal"]`.** A new optional node field in `loop-graph.ts`, its loader and writer, GRAPH_FORMAT, node help and the editor. For such a node, `chatPromptFor` adds `SUBGOAL_ASK`. The `SUBGOAL:` line is display only, shown as the agent's claim. Nodes without the field produce byte-identical prompts.
  - **Never stored.** Reports are derived on every read, never saved, and `chatPromptFor` and `delivers` are unchanged.
  - **Untouched:** journal kinds, record formats, host methods and the mission graph (Q5).
- **Round-1 finding R1, fixed.** Messages the person sent to a running step had disappeared behind a closed **Show live output**, which undid DSP-147. `LiveStep` in `App.tsx` now tracks whether the output is open. While it is closed, the messages are listed outside it under a `-shown` test id; while it is open, they appear in place, as before.
- **Review verdict: accept** (round 2). All five criteria met and tested. Open, not blocking:
  - **S-a. Departure from the coordinator's brief.** `subGoalClaimFrom` reads a `SUBGOAL:` line from every reply, not only from nodes with `declares`. It is display only and labelled as the agent's claim, so no routing or context is affected. It is left open, not accepted as decided. The next sub-goal touching `step-report-cards.ts`, or a small follow-up, should restrict it.
  - **S-b.** `INTEGRATOR_ROLE_IDS` is `["project-integrate"]`, recorded as decision 48.
  - **S-c.** The 600-character cut can land inside a code block or a list, and **Full report** is offered even when the excerpt is the whole reply.
  - **S-d.** A fan-out node's own reply and its branch group share a heading.
  - The reviewer took on the implementer's word that the scripted trials read `textContent`.
- **Checked, by the implementer** (the reviewer reused these):
  - `npm run typecheck` exit 0, rerun in round 2;
  - from round 1: `step-report-cards` 4/4, `run-presentation` 7/7, `loop-chat` 80/80, `loop-transcript` 48/48, `loop-graph` 42/42, `loop-graph-write` 6/6, `loop-node-help` 28/28;
  - also passing: `loop-definition`, `loop-final-card`, `loop-live`, `loop-skips`, `run-record-store` and `branch-presentation`.
- **Untested:** nothing has been seen in a real window. Live `sliceId` needs the rebuilt host.
- **Niclas tries,** after the transition:
  1. While a chat-loop step is writing, send it a message. It should stay visible while **Show live output** is closed.
  2. Each step should be a **Step report** card naming its node and visit or rework attempt, and **Full report** should expand it.
  3. In the parallel loop, branch reports should be grouped under the fan-out step, and the integrate step should read **Combined report**.
  4. A failure or question should stand out.
  5. The final run card should still be the only run report.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S19b — S19's open points — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 7 (call 29, decision 46); implemented (call 30, `done`); review `accept` (call 31, round 1); recorded and committed on coordinator visit 8 (call 32). `git status` showed exactly the four files the implementer named.
- **What was done:**
  - **(3) The red test.** `tests/loop-activity.test.ts` now gives its stand-in context `arrivedBy: null`, and the product code is unchanged. `StepContext.arrivedBy` is a required field, so accepting `undefined` would hide missing data. The file passes 19/19, which puts S20's refactored activity mapping back under test.
  - **(1) Cursor and Copilot model checks.**
    - `project-host.ts` passes `knownModelIds('cursor')` and `knownModelIds('copilot')`, the lists the chat service already read in this launch, to `prepareLoopRun`. No host method was added.
    - When a list has been read, a model it doesn't have is refused before the run starts, in Claude's wording. That covers every fixed model and `select` option in the drawing, or the entry's fixed model when there is no drawing.
    - When no list has been read, the run is not refused. A new `modelCheck` sentence on the "Runs with …" line says the models could not be checked and that the provider decides.
    - Claude's path is unchanged.
  - **(2) The "Runs with …" line for a `select` entry.** `entryFromQuery` keeps a `select` entry, with each option checked. The line names the default option's model "by default; an edge may select another". Only the line changes: `modelRequested`, `personModel` and Claude's entry refusal are untouched.
  - **Tests:** four added to `loop-model-select.test.ts`.
- **Behaviour change, stated:** once a Cursor or Copilot list has been read in this launch, a run whose drawing names a model that provider doesn't list is refused before it starts. Before, the provider decided. This follows S19's "never fall back silently".
- **Review verdict: accept.** All three parts met. The reviewer confirmed that an option's model cannot be empty (`loop-graph-load.ts` l.850–852). Non-blocking points, open:
  - Claude with no list read still says nothing on the line, unlike Cursor and Copilot.
  - The `modelCheck` sentence chooses "model" or "models" by the number of steps, not the number of distinct models.
  - Cursor with no list read, and a refused Copilot run, have no test of their own.
- **Checked by the implementer** (the reviewer reused these): `loop-activity` 19/19, `loop-model-select` 17/17, `loop-provider` 20/20, `loop-live` 71/71, `loop-agent-commands` 16/16, `loop-gate-check` 11/11, `npm run typecheck` exit 0.
- **Untested:** the host path, until the engine transition and **Restart host**; whether drawings' model ids match the ids Cursor and Copilot list for a real account.
- **Niclas tries,** after the transition:
  1. In a Cursor or Copilot workspace, open the model chooser once. Give a node a model the account lacks and run: it should be refused before it starts.
  2. In a fresh launch, without opening the chooser, the "Runs with …" line should say the models could not be checked.
  3. With a `select` entry, the line should name its default model.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S20 — Branches visible without hover — reviewed (agent review, not Niclas's approval)

- **Attempt 1.** Run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 6 (call 26, decision 45). Implemented on call 27 (`done`). Review on call 28 returned `accept`, round 1. Recorded and committed on coordinator visit 7 (call 29). `git status` showed 16 modified and 4 new files, exactly as the implementer listed them. DSpatch's 50 files count from the run's start, and the rest are in commits up to `a3c7813`.
- **What was done:**
  - **New `shared/branch-presentation.ts`.** It builds every visible text from S16's `branchViewsFromJournal`:
    - the node line ("3 branches · 1 working · 2 finished", plus queued, failed or cancelled);
    - each branch's row: its task or "not recorded", its state with the ending word ("failed: no-worktree", which settles S16 suggestion S4), its model or "the run's model", its message counts and its live-output address;
    - the note on when a message counts as delivered.
  - **`run-presentation.ts`.** `BranchView.model` is now filled from S19's `branch-started` data.
  - **`loop-run.ts`.** The runner journals the slice's `result` as **`task` on `branch-started`** (review F2). It is an additive data field like S12's `ownedPaths`; no journal kind changed.
  - **Node line on the canvas.** `GraphCanvas.tsx` draws it on the fan-out node at y=53, inside S18a's 72 px height, and squeezes it to fit when it is long. The line is also a control: click, Enter or Space opens the list. Before a new visit has a branch, the line reads "earlier visit: …".
  - **New `renderer/BranchList.tsx`**, used both in the editor and in the chat.
    - In `LoopEditor.tsx`, a **Branches — …** button sits outside the locked fieldset, so it works during a run. The old hover-only summary is gone.
    - The list stays open until closed. Each row has **Show output** and **Open in window**.
  - **Live output from branches.** `runInstance` in `main/loop-live.ts` emits activity with the branch's `sliceId` through the existing `onStepActivity`. One shared `activityFromEvent` maps events for both steps and branches.
    - `loop-activity.ts` gains `foldBranchActivity`, and `foldStepActivity` ignores branch events.
    - `RunView` gains `branchSteps`.
    - The host forwards events unchanged; no host code changed.
    - No prompt, stored result or shared inspection is touched.
  - **Chat (`App.tsx`).** It keeps the watched run's branch lines and activity in window memory and draws the same list under the run's entry.
  - **Branch window.** A client-side IPC call, `openBranchOutput(address)` on `dspatch:open-branch-output`, is wired through `main.ts`, `preload.ts` and `bridge.ts`. The new `renderer/BranchOutputWindow.tsx` is routed from `main.tsx`. It is sandboxed, refuses further windows, and adds no host method.
  - **Styles** go in `styles.css`, using palette variables.
  - **Tests.**
    - New `tests/branch-presentation.test.ts` (5 tests), in the `loop` group.
    - `loop-live.test.ts` now checks that both branches send `step-started` with their `sliceId`.
- **Review verdict: accept.** All four criteria are met by reading. The clicks are untested, and the boundaries hold.
  - **F1 is a fault in committed S19 code, not in S20:** `loop-activity.test.ts` has 1 failing test. It is now **S19b (3)**. Until it is fixed, nothing tests the step-activity mapping S20 refactored; the reviewer compared the old and new mapping by reading.
  - **F2** is the `task` field, recorded above.
  - **Suggestions:**
    - `App.tsx`'s `BRANCH_JOURNAL_KINDS` sits between import blocks, and the new state sits under `applyLoopTurnEvent`'s doc comment.
    - The branch window's heading uses the node id rather than its label.
- **Checked, by the implementer.** The reviewer reused these results.
  - `branch-presentation` 5/5, `run-presentation` 6/6, `loop-live` 71/71, `loop-fan-out-run` 7/7, `loop-mailbox-run` 4/4, `loop-run-view` 33/33.
  - Also `loop-fan-out` 4/4, `loop-run-report` 9/9, `loop-final-card` 15/15, `window-zoom` 18/18, `review-model` 36/36, `project-host-boundary` 2/2.
  - `npm run typecheck` exit 0.
  - **`loop-activity` 18/19 (F1).**
- **Untested:**
  - the clicks and the layout of the node line;
  - the branch window opening, and its catch-up when it opens mid-run, when it can miss events;
  - the chat's list (for the watched run only, never for a run read back from its record);
  - anything that needs the rebuilt host. Until then, rows read "not recorded" and there is no branch output.
- **Not in the engine.** Host-side code changed (`loop-live.ts`), so it needs an engine rebuild and **Restart host** at the next transition.
- **Niclas tries**, after the transition: run the parallel loop on a throwaway repository.
  1. Read the fan-out node's line without hovering.
  2. Click it, or use **Branches** in the node panel.
  3. Check each branch's task, state, model and messages, and the delivered note.
  4. Use **Show output**, then **Open in window**.
  5. Check that the chat shows the same list under the run's entry.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S19 and S22, parallel — reviewed (agent review, not Niclas's approval)

- **Path.** Run `chat-loop-2026-11-14T09-54-18-366Z`. Sent on coordinator visit 5 (call 15, decision 44) from base `3cb096a`. The path ran slicer, `branches` visits 2–4, `integrate` visits 2–5 and `parallel-review` visits 2–3, calls 16–25. Review round 1 had one blocking finding against S19, and round 2 accepted it. Recorded on coordinator visit 6 (call 26).
- **Slices, per visit:**

| Visit | Slice | Commit | Ending | Merged as |
| --- | --- | --- | --- | --- |
| 2 | s19 | `a9ea3dc` | finished | `2798903` |
| 2 | s22 | `4bce22c` | finished | `a40d3b8` |
| 3 | s19 | none | finished, nothing to rework | — |
| 3 | s22 | `151612c` | finished (`JSX` import) | `0b0fb3d` |
| 4 | s19 | `fac761a` | finished (round-1 finding) | `87b09ba` |
| 4 | s22 | none | finished, no rework asked | — |

- **The integrator's own commits:**
  - `bcd8a8b`: the graph is passed to `prepareLoopRun`, and both tests join the `loop` group.
  - `8323a90`: the graph is passed through the request builders instead, which keeps the call shape `loop-provider` reads.
  - `dbb2025`: `personModel` is passed at both `runLiveGraph` calls in `project-host.ts`, at lines 2698 and 3168.
- **Git check.** `3cb096a..dbb2025` holds those 11 commits and changes 24 files (2,460 insertions, 82 deletions). The temporary branches `.../branches/v2/{s19,s22}`, `v3/…` and `v4/…` are kept for Niclas. Only the main and engine worktrees remain.
- **Conflicts:** none on any visit.
- **Proposals, all resolved:**
  - `branches#2/m1` (s19 to s22): the card shows a model only when the entry carries `modelSource`.
  - `branches#2/m2`: the graph reaches `prepareLoopRun`. The integrator also accepted s19's helpers in `loop-run.ts` and the name `modelPolicy`.
  - `branches#4/m1`: the host wiring of `personModel`.
- **What S19 does.**
  - A node's `fixed` model is honoured on every step.
  - A new node field, `model: { policy: "select", options, default }`.
  - A new edge field, `selectsModel`, whose reason comes from `declaredReasonFrom`.
  - `node-entered` and `branch-started` carry `{ model, modelOption, modelReason, modelSource }` as data; there are no new journal kinds.
  - Claude switches model on the next turn; other adapters open a new session.
  - On Claude, a model the account does not list is refused before the run starts.
  - The node panel lets the person edit the policy.
  - GRAPH_FORMAT and the node help explain it.
  - **Round-1 finding, fixed:** an `inherit` step used to fall back to the entry step's model while the record named the person's. `prepareLoopRun` now returns `personModel`, which both the executor (`modelOfStep`) and the journal (`runModel`) use. A test covers it.
  - **Behaviour change, stated:**
    - a non-entry step's `fixed` model is now honoured;
    - in a graph whose entry fixes a model, `inherit` steps now run the person's model for the provider, not the entry's.
    
    No shipped graph is affected (decision 37).
- **What S22 does.**
  - `buildFinalRunCard` in the new `shared/loop-final-card.ts` is pure and derived, never stored.
  - The new `renderer/FinalRunCard.tsx` shows it at the end of the run's chat entry.
  - `RecordedRunEnding` gains additive fields for commits and upstream. `run-record-store.ts` adds `readRunCommits`, and the host records HEAD at the run's start and end.
  - The card covers the ending kinds, counters from S16, and "not recorded" for older records.
  - A run shows as "running" rather than "interrupted" while the host still runs it.
- **Review verdict: accept** (round 2). The integrator's account matches Git. Open points, not blocking:
  1. Cursor and Copilot models are not checked before a run. This is now **S19b**.
  2. `entryFromQuery` leaves a `select` entry step out of the "Runs with …" line. This is now **S19b**.
  3. `readRunCommits` makes up to five synchronous git calls in the host at the end of a run, each with a 10 s timeout. Left open.
  4. No test covers the host's two `personModel` lines; only the typecheck does.
- **Checked, by the integrator** (the review reused these):
  - On the final state: `npm run typecheck` exit 0, `loop-model-select` 13/13, `loop-provider` 20/20, `loop-live` 71/71, `loop-final-card` 15/15.
  - Earlier, and still valid: `loop-transcript` 48/48, `loop-record` 42/42, `run-record-store` 14/14, and `loop-graph` with `loop-graph-write` and `loop-node-help` 74/74.
- **Not in the engine.** Both change host code, so they need an engine rebuild and **Restart host** at Niclas's next transition, never during a run. No host method was added.
- **Niclas tries, after the transition:**
  - **S19:** in a scratch graph, give the implementer a `select` policy and an edge with `selectsModel`, then run it. The node panel and the record should show the model chosen and the reason. A graph whose entry has a fixed model should run its other steps with your model.
  - **S22:** end runs as completed, cancelled, and paused-then-cancelled. Each should get exactly one final card with the right status, commits and next action, and reopening the conversation should show no duplicate.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S25b — S25's follow-up — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 4 (call 12, decision 43); implemented (call 13, `done`); review `accept` (call 14, round 1); recorded and committed on coordinator visit 5 (call 15).
- **Reconciliation:** `git status` showed the seven modified files and the new `loop-stop-signal.ts`, exactly as the implementer named them. DSpatch's comparison lists 18 files; the other ten are in commits up to `3726249`.
- **What was done:**
  - **N1 (R7):**
    - `loop-control.ts` gains `LOOP_MODE_EXPLANATION`, a short `LOOP_MODE_HINT`, and a short `hint` for each button. The full sentences are kept.
    - `LoopControlBar.tsx` gets a **Details** / **Hide details** toggle in both forms. Only the person opens or closes it, and its text is selectable. It holds the phase headline and explanation, the current note in the compact form, the full mode explanation, each mode's meaning and each button's meaning.
    - In the compact form the toggle reads **Details · note** while a note waits.
    - Removed: the headline's hover, the long mode hover with the note appended, and the `<option>` hovers.
    - Styles: in `loop-editor.css` the compact panel is `position: fixed`, because the palette row clips overflow, and the strip's height is unchanged. `styles.css` styles the panel.
  - **N2:**
    - The new `renderer/loop-stop-signal.ts` uses `localStorage` and the `storage` event, the same pattern as `presentation-choice.ts`.
    - `LoopEditor.tsx` sends the signal after a confirmed **Cancel run** of a watched chat run.
    - `App.tsx` applies its existing `stop-requested` event for that run id.
  - **N3, settled as a finding, with no code.** The loop editor never shows a walk-loop run, so there is no greyed-out **Cancel run** to fix.
    - The host announces only editor and chat runs to the editor (`project-host.ts` l.2687, l.3147).
    - Walk-loop runs go to their own follow window, `WalkLoopFollow.tsx`. Its **Stop** uses `reviewPair.cancelJob`.
    - The reviewer confirmed this in `review-agent-jobs.ts` l.193.
    - My S25 brief assumed otherwise. S25 (b), "every control that shows a run offers the same way to end it", is met: each control that shows a run can end it.
    - Letting the editor show and cancel walk runs would need a host change. That is recorded as an open possibility, not a requirement.
  - **Test:** one in `loop-control.test.ts`. The mode hover is at most 60 characters, each button hint at most 40, and each keeps its full sentence.
- **Review verdict: accept.** All four criteria are met: criterion 3 by the reported finding, criterion 4 in code but untested across windows. Nothing changed in the host contract, journal, formats, prompts, routes or node sizes. Open, not blocking:
  - The editor marks the chat entry only after a confirmed cancel, whereas the chat's own Stop marks it first.
  - The compact Details panel is placed once when it opens and is pinned to the window's right edge.
  - The panel's shadow is a raw `rgb()` rather than a palette variable.
  - `stopSignalRunId` has no test.
  - `HandoffPrompt` still uses `choice.title` as a hover. S25b did not touch it; it is for the sub-goal that next touches it.
- **Checked, by the implementer:** `loop-control` 28/28; `loop-run-view` 33/33 (rerun because it reads `loop-editor.css`); `npm run typecheck` exit 0. The reviewer reused these.
- **Untested:** the storage signal between real windows; the Details layout and the strip's height.
- **Niclas tries:**
  1. With a run paused in the loop editor, press **Details**. The phase and note should be readable and selectable, the strip should not grow, and the mode hover should be short.
  2. Cancel a chat run from the editor. The chat should say "stop requested" until the run's ending shows.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S25 — A paused run reads correctly in every control — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T09-54-18-366Z`. Briefed on coordinator visit 3 (call 9, decision 42); implemented (call 10, `done`); review `accept` (call 11, round 1); recorded and committed on coordinator visit 4 (call 12). `git status` showed exactly the six files the implementer named. DSpatch's comparison listed 15 files, and the other nine are in `fdd2156`, `88a49dc`, `d6b2a3b` and `9a0205c`, so the two accounts agree.
- **What was done:**
  - **(a) The note follows the run and phase it was said in.** `loop-control.ts` gains `ControlNote`, `controlNoteFrom` and `currentControlNote`, and `LoopControlBar.tsx` stores and shows notes through them.
  - **(b) Cancel run in the editor works for watched chat runs.** The implementer found a wider cause than the brief said: **Cancel run** was enabled only for runs the editor itself started, so a chat run's button was greyed out all the time, not only while paused. Now it is also enabled for a watched chat-loop run that has not ended, and it calls `cancelChatLoopRun()`, the same cancel the chat's Stop uses. A failed call says the run is still going.
  - **(c) The graph shows the paused step.** `loop-run-view.ts`'s `nodeRunStates` reads `run-held`: for `pause` and `interactive-mode` holds, the held next step reads **waiting**. `run-released` or the run ending restores the step's earlier state, and a resource hold is left alone. The new `pausedNextStep` gives `next: "X" waits for you` or `next step not decided yet`, and `LoopEditor.tsx`'s title line shows it after "paused".
  - **Tests:** one each in `loop-control.test.ts` and `loop-run-view.test.ts`.
  - **Unchanged:** the engine's pause, continue and cancel behaviour, the host contract (no new method), journal kinds, formats, prompts, routes and node sizes.
- **Review verdict: accept.** All four criteria met by reading. Findings, none blocking:
  - **N1 (R7).** In compact form, which the editor uses, the phase explanation and the last note are only in hover text, and the note is appended to a hover of about 350 characters on the mode label (`LoopControlBar.tsx` l.194, 204–212). **The coordinator's brief was narrower than R7.** It said "any hover text you add or change", where R7 says "touch". The gap is now **S25b**.
  - **N2.** A cancel from the editor does not mark the chat entry "stop requested". The run still ends cancelled. Now in S25b.
  - **N3.** There is still no Cancel run for watched `walk-loop` runs, so S25 (b) is met for chat runs only, not for "every control that shows a run". Now in S25b.
  - **N4.** A mark can read "running" for a moment after *Paused*. This is the right choice, since the journal has not yet recorded the step's end. Left open.
  - **N5.** A step held by interactive mode now reads *waiting*. Niclas's trial.
- **Checked, by the implementer only** (the reviewer reused the results): `loop-control` 27/27, `loop-run-view` 33/33, `loop-control-run` 15/15, `npm run typecheck` exit 0. The window wiring has no test that runs it.
- **Niclas tries:**
  1. Start a loop run from the chat, open it in the loop editor, and press Pause while a step runs.
  2. While the step still runs, the bar should show "Pause requested" with its note.
  3. After the step ends, the bar should show only *Paused*. The graph should show the finished step as done and the next one as waiting, and the title line should end `· paused · next: "<step>" waits for you`, or `· paused · next step not decided yet`.
  4. **Cancel run** in the editor should end the run as the chat's Stop does.
  5. Repeat with interactive mode.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S17 and S18a, parallel — reviewed (agent review, not Niclas's approval)

- **Path.** Run `chat-loop-2026-11-14T09-54-18-366Z`. The coordinator chose the parallel path on visit 2 (call 4, decision 41), with base `06b3762` committed first. Then came the slicer, `branches` visit 1, `integrate` and `parallel-review` (`accept`, round 1, no rework). It was recorded on coordinator visit 3 (call 9).
- **Slices and branches** (visit 1; there was no rework visit):
  - **`s17`** owns `app/src/shared/graph-proposal.ts` (715 lines) and `app/tests/graph-proposal.test.ts` (320 lines).
    - Branch `dspatch/run/chat-loop-2026-11-14T09-54-18-366Z/branches/v1/s17`, commit `9d48c02`, ending `finished`.
    - Merged as `fdd2156`.
  - **`s18a`** owns:
    - new `app/src/shared/loop-edge-routing.ts` and `app/tests/loop-edge-routing.test.ts`;
    - `app/src/shared/loop-edge-geometry.ts`, `app/src/renderer/GraphCanvas.tsx` and `app/src/renderer/loop-editor.css`.
    
    Branch `.../branches/v1/s18a`, commit `52bc9c4`, ending `finished`. Merged as `88a49dc`.
  - **Integrator's commit `d6b2a3b`:** both test files added to the `loop` group in `app/scripts/run-tests.mjs`.
  - Altogether, `06b3762..d6b2a3b` changes 8 files (2,516 insertions, 78 deletions). That matches DSpatch's folder comparison, which also lists STATE.md, changed in `06b3762`.
  - The two temporary branches are kept for Niclas. The fan-out worktrees are gone, and only the main and engine worktrees remain.
- **S24 in live use.** This was the first live fan-out since `4c6e14f`. Both worktrees were created on this repository on Windows, and both branches finished. S24's "not yet run by a live fan-out" no longer holds.
- **Integration.** There were no conflicts; the slices share no file.
  - **Mailbox proposal `branches#1/m1`** came from s18a, which asked for three things. The integrator resolved all three:
    1. A real typecheck on the merge (the worktrees had no `node_modules`). Done, and it passed.
    2. The interface S18b builds on. Accepted: `findBackEdges(graph)`, `nodeSize(node)`, `FAN_OUT_NODE_HEIGHT`, and `nodeOutlinePath` with an optional height that defaults to `NODE_HEIGHT`.
    3. The `run-tests.mjs` line. Added.
  - **s18a went beyond its owned part of `GraphCanvas.tsx`.** It also changed `NodeShape` and `graphBounds`, as the taller fan-out node and the back-edge lanes need. The integrator and the review both accepted this.
- **What S17 does.**
  - `GraphEditProposal` has `explanation` as `AgentWords`, labelled with `source: 'agent'` and `AGENT_WORDS_LABEL`. Its `findings` are `loadLoopGraph`'s, unchanged.
  - `describeGraphChange` follows renames through S15's `replaceNode`. `reconcileDisk` and `manualEditsSince` complete the model.
  - `applyProposal` only returns a `ProposalWrite`, and writes or runs nothing. It returns `conflict` when:
    - the disk differs from the base hash, or the file is gone;
    - a new loop's files already exist;
    - a role file differs, or what it holds is not established.
    
    It refuses a proposal that has errors or is not open.
- **What S18a does.**
  - Orthogonal A\* routes around node boxes. Back edges are found by depth-first search from `entry` and run in an outer lane, with the `edge-back` class, a `3 4` dash, an open chevron and violet `#9d8ac6`. A declared failure keeps its own colour.
  - Node size depends on kind and on whether the node declares `fanOut`; fan-out nodes are taller.
  - Routes are memoised on `graph` alone. `node.view` and the saved bytes are unchanged, and no dependency was added.
  - It added no hover text, so R7 had nothing to apply to.
- **Review verdict: accept**, by reading and against Git.
  - All three criteria of each sub-goal are tested directly. For S18a, a measured test checks that no segment crosses an unrelated box in any of the 8 bundled graphs; that is not a claim of visual clarity.
  - The review reads "hit areas unchanged" as "the hit area follows what is drawn". The edge hit path now follows the route, and fan-out nodes get a taller hit area.
- **Non-blocking suggestions, open:**
  1. **Drag speed:** routes are recomputed on every graph change, including every mouse move during a drag, with no time limit tested. Niclas's trial.
  2. **The last-resort route:** when no route is found, `routeAll` falls back to a plain dog-leg that can cross nodes. It is untested; no bundled graph reaches it, but S18b's arranged graphs could. S18b should test it.
  3. **S17's rename detection:** a removed node plus an otherwise identical added node with nothing referencing either is reported as a rename. S23b's view should know this.
  4. **Edge labels** are now centred on the route's label point. Niclas's trial.
- **Checked by the integrator on the merged result** (the review reused these):
  - `npm run typecheck` exit 0;
  - `graph-proposal` 51 of 51;
  - `loop-edge-routing` 20 of 20;
  - `loop-edge-geometry` 3 of 3.
  
  No group run. No independent verification was asked for.
- **Untested:** the canvas on screen, and zoom, select and drag. S17 has no UI until S23b.
- **Niclas tries:** open the mission loop and the development loop in the loop editor.
  - Edges should stay clear of unrelated nodes, and rework edges should be dashed violet.
  - Edge labels should be readable, and fan-out nodes taller.
  - Zoom, select and drag should still work, with dragging still smooth.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### S16/S17 parallel attempt (run `chat-loop-2026-11-14T09-03-54-467Z`, calls 4–5) — failed, not done

- **Path:** coordinator visit 2 (call 3), with STATE committed as `63890bd`; slicer (call 4); fan-out `branches` visit 1 (call 5), which returned along `b-failed`.
- **Slices:**
  - `s16`: owns `app/src/shared/run-presentation.ts`, `app/tests/run-presentation.test.ts`, its line in `app/scripts/run-tests.mjs`, and optionally `loop-run-view.ts`'s `branchInstanceStates`;
  - `s17`: owns `app/src/shared/graph-proposal.ts` and `app/tests/graph-proposal.test.ts`, with its `run-tests.mjs` line left to the integrator.
- **Ending, both branches:** `no-worktree`, at base `63890bd` (HEAD).
  - `git worktree add` failed with "Filename too long" for 12 tracked `backlog/tasks/dsp-1xx/2xx - <long title>.md` files, then "fatal: Could not reset index file to revision 'HEAD'".
  - The worktree root is `<userData>/loop-runs/<runId>/worktrees/` plus the node, visit and slice, so long backlog filenames pass Windows' 260-character limit. `core.longpaths` is not set in this repository.
  - No branch ran an agent, and no integrator or review ran.
- **Left behind**, checked by the coordinator on visit 3:
  - the temporary branches `dspatch/run/chat-loop-2026-11-14T09-03-54-467Z/branches/v1/s16` and `.../s17`, both at `63890bd` with no work on them, kept for Niclas to delete;
  - no registered worktree beyond main and the engine; an empty stash; no tracked change.
- **Finding against S10a:** its record already listed "Windows long paths" as untested. This is that case, so the parallel path cannot run on this repository on Windows until it is fixed. That fix is S24.
  - It needs an engine transition to take effect.
  - Alternatively, Niclas can set `git config core.longpaths true` in this repository between runs. That is his choice: the coordinator does not change git configuration.

### Whole assessment

- Sent on coordinator visit 18 (call 54); returned `gaps` (mission-review, call 55); recorded on coordinator visit 19 (call 56). An agent's assessment, not Niclas's approval.
- **Holds:** BRIEF §5's fixed files and the content-exclusion contract unchanged from `59bd24e` to `bb7dba1`; no `dspatch/*` branches; empty stash; 16 mission commits, local, none pushed; the coordinator's account matches Git (the 75th file is the uncommitted DSP-209 card note). Success criteria 1–3 built and agent-reviewed, with a scripted stand-in only; the parts fit (snapshot reads skips and handovers; report reads branches and messages; visit-scoped branches allow rework).
- **Blocking gaps:** (1) the run report lacks the vision's "left for Niclas to examine" and does not list steps never reached; STATE.md had marked the requirement met and had not recorded that S12's "what to try" was dropped — now reopened; (2) the combined code was never tested together — every check was a single file by one implementer (the S3/S4 `loop-control-run` failure shows the risk), and after S12's rework the dependents of `loop-run.ts`, `loop-record.ts`, `run-mailbox.ts`, `loop-instruction.ts`, `project-host.ts` were not rerun. Both go to S14 (decision 31).
- **Open, needing Niclas:** Q2 (not met until he answers; the mission cannot be reported complete while it is open); durable resume wording — recorded as met within BRIEF §3's allowance (decision 30), since BRIEF §3 itself says manual continuation is enough; Q1, Q3, Q4 (Q4's condition, "once S11 builds them", is now met).
- **Not blocking:** per-branch cancel stays a follow-up ("cancel all" meets the vision's cancel requirement); speed (delivery time, integration rework, human effort) cannot be assessed without live runs — the final report must say so; cost is visible in the run report; S13's "(then)" wording nit.

### S14 — Run report completion and one integrated test run — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** briefed on coordinator visit 19 (call 56); implemented (call 57, `done`); review `accept` (call 58); committed on coordinator visit 20 (call 59).
- **What was done.** `loop-record.ts`: optional header `drawnSteps [{ id, label, kind }]` with `drawnStepsField` (kept only if every entry is well formed). `project-host.ts` writes it at run start from the drawing actually loaded and passes it to the window (`bridge.ts`), so a watched run and a restored run get the same report. `loop-run-report.ts`: section "Steps not reached" (drawn non-terminal, non-router steps with no visit and no skip; older records "not recorded (older record)"); section "Left for you to examine" built from journal entries and record fields — skips with reasons, the S4 corroboration line, a handover turn refused at run end, the count of undelivered messages, open proposals with the integrator's claim quoted, kept temporary branches, kept worktrees with reasons, declared verdicts ("its own verdict, not checked by DSpatch"), steps never reached — each pointing to its section; one line when nothing; always ending "Nothing here was tried by hand; agent review is not your approval." Steps named by the drawing's labels. `loop-transcript.ts` passes the drawn steps. Tests: `loop-run-report` (9), `run-record-store` (round-trip, malformed).
- **The integrated `loop` group run** (`node scripts/run-tests.mjs loop`, from `app/`): first run 770 tests, 766 passed, 4 failed (exit 1); second run 770/770 (exit 0); 158 suites in 40 files, none cancelled or skipped. Failures and fixes, both in test files tied to a reviewed sub-goal: (1) `loop-instruction-wiring` pinned one place that takes queued instructions; S11 (decision 29) added the mailbox's on purpose — the test now pins exactly these two and that a branch's prompt takes none; (2) `loop-provider` (3 tests) failed "Claude support needs repair": since S5a the chat loop's work step builds the handoff tool's server, and the test helper `tests/support/claude-loop-sdk.ts` loaded the real optional Claude support — the helper now gets a scripted tool kit; no product code changed. **Finding against S5a:** `loop-provider` had probably been failing since S5a (`7797e94`) because no targeted check ran it; commits `7797e94`..`bb7dba1` therefore carried a failing test file. Product risk none per `claude-support.ts`: any Claude session already needs the optional SDK (`npm run claude:install`). `npm run typecheck` exit 0.
- **Review verdict: accept.** Five criteria met by reading; the reviewer did not rerun the group. Non-blocking: (i) "a agent step" grammar slip at `loop-run-report.ts:660` — open wording nit; (ii) a handover send that fails after the run ended (S7's chat line) is not in the record, so the report cannot show it — open, stated limitation.
- **Checked:** the group run and type check, by the implementer only. The coordinator confirmed by read-only git: no `dspatch/*` branches, empty stash.
- **Untested:** how the two new sections look in the window; the host writing `drawnSteps` during a real run.
- **Niclas tries:** after a loop run, open the report and check "Steps not reached" and "Left for you to examine" against what happened.
- **Steps skipped:** independent verification (not asked for).
- DSP-209's dated note for this run was appended on coordinator visit 18 (`backlog task edit DSP-209 --append-notes`) and committed in `9ba0d86`.
- **Second assessment** (mission-review visit 2, call 60): `needs-decision`. Both first-assessment gaps fixed in `9ba0d86` (report sections read in the code; the `loop` group run rests on the implementer's account only, not rerun). Git agrees with the coordinator's account. Only Q2 stops *Reported complete*. Not blocking: decision 30 (Niclas may correct); Q1, Q3, Q4; the vision's speed assessment (delivery time, integration rework, human effort) is **not made** — nothing has run with a real provider; cost is visible in the run report; all live trials are Niclas's. An agent's assessment, not Niclas's approval.
- **Feasible work deliberately not sent out:** two wording nits — "a agent step" at `app/src/shared/loop-run-report.ts:660` and the "(then)" word on the 13 November BACKLOG.md line. Neither is a requirement; they are left open for the next run or for Niclas rather than spending an implement-and-review pair at the end of this one.

### S15 — Rename follows references; recap removal survives a restart — reviewed (agent review, not Niclas's approval)

- **Attempt 1:** run `chat-loop-2026-11-14T08-41-01-671Z`. Briefed on coordinator visit 1 (call 1), sequentially by decision 32; implemented (call 2, `done`); review `accept` (call 3); recorded and committed on coordinator visit 2 (call 4). Reconciled on visit 2: `git diff --stat` shows exactly the 8 files the implementer named plus STATE.md, matching DSpatch's snapshot comparison (217 insertions, 22 deletions including STATE). No `dspatch/*` branches, empty stash.
- **What was done, part (a).** `replaceNode` in `app/src/shared/loop-graph-editing.ts` now follows a rename into all eight node-id fields: `entry`, an edge's `from`, `to`, `delivers` and `skips`, and a node's `report.writtenBy`, `consumes` and `fanOut.slicesFrom`. The implementer and the reviewer each read `loop-graph.ts` and found no others.
  - Only exact ids change.
  - A field that is absent stays absent, and a list without the old id stays the same object.
  - Without a rename, `edges` is the same object.
  - The renamed node's own fields follow the rename too.
  - The doc comment lists all eight fields.
  - Tests: 3 in `app/tests/loop-graph-open.test.ts`, on the shipped chat and parallel loops, each followed by a save and reload with no error finding.
- **What was done, part (b).** A new optional `StoredConversation.removedLoopRecaps?: readonly string[]` in `app/src/shared/bridge.ts` (decision 33).
  - **Remove** (`discardPendingRecap('loop-recap')`) saves the conversation at once, and the field is written only while a removal waits for its message.
  - `adoptSaved` puts the stored list back into the in-memory map S7 uses.
  - The send path is unchanged: the next message records `{ runIds, text: null }`, then the field leaves the file.
  - `conversation-store.ts` gains `storedRemovedLoopRecapsField`, which drops damaged forms.
  - Repeated ids are removed.
  - Tests: one in `chat-service.test.ts` (remove, restart over the same store, not offered, a later run offered, the next send carries only the newer recap, the field gone afterwards) and one in `conversation-store.test.ts` (round-trip, older file, five damaged forms).
  - `BACKLOG.md`: the S3 rename proposal and the second S7 proposal are marked "Done by DSP-209 S15 (14 November 2026)".
- **Review verdict: accept.** All acceptance criteria met by reading. No host or bridge method was added. The coordinator confirmed the reviewer's one unchecked point by reading: `app/src/shared/remote-build.ts:25` hashes only the sorted `PROJECT_HOST_METHOD_NAMES`, so the host contract is unchanged and no host restart is needed. Non-blocking points, all left open:
  1. A send interrupted by a restart, after the save and before the provider takes the message, is untested. It is harmless because `loopRecapRuns` counts a run once.
  2. A failed save at **Remove** keeps the removal in memory only, as before.
  3. `replaceNode` does not guard a rename onto an id that already exists. This predates S15 and is outside its scope.
- **Checked, by the implementer only** (from `app/`, single files): `loop-graph-open` 15/15, `loop-graph` 41/41, `loop-skips` 14/14, `chat-service` 77/77, `conversation-store` 26/26, `loop-recap` 2/2; `npm run typecheck` exit 0. The first `chat-service` run had 1 failure, in the test itself: no session was opened after the resume. The implementer fixed the test, not the product code. The reviewer did not rerun anything.
- **Untested:** the editor panel after a rename; a real restart of the window.
- **Niclas tries:**
  - **(a):** in the loop editor, open the chat loop and rename `check`. Edges `e-unchecked` (skips) and `e-rework` (delivers) should show the new id, with no validation finding.
  - **(b):** after a loop run, press **Remove** on the recap, restart DSpatch without sending, and reopen the conversation. The recap should not be offered, and a run that ends later still should be.
- **Steps skipped:** research (the code settled it); independent verification (not asked for).

### Third whole assessment (run `chat-loop-2026-11-14T08-41-01-671Z`, call 5)

- **Verdict: `needs-decision`.** This is an agent's assessment, not Niclas's approval.
- **What the assessor checked.** It read BRIEF.md, STATE.md and `9ec6902`, and ran only read-only git and searches; it reran no tests.
  - The S15 commit holds exactly the 10 files DSpatch's comparison lists.
  - No `dspatch/*` branches, an empty stash, and only the main and engine worktrees (engine at `2e22eb2`).
  - No fixed file and no content-exclusion contract changed between `3af3975` and `9ec6902`.
- **S15.**
  - Part (a) is met by reading: all eight node-id fields, and the editor's rename paths (`LoopEditor.tsx` 1304, 2056, 2850; `loop-graph-editing.ts:352`) go through `replaceNode`.
  - Part (b) is met by reading.
  - Decision 32 records the sequential choice as the mandate asked.
  - The parts still fit together.
- **Open, not met:**
  - Q2 (Niclas's).
  - The vision's speed assessment: nothing has run with a real provider.
  - Every live and UI trial is Niclas's.
- **Open, not required:**
  - Q1, Q3, Q4.
  - Decision 30, which Niclas may correct.
  - S15's three review points.
- **Assessor's suggestions.**
  - (i) The last-commit line lacked `9ec6902`. Fixed on this visit.
  - (ii) If **Remove** comes when the conversation has nothing to save, nothing reaches the file (the early return in `saveConversation`).
    - The coordinator read `chat-service.ts:5042-5050`. The early return happens only when there is no store, no conversation id, or the conversation is not held in memory.
    - An open conversation offering a recap is held, so this is most likely unreachable. It is not confirmed either way.
    - It is left open as a reading, not briefed: it is not a requirement, and nothing shows it is a defect.
    - Niclas's restart trial for S15 covers it.

### S9 — SDK support research

- **Attempt 1:** sent to the researcher on coordinator visit 10 (call 27); answered (call 28); recorded on coordinator visit 11 (call 29). **Status: done as research** (code reading; nothing observed live; not reviewed — research is evidence, not a deliverable). No files written by the researcher.
- **Versions read (14 November 2026):** Claude Agent SDK 0.3.306 (`app/claude-support`), `@cursor/sdk` 1.0.31, `@github/copilot-sdk` 1.0.28 with Copilot CLI 1.0.105.
- **Correction to earlier records (S5a, S5b, S6 and `shared/loop-graph.ts:1004-1005`):** Copilot loop steps **do** get DSpatch app tools, by reading: `copilotPolicyFor('loop')` returns `COPILOT_CHAT_POLICY` (`provider-adapters.ts:127-129`, pinned by `tests/copilot-sdk-adapter.test.ts:146`), whose `surface: 'chat'` (`copilot-sdk-adapter.ts:198-199`) passes tools (`:769`). So a Copilot step on an enabled node should be offered the handoff tool. Not observed. The statements "Copilot loop steps are never offered it" in the S5a/S5b/S6 records are wrong by reading; the support row and GRAPH_FORMAT text are corrected in S8 (decision 21).

| # | Claude | Cursor | Copilot |
| --- | --- | --- | --- |
| 1 Concurrent sessions | Read from code: all state per session (`claude-agent-sdk-adapter.ts:1732`); each `send` has its own `AbortController` and `query()`, spawning its own Claude Code process (`:1970-1972`, `:2062-2065`, `:2816`, `:3693`); app-tool server per session (`:2059-2060`). Shared: read-only settings; the Claude config folder on disk — concurrent token refresh **unknown**. | Read from code: per-session agent (`cursor-sdk-adapter.ts:364`, `:801-821`); SDK in DSpatch's process, no child. Observed: 3 idle sessions side by side (`loop-live.ts:1548-1553`), not running at once. Documented: local store serialises writes (`store/jsonl-local-agent-store.d.ts:13-14`); `AgentBusyError` per agent (`errors.d.ts:86-90`). Two concurrent turns: **unknown**. | Read from code: one runtime process per session, isolated on purpose (`copilot-sdk-adapter.ts:647-669`, `:1250`). Shared: health-check timer (`:1177-1185`), model-list runtime. Concurrent turns: **not observed**. |
| 2 Input during a turn | Read from code: `steer` via `Query.streamInput()`, delivered only when the result lists the id (`:2108-2216`). | Read from code: `Run.steer()` (`:563-621`); documented optional, returns `complete_delivered` or `revert_to_followup` (`run.d.ts:9-22`, `:61`). | Not in the adapter (no `steer`; `send` refuses during a turn, `:1321-1322`). SDK documents `MessageOptions.mode: "immediate"` (`types.d.ts` ~3172); effect **unknown**. |
| 3 App tools on loop steps; tool state | Offered only when `offersHandoff(node)` (`loop-live.ts:2036`, `:1028`); in-process MCP server per session (`:2749-2761`). | `local.customTools` per session (`:342-346`); documented local agents only. | Offered by reading (correction above); per session (`:769-781`). |
| 4 Cancel one session | Read from code: session scope — deny tools, `interrupt()`, abort, SIGKILL own child (`:2225-2235`, `:3304-3346`); not a tree kill — shell children **unknown**. | Read from code: `run.cancel()` for that run (`:632-652`). | Read from code: `session.abort()`, after 8 s ends own runtime and its tree (`:1354-1389`, `:685-695`). |
| 5 Usage per session | Per run from the result message (`:3000-3003`, `:3070-3083`); cost is the SDK's estimate. | Tokens per run (`:1081-1085`); `getUsage()` observed refused 403 for this account (`:103-109`). | Per session `state.usage` (`:1113-1131`, `:1430`). |
| 6 Folder per session | `cwd: config.workspacePath` plus `additionalDirectories` (`:2752`). | `local.cwd` plus `dirs` (`:344-345`). | `workingDirectory` (`:778`); runtime process runs from temp (`:658-660`). |

- **Engine-side collisions (all in `main/loop-live.ts`, none in the adapters):** sessions keyed by node (`stepSessionId(runId, nodeId)`, `:1009`, `:1555`); one `handoff` object per executor (`:1470`, reset per turn `:2419-2420`); one `onSteerableStep` per run (`:511`, `:2407-2417`); `inspection` written by every step (`cancelled`, `finalSnapshotId`, `applyDiff`, `sessions.push`); every step gets the run's `options.workspacePath` (`:2029-2033`); one run-wide `abortSignal` (`:2396-2402`) — "cancel all" works, no per-branch cancel. Usage sums over sessions (`:257-270`, `:2724-2750`), so it stays per branch if each instance has its own session id.
- **Not blocking:** the working-copy lock (held once per run as agent work; worktrees outside the working copy don't overlap); `activeLoopRunRefusal` (runs per host, not steps).
- **Researcher's recommendations, adopted (decision 22):** `maxConcurrent` Claude 3, Copilot 3, Cursor 1 (serialised), all "read from code". S10 changes: session id per instance; worktree per instance as `workspacePath`; refuse `suggest-interactive` on fan-out nodes; turn off the person's steering during a fan-out and route their instructions to every instance as engine-delivered text (S11); per-instance snapshots/diffs or serialised writes to `inspection`; "cancel all" only in the first increment (per-branch cancel open). S11 delivery: at `check_messages` only in the first increment, with "delivered when the branch next checks its messages; it may finish without reading it" stated, and messages to ended branches recorded undelivered (decision 23; Q3).
- **Unknown; only a live trial settles:** two concurrent turns running cleanly for any adapter (Cursor especially); Claude shell children after SIGKILL; Claude config/token refresh under concurrent processes; Copilot `mode: "immediate"`; Copilot and Cursor tools on a live loop step; Copilot's own git operations inside a worktree (`enableHostGitOperations: true`, `:791`). Smallest probe: a two-slice fan-out under Claude in an isolated profile (`npm run dev -- --isolated-profile <folder>`) — distinct sessions, own usage, cancel, own worktree. A billed run: Niclas's.

## Requirements of the vision

All **open** at the end of planning. Sub-goals carrying each in brackets.

- Entry agent gets the conversation's relevant context [S1, S2] — met by reviewed sub-goals (agent review; host path untested end to end; Niclas's trial)
- Identifiable snapshot linked to the conversation [S1, S2] — met by reviewed sub-goals (record header `contextSnapshot`, `context.md`)
- Decisions and exclusions included, not optional retrieval [S1, S2] — met by reviewed sub-goals
- Original reachable; cuts explicit [S1, S2] — met by reviewed sub-goals
- Summaries separate instructions from guesses [S1] — met by reviewed sub-goals (agent text labelled and quoted)
- Repository state and project instructions [S1, S2; Q1] — met as references (names only); native loading waits on Q1
- Supplied context inspectable, apart from the provider's own [S2] — met by reviewed sub-goal (in the saved prompt; untested in the window)
- Exclusions apply to every recipient [S1, S2, S11] — met by reviewed sub-goals by construction (one provider and account per run; branch messages stay within it; whether the contract should name them is Q4)
- Later user messages are changes to the task [sequential: works today; branches: S11] — met by reviewed sub-goals (instructions during a fan-out reach every running branch at its next check)
- Works across a provider or model change [S1] — met by construction (DSpatch's own record); not exercised across providers
- Steps may be skipped with a recorded reason [S3, S4] — met by reviewed sub-goals (chat loop's check; live model behaviour is Niclas's trial)
- Required steps stay required [S3] — met by reviewed sub-goal (validation refuses)
- Skipped shown as its own state; available and taken paths shown [S3] — met by reviewed sub-goal (look untested; Niclas's trial)
- Explicit routing decisions, not inferred from prose [S3, S5a] — met by reviewed sub-goals (declared `RESULT:` line; handoff tool)
- A new decision surfaced, not absorbed [S5a; existing blocked and spec-error routes] — met by reviewed sub-goal plus existing routes (handoff tool and hold; `BLOCKED` declared failures)
- Recommendation prompt with the user's choice [S5a, S5b] — met by reviewed sub-goals (prompt's look untested; Niclas's trial)
- Not repeated after refusal [S5a] — met by reviewed sub-goal
- Recorded as handed over [S5a] — met by reviewed sub-goal (`handed-over` status, journal, record)
- Safe point before the switch [S5a] — met by reviewed sub-goal (read after the turn settles; no step starts during the hold)
- Continue once without pasting again [S6] — met by reviewed sub-goal (host path untested; Niclas's trial)
- Chat gets the run's results, and the reverse [S7, S2] — met by reviewed sub-goals (window and host source untested; Niclas's trial)
- No extra permissions on a mode change [S5a, S6] — met by reviewed sub-goals (same `sendTurn` body, same session and policy)
- Parallelism optional and bounded (2–3) [S10a, S10b] — met by reviewed sub-goals in the engine (caps read from code, not observed live); used by the bundled parallel loop (S10c)
- Branches get bounded assignments and ownership [S10a, S10b] — met by reviewed sub-goals (slice block; overlap refused; ownership enforced by worktree only)
- Worktrees from a known base [S10a, S10b] — met by reviewed sub-goals (HEAD or `git stash create`; untracked files not in the base, stated)
- Coordinator may serialise or combine [S10c] — met by reviewed sub-goal (slicer may return a single slice; role text, not enforced)
- Messages through a mailbox with sender, recipient, purpose [S11] — met by reviewed sub-goal
- Delivery separate from acknowledgement [S11] — met by reviewed sub-goal
- Contract changes not binding until resolved [S11, resolved at integration] — met by reviewed sub-goal (open proposals listed for the integrator; resolution is role text)
- No endless waiting; no restart from a stale message [S11] — met by reviewed sub-goal (no wait tool; ended recipients refused; no restart)
- Revision references on messages [S10, S11] — met by reviewed sub-goals (sender's base commit and branch on every message)
- One integrator owns the combined result [S10c] — met by reviewed sub-goal (integrator role merges; engine never merges; live behaviour untested)
- Integration-targeted checks, not a suite per agent [S10] — met by reviewed sub-goal as role text (S10c integrator and branch roles; untested live)
- Integration, completion and approval kept apart; report says implemented/reviewed/tested/skipped/left [S12, S14] — met by reviewed sub-goals ("Steps not reached" from the recorded drawing; "Left for you to examine" from recorded facts; older records say "not recorded"; look untested)
- Runtime owns identity, context versions, routing, branches, messages [S2, S3, S5a, S10b, S11] — met by reviewed sub-goals (snapshot id and record; declared skips; handoff hold; branch sessions and journal; mailbox journal)
- Provider support checked before claimed [S9] — met by research (read from code; concurrency not observed live)
- Delivery limits shown when not immediate [S11] — met by reviewed sub-goal ("delivered when each branch next checks its messages")
- Distinct states incl. handed over [S3, S5a] — met by reviewed sub-goals. Durable automatic resume — **met within BRIEF §3's allowance, limitation stated** (decision 30): there is no automatic resume; the continuation is a new run with the same mandate from the same conversation, which reconciles STATE.md for the mission and, for chat loops, carries earlier runs through S2's snapshot and S7's recap
- Cancel stops dispatch and accounts for tools in flight [S10b; sequential exists] — met by reviewed sub-goal for "cancel all" (each branch still commits its leftovers); per-branch cancel open
- Verification policy for every branch [S10, S11] — met by reviewed sub-goals as role text (branch does its slice's verification; integrator targets integration)
- UI says why a method was chosen and what each branch owns [S3, S5, S10, S12] — met by reviewed sub-goals (skip reasons, handover reasons, slices with owned paths, report; look untested)
- Concepts reusable for future graph construction [node help in S3, S5, S10]; dialogue-based graph construction — **in scope by Niclas's decision of 14 November 2026** (Q2 answered); now R1, pending
- **R7** (hover text short, with the full instructions in a persistent detail view; recorded 14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`). Met by reviewed sub-goals for every hover text this run added or touched [S18a, S18b, S20, S21, S22, S23b, S25, S25b].
  - The control bar's long hovers have moved into **Details** (S25b).
  - Hover texts this run did not touch are not swept. One known example is `HandoffPrompt`'s `choice.title`.
  - The look is untested; that is Niclas's trial.
- **R1–R6** (extension of 14 November 2026). These are agent-reviewed sub-goals only: no live run, no window trial, and not approved by Niclas. Recorded on coordinator visit 13 (call 51), before the whole assessment.
  - **R1, graphs through conversation** [S17, S23a, S23b]. Met by reviewed sub-goals.
    - Proposals are validated and kept apart from applied changes.
    - Apply checks the base it started from; editor saves and the unsaved-drawing question are checked as well.
    - Nothing runs.
    - The host path is untested. A1 is open: in this workspace, Apply can write the mission graph.
  - **R2, readable layout** [S18a, S18b]. Met by reviewed sub-goals as measured: no route crosses an unrelated box, and the layout is deterministic. Visual clarity is Niclas's to judge.
  - **R3, parallel work visible without hover** [S16, S20, S25, S25b]. Met by reviewed sub-goals. Branch activity needs the rebuilt host, and the window is untested.
  - **R4, a readable chat during a run** [S16, S21, S21b]. Met by reviewed sub-goals.
    - A run read back from its record shows no sub-goal claims (S21b).
    - No window trial.
  - **R5, the final run card** [S16, S22]. Met by reviewed sub-goals. The host path needs the rebuilt host.
  - **R6, one implementer with a model policy** [S16, S19, S19b]. Met by reviewed sub-goals as a capability. No shipped graph was merged (decision 37).
    - Claude, Cursor and Copilot are checked against a model list when one has been read.
    - Otherwise the "Runs with …" line says so.
- Reconcile the parallelism document [S8] — met by reviewed sub-goal (§10 of the parallelism document)

**Success criteria (BRIEF §1.3):** (1) "implement that" preserves decisions [S1, S2] — implemented and agent-reviewed; awaits Niclas's trial; (2) small task continues in chat without resubmission [S4, S5a, S5b, S6] — implemented and agent-reviewed; awaits Niclas's trial; (3) branches exchange a finding before completion [S10a–S10c, S11] — implemented and agent-reviewed with a scripted executor only; no live provider has run concurrent branches; Niclas's trial; (4) combined result keeps scope and provenance [S10a–S10c, S12] — implemented and agent-reviewed (branches, commits, base, messages, per-branch usage in the report; scripted only); Niclas's trial.

## Decisions taken by the mission

1. **Snapshot assembled mechanically by DSpatch, not summarised by an agent** (S1). Reason: faithful by construction, provider-independent, cannot promote an agent's guess to a decision. Alternatives: chat agent writes a structured summary (paraphrase risk); both (deferred as an optional labelled extra).
2. **Later steps get the person's words; only the entry step gets agent excerpts** (S2). Reason: TASK_PRECEDENCE makes the person's words the assignment, so reviewers need them; agent excerpts cost tokens at every step. Alternatives: entry only (fails the reviewer); everything everywhere (cost).
3. **Skip declared on the edge (`skips`), reason on the `RESULT:` line** (S3). Reason: visible in the drawing, explicit, reuses the outcome protocol; old replies still parse. Alternatives: a skip tool (provider-dependent, invisible in the drawing); inferring skips from unreached nodes (no reason).
4. **Handoff is a DSpatch tool, enabled per node** (S5). Reason: AGENT_BEHAVIOUR §4 forbids detecting it in reply text; all adapters carry app tools. Alternatives: `RESULT: handoff` (a work result, which §4 rules out); a human node (DSP-31 not built; puts the choice in the drawing).
5. **Parallelism is fan-out inside one node visit, not general fork/join** (S10). Reason: smallest real increment, named in the parallelism document §9; walk, journal and controls stay one node at a time. Alternatives: `split`/`join` node kinds (rewrites the single position); provider-native subagents (vision forbids depending on them).
6. **Worktrees start from a `git stash create` commit when the working copy is dirty** (S10). Reason: known common base that includes uncommitted work, without touching it. Alternatives: require clean (friction); HEAD (loses uncommitted work).
7. **The integrator is a role and it merges** (S10). Reason: the vision makes it the owner; engine merging would decide conflicts. Alternative: engine applies patches.
8. **One provider per run** (S2, S11). Reason: snapshot and messages never cross a provider/account boundary, so the content-exclusion contract is not crossed. Alternative: per-node provider (changes what a provider receives; would stop for Niclas).
9. **No blocking wait tool for messages** (S11). Reason: mutual waiting impossible by construction. Alternative: wait with timeout (bounded, adds a failure mode).
11. **The snapshot id covers every input, not only what the text shows** (S2). Reason: the record uses the id to say which state of the conversation a run started from; two different states must not share an id because a limit hid the difference. Alternative: id over the visible text only (recomputable from `context.md`); comparing the texts still answers that.
13. **"Done, check skipped" ends as `not-success` with its own sentences** (S4). Reason: `success` means "Assignment met"; `not-success` draws a neutral mark. Alternatives: `report-delivered` (would claim a report); a new `TerminalEnding` value (changes the graph-format contract for no gain).
14. **One trailing `:` after the outcome name is accepted, by one shared reader** (S4). Reason: a step writing `RESULT: done-unchecked: docs only` otherwise lost its outcome and the skip; every existing name reads the same. Alternative: fix only the comment and leave colon-writers routed to the fallback.
30. **Durable automatic resume is recorded as met within BRIEF §3's allowance, with the limitation stated, not as skipped** (whole assessment). Reason: BRIEF §3 (Niclas, 13 November) says a clear and reliable manual continuation is enough when automatic resumption is missing; the continuation is a new run with the same mandate, which reconciles STATE.md and, for chat loops, carries earlier runs (S2, S7). Alternative: leave it "skipped" (reads as unmet although the brief accepts it). If Niclas meant something else by continuation, he corrects this between runs.
31. **The whole assessment's two gaps become one sub-goal, S14, whose check is one run of the `loop` test group** (whole assessment). Reason: the report change touches the same files whose dependents were never run together; one group run covers both the new code and the integration risk the assessment names, under the verification policy's "concrete risk". Alternative: two sub-goals (an extra implement/review pair for a test run).
28. **Mailbox bounds: 4,000 characters per message, 20 messages per branch per visit** (S11). Reason: room for a finding with context without becoming a channel for whole files; stops a branch flooding the others. Alternative: unbounded (vision asks for bounded communication).
29. **The person's instructions during a fan-out go through the mailbox at each branch's next `check_messages`, and branch prompts no longer take from the instruction queue** (S11). Reason: reaches every running and waiting branch, recorded per branch, no steering (Q3 open). Alternatives: put instructions into each branch's prompt at start (misses running branches; the first branch would take them all); steering (ruled out).
27. **Branches run on a contained instance path that never writes the run's shared inspection** (S10b). Reason: concurrent turns cannot corrupt the run record; a branch's commit on its temporary branch is its record of change. Cost: no per-branch before/after snapshot. Alternatives: serialise `inspection` writes (locks across async turns); a second executor type (a second set of wiring everywhere). Also: too few calls for every branch ends the node `branch-failed` before any starts, never a half-started fan-out (alternative: `limit-reached`).
26. **Owned-path overlap rule and DSpatch's commit author** (S10a). Paths are normalised (forward slashes, no `./`, no trailing `/`) and overlap when equal or one contains the other, compared case-insensitively (Windows); empty, absolute, drive, UNC, `.`/`..` and glob paths are refused. Commits on temporary branches are authored `DSpatch <dspatch@localhost>`, so they are visibly DSpatch's. Alternatives: plain string prefix (`app/src` would overlap `app/srcx`); case-sensitive (two branches could write one Windows file); globs (overlap undecidable simply); committing as the person's git identity (would make DSpatch's commits look like his).
24. **Fan-out specification choices made in S8** (S8, recorded after review): at most 6 slices per fan-out, with slices beyond the concurrency cap waiting for a free branch rather than refused; worktrees under `<userData>/loop-runs/<runId>/worktrees/` (outside the working copy); DSpatch commits each branch's leftover work to its temporary branch `dspatch/run/<runId>/<slice>` (a commit on a DSpatch-made branch, not a merge — decision 7 stands: the integrator merges); temporary branches kept and listed in the report for Niclas to keep or delete, never deleted by DSpatch; a malformed slice block ends the node as `branch-failed`, not as its own ending. Reason: each keeps the working copy untouched until integration and leaves deletion of anything in the repository to Niclas. Alternatives: refuse more than the cap; worktrees inside the repository; leave uncommitted work in the worktree (lost when it is removed); delete temporary branches at the run's end (deletes work).
25. **S10 split into S10a, S10b, S10c** (coordination). Reason: S10 is the largest change of the mission; format and worktree code can be proven by unit tests before the engine runs instances concurrently, and the bundled graph comes last. Alternative: one sub-goal (the S10 stall risk the plan names).
21. **Correct the Copilot caveat rather than keep Copilot loop steps off app tools** (S9 → S8). Reason: the code already offers tools on Copilot loop steps under the chat policy, which the person chose for loop steps (`copilotPolicyFor('loop')`, pinned by a test); the caveat was wrong, not the policy. Alternative: change the policy to withhold tools from Copilot loop steps (a change to a decided permission/tool policy, which would stop for Niclas).
22. **Fan-out bounds per adapter: Claude 3, Copilot 3, Cursor 1** (S10, from S9). Reason: per-session isolation by reading for Claude and Copilot; Cursor runs in-process and concurrent turns were never observed. All recorded as read from code, not observed. Alternative: 1 everywhere until a live probe (honest but builds no parallelism the vision asks for).
23. **Branch messages are delivered only at `check_messages` in the first increment; no use of steering for agent-to-agent text** (S11, from S9). Reason: works for every provider, is recorded, and does not change what steering means (today it carries only the person's input). Alternative: push into running turns via `steer` where supported (Q3, Niclas's).
19. **A loop recap and its removal share one stored field, `StoredMessage.loopRecap { runIds, text | null }`, and removal reuses DSP-121's `discardPendingRecap`** (S7). Reason: one place to keep in step, one removal mechanism, no host-contract change. Alternatives: a separate list of removed run ids; a second removal method (a second mechanism and a contract change).
20. **S9 before S8** (coordination). Reason: S8 names the first parallel increment and its bounds; whether concurrent sessions are safe per adapter (S9) decides `maxConcurrent` and what S8 may claim. Alternative: S8 first and revise it after S9.
17. **The handover text is stored in `StoredMessage.handover`, with the saved prompt empty** (S6). Reason: a reader that ignores a flag can never quote DSpatch's text as the person's words. Alternative: keep the text in `prompt` with a flag.
18. **After a handover the window unticks *Use loop*** (S6). Reason: no hidden mode where the box is ticked but the next send bypasses the loop. Alternative: leave it ticked and bypass.
16. **`StepHold` `'handoff'` removed; the wait shows through `describeControl`** (S5b). Reason: a `StepHold` names why a step's release waits (`run-held`); a handoff waits after the step ran and has its own journal kinds. Alternative: a new reducer-state field producing `'handoff'` (changes existing control tests).
15. **S5 split into S5a (engine) and S5b (window)** (coordination). Reason: S5 spans engine, tools, control port, record, IPC and renderer; one review round over all of it risks stalling, and the engine part can be tested with a scripted executor on its own. Alternative: one sub-goal (larger rework risk).
12. **The bundled chat loop's check becomes skippable** (S4). The chat loop's notes record the interaction-model correction's "a successful work step always reaches check"; the vision (adaptive loops) and BACKLOG's near-term follow-up ("mandatory checking in the small chat loop is not evidence") supersede that for this graph, under Niclas's 13 November authorisation (BRIEF §3). The graph's notes are updated to say which decision they now record. A skipped check ends at a terminal that never reads as "met". Alternatives: keep check mandatory and demonstrate skips only in a new graph (leaves the vision's main case unbuilt); make check skippable in the development loop too (not asked for; that loop guards code changes).
33. **A waiting recap removal is stored on the conversation, as `StoredConversation.removedLoopRecaps`, saved when Remove is pressed** (S15, the implementer's choice, accepted by review). Reason: the removal belongs to the conversation, and the conversation file is already written atomically and parsed defensively. Alternatives: a placeholder message with `loopRecap { text: null }` (a turn that never happened); a separate store under `userData` (a second file to keep in step); leaving it in memory (the bug).
32. **S15 goes to the one implementer (`implement`), not the parallel path** (run `chat-loop-2026-11-14T08-41-01-671Z`, visit 1, as the mandate asks this choice to be recorded). Dependencies: none between (a) and (b). They write different files (a: `shared/loop-graph-editing.ts` and an editor test; b: `main/chat-service.ts`, maybe `main/conversation-store.ts`/`shared/bridge.ts`, and their tests) and share no interface, so the split is structurally possible. Expected benefit: low. Both parts are small; (a) is a few lines in one pure function. The parallel path costs about five calls (slicer, two branch instances, integrator, parallel review) against two (implementer, review), plus committing STATE first and a merge. The time it saves is about the length of (a), which the slicer and integrator steps use up. (b) also holds the one real design choice (where a removal is stored), which suits one coherent attempt. Alternatives: `implement-parallel` with slices (a) and (b) (it would work but brings no gain worth its cost); two sub-goals S15a/S15b (an extra review pair for no gain; the mandate names one S15). Parallelism is not a goal in itself (BRIEF §3).
35. **S16 and S17 go together through `implement-parallel`** (visit 2). They write different new files (`shared/run-presentation.ts` and `shared/graph-proposal.ts`, each with its own test). Neither imports the other, so there is no interface between them, and both must exist before any dependent sub-goal starts. Done in sequence they would take two implementer and review pairs. In parallel they take a slicer, two branches, an integrator and one review, about the same number of calls, in roughly half the wall time, with one review checking both shared interfaces together. Alternatives: two sequential `implement` sub-goals (same calls, slower); one implementer for both (one large coherent brief, but no shared design to keep coherent).
36. **Layout and routing are written in-house, with no new dependency** (planner N4, adopted). Reason: graphs have up to about 25 nodes, the code is deterministic and unit-testable, and it adds no bundle or licence cost. Alternative: elkjs (EPL-2.0, about 1.4 MB), which would make a licence choice for Niclas.
37. **R6 is built as a capability, and no shipped graph is merged** (planner N1). No bundled graph has small, medium and large implementer nodes, so there is nothing to merge without inventing one. S19's test uses a scripted graph with a select policy. Models stay within the run's one provider (decision 8; planner N3).
34. **R1–R6 start with `plan`, not with an implementer brief** (run `chat-loop-2026-11-14T09-03-54-467Z`, visit 1). Reason: there is no plan for them. They span the graph editor, the canvas layout, the run view, the chat transcript, the record and run report, and node model selection. The mandate asks for the shared interfaces to be defined before dependent changes diverge, and that needs a code-read map of what exists: `GraphCanvas.tsx`, `LoopEditor.tsx`, `loop-run-view.ts`, `loop-transcript.ts`, `loop-run-report.ts`, `loop-record.ts`, the drawing's position fields and the node's model fields. The app has no layout library among its dependencies (`app/package.json` has no elkjs, dagre or React Flow), so a layout approach is a real choice for the plan. Research is skipped for now: the code should settle most of it, and the planner can name a concrete uncertainty if one blocks a sub-goal. Alternatives: brief a first "shared interfaces" sub-goal directly (it would guess at the existing code); a separate research step first (no concrete uncertainty is named yet).
38. **After the failed parallel attempt, S16 and S17 go to the implementer one at a time** (visit 3). Reason: the engine running this mission is fixed at `2e22eb2`, so the fan-out fails the same way on every later visit in this run, and retrying it would spend calls for nothing. Alternatives: retry in parallel (same failure); S16 and S17 in one implementer brief (allowed, but the role asks for one sub-goal per brief, and S16 is the larger shared interface). The parallel path stays unused in this run unless S24 is in the engine or `core.longpaths` is set.
39. **Decision 38 no longer stands (Niclas, 14 November 2026, between runs).** Its reason was that the engine fixed at `2e22eb2` could not make worktrees on this repository on Windows. S24 is now fixed and in the engine, so the coordinator again chooses `implement` or `implement-parallel` per sub-goal by its dependencies and expected benefit (BRIEF §3, *Parallel sub-goals in the mission loop*). Nothing done under decision 38 is redone: S16 is implemented and goes to review.
40. **S16's account goes through `implement`, not through review directly, and not in parallel** (run `chat-loop-2026-11-14T09-54-18-366Z`, visit 1). The mandate asks for this. In the drawing, review is reached only after an implementer or integrator visit, and the reviewer needs an account of what was done. The implementer's account is to cover what the preserved code does against S16's five acceptance criteria (quoted in the brief from the earlier run's coordinator visit 3), which checks already passed and why they still hold, and what remains uncertain. Its checks are reused, not rerun: none of S16's imports changed since they ran. The implementer reruns a check only if it changes code or has a concrete unresolved concern, and says which. The parallel path is not used: there is nothing to split, and no new code is planned. Alternatives: `implement-parallel` (nothing to slice); reimplementing S16 (forbidden by the mandate and wasteful).
41. **S17 and S18a go together through `implement-parallel`** (run `chat-loop-2026-11-14T09-54-18-366Z`, visit 2, under decision 39). Neither depends on anything, and neither imports the other.
    - **Separate files.** S17 writes `shared/graph-proposal.ts` and its test. S18a writes `shared/loop-edge-routing.ts` and its test, plus `GraphCanvas.tsx`, `loop-editor.css` and `loop-edge-geometry.ts`.
    - **One shared file.** The only file both touch is `app/scripts/run-tests.mjs`, one line each. It goes to the integrator.
    - **Benefit.** It is the same as decision 35: about the same number of calls as two sequential pairs, in roughly half the wall time, and both are substantial new modules.
    - **The engine path.** This is the first live use of S24's worktree fix. If a branch fails, the sub-goal is not done. The fallback is `implement` per sub-goal, recorded as a new attempt.
    - **Alternatives.** Sequential S17 then S18a (slower, same calls). Pairing S18a with S19 or S22, as the planner suggested (S19 and S22 depend on S16, which is now reviewed, but S19 holds a host change and S22 depends on the S16 label question S1). Including S25 (it is small, but it touches the editor window, close to S18a's files).
42. **S25 goes to the one implementer (`implement`)** (run `chat-loop-2026-11-14T09-54-18-366Z`, visit 3). It is small. Its three parts all concern how a paused run reads in the window: the control bar note, the editor's cancel control, and the graph's pause marks. They share one fact, how the window learns the run's phase, so splitting them would put that one choice in three branches. Alternatives: `implement-parallel` with three slices (more calls than the work; a shared undecided choice); pairing S25 with S19 or S22 in parallel (they are unrelated sub-goals, and S22 waits on S16 suggestion S1's label question, which S25 does not settle).
43. **S25's review findings N1–N3 become a sub-goal of their own, S25b, sent to `implement` now** (visit 4). Reason: N1 is an R7 gap that S25 touched; the coordinator's S25 brief said "add or change" where R7 says "touch". N3 leaves Niclas's S25 (b) only partly met. Both are small and in the same window files S25 just changed, so the context is fresh. Alternatives: fold them into S20/S23b (it leaves an approved requirement open across several sub-goals); S19 ‖ S22 first (feasible, and next).
44. **S19 and S22 go together through `implement-parallel`** (visit 5). Both depend only on S16, which is reviewed, and neither depends on the other. Both are substantial. They meet in two places:
    - **The run record type `loop-record.ts`.** S22 owns it, adding fields to `RecordedRunEnding`. S19 writes its model data only as data on `node-entered` and `branch-started` in `loop-run.ts`/`loop-live*.ts`. Both are additions, so neither changes the other's fields.
    - **`host/project-host.ts`.** S22 owns the run-start HEAD capture and the ending write (about l.3984). S19 may touch only its `prepareLoopRun` call (l.146 import, the chat-loop start path) to pass the graph for the pre-run model check. Those are different hunks, so the integrator merges them.

    S16's `ModelSelectionRecord` is the shared type: S19 fills it, and S22 shows it if it is present.

    S16 review suggestion S1 is still open: any step that receives a fan-out's result is labelled integrator. S22 must not show that label as fact. It shows counters only.

    Alternatives: run the two in sequence (slower, about the same number of calls); keep S19 alone and do S22 with S20 (S20 also needs S18a and S19 for the model).
45. **S20 goes to the one implementer (`implement`)** (visit 6). Its parts are branch activity in the engine (`runInstance` emits step activity with `sliceId`), host forwarding, the node summary, the **Branches** panel, the chat detail and a separate client window. They all hinge on one undecided shape: how branch activity is carried and folded per S16's `LiveOutputAddress`. Each UI part depends on that shape, so slicing would leave every branch guessing it. The previous parallel pair also needed four branch visits and five integrator visits. Alternatives: `implement-parallel` with an engine slice and a window slice (the interface is not yet fixed); S19b first (small, and not on the R3 path).
46. **S19b goes next, before S21, through `implement`** (visit 7). Its new part (3) is a failing test in the `loop` group, in committed S19 code, and it leaves S20's step-activity mapping untested. A red test should not sit under further sub-goals. Parts (1) and (2) are small and touch the same model-selection code. One implementer covers all three. Alternatives: S21 first (it would build on a red group); folding the guard into S21 (unrelated files).
47. **S21 goes to the one implementer (`implement`)** (visit 8). The step-report card, branch grouping, the integrator's combined report, attention markers and the opt-in `SUBGOAL:` line all fold the same per-visit model, S16's `stepReportsFrom`, into one chat entry, and they share one design question: which step counts as the integrator. S16 review suggestion S1 is settled here. The plan's rule is structural: a step whose arriving edge delivers a fan-out node's result. S21 narrows it to the step that a fan-out's success edge leads to directly, and leaves the label off when that step's role is not the integrator, so a reviewer reached later is not mislabelled. Splitting the work would put that one question into every branch. Alternatives: `implement-parallel` with a pure card model in one slice and the window in another (they meet on the card type, which is not yet settled); S18b first (it is independent, but R4 is the more central requirement).
48. **The integrator role is identified by the role id `project-integrate`** (S21, the implementer's choice, recorded at the review's request). Reason: decision 47 asks for a role test, not a name test. `project-integrate` is the one integrator role the bundled loops use, the Parallel loop and the mission loop. Alternatives: a role capability field (a format change for one use); any role whose id contains "integrat" (a name test by another route). A graph with its own integrator role gets ordinary step cards until its id is added.
49. **S18b goes to the one implementer (`implement`)** (visit 9). It is one coherent layout algorithm (`shared/loop-layout.ts`) and one **Arrange** action in the editor, so there is nothing to split. It reuses S18a's `findBackEdges` and `nodeSize`. It also takes S18a's review suggestion 2, a test for the last-resort route, because arranged graphs are where that route could appear. Alternative: S23a first (it depends on S18b by the plan).
50. **S23a goes to the one implementer (`implement`); a new loop's place is the planner's recommendation** (visit 10).
    - **Why one implementer.** S23a is one coherent host feature: four chat-session app tools and one stored conversation field. It also holds a saved-format change, which suits one careful attempt.
    - **Where a new loop lives.** `<first project folder>/.dspatch/loops/<id>.loop.json`, with `<id>.graph.json` beside it, and new role texts under `.dspatch/loops/roles/<id>-<role>.role.md`. This is an ordinary design choice within R1. It needs no definition-format change and keeps the loop inside the project.
    - **What a provider receives.** The tools give the chat agent only project files it can already read with its own tools, plus DSpatch's own node help. No new category goes to the provider, so this is not a content-exclusion question for Niclas.
    - **Alternatives.** `implement-parallel` with a tools slice and a storage slice: they meet on the proposal type, which S17 fixed, but the storage slice is small. Storing proposals in a separate file under `userData`: a second store to keep in step, against decisions 17, 19 and 33's pattern.
51. **Proposals are stored as a list, `StoredMessage.graphProposals`, not a single `graphProposal`** (S23a, the implementer's choice, accepted by review). Reason: an agent whose draft has errors proposes again in the same turn, so one turn can hold several proposals. It is optional and parsed defensively, in the pattern of decisions 17, 19 and 33. Alternative: one field per message (a second proposal in a turn would overwrite the first).
52. **S23b goes to the one implementer (`implement`), and Apply writes only inside the project's own folders** (visit 11). Reason: the card, Apply, the save check and the editor's reconcile all turn on one contract, the `expectedContentHash` on `loop.saveGraph`, so they belong in one attempt. On S23a's A1, Apply refuses three things:
    - a target outside the open project folders, which covers DSpatch's own bundled loops when they are not the project;
    - a graph that an active run uses;
    - a stale base.
    
    The card shows the full path it will write. This repository's mission files are inside the project, so the active-run refusal is what keeps the running mission's graph safe. The product cannot know about BRIEF §5's fixed files; they stay fixed by the mission's rules. Alternatives: a protected-file list in the product (mission bookkeeping turned into product rules); allowing bundled targets (writes into DSpatch's install).
53. **S21b goes to the one implementer (`implement`) before the whole assessment** (visit 12). Reason: it is the last open departure from a brief that this run made. It is small, in one pure function and its two callers. The assessment should judge R4 with it settled. Alternative: leave it for the assessment to list (it would stay a known gap the run could have closed for one implement and review pair).
10. **The planner's result accepted as the plan despite its undeclared `RESULT: planned`** (coordination). Reason: the content is complete and checked against code; re-planning would spend calls for nothing. Alternative: send back to `plan`.

## Decisions needed from Niclas

**Q1 — Should loop steps load project instructions (AGENTS.md) natively** (Claude `settingSources`, Copilot without `skipCustomInstructions`)? Affects S1/S2 and what the provider receives (a content-exclusion matter, so it is Niclas's). Recommendation: no; S1 lists instruction files as references and roles keep pointing at them. Continues without it: everything.

**Q4 — Should the content-exclusion contract's §6 list of unfiltered agent-written material name branch messages once S11 builds them?** (S11 has built them, `6de7fd6`; the condition is met.) (from S8, 14 November 2026) It is an edit to a decided contract, so it is Niclas's. Recommendation: yes, as a one-line addition after S11, since branch messages are of the same kind as loop handovers and results passed to the next step. Continues without it: everything.

**Q3 — May a branch's message be pushed into another branch's running turn through steering (Claude `streamInput`, Cursor `Run.steer`)?** (from S9, 14 November 2026) Steering today carries only the person's input; using it for agent-to-agent text changes what that channel means. Affects S11's "immediate" delivery. Recommendation: not in this mission; deliver at `check_messages` (decision 23) and, if wanted later, push only with the text labelled as from that branch. Continues without it: all of S10 and S11.

**Q5 — May the mission graph and its coordinator role opt into S21's `declares: ["subgoal"]` (and later S19's model policy), between runs?** These are BRIEF §5's fixed files, so Niclas has to edit them or allow the edit. Without that, the mission loop's own step cards show "sub-goal unknown". (From planner N2, 14 November 2026.) Recommendation: yes, as a between-runs edit after S21 is reviewed. Continues without it: everything.

**Q2 — Dialogue-based graph construction: skipped in this mission?** The vision frames it as future; this mission makes the concepts reusable and explained, but builds no conversational graph assembly. Recommendation: record as skipped with that reason, not as met. Continues without it: everything; if wanted in scope, it becomes a sub-goal after S12.
- **Answered by Niclas, 14 November 2026** (run `chat-loop-2026-11-14T09-03-54-467Z`'s mandate): **in scope.** He wrote: "Niclas explicitly approves including Q2, dialogue-based graph construction, in this assignment. Extend the existing mission and record this decision. Preserve completed work, including S15." It is requirement R1. It is no longer a question.

## Next action

What the coordinator will do next, rewritten on every visit, so that a run that ends between two steps leaves it here.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 13 (call 51).** S21b is reviewed and committed with this file. Every sub-goal planned for R1–R7 is now reviewed: S16–S25b. R1–R7 are marked in *Requirements of the vision*. The whole is sent to assessment (`assess-whole`), the first since the extension.

**Next:** record the assessment's verdict. A concrete gap it names becomes a sub-goal, for example restored runs showing no sub-goal claims (S21b) or A1 (S23b). If only Niclas's items remain, end `needs-decision` and add this run's run-log line and DSP-209's dated note. Those items are his trials, Q1, Q3, Q4, Q5, and the engine transition with **Restart host**.

If this run ends first, the next run reconciles from the S21b commit.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 12 (call 48).** S23b is reviewed after one rework round, and committed with this file. S21b went to `implement` (decision 53). **Next:**
1. Record S21b's review and commit it.
2. Mark R1–R7 in *Requirements of the vision* from the records.
3. Send the whole to assessment (`assess-whole`), which has not been done since the extension.

Host code changed in S19, S19b, S20, S21, S22, S23a and S23b. The engine therefore needs a rebuild and **Restart host** at the next transition. No new host method was added in this run. If this run ends first, the next run reconciles S21b from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 11 (call 43).** S23a is reviewed and committed with this file. S23b went to `implement` (decision 52). **Next:** record S23b's review and commit it, then S21b (small), then the whole assessment of R1–R7 (`assess-whole`). Host code changes in S19, S19b, S20, S21, S22, S23a and S23b, so the engine needs a rebuild and **Restart host** at the next transition. If this run ends first, the next run reconciles S23b from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 10 (call 40).** S18b is reviewed and committed with this file. S23a went to `implement` (decision 50).

**Next:**
1. Record S23a's review and commit it.
2. Then S23b. Fold in S21's S-a (restrict `SUBGOAL:` to declaring nodes) only if S23b touches `step-report-cards.ts`. Otherwise brief S-a alone.
3. Then the whole assessment of R1–R7.

Host code changes in S19, S19b, S20, S21, S22 and S23a, so the engine needs a rebuild and **Restart host** at the next transition.

If this run ends first, the next run reconciles S23a from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 9 (call 37).** S21 is reviewed after one rework round, and committed with this file. S18b went to `implement` (decision 49).

**Next:**
1. Record S18b's review and commit it.
2. Then S23a (needs S17 and S18b), then S23b.
3. Then a whole assessment of R1–R7, since this extension has not been assessed yet.

S21's suggestion S-a (restrict `SUBGOAL:` to declaring nodes) is open; fold it into a brief that touches `step-report-cards.ts`, or brief it alone before the assessment.

Every UI brief carries R7. Host-side code changed in S19, S19b, S20, S21 (an optional `sliceId` on a reply event) and S22, so the engine needs a rebuild and **Restart host** at the next transition.

If this run ends first, the next run reconciles S18b from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 8 (call 32).** S19b is reviewed and committed with this file. S21 went to `implement` (decision 47). **Next:**
1. Record S21's review and commit it.
2. Then S18b, which is independent and builds on S18a's `findBackEdges`.
3. Then S23a and S23b.

Every UI brief carries R7. Host-side code changed in S19, S19b, S20 and S22, so the engine needs a rebuild and **Restart host** at the next transition. If this run ends first, the next run reconciles S21 from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 7 (call 29).** S20 is reviewed and committed with this file. S19b went to `implement` (decision 46). **Next:**
1. Record S19b's review and commit it.
2. Then S21, which needs S16 and S20 and settles S16 suggestion S1 (the integrator label).
3. Then S18b, S23a and S23b.

Every UI brief carries R7. Host-side code changed in S19, S20 and S22, so the engine needs a rebuild and **Restart host** at the next transition. If this run ends first, the next run reconciles S19b from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 6 (call 26).** S19 and S22 are reviewed and recorded, and their code is in `2798903`..`dbb2025`. This file is committed after them. S20 went to `implement` (decision 45). **Next:**
1. Record S20's review and commit it.
2. Then S21, which needs S20 and settles S16 review suggestion S1, the integrator label.
3. Then S19b (small), S18b, S23a and S23b.

Every UI brief carries R7. Host code changes in S19, S20 and S22, so the engine needs a rebuild and **Restart host** at the next transition. If this run ends first, the next run reconciles S20 from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 5 (call 15).** S25b is reviewed and committed together with this file. Then S19 and S22 were sent through `implement-parallel` (decision 44), from that commit, with no tracked change left uncommitted.

**Next:** when the parallel path returns, record:
- the slices and their owned paths;
- each branch's `dspatch/run/chat-loop-2026-11-14T09-54-18-366Z/branches/v<n>/<slice>` branch, with its commit and ending;
- the integrator's merges, how it handled `project-host.ts` and `run-tests.mjs`, and any proposals;
- the review's verdict.

Then commit this file. If a branch failed, record what was merged and what was not, and send the missing sub-goal through `implement` as a new attempt. After that: S20 (needs S16, S18a and S19), S21, S18b, S23a and S23b.

Host code changes in S19 and S22. Both need an engine rebuild and a **Restart host** at Niclas's next transition, never during this run.

If this run ends first, the next run reconciles from `git log` after the S25b commit and from `git branch --list 'dspatch/*'`.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 4 (call 12).** S25 is reviewed and committed with this file. S25b went to `implement` (decision 43). **Next:** record S25b's review and commit it. Then S19 ‖ S22: check their files for overlap and use `implement-parallel` if there is none, committing this file first. After that: S20, S21, S18b, S23a and S23b. Every UI brief says R7 covers hover texts it **touches**, not only those it adds. If this run ends first, the next run reconciles S25b from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 3 (call 9).** S17 and S18a are reviewed and recorded. Their code is in `9d48c02`/`fdd2156`, `52bc9c4`/`88a49dc` and `d6b2a3b`, and this file is committed after them. S25 went to `implement` (decision 42). **Next:** when S25's review returns, record it, and if accepted commit S25's named paths with this file. Then go on in this order: S19 and S22, which both depend only on S16, as a candidate parallel pair if their files do not overlap (S19 changes host and session code, S22 the shared final card and the ending); then S20, S21, S18b (which tests the last-resort route, suggestion 2 above), S23a and S23b. Every UI brief carries R7. If this run ends first, the next run reconciles S25 from the uncommitted working copy.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 2 (call 4).** S16 is reviewed and recorded, and committed with this file as `(DSP-209 S16)` after `9fe95a9`. S17 ‖ S18a were sent through `implement-parallel` (decision 41) after that commit, so no tracked file is uncommitted. **Next:** when the parallel path returns, record:
- the slices and their owned paths;
- each branch's `dspatch/run/chat-loop-2026-11-14T09-54-18-366Z/branches/v<n>/<slice>` branch, with its commit and ending;
- the integrator's merge commits and how it resolved the `run-tests.mjs` line and any proposals;
- the review's verdict.

Then commit this file. If a branch failed, record what is merged and what is not, and send the missing sub-goal through `implement` as a new attempt. After that: S25 (`implement`, small, window), then S19 and S22 (both after S16), S20, S21, S18b, S23a and S23b. Every UI brief carries R7. If this run ends first, the next run reconciles from `git log` after the S16 commit and `git branch --list 'dspatch/*'`.

**14 November 2026, run `chat-loop-2026-11-14T09-54-18-366Z`, coordinator visit 1 (call 1).** Reconciled (see *Where the mission stands*). R7 recorded. S16 sent to `implement` for its account only (decision 40). **Next:** when S16's review returns, record the verdict, findings and checks in a new S16 record. If it accepts, commit exactly `app/src/shared/run-presentation.ts`, `app/tests/run-presentation.test.ts`, `app/scripts/run-tests.mjs` and this file, with a message naming DSP-209 S16 (no push). Then choose the next sub-goal. S17 and S18a have no dependencies. S25 is small and window-only (`LoopControlBar.tsx`, the editor's cancel control, the graph's pause marks). S19 and S22 depend only on S16. Choose `implement` or `implement-parallel` by decision 39. S17 ‖ S18a is a candidate pair: they write different new shared files and share no interface. Commit this file before any `implement-parallel`. Every UI brief carries R7. If this run ends before the review, the next run finds S16 still uncommitted in the same three files, and reruns review from an account, never reimplementing.

**14 November 2026, between runs (main chat, Niclas's request).** Run `chat-loop-2026-11-14T09-03-54-467Z` was paused by Niclas after call 7 (the implementer's S16 attempt 2 ended `done`), before `Review the sub-goal` started; nothing was reset. S24 (Windows long paths in fan-out worktrees) was fixed in `4c6e14f` and taken into the engine, and decision 39 lifts decision 38. **Next run:** reconcile with Git; S16's work is the uncommitted `app/src/shared/run-presentation.ts`, `app/tests/run-presentation.test.ts` and its line in `app/scripts/run-tests.mjs`. Send S16 to review (it is implemented; do not reimplement it): brief the implementer only if the review needs rework, or record the review through `implement` with a brief that says S16 is done and asks only for the account the review needs. Then choose S17 and the rest of the order (S16 ‖ S17 → S18a → S19, S22 → S20 → S21 → S18b → S23a → S23b, plus S25) by dependencies and benefit, `implement-parallel` where sub-goals or parts are independent. The temporary branches `dspatch/run/chat-loop-2026-11-14T09-03-54-467Z/branches/v1/s16` and `.../s17` hold no work and are kept for Niclas to delete. This supersedes the paragraphs below where they differ.

**14 November 2026, run `chat-loop-2026-11-14T09-03-54-467Z`, coordinator visit 3 (call 6).** The parallel attempt failed with `no-worktree` (Windows long paths) before any work, as recorded above. S16 went to `implement` (decision 38). **Next:** record S16's review. If it is accepted, commit S16's named paths with this file, then brief S17 (`implement`), then S24 (small), then S18a, choosing `implement` while the parallel path cannot run. If this run ends first, the next run reconciles S16 from the uncommitted files `app/src/shared/run-presentation.ts`, `app/tests/run-presentation.test.ts` and `app/scripts/run-tests.mjs`.

**14 November 2026, run `chat-loop-2026-11-14T09-03-54-467Z`, coordinator visit 2 (call 3).** The plan was recorded (above); `git status` showed only this file changed, by visit 1. S16 and S17 went to `implement-parallel` (decision 35), after this file was committed. **Next:** when the parallel path returns, record:
- the slices, their owned paths, and each branch's `dspatch/run/<runId>/branches/v<n>/<slice>` branch with its commit and ending;
- what the integrator merged, and the commits that are S16's and S17's;
- the review's verdict, findings and checks.

Then commit this file, and go on to S18a (`implement`). If a branch failed or the integration was refused, record what is in the working copy and what is not. If this run ends first, the next run reconciles from `git log` after this file's commit and `git branch --list 'dspatch/*'`.

**14 November 2026, run `chat-loop-2026-11-14T09-03-54-467Z`, coordinator visit 1 (call 1).** Reconciled with Git; nothing was unrecorded. Recorded the Q2 answer (in scope) and R1–R6. Sent to the planner (`plan`, decision 34). **Next:** record the planner's map and plan as sub-goals S16 onward, with ids, dependencies, the shared interfaces first and the files each one owns. Then brief the first feasible sub-goal, choosing `implement` or `implement-parallel` by dependencies and expected benefit (decision 32's reasoning). Commit STATE.md before any `implement-parallel`. If this run ends before the plan returns, the next run starts by sending it to the planner again; the planner writes no files.

**14 November 2026, run `chat-loop-2026-11-14T08-41-01-671Z`, coordinator visit 3 (call 6).** The third assessment returned `needs-decision`, and the run ends `needs-decision`: only Q2 stops *Reported complete*, and it is Niclas's. **Next run:** reconcile from this file's commit after `9ec6902`.
- If Niclas answers Q2 as out of scope, record it as out of scope by his decision and send the whole to assessment for *Reported complete*.
- If he puts Q2 in scope, plan it as S16.
- Record any answers to Q1, Q3 and Q4 and any correction to decision 30. Findings from his trials (S15's included) become sub-goals.

**14 November 2026, run `chat-loop-2026-11-14T08-41-01-671Z`, coordinator visit 2 (call 4).** S15 is reviewed and committed, and DSP-209's dated note is appended in the same commit. No other sub-goal is feasible: every planned sub-goal is reviewed, Q2 is Niclas's, and the review's three points are not requirements. The whole is sent to assessment (`assess-whole`), because S15 changed it after the second assessment. **Next:** record the assessment's verdict. If it finds a concrete gap in S15 or elsewhere, brief that gap as a sub-goal. If only Q2 remains, end `needs-decision` and add this run's run-log line. If this run ends first, the next run reconciles from the S15 commit.

**14 November 2026, run `chat-loop-2026-11-14T08-41-01-671Z`, coordinator visit 1 (call 1).** Reconciled (see *Where the mission stands*); S15 briefed to the implementer (decision 32). **Next:** when S15's review returns, record the verdict, findings and checks in a new S15 record; if accepted, commit S15's named paths with this file in one local commit naming DSP-209 S15 (no push), append the run's dated note to DSP-209, then, with Q2 still open and nothing else feasible, send the whole to assessment or end `needs-decision` as the assessment finds. If the review asks for rework, it goes straight back to the implementer; a stalled S15 is recorded as blocked with its findings. If this run ends before that, the next run reconciles S15 from the working copy (uncommitted changes in the files named in its brief) before briefing anything again.

**14 November 2026, between runs: Niclas added parallel sub-goals to the mission.** The mission loop now has two ways to implement a sub-goal, and the coordinator chooses per sub-goal (BRIEF §3, *Parallel sub-goals in the mission loop*; the coordinator role, *Choose how a sub-goal is implemented*). `implement` goes to the implementer and `review`; `implement-parallel` goes to `slicer` → `branches` (fan-out, worktrees) → `integrate` → `parallel-review`, and both return to the coordinator. Before choosing `implement-parallel`, commit STATE.md so no tracked file is uncommitted. When a parallel sub-goal returns, record its slices, branches with their commits and endings per visit, what was merged, the review's findings and the next action. This supersedes the paragraph below where they differ; Q2 stays open and does not block it.

**14 November 2026, run `chat-loop-2026-11-14T01-36-57-404Z`, coordinator visit 21 (call 61).** The run ends `needs-decision`. **Next run:** reconcile STATE.md with Git (last mission commit is the STATE commit after `9ba0d86`). If Niclas answered Q2: if out of scope, record dialogue-based graph construction as out of scope by his decision and send the whole to assessment for *Reported complete*; if in scope, plan it as S15 and continue. Fold in the two wording nits with the next sub-goal that touches those files, or brief them alone if nothing else remains. Record any answers to Q1, Q3, Q4 and any correction to decision 30. Niclas's live trials and their findings, once he reports them, become sub-goals.

## Run log

One line per run, appended at its end where the run ends at a terminal: the date, what it did, the ending and why. A run that ended on a fault or a limit has no line; the next run adds one for it when it reconciles.

- **14 November 2026, run `chat-loop-2026-11-14T01-36-57-404Z`** (61 calls of 180; two rework rounds, S10c and S12): mapped and planned the vision, then implemented and agent-reviewed S1–S14 (S5 and S10 split; S9 research), committed locally `610fa1a`..`9ba0d86` plus this record, none pushed. Two whole assessments: the first found two gaps (fixed in S14), the second `needs-decision`. Ended `needs-decision` because the only open requirement, Q2 (dialogue-based graph construction), is a scope decision that only Niclas can make. Nothing has run with a real provider; agent review is not his approval.
- **14 November 2026, between runs, in the main chat at Niclas's request (not a loop run).** Four faults the night run showed were fixed before his trials, in one commit after `e1d8ce2`. (1) Claude's adapter glued the text blocks either side of a tool call together, so the planner's `RESULT: planned` landed mid-line, was not read, and routed `not-established`; blocks are now joined by a blank line, in the reply and live (`joinTextBlocks`, `app/src/adapter/agent-adapter.ts`), and `waitForTurn` joins separate assistant messages the same way. (2) Conversation lines said "21th"; one shared `ordinal` (`app/src/shared/ordinal.ts`) replaces three copies. (3) After a rework round the coordinator received only that round's accounts, by the engine's decided one-visit binding; the mission graph's `implementer` and `review` purposes now ask the rework report and an accepting review to cover the whole sub-goal, the engine unchanged. This edits a file BRIEF §5 fixes for the run, by Niclas's request between runs. (4) The wording slips: "a agent step" in the run report and the 13 November BACKLOG line. Checked by targeted tests and the type check; nothing tried live. The next run reconciles from that commit.
- **14 November 2026, between runs, in the main chat (Niclas's explicit addition, not a loop run).** The mission loop gained a parallel path: coordinator outcome `implement-parallel`, nodes `slicer` (project slice role), `branches` (the engine's existing fan-out, at most three at once, worktree isolation, project branch role), `integrate` (project integrate role, merges as commits) and `parallel-review` (the reviewer), failure kind `branch-failed` back to the coordinator as not done. The coordinator role and BRIEF §3 and §5 say how to choose and record it. No engine change and no graph generated at run time. Checked by `app/tests/loop-mission-parallel.test.ts` (the graph loads with its real roles; a scripted walk on a temporary repository takes the parallel path with one rework from the merged state, then the sequential path; a failed branch returns to the coordinator past integration and review) and the type check; nothing run with a provider.
- **14 November 2026, run `chat-loop-2026-11-14T08-41-01-671Z`** (6 calls of 180; no rework): reconciled with Git; implemented S15, Niclas's addition, sequentially (decision 32); agent-reviewed and committed locally as `9ec6902`, with DSP-209's dated note; none pushed. A third whole assessment returned `needs-decision`. Ended `needs-decision` because the only open requirement, Q2, is Niclas's to decide. Nothing has run with a real provider; agent review is not his approval.
- **14 November 2026, run `chat-loop-2026-11-14T09-03-54-467Z`** (7 calls; no rework): reconciled, recorded Q2 in scope and R1–R6, planned S16–S23b, tried S16 ‖ S17 in parallel (both branches `no-worktree`: Windows long paths), recorded S24 and decision 38, implemented S16 sequentially (`done`, not reviewed). Paused by Niclas before S16's review and ended between runs for the engine transition, so its record has no ending. S24 was fixed in the main chat (`4c6e14f`).
