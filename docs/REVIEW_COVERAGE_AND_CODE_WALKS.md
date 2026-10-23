# DSpatch review coverage and code walks

A vision for code review with visible coverage and learning

Version 1.1 · 23 October 2026 · Proposed product concept

Change in version 1.1: record Niclas's answers to the first two reconciliation questions; VISION.md section 3.4 holds the decision.

**Source and status.** This document is the maintained English version of Niclas Danielsson's Swedish document *DSpatch Review Coverage och Code Walks* (Word, 22 October 2026, version 1.0), translated in full from a faithful Swedish Markdown conversion. The source version and date identify that historical document; the version above identifies this English document. Sections 1–8 and both tables follow the source. The introduction keeps its content, and the closing section records the source's references together with their current equivalents. The rest of the document reconciles the source with governing decisions made after it.

The capabilities described here are **proposals, not implemented features or accepted architecture**. The decision that review is a standalone capability is recorded in [VISION.md, section 3.3](VISION.md#33-review-as-a-standalone-capability), and its summary of these proposals for a bounded pilot is [section 3.4](VISION.md#34-walkthrough-coverage-and-levels-of-engagement). Where this document and a governing document differ, the governing document applies and the difference is reported rather than settled here.

DSpatch should help us understand agent-generated changes and choose where to spend our own attention. The proposal is to combine guided code walks with a visible map of what has been reviewed, accepted, delegated or still remains. Review should also be usable for learning the codebase and the programming language.

The source presented itself as a vision addendum to sections 1.1 and 3–3.1 of the DSpatch vision and governing document. The functions are not yet implemented. The addendum makes concrete how behaviour, code understanding and revision-bound review can meet in the same workspace.

## How this concept fits current decisions

Each point summarises a decision and links to the document that owns it; that document governs, and this one extends none of them.

- **Input.** A code walk works on a repository and a selected diff or revision, without Maestro, the graph editor or a coordinator, as [VISION.md section 3.3](VISION.md#33-review-as-a-standalone-capability) decides. None of the examples below needs a DSpatch task.
- **Supplementary material.** Task requirements, the implementer's rationale and verification results are optional, identifiable inputs. The implementer's claims are material to check, not evidence ([VISION.md section 3.3](VISION.md#33-review-as-a-standalone-capability) and [explanations must be checkable](VISION.md#förklaringen-måste-gå-att-kontrollera)).
- **Agent acceptance.** "Accepted by agent" in the status table of section 3 is a delegated assessment under an explicit mandate. It never becomes human approval by itself ([AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 5](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md#5-orchestration-and-independent-review-share-the-agent-connection); [VISION.md section 3.4](VISION.md#34-walkthrough-coverage-and-levels-of-engagement)).
- **Agent connection.** Review and orchestration reuse the same `AgentAdapter` and SDK adapters, including authentication, tool control, cancellation and session handling. [RUNTIME_PLATFORM_ROADMAP.md section 2](RUNTIME_PLATFORM_ROADMAP.md#keep-the-product-common) owns those runtime responsibilities; this document adds none.
- **Persistent records.** What a review record holds, its binding to identified content and its separation from resuming a provider session are directed by [TASK_MANAGEMENT_AND_WORKING_MEMORY.md section 11](TASK_MANAGEMENT_AND_WORKING_MEMORY.md#11-review-records-without-an-orchestration-dependency). The status terms in section 3 are user-facing terms, not a schema.
- **Scope.** Initial development stays in the same repository with a shared implementation ([VISION.md section 3.3](VISION.md#33-review-as-a-standalone-capability)). This document authorises no rewrite, separate application or pilot. A pilot needs its own task and mandate, and an isolated branch or worktree for it needs Niclas's explicit request ([TASK_MANAGEMENT_AND_WORKING_MEMORY.md section 11](TASK_MANAGEMENT_AND_WORKING_MEMORY.md#11-review-records-without-an-orchestration-dependency)).
- **Evidence.** The research in [REVIEW_RESEARCH.md](REVIEW_RESEARCH.md) and its deliverables applies. DSP-12 found no controlled evaluation of the agent-generated walkthroughs that tools widely ship. [DSP-13 section 9.1](research/dsp-13-comprehension-research.md#91-the-direct-answer-to-dsp-12s-open-question-1) concluded that a generated overview of a change should be treated as attention-steering, not as a comprehension aid, until measured otherwise. See the reconciliation questions at the end.

## 1 Review through meaningful code walks

A code walk is a guided tour of a behaviour or a question that the change touches. It can pass through several files and show both changed lines and the unchanged code needed to understand the context. The walk is the unit of the experience; the concrete code locations provide a checkable coverage map.

One example is the question: "What happens when the user cancels a running agent run?" The walk follows the button press, the cancellation signal, the adapter, the handling of remaining text and the final state of the interface. The associated tests show what has actually been verified. The reviewer can then ask "can any reply arrive after the cancellation?" while the relevant code is gathered in one place.

The LLM proposes a number of walks and explains why they are relevant. The proposals can be prioritised by, for example, the consequences of errors, uncertain assumptions or central behavioural changes. The user can choose the order and start where their own attention does most good.

Together, the walks must cover all changes. Common execution paths are not always enough: error handling, configuration, tests and removed functionality may need their own thematic walks. A walk about a removed behaviour can, for example, show what previously called it and how those calls are now handled.

A proposed execution path must be distinguishable from a path actually observed in a test. Every described relationship must be traceable to the code or other evidence, and uncertain relationships must be shown as such. A credible explanation from the agent is not in itself proof that the behaviour works.

## 2 Start with an overview and open details when needed

The overview shows the changed files and how large a share of each file's changed lines has been walked through. From there the user can open a file or choose a proposed walk. The file view marks which code regions have been covered and what remains, with text labels or symbols as a complement to colour.

The user must be able to move between the overview, a walk and the full diff without losing their place. Changes that do not fit the agent's proposed narrative must still be visible and directly reviewable.

The percentage needs a clear denominator. In the simplest form we measure changed lines in the selected diff, including additions and deletions. Unchanged code is shown as context but does not add to this denominator. The exact counting rule needs to be fixed at implementation and applied consistently.

## 3 Show how the code has been reviewed

That a line has been shown on screen does not mean it has been reviewed. Having walked through the code does not automatically mean it has been accepted either. The user must be able to see the difference between a walk-through, an assessment and a deliberate decision to abstain.

| Status | Meaning |
| --- | --- |
| Remaining | The part has no walk-through and no review decision. |
| Walked through | The code has been covered in a walk but is not automatically accepted. |
| Accepted by you | You have accepted the current part at the reviewed revision. |
| Accepted by agent | Delegated review is complete, with a reported assessment. |
| Exempted | You have explicitly chosen not to review the part. |
| Needs reassessment | Changed code or changed supporting material affects the earlier assessment. |

These are the user's terms for the state, not a fixed storage schema. Walk-through, decisions and freshness may need to be stored separately. If the code has been walked through and a problem was found, the problem must remain visible even though walk-through coverage has increased.

The overview could say, for example: "All changes handled: 60 percent reviewed together, 30 percent agent-reviewed and 10 percent exempted." It must not describe this as 100 percent manually reviewed. Open findings and parts that need reassessment are shown separately and must not be hidden by a high percentage.

Coverage helps us see gaps and allocate attention. It does not measure how well a person has understood the code and does not guarantee that the change is correct. One important error-handling line can require more attention than a large number of routine changes.

## 4 Delegate and exempt with visible decisions

The user does not need to examine every line. A whole walk or another bounded part can be delegated to a review agent. The user could say, for example: "Review test X and accept it unless you find something you need to raise with me." The agent then has an explicit mandate to assess exactly that part and must report the result and any findings.

Another choice is: "I don't need to review test X." This is recorded as an exemption for the bounded part, with the scope of the decision and its reason when one is given. It gives an honest close without pretending that a review was performed.

The LLM proposes the walks, while DSpatch checks their connection to the diff. Each walk is bound to concrete code regions. The tool can then detect changes that no walk covers and avoid double-counting when several walks pass the same lines. That a line is included in a planned walk does not yet make it reviewed.

## 5 Choose review depth and learning separately

Review depth and pedagogical engagement are two separate choices. An experienced developer may want to review a risky flow very thoroughly without language explanations. A beginner may want to understand the basics of the language through a simple change.

| Choice | Example levels | What the choice controls |
| --- | --- | --- |
| Review depth | Overview, normal walk-through, detailed review | How thoroughly we examine behaviour, assumptions and code. |
| Teaching mode | Concise, explain when needed, Teach me something new | How actively the agent explains concepts and helps the user learn. |

Both choices must be changeable in the middle of a walk. "Go one level deeper" deepens the current part. "I know this part" lets the user move on without getting the same explanation again. Changing mode preserves the position, the questions and the review decisions already made.

In a concise mode, the agent focuses on what the change does, whether it meets its intent and what errors or uncertainties exist. In Teach me something new, the agent also looks for relevant opportunities to explain a concept, preferably by comparison with something the user already knows. The explanation must help the ongoing review and be possible to skip.

## 6 Learn a language by reviewing real code

Suppose the user is used to programming but has never written GDScript in Godot. During a walk we reach a signal that connects an event to another part of the program. The agent can explain how the signal is used here, why the solution was chosen, and how it resembles or differs from a callback or event mechanism the user already knows.

The walk then returns to the concrete review question: who connects the receiver, when does that happen, and can the same event be handled more than once by mistake? Knowledge of the language and the assessment of the change develop together.

At the next occurrence, the agent can explain less, based on what the user has expressed and what has already been discussed. The user must be able to correct the level. The tool can support learning from the ground up without requiring every walk to become a lesson or the user to take a knowledge test.

Code accepted should be a review outcome rather than the name of a teaching mode. Acceptance means that the current part has been accepted on the basis of the review and the available material. It is no guarantee that the code is free of bugs.

## 7 Preserve the review when the code changes

Every walk, comment and acceptance belongs to an identified revision. If an agent keeps working, the ongoing review stays on its version and shows that newer changes exist. The user can then choose when the walk-through should be updated.

After a fix, DSpatch must show which parts need to be reviewed again. A change in how the adapter signals a cancellation can, for example, affect an earlier assessment of the interface even if the interface's own lines are unchanged. Both directly changed code regions and relevant dependencies therefore need attention.

When the impact is uncertain, the tool must show that the assessment needs to be reconsidered. Earlier reasoning and decisions are preserved as history, so that the user can understand what changed and continue from there. An old acceptance must not be carried over silently to new code.

## 8 The value to test in real work

The proposal gives concrete form to the ambition of delegating a great deal while still understanding one's software. The reviewer chooses where their own attention is needed, gets support in following behaviours across file boundaries, and can always see which parts lack a decision. The same walk-through can help a colleague learn an unfamiliar codebase or a new language.

A first increment could include a file overview, marking of changed code regions, proposed walks with clear code references and explicit review decisions. Depth and teaching mode can be introduced as simple choices in the walk. A complete analysis of every possible execution path does not need to be finished to test the value.

The evaluation should use real changes. Can the user explain the changed behaviour, find a relevant dependency and identify a remaining uncertainty? Does it become easier to discover errors and to resume the review after a fix? A high coverage figure is useful only when it helps us make better review decisions.

## Relationship to the other governing documents

**Source text, translated.** The addendum develops the DSpatch vision and governing document, version 1.5, especially section 1.1 on work and learning and sections 3–3.1 on code review and understanding. It also follows the division of responsibility in *Agent behaviour and orchestration in DSpatch*, version 1: the agent's instructions govern review method and teaching, while DSpatch is responsible for code references, state, revisions and history. The Markdown version can be used as the version-controlled source and the Word version as the reading copy.

**Current references.** The sections cited by the source keep their numbers:

- [VISION.md](VISION.md) is now version 1.13. The source's references are [section 1.1](VISION.md#11-ett-verktyg-för-arbete-och-lärande), [section 3](VISION.md#3-kodgranskning-och-enkel-redigering) and [section 3.1](VISION.md#31-förstå-förändringar-och-deras-sammanhang). The vision has since added [section 3.2](VISION.md#32-research-and-emerging-review-concepts) on research and review concepts, [section 3.3](VISION.md#33-review-as-a-standalone-capability) with the standalone-review decision, and [section 3.4](VISION.md#34-walkthrough-coverage-and-levels-of-engagement), which summarises these proposals for a bounded pilot.
- [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) is now version 1.1. Its division of responsibility is in [section 1](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md#1-responsibilities-and-task-needs), and [section 5](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md#5-orchestration-and-independent-review-share-the-agent-connection) applies it to review.
- This English Markdown file is the maintained source. The Swedish Word document of 22 October 2026 is historical provenance, and any Word reading copy should be generated from this file.

## Reconciliation questions

Niclas answered questions 1 and 2 on 23 October 2026; [VISION.md section 3.4](VISION.md#34-walkthrough-coverage-and-levels-of-engagement) records the decision, and the answers below only summarise it. Questions 3 and 4 are details both texts leave open; they need no decision before a pilot.

1. **What "Code accepted" names: decided.** "Code accepted" names a review outcome, not a mode, as section 6 proposed. [VISION.md section 3.4](VISION.md#34-walkthrough-coverage-and-levels-of-engagement) is corrected accordingly. "Concise" is the low-explanation teaching mode, chosen independently of review depth, and selecting it neither implies acceptance nor reduces the rigour of the review. Acceptance by the user and acceptance through explicitly delegated agent review stay distinct. Acceptance applies to the reviewed scope and revision and is not a guarantee of correctness.
2. **Whether a walk pilot comes first: decision process kept.** Section 8 and VISION.md section 3.4 describe a first increment built on walks. [DSP-13](research/dsp-13-comprehension-research.md#91-the-direct-answer-to-dsp-12s-open-question-1) argued against making a generated walkthrough DSpatch's first review investment and ranked a planted-defect probe ([DSP-13 section 12](research/dsp-13-comprehension-research.md#12-assessing-comprehension-orientation-and-confidence-with-one-user-ac4)) as the most valuable cheap experiment. Niclas kept the existing process: DSP-14 makes a recommendation and he decides the direction in DSP-15. VISION.md section 3.4 permits a prepared-walk pilot but does not rank it above the planted-defect probe, and no pilot is authorised now. Section 8's first increment and its evaluation questions remain proposals for that choice.
3. **The counting rule.** Section 2 counts additions and deletions in its simplest form, and section 4 counts lines shared by several walks once. VISION.md section 3.4 also counts shared ranges once and names removed lines, moved code and overlapping walks as cases needing a defined rule. Both leave the exact rule to implementation.
4. **The number of levels.** Section 5 gives three example levels for review depth and three for teaching mode. VISION.md section 3.4 keeps depth and teaching as separate choices without naming depth levels, and names two teaching modes, "Concise" and the provisional "Teach me something new". These are compatible as examples; the actual levels remain open.
