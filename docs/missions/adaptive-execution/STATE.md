# Adaptive execution and shared context: working state

The mission's working memory ([BRIEF.md](BRIEF.md), section 6). The mission coordinator writes it before every outcome it names. Niclas may correct it between runs. A run reconciles this file with Git before it chooses anything.

## Where the mission stands

- **Status:** in progress. Night run `chat-loop-2026-11-14T01-36-57-404Z` began 14 November 2026. Mapping and plan done (planner, call 2); S1 reviewed and committed (calls 4–6); S2 reviewed and committed (calls 7–9); S3 reviewed and committed (calls 10–12); S4 reviewed and committed (calls 13–15); S5 sent to the implementer (coordinator visit 6, call 15).
- **Engine commit the runs use:** `c04536b`, from `C:\Users\nicla\development\DSpatch-engine` (prepared 13 November 2026; checked on 14 November 2026 at the start of run `chat-loop-2026-11-14T01-36-57-404Z`: unchanged). The engine checkout lags this working copy by the documentation commits that follow it; that is expected. Every run checks the engine commit and records a change here.
- **Working copy at the start of the first run:** HEAD `59bd24e` (DSP-208's last preparation commit). No mission commits. Untracked and **not mission work, leave alone and never commit with a sub-goal**: `_all.txt`, `_groups.csv`, `_live.txt`, `_loop.txt`, `_pack.txt`, `_status.txt`, `_tree.csv`, `_vision.diff` (dated 30 September 2026) and `docs/research/agent-framework-comparison/` (dated 1–15 October 2026). Sub-goal commits stage named paths only.
- **Last recorded commit of mission work:** `610fa1a` (S1), `5c3c1ae` (S2), `3fb6574` (S3), then the S4 commit made on coordinator visit 6 (`(DSP-209 S4)` in `git log`, the commit after `3fb6574`).
- **Sub-goal in progress:** S5 (agent can recommend interactive work), sent to the implementer on coordinator visit 6.
- **Waiting on Niclas:** nothing that stops work (Q1, Q2 below are recorded with recommendations).

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
| S4 | Adaptive route in the bundled chat loop (check skippable) | S3 | reviewed | 1 | S4 commit after `3fb6574` |
| S5 | Agent can recommend interactive work (handoff tool, `handed-over`) | — (S2 useful) | in progress | 1 | |
| S6 | Continue interactively without resubmitting | S5, S1 | pending | 0 | |
| S7 | The chat knows what a loop did (one-time run recap) | S1 | pending | 0 | |
| S8 | Reconcile the parallelism document; spec `fanOut` in GRAPH_FORMAT | — | pending | 0 | |
| S9 | Research: installed SDK support for concurrency, mid-turn input, tools, cancel | — | pending | 0 | |
| S10 | Bounded fan-out node, isolated worktrees, one integrator | S8, S9 (S3 useful) | pending | 0 | |
| S11 | Mailbox between running branches | S10, S9 | pending | 0 | |
| S12 | Run report with exact scope and provenance | S3 (S5, S10 add parts) | pending | 0 | |
| S13 | Documents and backlog (BACKLOG near-term follow-up line, AGENT_BEHAVIOUR §4 status) | those described | pending | 0 | |

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

**S7 — The chat knows what a loop did.** Also carries S2's open review findings (i) and (ii) and S3's finding (iii): move `conversationMessages` off `mergedMessages`'s doc comment in `chat-service.ts`; move `SkippingRoute` / `skippingRoutesOf` off `outcomeInstructions`'s doc comment in `loop-chat.ts`; make `chatLoopContextSnapshot` fall back to `null` with the failure recorded. After any loop run in a conversation, the next chat turn is prefixed once with a disclosed, removable run recap (S1 builder, DSP-121 mechanism). *Acceptance:* first turn carries it, second not; visible and discardable; no run → no change. *Checks:* `chat-service` tests, type check.

**S8 — Reconcile parallelism.** Reconciliation section in `CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md` saying which §9 open decisions the vision settles (2–3 agents, worktrees for writers, single integrator, mailbox, slicer as a role), naming the first increment (one-level fan-out of one node with one integration point); GRAPH_FORMAT spec for `fanOut`, the slice block and S5's capability. Documentation only.

**S9 — SDK support research.** Table for installed Claude Agent SDK, Cursor SDK and Copilot SDK: concurrent sessions in one process, input during a turn, custom tools on the loop surface, cancel isolation; each row read-from-code / documented / observed / unknown. Every later support claim cites it.

**S10 — Fan-out node.** `fanOut: { slicesFrom, maxConcurrent ≤ 3, isolation: "worktree" | "shared-read-only" }`; fenced JSON slice block validated, overlapping write ownership refused; worktree per writer from a recorded base (HEAD or `git stash create`); concurrent instances with own sessions, `branch-started`/`branch-ended` kinds, per-instance usage; cancel aborts all; temporary branches `dspatch/run/<runId>/<slice>`; success or declared `branch-failed`; integrator role merges and checks contracts; worktrees removed at the end; run view instance states; new bundled graph slicer → fan-out implementer → integrator → review. *Acceptance:* two-slice dry run, separate journals, no double-counted calls; overlap refused; `maxConcurrent` honoured; cancel ends all; working copy untouched until integration; base recorded. If S9 shows concurrency is unsafe, shrink to `maxConcurrent: 1` with the finding stated.

**S11 — Mailbox.** `send_message`, `check_messages`, `acknowledge_message` for fan-out instances; one mailbox per run, additive kinds for sent/delivered/acknowledged; delivery at the next safe boundary (into a running turn where S9 shows it works, otherwise at `check_messages`), with non-immediate delivery stated; no blocking wait; messages to ended branches recorded undelivered; `contract-change` is a non-binding proposal for the integrator; person's instructions reach every instance. *Acceptance:* scripted two-instance run where A's message reaches B before B ends; delivery and acknowledgement separate; nothing waits without bound.

**S12 — Run report.** Also carries S4's finding (i): when a run ends at "Done, check skipped" and DSpatch's own before-and-after snapshots show changed files, the ending says so, as corroboration only, never routing. Ending summary from journal and record: path, skipped steps with reasons, handover, per-branch ownership and changed files, integrator, usage and cost per step and branch, what was reviewed and checked, what to try, "agent review is not your approval". Nothing inferred from prose; unknown says unknown.

**S13 — Documents and backlog.** Dated line in BACKLOG.md's near-term follow-up pointing at this file (no duplicate entry); AGENT_BEHAVIOUR §4 status if S5 did not; INTERACTION_MODEL only where skipped / handed-over need naming. Backlog: note for DSP-31 that S5 builds the shared explicit-choice mechanism it should reuse (as a field-change proposal; the coordinator changes no other card).

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

### S5 — Agent can recommend interactive work

- **Attempt 1:** briefed on coordinator visit 6 (call 15). Not yet reviewed.

## Requirements of the vision

All **open** at the end of planning. Sub-goals carrying each in brackets.

- Entry agent gets the conversation's relevant context [S1, S2] — met by reviewed sub-goals (agent review; host path untested end to end; Niclas's trial)
- Identifiable snapshot linked to the conversation [S1, S2] — met by reviewed sub-goals (record header `contextSnapshot`, `context.md`)
- Decisions and exclusions included, not optional retrieval [S1, S2] — met by reviewed sub-goals
- Original reachable; cuts explicit [S1, S2] — met by reviewed sub-goals
- Summaries separate instructions from guesses [S1] — met by reviewed sub-goals (agent text labelled and quoted)
- Repository state and project instructions [S1, S2; Q1] — met as references (names only); native loading waits on Q1
- Supplied context inspectable, apart from the provider's own [S2] — met by reviewed sub-goal (in the saved prompt; untested in the window)
- Exclusions apply to every recipient [S1, S2, S11] — open
- Later user messages are changes to the task [sequential: works today; branches: S11] — open for branches
- Works across a provider or model change [S1] — met by construction (DSpatch's own record); not exercised across providers
- Steps may be skipped with a recorded reason [S3, S4] — met by reviewed sub-goals (chat loop's check; live model behaviour is Niclas's trial)
- Required steps stay required [S3] — met by reviewed sub-goal (validation refuses)
- Skipped shown as its own state; available and taken paths shown [S3] — met by reviewed sub-goal (look untested; Niclas's trial)
- Explicit routing decisions, not inferred from prose [S3, S5] — open
- A new decision surfaced, not absorbed [S5; existing blocked routes] — open
- Recommendation prompt with the user's choice [S5] — open
- Not repeated after refusal [S5] — open
- Recorded as handed over [S5] — open
- Safe point before the switch [S5] — open
- Continue once without pasting again [S6] — open
- Chat gets the run's results, and the reverse [S7, S2] — open
- No extra permissions on a mode change [S5, S6] — open
- Parallelism optional and bounded (2–3) [S10] — open
- Branches get bounded assignments and ownership [S10] — open
- Worktrees from a known base [S10] — open
- Coordinator may serialise or combine [S10] — open
- Messages through a mailbox with sender, recipient, purpose [S11] — open
- Delivery separate from acknowledgement [S11] — open
- Contract changes not binding until resolved [S11, resolved at integration] — open
- No endless waiting; no restart from a stale message [S11] — open
- Revision references on messages [S10, S11] — open
- One integrator owns the combined result [S10] — open
- Integration-targeted checks, not a suite per agent [S10] — open
- Integration, completion and approval kept apart; report says implemented/reviewed/tested/skipped/left [S12] — open
- Runtime owns identity, context versions, routing, branches, messages [S2, S3, S5, S10, S11] — open
- Provider support checked before claimed [S9] — open
- Delivery limits shown when not immediate [S11] — open
- Distinct states incl. handed over [S3, S5]; durable automatic resume — **skipped**: BRIEF §3 accepts manual continuation; S2 makes a new run from the same conversation carry earlier runs (limit stated, not met)
- Cancel stops dispatch and accounts for tools in flight [S10; sequential exists] — open
- Verification policy for every branch [S10, S11] — open
- UI says why a method was chosen and what each branch owns [S3, S5, S10, S12] — open
- Concepts reusable for future graph construction [node help in S3, S5, S10]; dialogue-based graph construction — proposed **skipped** (Q2), not met
- Reconcile the parallelism document [S8] — open

**Success criteria (BRIEF §1.3):** (1) "implement that" preserves decisions [S1, S2] — implemented and agent-reviewed; awaits Niclas's trial; (2) small task continues in chat without resubmission [S4, S5, S6] — open; (3) branches exchange a finding before completion [S10, S11; scripted adapter only, live trial is Niclas's] — open; (4) combined result keeps scope and provenance [S10, S12] — open.

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
12. **The bundled chat loop's check becomes skippable** (S4). The chat loop's notes record the interaction-model correction's "a successful work step always reaches check"; the vision (adaptive loops) and BACKLOG's near-term follow-up ("mandatory checking in the small chat loop is not evidence") supersede that for this graph, under Niclas's 13 November authorisation (BRIEF §3). The graph's notes are updated to say which decision they now record. A skipped check ends at a terminal that never reads as "met". Alternatives: keep check mandatory and demonstrate skips only in a new graph (leaves the vision's main case unbuilt); make check skippable in the development loop too (not asked for; that loop guards code changes).
10. **The planner's result accepted as the plan despite its undeclared `RESULT: planned`** (coordination). Reason: the content is complete and checked against code; re-planning would spend calls for nothing. Alternative: send back to `plan`.

## Decisions needed from Niclas

**Q1 — Should loop steps load project instructions (AGENTS.md) natively** (Claude `settingSources`, Copilot without `skipCustomInstructions`)? Affects S1/S2 and what the provider receives (a content-exclusion matter, so it is Niclas's). Recommendation: no; S1 lists instruction files as references and roles keep pointing at them. Continues without it: everything.

**Q2 — Dialogue-based graph construction: skipped in this mission?** The vision frames it as future; this mission makes the concepts reusable and explained, but builds no conversational graph assembly. Recommendation: record as skipped with that reason, not as met. Continues without it: everything; if wanted in scope, it becomes a sub-goal after S12.

## Next action

What the coordinator will do next, rewritten on every visit, so that a run that ends between two steps leaves it here.

**14 November 2026, run `chat-loop-2026-11-14T01-36-57-404Z`, coordinator visit 6 (call 15).** S4 reviewed and committed. S5 sent to the implementer (the largest sequential sub-goal so far). When the review returns: if accepted, record and commit S5, then brief S6 (depends on S5, S1). If S5 stalls or blocks, S6 depends on it; go on with S7, then S8 and S9. If a run ends before S5's review is recorded, the next run reconciles S5's files (`app/src/shared/loop-run.ts`, `loop-control.ts`, `loop-graph.ts`, `loop-graph-load.ts`, `loop-record.ts`, `loop-transcript.ts`, `loop-chat.ts`, `bridge.ts`, `app/src/main/loop-live.ts`, `loop-control-runtime.ts`, `app/src/host/project-host.ts`, renderer files, the chat loop graph and work role, `docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md`, their tests) before briefing again.

## Run log

One line per run, appended at its end where the run ends at a terminal: the date, what it did, the ending and why. A run that ended on a fault or a limit has no line; the next run adds one for it when it reconciles.
