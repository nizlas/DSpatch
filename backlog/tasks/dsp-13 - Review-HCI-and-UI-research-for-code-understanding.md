---
id: DSP-13
title: Review HCI and UI research for code understanding
status: To Do
assignee: []
created_date: '2026-09-14 20:13'
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
- [ ] #1 A search record identifies scope, dates, sources and selection rationale across relevant code-understanding research and applicable HCI/UI research outside IDEs.
- [ ] #2 Selected primary studies or prototypes have traceable references and summaries of their interaction, evaluation setting, findings and limitations; untested proposals are labelled.
- [ ] #3 Negative, mixed or context-dependent findings are recorded where found, and unsearched areas are distinguished from areas with no results found.
- [ ] #4 The synthesis explains implications for DSpatch, separates direct evidence from inferred transfer, and identifies ways to assess comprehension, orientation and confidence against correctness.
- [ ] #5 A concise handoff to DSP-14 captures supported principles, competing approaches and unresolved questions without preselecting the five seeds.
<!-- AC:END -->
