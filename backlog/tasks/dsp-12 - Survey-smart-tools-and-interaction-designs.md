---
id: DSP-12
title: Survey smart tools and interaction designs
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
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

We need to learn what useful interaction designs already exist before choosing DSpatch's next review features. A list of competitors or a checkmark for "has a diff view" does not explain how a person understands and navigates a change.

### Scope

Conduct a bounded, open survey of current and older development tools, code browsers, debuggers, review/visualisation tools and research prototypes. Look at code/data flow navigation, semantic or intent-based changes, linked views, explanations, revision history and overview-to-detail transitions. Include relevant examples outside AI-first tools and outside IDEs where the interaction offers a useful comparison.

Collect concrete interaction examples from official documentation, demonstrations or bounded hands-on trials. Record the product/version/date, source, task served, interaction sequence, strengths and limitations, and whether the evidence was documented, demonstrated or personally observed. Expensive or inaccessible products can be documented with the limitation visible; do not purchase tools merely to complete the survey.

Search beyond the five seeds and include alternatives that could change our direction. Produce a compact interaction gallery/comparison for DSP-14, not a recommendation that commits us to a product or feature. DSP-13 owns the research synthesis; relevant references may be shared without duplicating the same analysis.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bounded search scope and dated source record cover relevant existing tools and prototypes, including older or non-AI examples; coverage gaps and access limits are explicit.
- [ ] #2 Each selected example shows a concrete interaction sequence through screenshots, a linked demonstration or a clear walkthrough, with version/date and provenance.
- [ ] #3 The comparison explains the user problem, useful ideas and limitations, and distinguishes documented or demonstrated capabilities from our own observations.
- [ ] #4 The survey includes approaches beyond the five concept seeds and identifies what DSpatch could reuse, adapt or test without unsupported novelty or superiority claims.
- [ ] #5 A concise handoff to DSP-14 lists promising patterns, conflicting examples and unresolved questions.
<!-- AC:END -->
