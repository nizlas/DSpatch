---
id: DSP-152
title: Understand and review changes through agent-generated code walks
status: Review
assignee: []
created_date: '2026-10-28 22:32'
updated_date: '2026-10-29 12:55'
labels:
  - review
  - code-walks
dependencies:
  - DSP-150
priority: high
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A first implementation awaits Niclas's trial (29 October 2026; see the notes). From a chosen revision pair to an understandable walkthrough and a review decision, with readability as part of the function.

### Requirements source

The requirements are in the original plan from Niclas's discussion, kept verbatim in Swedish: [DSpatch-code-walks-plan-original.md](../../docs/plans/DSpatch-code-walks-plan-original.md). The acceptance criteria below are derived from it section by section (§1–§7) and add no requirements. Where this card and the plan differ, the plan governs. The plan's own title for the story is "Förstå och granska ändringar genom agentgenererade code walks".

### Governing and related material

- **Vision:**
  - [VISION.md section 3.1](../../docs/VISION.md#31-förstå-förändringar-och-deras-sammanhang) (understanding changes and their context);
  - [explanations must be checkable](../../docs/VISION.md#förklaringen-måste-gå-att-kontrollera);
  - [section 3.3](../../docs/VISION.md#33-review-as-a-standalone-capability) (standalone review);
  - [section 3.4](../../docs/VISION.md#34-walkthrough-coverage-and-levels-of-engagement) and its [decided review flow](../../docs/VISION.md#the-decided-review-flow-niclass-decision-28-october-2026) (DSP-150).
- **Review concept:** [REVIEW_COVERAGE_AND_CODE_WALKS.md](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md), sections
  - [1 meaningful code walks](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md#1-review-through-meaningful-code-walks),
  - [3 how the code has been reviewed](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md#3-show-how-the-code-has-been-reviewed),
  - [4 delegate and exempt](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md#4-delegate-and-exempt-with-visible-decisions),
  - [5 depth and learning](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md#5-choose-review-depth-and-learning-separately),
  - [7 preserving review when code changes](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md#7-preserve-the-review-when-the-code-changes),
  - the [reconciliation questions](../../docs/REVIEW_COVERAGE_AND_CODE_WALKS.md#reconciliation-questions).
- **Interaction model:** [INTERACTION_MODEL.md section 1](../../docs/INTERACTION_MODEL.md#1-the-division-of-responsibility) (division of responsibility) and [section 5](../../docs/INTERACTION_MODEL.md#5-what-makes-a-result-understandable) (what makes a result understandable).
- **Runtime and provider decisions:**
  - [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 5](../../docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md#5-orchestration-and-independent-review-share-the-agent-connection) (review shares the agent connection);
  - [RUNTIME_PLATFORM_ROADMAP.md, keep the product common](../../docs/RUNTIME_PLATFORM_ROADMAP.md#keep-the-product-common);
  - [TASK_MANAGEMENT_AND_WORKING_MEMORY.md section 11](../../docs/TASK_MANAGEMENT_AND_WORKING_MEMORY.md#11-review-records-without-an-orchestration-dependency) (review records);
  - the content-exclusion contract, [DSPATCH_CONTENT_EXCLUSION_CONTRACT.md](../../docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md).
- **Review stories:**
  - [DSP-150](dsp-150%20-%20Review-a-chosen-revision-pair-repository-log-diff-window-and-code-walks-beside-it.md): the diff review, line marks, the revision-pair record and the walk windows this builds on.
  - [DSP-126](dsp-126%20-%20Open-review-from-the-main-window-as-a-separate-window.md): review windows.
  - [DSP-127](dsp-127%20-%20Discuss-the-code-under-review-in-the-review-window.md): the review discussion.
  - [DSP-132](dsp-132%20-%20Ask-about-code-in-review-through-Claude-text-only.md): the text-only review discussion through Claude.
  - [DSP-129](dsp-129%20-%20Bundle-the-DSP-116-walk-as-a-portable-example-review.md): the DSP-116 example.
  - [DSP-13](dsp-13%20-%20Review-HCI-and-UI-research-for-code-understanding.md), [DSP-14](dsp-14%20-%20Compare-and-try-code-review-concepts.md) and [DSP-15](dsp-15%20-%20Agree-the-next-direction-for-review-and-Maestro.md): research and the review direction.

### Out of scope (from the plan)

- Import from Gerrit or GitHub (that is [DSP-151](dsp-151%20-%20Open-external-reviews-from-Gerrit-and-GitHub.md)).
- Automatic code fixes.
- Publishing review decisions.

### Open questions

The plan leaves these open, or they arise from existing decisions. Niclas's mandate of 29 October 2026 settled 3 and 4 and delegated 1, 2 and 6 as design choices within the story; the choices made are in the notes and can be changed after his trial. 5 remains open.

1. **The analysis agent's access.** The plan (§6) says the exact access for the analysis work is to be settled against the repository's architecture decisions before implementation. It must be a bounded assignment without a mandate to change project code. The existing review discussion is tool-free (DSP-132, `REVIEW_PERMISSIONS`) and must not gain permissions silently.
2. **Recording delegated agent review.** The current review model reserves delegated agent review and refuses to save it (DSP-150 notes). Delegation under §5 needs a recorded agent review with its mandate. How it is recorded is open.
3. **The default review requirement.** Per §5, the default introduced in DSP-150 ("your review or a recorded agent review") is not an approved decision. See the conflicts below.
4. **Order against the research.** [VISION.md section 3.4](../../docs/VISION.md#34-walkthrough-coverage-and-levels-of-engagement) leaves the choice between a walk pilot and the planted-defect probe to DSP-14 and DSP-15. DSP-13 treats a generated overview as attention-steering until measured. Whether this story goes ahead before DSP-14 and DSP-15 is Niclas's call.
5. **How the user trial is run.** §7 requires a real user trial for explanation quality. What it looks like, and who judges it, is open.
6. **The counting rule.** How walk coverage, "walked through" and line decisions relate in the counting rule beyond what DSP-150 decided.

### Conflicts with recorded material (reported, not resolved)

- **The default requirement.** DSP-150 implemented one requirement per revision pair, defaulting to "your review or a recorded agent review". The DSP-150 implementation notes record this as an implementation choice. The plan (§5) says this default is not to be treated as an approved decision. *Resolved 29 October 2026:* Niclas decided that manual review is the default for new reviews; a pair record that already stores the older requirement keeps it.
- **Generation was unspecified.** The decided review flow in VISION.md section 3.4 says automatic generation of walks "is not specified yet and is not built". This plan now specifies it as planned work. *Resolved 29 October 2026:* the vision text now points to the plan and records the decision and what was implemented in a subsection of its own.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Prepare code walks in the diff review lets the agent examine the chosen revisions, the diff and relevant surrounding code, and propose walks around behaviours or questions; each walk has a short description of what the person will understand, a reason it is relevant, steps with concrete code references (also across files) and the changed lines it covers (plan §1)
- [x] #2 DSpatch validates the references and shows changes no walk covers; tests, configuration, error handling and removed behaviour can be covered too; a created walk is no review and no approval (plan §1)
- [ ] #3 Each step's basic explanation says what happens, why and what matters in the code, gives the needed context before details, and follows the plan's writing rules, including keeping the code's intended behaviour, the agent's conclusions and observed test results apart; there is no fixed word count or template of mandatory headings (plan §2)
- [x] #4 Each step offers Tell me more, Explain more simply and Explain this; the request carries the revision pair, the current step, the relevant code and any selected text, and the answer appears as a local collapsible deepening at the step and can continue in the review chat with the same context (plan §3)
- [x] #5 A deepening keeps position and review decisions; asking for a simpler explanation does not change the whole review's level; review depth and teaching level stay separate (plan §3)
- [ ] #6 The explanation column gets more room by default with a draggable divider whose chosen width is kept; the layout follows the plan's points on line length, a short walk introduction, no stacked repeated explanations, code references near their explanation and use in smaller windows; the diff overview and the walk window stay separate with shared status and independent navigation (plan §4)
- [x] #7 The person can review, discuss, or explicitly delegate a walk, file or line range to the agent, which reports what it actually reviewed, its assessment and evidence, problems and remaining uncertainties, and what can be approved within the given mandate (plan §5)
- [x] #8 Reading an explanation, showing code or creating a walk never approves anything; an exemption is a separate explicit decision; open findings stay visible when walk coverage is high; review requirements are understandable and choosable (plan §5)
- [x] #9 The host owns revision material, validation, review status and history; the agent analyses and explains through the existing provider integration and its own tools, under a bounded assignment without a mandate to change project code; the existing tool-free review discussion gains no permissions silently (plan §6)
- [x] #10 Walks, deepenings, findings and decisions are bound to the reviewed version and survive a restart; new revisions never replace the material under review automatically (plan §6)
- [x] #11 Verification covers function and content: references and coverage match the revision pair, deepenings use the right step and code context, windows, positions and marks work after reopening, and agent approvals require an actual review result and the right mandate (plan §7)
- [ ] #12 Whether the explanations make the behaviour easier to understand without hiding important detail is judged in a real user trial; simulated answers verify the flow only, not the quality of the agent's explanations (plan §7)
- [x] #13 The existing DSP-116 example has its explanations reworked to the same principles, checked against the historical code it describes (plan §7)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
29 Oct 2026: implementation started under Niclas's mandate of this date (DSP-152 taken before DSP-14/15; manual review is the default for new reviews; design decisions within the story's scope delegated). Focus: mapping the review discussion's agent path, model choice, the walk definition format and the walk view before planning.

29 Oct 2026: first implementation, set to Review for Niclas's trial. Commits 8216451 (host jobs), bb7039e (windows), and the docs/example commit that sets this status.

### What the person can do

- **Prepare code walks** (diff window, *Files changed*): choose agent and model, start, stop. The result is saved as a review definition under `userData/reviews/` with a provenance note and listed among the pair's walks; changed lines no walk covers are named.
- **In a walk:** a wider explanation column with a draggable divider (pointer or ArrowLeft/ArrowRight), width kept in review preferences; the walk purpose shows its first sentence with *More*; each step offers *Tell me more*, *Explain more simply* and *Explain this* (selected text). Answers appear collapsible under the step, persist and can be continued in the review discussion.
- **Delegate review** of selected lines (*Delegate…*), a file (*Delegate file…*), a walk (*Delegate this walk to the agent…*) or the whole review (*Delegate the whole review…*). The result shows assessment, what was reviewed, findings (each linking to its lines) and uncertainties; approved lines are violet in the strip.

### Design choices within the mandate (changeable after the trial)

1. **Analysis access: tool-free, material in the prompt.** *(Superseded on 29 Oct 2026 by the analysis access below.)* The host reads the two commits (diff with `-M`, excerpts of changed files with 25 lines of context, budget 180 000 characters) and sends them in the prompt. The agent runs with the existing `REVIEW_PERMISSIONS` policy (no tools) from an empty folder `userData/reviews/agent-cwd/<key>`; a job refuses to start if the policy differs. This keeps the working copy out of reach, makes the material exactly the chosen revisions, and adds no permissions. Cost: the agent cannot browse code outside the excerpts. AC #9's "its own tools" is therefore not met as written; widening access is Niclas's decision.
2. **One host function for every way in.** `reviewPair.startJob` in the project host serves preparation and every delegation scope; the windows only call it.
3. **Validation and repair.** Every place and coverage range is checked against the commits (`walkPlaceProblems`). One repair round is asked for with the problems listed; places still invalid after it are dropped and the walk says so in its note. Uncovered changed lines are counted once, however many walks pass them.
4. **Recording agent review.** A delegated job stores its scope, revisions, model and result in the pair record (`jobs`); approvals become `AgentReview` entries with `jobId`. An approval counts only if the line is inside the scope, was reported as reviewed and carries no problem; anything else is listed under *adjustments*. An insufficient, cancelled, failed or unknown job approves nothing.
5. **Requirement.** New pairs default to `manual`, worded "Your review, or the agent's where you delegate": an explicitly delegated agent review counts; an undelegated one would not. A stored `manual-or-agent` is kept with its meaning.
6. **Deepenings** go through the existing review discussion service (same provider, same tool-free policy) with the step as subject and the request stored on the question (`deepen`). *Explain more simply* affects that answer only.
7. **Lifecycle.** A job is persisted before its prompt is sent. *Stop* records cancelled only on a confirmed end, otherwise unknown. Reopening never resends; after a restart a job that was running is shown as unknown (the outcome is not known, nothing is approved).
8. **Writing rules** from the plan are included in the preparation prompt; DSpatch does not rewrite the model's text.
9. **No new permanent panels:** jobs appear as one line where they were started.

### DSP-116 example (AC #13)

Summary, body and why of all 22 steps and W1's purpose rewritten (sv and en): what happens first, short paragraphs and lists, less repetition of "the chat does not use the Claude adapter yet" (kept in W1.7 and W2.8). Each number and claim was checked against the code at 73aaddc (e.g. `CANCEL_CONFIRM_MS` 10 s, grace 1 s; stop sequence 3 + 10 + 2 s; `PREVIOUS_TURN_EXIT_MS` 15 s; `DISPOSE_EXIT_WAIT_MS` 5 s, `DISPOSE_BOUND_MS` 7 s; `main.ts` 8 s). A script confirmed that nothing but these text fields and an appended provenance sentence changed. Pin and README updated.

### Verification

Simulated provider (`DSPATCH_REVIEW_SIM=bad-ref-first`), isolated userData in scratchpad kits, no live calls, no Cursor, no real userData.

- `tests/review-agent-jobs.test.ts` (13, new): pass. Review test group and host test group: pass. `tests/example-review.test.ts`: 4/4 pass. Typecheck and build clean.
- Scenario `code-walks`, two phases through the real windows: preparation with exactly one repair (4 walks, 8 steps, 2 uncovered lines named, no working-copy content in any prompt); the generated walk opens; divider 520 → 560 px and kept; *Tell me more* and *Explain this* answered and shown in the discussion; delegated lines 8–9 of `src/keep.ts`: line 8 approved (violet), finding on line 9; `docs/gone.md` insufficient, nothing approved; walk W1 delegated and shown in the diff; a stopped review cancelled with no approvals; reopening sends no prompts (8 → 8); after restart jobs, deepenings and the unknown outcome of the job closed mid-run are back, 0 prompts sent.
- Scenarios `pair-review` (both phases) and `review-window`: pass on the final build.

### Not established

- The quality of real models' walks and explanations (AC #3, #12): needs Niclas's trial with a real provider.
- Live runs with Cursor or Claude.
- The layout in narrow windows was judged from screenshots only; the scripted capture restores the window size. UX acceptance (AC #6) is Niclas's.
- Content exclusion: DSpatch has none yet; when it does, `ReviewPairs.material()` is the single place the agent's material is read.
- Linux.

Unchecked on purpose: #3 and #12 need a real model and Niclas's trial (the writing rules are in the prompt; simulated answers show only the flow); #6 is UX acceptance, Niclas's; #9 is met except "its own tools", see design choice 1.

29 Oct 2026, after Niclas's first live trial: priority fix. Observed: the agent picker in the review flow could not be used; the review seemed to pick Haiku instead of the opening context's provider and model; Prepare code walks tried to start Cursor (UnknownAgentError plan_required). Focus: trace the provider/model choice from the opening window through the review window, picker, host job start, provider factory and adapter; fix where it is lost; short error in the normal view with the raw SDK text in details. Do not contact Cursor. The tool-free analysis departure (design choice 1) stays a separate follow-up.

### Fix after the first live trial (29 Oct 2026): the agent and model of review jobs

**Observed by Niclas (live):** the agent picker could not be used; the review seemed to pick Haiku; *Prepare code walks* failed with Cursor's `UnknownAgentError: [plan_required]`, so Cursor was started although his chat used Claude.

**Cause, traced from the opening window to the adapter:**
- `AgentPicker` preselected the first usable agent of `['cursor', 'claude']`. `providerAvailability` always counts Cursor as usable (its account is checked only at session start), so the picker always started on **Cursor**, whatever the opener used.
- Its model came from `reviewModelFor`, whose Cursor branch fell back to `REVIEW_DISCUSSION_DEFAULT_MODEL` = `claude-haiku-4-5`: the **hard-coded Haiku**.
- The windows carried the opener's provider (`defaultProvider`, DSP-132) for the discussion, but the picker never read it, and no model was carried at all.
- Opening the picker listed Cursor's models through the chat's lookup, so Cursor was asked something even before a start.
- A late model listing for one agent could overwrite the list after the agent was changed.
- The host, the factory and the adapter passed on exactly what they were given; the choice was wrong before it left the window. My earlier `code-walks` verification only pressed *Start* and so ran exactly that combination without noticing.

**Fix:**
- `review.openContext` returns the opener's agent (`resolveLoopProvider`: the open session's, else the stored choice, the same rule as the loop editor's run) and its model (`chatService.modelFor`). The review windows carry it as `defaultModel` beside `defaultProvider`, including walk windows opened from the diff.
- `reviewPair.agents(key, opener)` (host, `ReviewAgentJobs.agents`) answers the options and the current choice: the review's own (`PairRecord.agent`, written when a job is started) else the opener's, else none. It builds nothing and picks nothing; an unusable choice comes back with its reason.
- `AgentPicker` starts from that choice, lists models only for the chosen agent (ignoring stale answers), starts a changed agent with no model unless it is the one already chosen, and never falls back. Without a usable choice it says why and waits for one. The start button sends exactly what is shown.
- A job that fails gets a short note in the window; the provider's or SDK's own text is kept in `AgentJob.detail` and shown under *Details*. A session start that fails says "<Agent> could not start a session with <model>. Nothing was sent, and nothing was approved." No other agent or model is tried.
- The old `reviewAgentOptions`/`reviewModelFor` are removed.

**Design choice (changeable):** a choice made in a review (by starting a job) wins over the opener's the next time that review is opened, as a stored discussion keeps its agent (DSP-132).

**Verified** (simulated providers, isolated userData in scratchpad kits, no live calls, no Cursor contact):
- `tests/review-agent-jobs.test.ts`: 13/13, three new (choice order and storing, unusable choice, start failure with detail and no other agent); `tests/review-pairs.test.ts` 23/23; typecheck and build clean.
- New scenario `review-agent-choice`, real input events (`press`, `press-key` through `sendInputEvent`) in the review windows:
  - `first` (from the chat): picker shows Claude · `claude-sonnet-4-5`; walks ran with it and the adapter's session got Claude/`claude-sonnet-4-5`; the model changed with the Up key in *Delegate the whole review*, and that job and session got `claude-haiku-4-5`; the picker then offers the changed choice.
  - `editor` (from the loop editor): the same with a delegation first and walks after the change.
  - `unavailable` (the first kit relaunched without Claude, the chat on Cursor): the picker says Claude cannot be used and why, preselects nothing, cannot start; no adapter built, no session.
  - `start-fails` (simulated `plan_required` start error): short note, raw text folded under *Details*, one start only, nothing approved.
  - In every phase the review adapters were built for Claude only.
- `code-walks` (both phases) passes after the change.

**Not established:** a live run with Claude; how the real Claude SDK names or lists models compared with the simulated list; the missing-choice case in the UI (covered by the unit test; with no usable agent the main window has no review button). Remaining: the chat's own Cursor default (`DEFAULT_MODEL`) and the review discussion's Cursor fallback are still `claude-haiku-4-5`; both apply only to Cursor and were not changed here. The tool-free analysis with bounded excerpts (design choice 1) remains a separate follow-up. This fix does not make DSP-152 as a whole done.
### Second live trial (29 Oct 2026): an earlier Cursor failure shown as the outcome of a new choice

**Observed by Niclas (live, build of 08:22 with d5a670b):** a review opened with Claude · Opus 5.5 showed `Cursor adapter operation "startSession" failed: UnknownAgentError: [plan_required]`.

**Established from his profile (read only; the record was copied to a scratchpad kit, nothing in the profile changed):**
- The review of that revision pair (`reviews/pairs/abebf79d…json`, MiniDAWLab, `b87f042` → `8c7d41b`) holds one job: `job-56bdb702…`, walks, Cursor · `claude-haiku-4-5`, started 00:02:34Z and failed 00:02:35Z, which is before d5a670b (00:29Z). Its note is in the old form, with the raw SDK text inside the note.
- The app was started at 07:22Z and the review opened at 07:22:27Z; only its position was saved. `agent` is still `null` and there is no later job. `ReviewAgentJobs.start` writes a job synchronously before anything is sent, so no new job reached the host, and no Cursor session was started that morning.
- A review record belongs to its revision pair, so opening "a new review" of the same two commits is the same review and reads its jobs back. That is intended; the defect was how the last job was drawn. The window drew the last walks job directly under the picker, with no agent, model or time, and the old note carried the raw Cursor text. So a failure from before the fix read as the outcome of the Claude/Opus choice shown above it.

**Fix:**
- A finished job's line says which attempt it was: `Last attempt (<Agent> · <model> · <time>):` before the note (a done job shows its agent, model and time too). Its *Details* name the job id, agent, model, start and end, and hold the provider's own text.
- While the picker for new work is open, the previous finished job of that kind is not drawn beside it (diff window: walks and whole delegation; walk window: walk delegation). A running job stays visible.
- A job stored before the fix of d5a670b has its note split on reading: the short meaning stays as the note and the raw text moves to the detail, as a new failure is written.
- A stored job without a known agent is no longer read as Cursor; it is not attributed to any agent.

**Verified** (simulated providers, isolated userData, no live calls, no Cursor contact):
- `tests/review-pairs.test.ts` 24/24 (one new: the copied legacy job is read with its own agent, the raw text is split into the detail, and a job without an agent is not read as Cursor); `tests/review-agent-jobs.test.ts` 13/13; typecheck and build clean.
- New phase `history` of `review-agent-choice`, real input events. The kit is seeded with the chat on Claude with the model `opus` and with Niclas's stored record (its pair identity replaced by the kit's): the old job is shown as `Last attempt (Cursor · claude-haiku-4-5 · …)` with the raw text only under *Details* with its job id; with the picker open it is not drawn, and the picker shows Claude · `opus`; no adapter was built before the start; the start ran Claude/`opus` (job and adapter session); both jobs are kept; the line then shows only the Claude job. The host log has one model listing, for Claude, and no line mentioning Cursor.
- Phases `first` and `start-fails` pass again after the change.

**Not established:** a live run with Claude and the real SDK's `opus` alias (the simulated list gained an `opus` entry for this). Once a newer job of the same kind exists, an older failed job is kept in the record but no longer drawn in the window. The tool-free analysis follow-up is unchanged, and DSP-152 as a whole is not done.

### Second live trial, continued (29 Oct 2026): why *Prepare code walks* started nothing

**Established about the trial** (profile read only): no start request reached `ReviewAgentJobs.start`, which writes a job before anything is sent. The app ran from `npm start` (08:22:15) with its output on a console that is not kept, and nothing logged clicks or review IPC, so which control was pressed and whether a request left the window cannot be established afterwards. The picker had read the review's agents from the host (it showed Claude and the model), so the window, its key and the host's review service were working at that moment.

**Reproduced with real input** (new scenario `walk-start`, d5a670b's flow unchanged at the time of the first run), each of which ends with no job and nothing new in the window, as in the trial:
- Two controls were named *Prepare code walks*: the header one opens the picker and, with the picker open, a press on it does nothing; only the picker's own button starts.
- A start request that fails on its way (IPC or the host throwing, as against refusing) was a rejected promise nobody caught: no job, no message. The main-process log showed "start request failed before the host answered" while the window showed nothing.
- A start that cannot be pressed (the model is not in the account's list) was a grey button with no reason beside it.
- The picker listed the provider's raw list, the `default` alias as a model of its own, instead of the chat's `modelRows`.
The trial cannot tell which of the first two Niclas met; both are fixed.

**Fix:**
- While the picker is open, the header's *Prepare code walks…* (now with an ellipsis, as it opens a choice) and *Delegate the whole review…* are not drawn: the picker's button is the only one that starts.
- A start request that fails on its way is shown in the window: "The code walks could not be started: <reason>" (diff window, whole and file delegation; walk window: walk delegation); a stop request likewise.
- The picker draws models with `modelRows` (the provider's `default` alias is not a model; the model it resolves to is marked `· default`) and says beside the start why it cannot start ("<model> is not in Claude's list for this account. Choose a model.", "Choose a model.").
- Transitions are logged by ids, without prompt content: the review window's request in the main process (received, answered, failed before the host answered), the host's request, refusal or registered job id with agent and model, and the session opened.
- Trials: `pairWindowCheck` presses in the main window (`id` 0) with real input and refuses to click a point covered by another element; the presentation adapter can list models shaped like a Claude account's (`default` alias, `opus`, ...) after a delay (`DSPATCH_PRESENTATION_MODELS=claude`, `DSPATCH_PRESENTATION_LIST_MS`); `DSPATCH_REVIEW_SIM=start-throws` fails a start request in the host (presentation mode only). The window reading's picker and Details text no longer lose the letter s (a broken `\s`).

**Verified** (SIMULATED provider, isolated userData, real mouse and keyboard from the main window on, nothing set by script):
- `walk-start` `first`: Niclas's stored review (copied, with its failed Cursor job), chat on Claude/`opus`, list arriving after 9 s: the picker shows Claude and `opus (reading Claude's models…)` while it is read and `Opus 5.5 · default` after; no second start control; Start → host log `job request: walks with claude/opus` → `job … registered` → `session opened with claude/opus` → done; *Show the walks* → the walk → the walk window opens with the walk.
- `clean`: no earlier job; the model changed with the keyboard to `sonnet` after the list arrived; job, session and walk with `sonnet`.
- `blocked`: a stored model the list does not offer: the picker says so and Start is refused; a model chosen with the keyboard; the host fails the request (SIMULATED): the window says "The code walks could not be started: …", no job, no adapter built.
- No log line mentions Cursor in any phase; only Claude's model list was read.
- `review-agent-choice` (four phases) and `code-walks` (two phases) pass after the change; `review-pairs`, `review-agent-jobs` and `model-choice` tests 41/41; typecheck and build clean.

**Not established:** which of the reproduced paths Niclas met; a live run with Claude (whether the real SDK lists `opus` and runs a walk with it). The tool-free analysis follow-up is unchanged, and DSP-152 as a whole is not done.

29 Oct 2026, analysis access (Niclas's assignment of this date; the decided runtime-tool access, separate from the tool-free discussion): give walk preparation, delegated review and step questions read-only access to both revisions through the provider's own Read/Glob/Grep, from a host-owned snapshot of the two commits; keep host validation, job records and the model choice of b420a3f. Gaps mapped: analysis is tool-free with 25-line excerpts and a 180 000-character cap (design choice 1); no revision material on disk; no read-only policy; deepenings see only the current place; material() named as the only content path.
### Analysis access (29 Oct 2026): the agent examines the code itself

Assignment of this date: replace the tool-free analysis (design choice 1: 25-line excerpts, a 180 000-character prompt) with the access the plan (§6) decided, the runtime's own tools over the right revisions, and connect it to the flow built so far. This supersedes design choice 1 and the earlier note that `ReviewPairs.material()` is "the single place the agent's material is read".

**What works now**
- *Prepare code walks*, every delegation (lines, file, walk, whole review) and a new step question (*Look into the code…* under each step) run as analysis jobs. The host writes the two commits to `userData/reviews/revisions/<pair key>/base/` and `target/` and runs the agent there. The prompt opens with the change, its changed lines and the unified diff (whole files' diffs up to 60 000 characters) for orientation, and tells the agent to read whole files, follow calls, definitions and callers, and look at unchanged code and tests with its tools.
- Results are checked against Git at the two commits, never against the folder: walk places and answer references must exist at their commit (one repair round for walks, invalid references in answers left out and named), findings whose place does not exist lose the place and are named, approvals only inside the scope among reviewed lines, and lines in files the agent could not read are not approved.
- Each job records what the agent could read (`material`: the commits, file count and anything left out with its reason) and what it read and searched (`investigation`, from the provider's tool reports; refused calls separately). Both are under *Details*, not in the view.
- The review discussion stays tool-free. A step's deepenings (*Tell me more*, *Explain more simply*, *Explain this*) now get every place of the step as code context and the step's answered code questions as "What the agent found in the code for this step", read by the host from the pair record.

**Design choices (changeable)**
1. **Revision material: written files, not checkouts.** `RevisionSnapshots` lists each commit with `git ls-tree` and writes every blob from `git cat-file --batch`: no worktree, no index, nothing added to `.git`, the commit's bytes exactly. Considered and not chosen: `git worktree add` (writes into the person's `.git`, needs cleanup there) and a checkout into a temporary index (more moving parts for the same files). Symbolic links, submodules, names the file system cannot hold, case collisions and files beyond 1 GiB per side are left out and named; changed files are never left out for size. Files are written read-only (a guard, not containment).
2. **Lifecycle.** A job holds the pair's folder from before the session until the session is closed; jobs over one pair share it; the last release deletes it, and folders left by an earlier run are deleted when the host starts. Walks and results name repository paths at a commit, so they open without the folder. Stop, unknown outcomes, no resend on reopening and restart reconciliation are the existing job handling, unchanged.
3. **Permissions (Claude).** A new purpose `analysis` in the shared factory gives `ANALYSIS_PERMISSIONS`:
   - `tools: Read, Glob, Grep`; `allowedTools: Read(/**), Glob, Grep`;
   - every writing, command, web, agent, skill and MCP tool in `disallowedTools`;
   - `dontAsk`, `settingSources: []`, `strictMcpConfig`, no app tools;
   - a PreToolUse hook (`confineToFolders`) that denies any other tool, any Read/Glob/Grep path outside the session folder and any absolute or `..` pattern, before allow rules apply.

   A job refuses an adapter without exactly this policy. Technically enforced: what Claude Code's permission system and the hook do. Not enforced: the Claude Code process is not sandboxed; "you cannot change files or run commands" in the prompt is an instruction, not the control. Managed (policy) settings, including hooks an organisation installs there, still apply; DSpatch neither loads nor removes them.
4. **Cursor does no analysis work.** Its adapter has only "no tools" or the provider's default set (which writes and runs commands); neither is read-only analysis, so the factory and the picker refuse Cursor here with the reason ("Cursor cannot be limited to reading files through DSpatch's Cursor connection…"). This removes the earlier tool-free Cursor walks. Whether Cursor's SDK can be limited to reading is not established (not contacted).
5. **Step questions** are a fourth action under a step rather than a change to the three deepening actions: the three keep the discussion's tool-free path and the plan's pedagogy; a question that needs the code goes to the analysis path, and its answer becomes context for the discussion.

**Content exclusion.** Repository content now reaches the model by three ways:
- the opening diff (`ReviewPairs.material`);
- the agent's own reads of the revision folder, where `RevisionSnapshots` decides what is written and Claude Code's permission path (including managed hooks) sees each read before it happens;
- the discussion's envelope (`ReviewService.envelopeFor`), now with the step's places and code answers.

DSpatch excludes nothing in any of them today and does not claim to; the content-exclusion contract's controls are not built here.

**Departures closed:** design choice 1 (tool-free analysis with bounded excerpts; AC #9's "its own tools"); `material()` described as the single content path.

**Verified** (no provider contacted, no live calls, isolated user data, the real profile untouched):
- New `tests/review-analysis.test.ts` (10), over a real Git repository whose changed `total()` calls `findDiscount()`, defined 61 lines down in an unchanged file and able to return null, with an edited, staged and untracked working copy (`tests/support/analysis-fixture.ts`):
  - the folder holds exactly the commits' bytes, nothing staged or untracked, and the working copy, index, HEAD and worktrees are unchanged;
  - links and submodules are left out and named; stale folders are swept; a shared folder is removed after its last holder;
  - the policy's decisions for inside and outside paths, patterns and other tools;
  - the factory builds `ANALYSIS_PERMISSIONS` for Claude and refuses Cursor before building anything;
  - the real `ClaudeAgentSdkAdapter` with a substituted SDK whose scripted model calls tools through the adapter's own hooks, reading real files only when allowed: the session ran in the revision folder with the policy's options; reads of the revisions passed, a read of the working copy and a Bash call were refused; the definition was not in the prompt yet the walk points at `src/pricing.ts` line 61; the job recorded what was read and refused; the folder was gone after the job.
- `review-agent-jobs` (13) updated; the review group (138), the provider group (103), `provider-selection`, `project-host-boundary` and `loop-agent-commands` pass; `npm run typecheck` and `npm run typecheck:claude` pass (the latter checks the tool names and the Read/Glob/Grep input fields against the installed SDK 0.3.306); build clean.
- New scenario `analysis-access`, real mouse and keyboard from the main window, presentation agent that reads the revision folder from disk:
  - `first`: walks with Claude/`opus` (a step at the unchanged definition); the walk opened at that place; a typed step question answered with references to `src/pricing.ts` lines 61–66 (To) and the reads under Details only; *Tell me more* sent with the step's answer and the definition's code in its context and no working-copy text; `src/checkout.ts` delegated (a problem at line 4, a note at the definition, line 4 not approved); `README.md` not enough to judge, nothing approved; a delegation stopped, cancelled, nothing approved.
  - `again` (restart): jobs, walk and the step's answer back, 0 prompts sent.
  - The runner showed: the working-copy fingerprint unchanged after both phases; every job's recorded commits equal to the kit's; five folders written and five removed; none left; no log line names Cursor.
- `code-walks` (both phases, now with a Claude kit since Cursor does no analysis), `walk-start` (three phases) and `review-agent-choice` pass (`unavailable` now expects "No agent can be used here" with both reasons).

**Not established**
- Whether the real Claude Code process honours `tools`, `allowedTools`, `disallowedTools` and the hook's decision as documented, and that `Read(/**)` and bare `Glob`/`Grep` behave as expected on Windows paths: needs the live trial; a denial there fails closed (the agent reads less).
- What a real model reads and writes, and the quality of its walks, reviews and answers (AC #3, #12).
- How long writing the folder takes for a large repository (the fixtures are small); Linux.
- Cursor's ability to read-only analysis.

29 Oct 2026: in progress again under Niclas's assignment of this date: explain selected code directly in the diff window (Explain this on a text selection, in both layouts, through the analysis path of 35fd548). Focus: the selection's identity (file, side, revision, lines and characters), the host's checks and storage, then the window.

### Explaining selected code in the diff (29 Oct 2026)

Assignment of this date: explain code the person selects in the diff window, without copying it into a chat or making a walk first, through the analysis path of 35fd548.

Governing decisions: the plan's deepening actions and writing rules (§2, §4); analysis through the runtime's own read-only tools over the two revisions (design choices 1–3 of *Analysis access* above); the review discussion stays tool-free (design choice 5); agent work starts only from an explicit action, with the review's agent and model and no fallback (fixes d5a670b, 4122f81, b420a3f); nothing but the person or an explicit delegation marks or approves lines (manual review default, 29 Oct).

**What works now**
- Selecting code with the mouse in either layout offers *Explain this* beside the selection. The same action is in a context menu (right click, or the context-menu key) and on Ctrl+Shift+E. Changed lines selected for review by their strip can also be explained (*Explain* in the line bar), which is the keyboard-only way. Pressing the action keeps the selection.
- A selection may be part of a line, several lines, or removed, added or unchanged code. Side by side, a selection stays in the column it starts in. In the unified layout a selection over removed and added lines becomes separate parts.
- The explanation opens in a panel beside the diff. The panel shows each selected part with its place ("src/checkout.ts line 4, characters 19–36 (To, added)"), colours removed and added parts, and offers *Show in diff*. The explained code stays marked in the diff (a CSS highlight, which changes neither the DOM nor the selection). The panel can be hidden to a narrow tab, and the row being read stays in place when its width changes.
- *Tell me more*, *Explain more simply* and a typed follow-up ask again about the same selection, with the earlier answers. Each answer is folded except the latest; references open in the diff when they are in the change; Details say what the agent read.
- Explanations are kept with the review. They reopen from "Explanations in this file", and after a restart, without anything being sent.
- With no usable agent chosen for the review, the picker opens in the panel and the selection waits for it.

**Design choices (changeable)**
1. **Explanations are analysis jobs.** Each explanation and each follow-up is an `explain` job with a `selection` (and `followUp`), stored in the pair record like the step questions. This reuses job registration, stop, unknown outcomes, restart reconciliation, Details and the one-at-a-time rule per kind. Follow-ups go through the analysis path rather than the discussion, so the agent can read further for them; the discussion is not given tools.
2. **The host decides what was selected.** The window sends file, side, lines, characters and the text it saw. The host reads those lines from Git at the named commit, decides which are removed, added or unchanged from the diff, and splits runs of different kinds. It refuses the selection when the text differs from the commit. A follow-up's selection is taken from the explanation it follows, never from the window. A selection is bounded to 40 parts, 400 lines and 20 000 characters.
3. **The prompt keeps the sides apart.** Each part names its commit and kind ("REMOVED: only in From …", "ADDED: only in To …", "UNCHANGED …"). It includes the exact text and the lines around it at that side, plus the folder and orientation sections of the other analysis tasks. The agent is told never to describe removed code as current behaviour or added code as earlier behaviour.
4. **No question per press.** The action uses the review's current agent and model (the review's own choice, else the opener's), as the picker would preselect them. It shows the picker only when that choice is missing or unusable. It never uses Cursor (refused for analysis) or another model.
5. **The panel narrows the diff rather than covering it.** Covering would hide the To column side by side. The anchor row keeps the reading position.

**Boundaries kept:** selecting text and explaining never change marks, approvals or delegations (no agent review is written for an explanation job); the existing line selection by strip and number is unchanged and works alongside; the analysis permissions, revision snapshots and host/client split are those of 35fd548; the discussion has no new tools. Content exclusion: an explanation's prompt adds the selected lines and the lines around them read from the commits, a fourth path alongside those named above; DSpatch excludes nothing there either.

**Verified** (no provider contacted, no live calls, isolated user data, the real profile untouched):
- `tests/review-analysis.test.ts` +3. The selection is recorded as the commits hold it, split into removed, added and unchanged, and marks and approves nothing. Wrong text, wrong side, another file and an unchecked start are refused. A follow-up carries its explanation's selection (a forged one is ignored) and the earlier answer. A follow-up of a follow-up is refused. 13/13; review group 141/141; `npm run typecheck`; build.
- Scenario `selection-explain` used real input through `sendInputEvent` (left-button drags over characters, a right click with Windows' context-menu event, Ctrl+Shift+E, Enter on a strip), the SIMULATED agent reading the revision folder (it answers only if the selected text is at the sent side and place) and isolated user data:
  - `first`:
    - Part of an added line side by side ("findDiscount(code)", To, line 4, characters 19–36). The selection was kept after pressing, the agent read on to `src/pricing.ts` line 61, and the prompt carried the exact text, ADDED and the To commit, and no working-copy text.
    - *Tell me more*, *Explain more simply* and a typed question each built on 1, 2 and 3 earlier answers.
    - Two removed lines through the context menu (From, lines 3–4, read in `base/`).
    - Part of an unchanged line with Ctrl+Shift+E.
    - In unified, one drag over removed lines 3–4 and added line 3, recorded as two parts.
    - A line selected for review with the keyboard, explained, then marked as reviewed. Only that line changed, and no explanation changed any line's status, approved anything or started a review.
    - An earlier explanation reopened with its follow-ups.
  - `again` (restart): five explanations back, reopened with answers and the selection marked, 0 prompts sent.
  - `pick` (chat on Cursor): the picker in the panel with the selection kept; Claude/opus chosen there; no adapter built for Cursor.
  - Runner, every phase: working copy unchanged; every job's commits equal to the kit's; every revision folder removed.
- Regression: `analysis-access` (`first`) passes with the fixture's new unchanged tail.

**Not established**
- What a real model writes for a selection, and whether the opening explanation and the follow-ups meet the plan's writing rules (needs the live trial, AC #3, #12).
- Text selection with a real mouse and touchpad by a person, including selections that start or end in a fold, a number or the gap between columns; the scenarios' drags are exact.
- UX acceptance: how the button, the panel's width and the reading position feel in use.
- Linux.

<!-- SECTION:NOTES:END -->
