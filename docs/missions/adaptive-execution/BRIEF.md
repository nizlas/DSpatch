# Adaptive execution and shared context: start brief

Prepared by DSP-208 on 13 November 2026 for the main assignment, [DSP-209](../../../backlog/tasks/dsp-209%20-%20Adaptive-execution-and-shared-context-the-main-assignment-run-through-the-mission-loop.md). It is run through DSpatch's own run engine with the loop **DSpatch mission loop** (`dspatch-mission-loop`, [graph](../../loop/graphs/dspatch-mission-loop.graph.json), [definition](../../../.dspatch/loops/dspatch-mission-loop.loop.json)). The working memory is [STATE.md](STATE.md).

Every step of every run reads this brief in full, then STATE.md, before anything else. It is the run's fixed instruction: no run edits it, and only Niclas changes it, between runs.

**This brief is not the mission's product.** It is a document prepared by hand so that this one assignment starts with the conversation's decisions in front of every step. The general context transfer the vision asks for (an identifiable context snapshot linked to a conversation, carried into a loop's entry agent by DSpatch itself) is something this mission is to build, not something this brief demonstrates.

## 1 The assignment

Realise **the whole vision** in [ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md](../../ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md) (version 0.1, 13 November 2026). Niclas decided on 13 November 2026 that all of it is in scope, in one long autonomous run: context carried into a loop, adaptive loops with visible skipped steps, returning to interactive chat, structured parallel execution, communication during execution, integration and ownership of the result, the runtime's responsibilities, and the working policy and user experience. Build it in increments, starting from its section *Relationship to existing work and next increment*:

1. Map the vision to the current engine, adapter and UI capabilities **by reading code**: what already works, what needs wiring, what is missing.
2. Plan sub-goals over the whole vision, and go straight from the plan into implementing it when the material is enough. Order them by dependency and value; the vision's own order is a good start: faithful context transfer from conversation to loop, explicit method selection (adaptive routing with visible skipped steps), returning to chat, then a bounded parallel split with integration and communication between agents, where the runtime supports it. Each reviewed sub-goal is followed by the next one.
3. Judge the whole against the vision's success criteria, its last paragraph:
   - "implement that" preserves the preceding decisions;
   - a small task can continue in chat without being submitted again;
   - independent branches can exchange a relevant finding before completion;
   - the combined result keeps exact scope and understandable provenance.

   Assess speed from useful delivery time, integration rework and human effort, with cost visible. Judge quality from the result, not from the number of agents.

The mission may conclude that a part of the vision cannot or should not be built in this run. That is a finding to record with its reason, as skipped or blocked, never as met.

**Done** means that the vision's agreed requirements are implemented and reviewed, with their limitations and the points Niclas should check by hand stated. Untested or blocked work is never reported as done. Niclas's product approval is separate from all of it.

## 2 Read first, in this order

Read the current repository versions. Read each one's relevant sections, not necessarily the whole document.

| Document | Why |
| --- | --- |
| [AGENTS.md](../../../AGENTS.md) | Governs all work, including **the verification policy** and *follow the decided design*. It binds every step. |
| [ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md](../../ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT.md) | The vision for this mission, in full. |
| [INTERACTION_MODEL.md](../../INTERACTION_MODEL.md) §1, §2, §4.2–4.7, §9 | Who decides what; pause, cancel, continue and history. It governs over older wording elsewhere. |
| [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](../../AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) §1, §2, §4, §5 | Visible instructions; switching to interactive work (a proposal); review independence. |
| [TASK_MANAGEMENT_AND_WORKING_MEMORY.md](../../TASK_MANAGEMENT_AND_WORKING_MEMORY.md) §3–§8 | Working memory, separate task, run and step states, handover contract, robustness. |
| [CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md](../../CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md) | The earlier agreed direction on parallelism. The vision asks you to reconcile it before a new canonical specification is written. |
| [RUNTIME_PLATFORM_ROADMAP.md](../../RUNTIME_PLATFORM_ROADMAP.md) and [DSPATCH_CONTENT_EXCLUSION_CONTRACT.md](../../DSPATCH_CONTENT_EXCLUSION_CONTRACT.md) | Drafts. Read them for anything touching providers, sessions, information flows or what a recipient may receive; context transfer touches the latter. |
| [GRAPH_FORMAT.md](../../loop/GRAPH_FORMAT.md) | The graph contract the engine and editor share. |
| [BACKLOG.md](../../../BACKLOG.md), *Near-term follow-up: adaptive loops and interactive chat* | The planning anchor this mission extends. |

## 3 Decisions and limits from the conversation that set this up

These were said by Niclas on 13 November 2026, in Swedish, in the conversation that prepared this mission. They are summarised here in English. They bind every step.

**Decisions**

- **The engine.** The mission runs through DSpatch's own loop engine. The external `/dspatch-loop` procedure, run from Cursor or Claude Code, is a different thing with different responsibilities; do not mix them.
- **The planning anchor.** BACKLOG.md's near-term follow-up (commit `53ed093`) is the anchor; extend it and do not create a duplicate follow-up.
- **Start sequentially.** Adaptive routing, parallel execution and communication between agents are parts of the vision this mission builds, not things its own loop must already have.
- **No interim orchestrator.** Do not build a new general orchestration system to get around something. Use what exists, and where something is missing, make the smallest change that is a real part of the vision.
- **Verification.** The policy in AGENTS.md applies to every step and every sub-goal. Use targeted tests and the type check where warranted. Do not run suites, Xvfb, platform matrices, window trials or extra CI runs unless Niclas asks or a concrete risk calls for it. Niclas does the manual product and UI trials. Model benchmarks and long calibrations are not required.
- **Resumption.** If automatic resumption is missing, a clear and reliable manual continuation is enough, and the limitation is stated honestly. Never work around a login: when a provider needs Niclas's authentication, stop and say so.
- **A stable engine.** The run uses a stable engine version. Engine changes this mission makes are built separately and taken into use at a controlled transition between runs, never by switching the engine during an active step.
- **What counts as done.**
  - Skipped is not met.
  - Agent review is not Niclas's product approval.
  - Clear stopping conditions; no unbounded iterations.
  - Finished, blocked, paused and aborted are kept apart.
- **Releases.** No release. Commit locally; push only when Niclas says so.

**What the vision itself says about its status.** The vision records an agreed direction. It is not a claim that anything is implemented, and not a mandate to build all of it at once. Its detailed protocols and defaults remain design choices.

**The night run (Niclas, 13 November 2026).** These replace anything above or below that says otherwise.
- The whole mission runs in one run, overnight, without routine approvals from Niclas.
- There is no stop after planning and no batch limit.
- Plans are followed directly by implementation, and each reviewed sub-goal by the next.
- Separate review stays, and concrete findings go back for correction.
- The mission makes ordinary design and implementation decisions, architecture included, within the vision and the project's rules. It does not stop for them.
- No release, and no update of the engine that is running the mission.

**Which decisions are the mission's, and which stop for Niclas.** Niclas's authorisation of 13 November 2026 is the explicit approval that *follow the decided design* in AGENTS.md asks for, for the decisions the vision calls for: architecture, the division of work between engine, agents and person that the vision describes, and the design of the features it names. Make them and record each significant one in STATE.md under *Decisions taken by the mission*, with the reason and the alternatives. A decided document that the vision supersedes may be updated to match it, saying which decision it records. Decisions that stop for Niclas:
- changing the mission's scope (adding work the vision does not ask for, or dropping a requirement it does);
- an irreversible action outside the mandate: deleting history or someone else's work, pushing, publishing, touching accounts or anything outside this repository;
- missing permissions or access;
- a decisive question the brief, the vision and the documents cannot settle, where either answer would build something different;
- a departure from a decided design that the vision does not cover, such as the permission model or a control boundary in the content-exclusion contract, or a change in what a provider may receive.

Record the question, your recommendation and what can continue without it, and **go on with work that does not depend on the answer**. The run ends with `needs-decision` only when everything left depends on Niclas.

## 4 What the engine does today

The preparation established this by reading code on 13 November 2026, from the commit that added this brief. The mission changes this code, so verify a statement before relying on it.

- **A run is one in-memory walk.**
  - A run is one `runLoopGraph` call (`app/src/shared/loop-run.ts`).
  - Its journal, path, counters and per-node provider sessions live in memory.
  - What reaches disk:
    - a run record, `userData/loop-runs/<runId>.jsonl`, one line per journal entry plus each step's prompt and reply;
    - each step's result, in `userData/loop-runs/<runId>/results/`.
- **No resume.**
  - After a restart, a fault or a cancel, the record reads as interrupted or ended.
  - `stop-and-reconcile` ends the run and retries nothing.
  - A human node ends the run as `awaiting-human`.
  - A new run starts at the entry.
- **The graph is fixed for the run.**
  - The graph is read once and held for the run's lifetime; its bytes are hashed into the record.
  - Role files are read for the run.
- **Routing.**
  - Edges route only on `success`, a named `outcome` or a `declared-failure`.
  - A step names its outcome on a `RESULT:` line, with `whenUndeclared` as the fallback.
  - A `router` node always takes its first outcome.
  - There is no skip mechanism and no skipped state: a node not visited is `not-reached`.
- **Results and rework.**
  - An edge's `delivers` decides what the arriving step is given, bound to the producing visit.
  - Each agent node keeps its own provider session across its visits in a run.
- **Limits.**
  - The graph's `maxCalls` and `maxReworkRounds` bound the run; `maxReworkRounds` counts all rework edges together.
  - `maxMinutes` bounds each step. A live step with no `maxMinutes` is stopped after 20 minutes.
  - There is no bound on the run's wall time, tokens or cost. Cost and usage are recorded.
  - A spent bound ends the run as `limit-reached` unless a `limit-reached` edge is drawn.
- **Person in the loop.**
  - Pause after the current step, continue, autonomy mode, cancel, and an instruction to the next step (chat runs) all exist.
  - Answering a human node does not exist.
- **Context.**
  - The entry step gets the role, the engine's preamble, the working folders and the **mandate, which is only the composer text**, plus the node's purpose. Later steps get the same and the results their arrival delivers.
  - Nothing of the conversation before the run is carried in. That is the vision's first gap.
- **Project instructions.**
  - No runtime loads `AGENTS.md`: Claude's `settingSources: []`, Copilot's `skipCustomInstructions`, and Cursor loading none.
  - It reaches a step only through role text telling the agent to read it.
- **The run view.**
  - The editor's graph marks are not-reached, ready, waiting, running, done, failed and stopped.
  - The chat column shows each step's whole reply, the hand-off trail, the prompt sent, tool calls and the ending.
  - There is no per-sub-goal view, no skipped or blocked node state, and no report panel beyond the replies.
- **Fixed by the preparation.** The editor's validation said `limits` and `onRuntimeFault` were honoured by nothing. It now says what the runner enforces and where that stops.

## 5 Mandate and boundaries for every run

- **What may change.** Change DSpatch's code, tests and documents as each sub-goal requires.
- **Who commits.** The coordinator commits each sub-goal locally once review accepts it, together with STATE.md, in the repository's commit style, with a message naming DSP-209 and the sub-goal id. **Do not push, tag, publish or release.** The implementer does not commit.
- **Fixed instructions.** Do not edit the mission's own instructions:
  - this brief;
  - `docs/loop/roles/run/dspatch-mission-coordinator.role.md`;
  - `docs/loop/graphs/dspatch-mission-loop.graph.json`;
  - `.dspatch/loops/dspatch-mission-loop.loop.json`.

  A sub-goal that needs one of these changed is a `needs-decision`.
- **Role sources the run itself uses.** A change to `docs/loop/roles/dspatch-{implementer,reviewer,verifier,researcher,backlog-planner}.role.md` takes effect for the next run's own steps. Make it only as a deliberate part of a sub-goal, name the effect in the review, and record it in STATE.md.
- **The engine stays fixed.** Engine changes take effect only when Niclas moves the run's engine to a newer commit between runs (see section 7). Never restart, rebuild or replace the DSpatch that is running the mission, and never stop its host. It runs from a separate checkout, `C:\Users\nicla\development\DSpatch-engine`, which no step touches. Do not start another DSpatch on Niclas's profile either: a second host would ask to replace the running one. A sub-goal that needs the app running for a check uses `npm run dev -- --isolated-profile <a temporary folder>` from the working copy, and only where the verification policy allows a window check at all.
- **Reconcile before redoing.** At the start of every run, and whenever STATE.md and the working copy disagree, an interrupted step may have left changes nobody recorded. Keep them, establish what they are and how far they got, and decide what remains before anything is done again. Never reset, stash away or overwrite uncommitted work to get a clean start.
- **What the agents can reach.** The night run uses Niclas's existing choice: Claude, model `opus`, with his existing login. Claude steps run with DSpatch's chat permissions:
  - read and edit anywhere under the working copy, and run shell commands;
  - nothing that would need a prompt: the mode is `dontAsk`, so anything not pre-approved is refused instead of waiting;
  - no web tools, so research works from the code, the repository's documents and installed packages;
  - no MCP servers and no settings files.
- **Backlog.** The coordinator appends one dated line to DSP-209's notes at the end of each run (`backlog task edit DSP-209 --append-notes "..."`). It changes no other card and sets no status.
- **Content.** No private endpoints, credentials or internal discussions in the repository (AGENTS.md *Public repository content*). Repository content is in English.

## 6 Limits, and when to continue or stop

The hard limits are in the graph and can be changed in the loop editor:

| Limit | Value |
| --- | --- |
| `maxCalls` per run | 180: about forty sub-goals with their rework, plus mapping, research and the whole assessment |
| `maxReworkRounds` per run | 60, counting every sub-goal's rework together, so ordinary rework never reaches it |
| The runner's own transition bound | 200, not set from the graph; 180 calls ends the run first |
| Step time, default | 45 minutes |
| Step time, implementer | 120 minutes |
| Step time, whole assessment | 60 minutes |
| Step time, coordinator and final report | 30 minutes |
| Wall time, tokens and cost for the whole run | no bound in the engine; cost and usage are recorded |

The soft limits below are the coordinator's and the reviewer's to keep. They live here, and Niclas changes them between runs.

| Soft limit | Value |
| --- | --- |
| Batch | **none** for the night run: continue while feasible work remains |
| Rework rounds per sub-goal | ordinary rework continues while each round changes the findings; the review answers `stalled` when the same concrete finding survives two rounds, or a third round would be needed |
| A stalled or blocked sub-goal | recorded with its open findings, then work goes on with sub-goals that do not depend on it. A retry later is a new, differently briefed attempt, at most one. |
| Independent verifications per sub-goal | at most **1**, asked for by the reviewer |

**Continue** while there is feasible work: concrete review findings with a path to improvement, or a sub-goal whose dependencies are met.

**End the run with the state saved** (STATE.md written first) only when no feasible work remains:
- everything left waits on Niclas: `needs-decision`;
- everything left is stalled or blocked by the work itself: `no-progress`;
- an obstacle stops the whole mission, such as a login or access only Niclas can give: `blocked`;
- the whole is assessed and reported: the final report.

A hard limit, a provider fault, a lost login or the machine sleeping ends the run without a coordinator step. STATE.md then shows the last coordinator visit, and the next run reconciles. The engine cannot resume an interrupted run on its own, and nothing here restarts one automatically; a new run is started by Niclas.

**Statuses, kept apart**

| Situation | Where it shows | What it means |
| --- | --- | --- |
| Reported complete | terminal *Reported complete: awaits Niclas* | The whole assessment found nothing required open. It is still not approved. |
| Paused | *Paused: needs Niclas's decision*, *Paused: no progress*, *Paused: batch done* (unused tonight); an engine `limit-reached`; or Pause in the control bar | State saved; a new run continues. |
| Blocked | terminal *Blocked* | An obstacle stops the whole mission; STATE.md says what is needed. A single blocked sub-goal is recorded in STATE.md and does not end the run. |
| Aborted | Cancel in the control bar, or a fault | The run ended mid-step; the next run reconciles first. |
| Stopped | *Stopped: no outcome named* or *Ended without complete reporting* | The run could not route. Read the reply; the next run reconciles. |

In STATE.md a sub-goal is **pending**, **in progress**, **reviewed** (accepted by agent review), **skipped** (with the reason; not met), **blocked** or **awaiting decision**.

## 7 Operating the run (for Niclas)

**Once, before the first run: a stable engine.**

Run the mission from a separate checkout of DSpatch. The mission then edits the working copy without touching the program that runs it:

```bash
git -C C:/Users/nicla/development/DSpatch worktree add --detach C:/Users/nicla/development/DSpatch-engine main
```

```bash
cd C:/Users/nicla/development/DSpatch-engine/app && npm ci && npm run claude:install && npm run build && npm start
```

`npm start` runs the built app without the dev server, so nothing reloads when the mission edits renderer files, and its local host runs from that checkout's own `dist/host`. Its data and logins are your ordinary DSpatch profile. End a host another DSpatch left running (**End host**) before you start the engine window. Do not start a second DSpatch on that profile while a run is active, because it would ask to replace the running host, and replacing it stops the run. For your own trials of the mission's results, use `npm run dev -- --isolated-profile <folder>` from the working copy.

**Starting a run.**

1. In the engine window, open the folder `C:\Users\nicla\development\DSpatch` (the working copy) as the workspace.
2. Open the loop editor. In its **Loop** list choose **DSpatch mission loop**. The graph opens and can be edited and saved there.
3. In the chat, tick **Use loop** and send this mandate, the same every time:

   > Run the adaptive-execution mission (DSP-209) on this repository. Read docs/missions/adaptive-execution/BRIEF.md in full, then docs/missions/adaptive-execution/STATE.md, before anything else: they are the assignment, its decisions and limits, and where the mission stands. Continue from the state file.

**Following it.**
- The chat column shows each step's reply. The coordinator's reply opens with the sub-goal it is about, and the hand-off trail shows which step handed to which and on what branch.
- The editor's graph marks the running step and the path taken.
- STATE.md in the working copy is the mission's state between and during runs.
- A review's findings and a rework return show in the reviewer's reply and in the branch label *rework with findings*.

**Pausing.** **Pause** in the loop's control bar lets the running step finish and holds the run before the next one starts. **Continue** resumes it. While it is paused you can write an instruction in the chat, and the next step receives it. To stop the mission for longer, let the run reach a terminal, or cancel it.

**Resuming after any ending.** Start a new run with the same mandate. The coordinator reconciles STATE.md with Git and continues. Nothing is replayed: accepted sub-goals are commits, and a sub-goal that was in progress is re-established from the working copy before anything is repeated.

**When a login expires.** The step faults and the run ends. Log in again where the provider asks (DSpatch does not do this for you), then start a new run.

**Taking an engine change into use (a controlled transition).** Between runs only, with no run active:
1. Close the engine window and end its host.
2. Bring the engine up to date:
   ```bash
   git -C C:/Users/nicla/development/DSpatch-engine checkout --detach <commit>
   ```
3. Run `npm ci` if dependencies changed, then `npm run build && npm start`.
4. Start the next run.

## 8 What is left to Niclas

- Every decision the run stops for, and every login.
- Manual product and UI trials of what the sub-goals deliver. STATE.md lists what to try for each.
- Pushing commits, and the status of DSP-209.
- Changing this brief, the mission graph, the mission coordinator role and the limits, between runs.
- Assessing the final result. The mission's *Reported complete* is an agent's assessment.
