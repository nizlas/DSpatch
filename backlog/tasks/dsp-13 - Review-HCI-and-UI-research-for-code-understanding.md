---
id: DSP-13
title: Review HCI and UI research for code understanding
status: Done
assignee: []
created_date: '2026-09-14 20:13'
updated_date: '2026-09-15 22:42'
labels:
  - ux
milestone: m-1
dependencies:
  - DSP-6
documentation:
  - docs/VISION.md
  - docs/REVIEW_RESEARCH.md
  - BACKLOG.md
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Attractive interfaces and convincing agent explanations may not improve understanding. We need research evidence about how people navigate, build mental models and assess changes, including findings that challenge our initial ideas.

### Scope

Conduct a bounded review of primary HCI and software-engineering research on program comprehension, code navigation, software visualisation, change review and human-AI interaction. Also investigate relevant UI/information-visualisation research outside programming, such as coordinated views, focus/context, semantic zoom, attention and communicating uncertainty. Transfer to code review must be explained as an inference where it has not been studied directly.

Include established or older work and published prototypes, not only recent AI papers. Record the question, study design, tasks and participants, finding, limitations and implications. Look for negative, mixed and context-dependent results as well as successful examples. Document how material was found and where the bounded search stopped.

This story supplies an evidence synthesis and assessment ideas to DSP-14. It does not claim an exhaustive literature review, general effectiveness from a small study, or that an unlocated idea has never been tried.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A search record identifies scope, dates, sources and selection rationale across relevant code-understanding research and applicable HCI/UI research outside IDEs.
- [x] #2 Selected primary studies or prototypes have traceable references and summaries of their interaction, evaluation setting, findings and limitations; untested proposals are labelled.
- [x] #3 Negative, mixed or context-dependent findings are recorded where found, and unsearched areas are distinguished from areas with no results found.
- [x] #4 The synthesis explains implications for DSpatch, separates direct evidence from inferred transfer, and identifies ways to assess comprehension, orientation and confidence against correctness.
- [x] #5 A concise handoff to DSP-14 captures supported principles, competing approaches and unresolved questions without preselecting the five seeds.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review delivered 15 September 2026 by Researcher call 008 of run `20260915-174013-p6qd`. The deliverable is [docs/research/dsp-13-comprehension-research.md](../../docs/research/dsp-13-comprehension-research.md), 1,360 lines; the call report is `reports/008-researcher-dsp13-hci.md` in that run. Criteria are left unticked for the Reviewer.

Twenty-two primary entries against a stated bound of 12 to 20, an overrun reported with its reasons and with a recommendation for which two to cut. Twelve entries predate 2020, six predate 2010, the oldest is 1987. Structure is derived from the evidence rather than from the five concept seeds, as AC#5 requires.

Three findings that change what DSP-14 should weigh first:

- **A generated account of a change is an attention-steering feature until measured otherwise.** The specific study of a generated *walkthrough* still does not exist. The nearest measured interaction — Tufano and colleagues, ICSE 2025, 29 professionals, 50+ hours of recorded reviews — found reviewers focusing on the locations the model named, finding more low-severity issues, finding **no more high-severity issues**, saving no time and gaining no confidence. This argues against making a generated walkthrough DSpatch's first review investment.
- **Preference and benefit come apart, in both directions.** An overview was preferred by 80% with no accuracy gain, was slower on one map and worse for recall; and the one intervention family measured to reduce overreliance was rated worst by the people it helped. Niclas liking or disliking a sketch is therefore not an acceptance criterion for anything in this area.
- **The best-supported candidates are the unglamorous ones**: a chronological trail of the code actually touched, shown on return; co-locating relevant fragments rather than improving navigation between them; and decomposing a change by inspectable analysis the user can contest. None needs a model, and all three are consistent with VISION section 3 as written.

Two of DSP-12's conclusions are corrected in place: Jul & Furnas's "desert fog" is a proposal whose authors state the user studies were only planned, not a finding; and the "diff of two executions" space DSP-12 called the most concrete unclaimed opportunity is occupied by Divergence-Driven Debugging (ICPC 2025) and the older relative-debugging line, so the gap is in the evidence rather than in the tooling. A third is refined: the minimap question is answered more precisely than expected, because the one controlled study improved its measure by adding a derived information layer to the miniature rather than by adding the miniature.

**Evidence status.** All 22 entries are documented-class; none demonstrated, none personally observed, because the role has no shell. Nothing was read cover to cover — 19 entries as abstract plus verbatim quoted passages, 3 as abstract only. Eight figures are marked "reported, unverified" and must not be repeated as established. One entry (arXiv 2304.09301, a null result on spatial code layout) could not be identified by title, author or venue and is recorded as a lead, not a citation; it is the main counterweight to the co-location argument and is worth resolving. The Whyline ArgoUML citation is ambiguous between two papers.

**Named gap against AC#4:** Siegmund and colleagues' methodological work on *measuring* program comprehension was not searched, and is where to look first for better instruments than §12 offers.

### Reviewed and corrected, 16 September 2026

An independent Reviewer read the **full text** of the ICSE 2025 paper the central conclusion rests on — the first such reading in this project, since the document's author reached only the abstract — returned REWORK bounded to one editing pass, and then re-checked the result and returned ACCEPT. Reports `005-reviewer-discovery-documents.md`, `006-implementer-dsp13-corrections.md` and `008-reviewer-dsp13-recheck.md` in run `20260915-224600-w7h3`.

**The conclusion survived and came out better founded.** The paper's own authors draw the attention-versus-comprehension distinction in the programming domain, and independently recommend adopting an automated review only *after* manual inspection — which is the commit-first design the document had imported from crowd-worker studies and marked as its own inference. Two inference markers were therefore demoted rather than defended.

**One sentence had exceeded its evidence and is withdrawn**: "steering attention has a measured cost in what stops being examined". Coverage per reviewer showed no significant difference and both arms found a median 50% of injected issues; what narrowed was diversity *across* reviewers, a population property that cannot apply to a single-user tool. Four missing facts were added, the sharpest being a third experimental arm in which a complete and correct generated review *did* transfer its findings — so the binding constraint on the null was **generator recall**, not anything intrinsic to generated accounts.

Every figure transcribed in that pass was checked back against the Reviewer's own reading and none was garbled.

**Two one-line imprecisions remain, deliberately.** In §9.1 the time comparison, 57 minutes against 42, is not marked non-significant although no variable reached significance on any time measure; and §11 item 2's summary tail says the cost "was not measured" where "was not measured per reviewer" is exact. Both are accurate in the correction blocks beneath them, neither justifies a call, and both should ride along with the next edit that opens the file.

§12 is the section to read before planning any trial with Niclas. It answers AC#4 under the constraint that we have one user, so no controlled experiment is available, and it names the most likely way to waste his time: running a comprehension probe on code he wrote and a change he specified. Probe 1 — timing how long it takes him to resume work in DSpatch — needs nothing built and would give the project its first number about its most-observed problem.
<!-- SECTION:NOTES:END -->
