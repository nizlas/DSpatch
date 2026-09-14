---
id: DSP-11
title: Research code-understanding interactions and agree the next direction
status: To Do
assignee: []
created_date: '2026-09-14'
labels:
  - ux
milestone: m-1
dependencies:
  - DSP-6
documentation:
  - docs/VISION.md
  - docs/REVIEW_RESEARCH.md
  - BACKLOG.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

After the usable Phase 0 workflow, take a step back with Niclas before further product implementation. Combine human-interaction observations, HCI and software-engineering research, and existing-tool evidence to choose a useful next increment for code understanding and Maestro orchestration.

### Scope and proposed approach

Follow [the discovery brief](../../docs/REVIEW_RESEARCH.md). Start with Phase 0 observations and a bounded study scope. Inspect relevant primary research and documented or demonstrable tool interactions; label the kind and limits of each piece of evidence.

Compare all five early concepts with those findings: guided code flow with tree highlights, essential diffs, conceptual differences, benefits/risks in code and text, and a zoomable minimap or another overview. These are hypotheses, not selected features or claims of novelty. Include alternatives suggested by the research and invite Niclas's further ideas.

Select one or two inexpensive sketches or disposable prototypes for a small comparison with the conventional diff workflow. Assess comprehension, orientation and ability to identify risks or unsupported claims. Record who tried what on which version and distinguish observed feedback from agent predictions.

Discuss the evidence and the next direction with Niclas, covering both review interactions and Maestro's orchestration role. Propose one bounded next experiment and explicit deferrals.

### Boundaries and human involvement

No production review feature, general editor, storage framework or Maestro loop is implemented by this task. Do not turn missing search results into claims that an idea has never been tried. A limited personal trial does not prove general effectiveness.

The task follows DSP-6 and is not an extra Phase 0 completion requirement. Human feedback and the direction decision remain open until Niclas provides them. Preserve interactive work as a full option.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 A bounded study scope and concrete user questions are recorded using Phase 0 observations; Niclas's observations are distinguished from agent hypotheses.
- [ ] #2 A dated evidence map of relevant primary research and existing-tool approaches records evaluation context, findings, limitations and gaps without unsupported novelty or superiority claims.
- [ ] #3 All five concept seeds are assessed against the evidence, with alternatives, open design questions and reasons for selecting one or two small experiments.
- [ ] #4 The selected sketches or prototypes are compared with the conventional diff workflow on identified tasks; Niclas's feedback, comprehension/orientation observations and study limitations are recorded.
- [ ] #5 Niclas has discussed the findings and selected the next direction for review features and Maestro. A bounded next task proposal, assessment criteria and explicit deferrals are recorded in the development plan.
<!-- AC:END -->
