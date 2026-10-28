---
id: DSP-152
title: Understand and review changes through agent-generated code walks
status: To Do
assignee: []
created_date: '2026-10-28 22:32'
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
Planned, not implemented. From a chosen revision pair to an understandable walkthrough and a review decision, with readability as part of the function.

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

The plan leaves these open, or they arise from existing decisions. None is decided here.

1. **The analysis agent's access.** The plan (§6) says the exact access for the analysis work is to be settled against the repository's architecture decisions before implementation. It must be a bounded assignment without a mandate to change project code. The existing review discussion is tool-free (DSP-132, `REVIEW_PERMISSIONS`) and must not gain permissions silently.
2. **Recording delegated agent review.** The current review model reserves delegated agent review and refuses to save it (DSP-150 notes). Delegation under §5 needs a recorded agent review with its mandate. How it is recorded is open.
3. **The default review requirement.** Per §5, the default introduced in DSP-150 ("your review or a recorded agent review") is not an approved decision. See the conflicts below.
4. **Order against the research.** [VISION.md section 3.4](../../docs/VISION.md#34-walkthrough-coverage-and-levels-of-engagement) leaves the choice between a walk pilot and the planted-defect probe to DSP-14 and DSP-15. DSP-13 treats a generated overview as attention-steering until measured. Whether this story goes ahead before DSP-14 and DSP-15 is Niclas's call.
5. **How the user trial is run.** §7 requires a real user trial for explanation quality. What it looks like, and who judges it, is open.
6. **The counting rule.** How walk coverage, "walked through" and line decisions relate in the counting rule beyond what DSP-150 decided.

### Conflicts with recorded material (reported, not resolved)

- **The default requirement.** DSP-150 implemented one requirement per revision pair, defaulting to "your review or a recorded agent review". The DSP-150 implementation notes record this as an implementation choice. The plan (§5) says this default is not to be treated as an approved decision. Nothing has been changed; Niclas decides.
- **Generation was unspecified.** The decided review flow in VISION.md section 3.4 says automatic generation of walks "is not specified yet and is not built". This plan now specifies it as planned work. The vision text is left as it was; it stays true until this story is implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Prepare code walks in the diff review lets the agent examine the chosen revisions, the diff and relevant surrounding code, and propose walks around behaviours or questions; each walk has a short description of what the person will understand, a reason it is relevant, steps with concrete code references (also across files) and the changed lines it covers (plan §1)
- [ ] #2 DSpatch validates the references and shows changes no walk covers; tests, configuration, error handling and removed behaviour can be covered too; a created walk is no review and no approval (plan §1)
- [ ] #3 Each step's basic explanation says what happens, why and what matters in the code, gives the needed context before details, and follows the plan's writing rules, including keeping the code's intended behaviour, the agent's conclusions and observed test results apart; there is no fixed word count or template of mandatory headings (plan §2)
- [ ] #4 Each step offers Tell me more, Explain more simply and Explain this; the request carries the revision pair, the current step, the relevant code and any selected text, and the answer appears as a local collapsible deepening at the step and can continue in the review chat with the same context (plan §3)
- [ ] #5 A deepening keeps position and review decisions; asking for a simpler explanation does not change the whole review's level; review depth and teaching level stay separate (plan §3)
- [ ] #6 The explanation column gets more room by default with a draggable divider whose chosen width is kept; the layout follows the plan's points on line length, a short walk introduction, no stacked repeated explanations, code references near their explanation and use in smaller windows; the diff overview and the walk window stay separate with shared status and independent navigation (plan §4)
- [ ] #7 The person can review, discuss, or explicitly delegate a walk, file or line range to the agent, which reports what it actually reviewed, its assessment and evidence, problems and remaining uncertainties, and what can be approved within the given mandate (plan §5)
- [ ] #8 Reading an explanation, showing code or creating a walk never approves anything; an exemption is a separate explicit decision; open findings stay visible when walk coverage is high; review requirements are understandable and choosable (plan §5)
- [ ] #9 The host owns revision material, validation, review status and history; the agent analyses and explains through the existing provider integration and its own tools, under a bounded assignment without a mandate to change project code; the existing tool-free review discussion gains no permissions silently (plan §6)
- [ ] #10 Walks, deepenings, findings and decisions are bound to the reviewed version and survive a restart; new revisions never replace the material under review automatically (plan §6)
- [ ] #11 Verification covers function and content: references and coverage match the revision pair, deepenings use the right step and code context, windows, positions and marks work after reopening, and agent approvals require an actual review result and the right mandate (plan §7)
- [ ] #12 Whether the explanations make the behaviour easier to understand without hiding important detail is judged in a real user trial; simulated answers verify the flow only, not the quality of the agent's explanations (plan §7)
- [ ] #13 The existing DSP-116 example has its explanations reworked to the same principles, checked against the historical code it describes (plan §7)
<!-- AC:END -->
