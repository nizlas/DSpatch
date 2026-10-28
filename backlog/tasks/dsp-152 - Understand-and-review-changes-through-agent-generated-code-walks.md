---
id: DSP-152
title: Understand and review changes through agent-generated code walks
status: Review
assignee: []
created_date: '2026-10-28 22:32'
updated_date: '2026-10-28 23:19'
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
- [ ] #9 The host owns revision material, validation, review status and history; the agent analyses and explains through the existing provider integration and its own tools, under a bounded assignment without a mandate to change project code; the existing tool-free review discussion gains no permissions silently (plan §6)
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

1. **Analysis access: tool-free, material in the prompt.** The host reads the two commits (diff with `-M`, excerpts of changed files with 25 lines of context, budget 180 000 characters) and sends them in the prompt. The agent runs with the existing `REVIEW_PERMISSIONS` policy (no tools) from an empty folder `userData/reviews/agent-cwd/<key>`; a job refuses to start if the policy differs. This keeps the working copy out of reach, makes the material exactly the chosen revisions, and adds no permissions. Cost: the agent cannot browse code outside the excerpts. AC #9's "its own tools" is therefore not met as written; widening access is Niclas's decision.
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
<!-- SECTION:NOTES:END -->
