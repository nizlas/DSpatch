---
id: DSP-185
title: >-
  One code place per walk step, and references that lead to the walk step or to
  the right lines in the diff
status: In Progress
assignee: []
created_date: '2026-11-09 13:00'
updated_date: '2026-11-09 13:00'
labels:
  - review
dependencies:
  - DSP-152
  - DSP-184
priority: high
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's evaluation of 0.1.11, 9 November 2026 (points 2 and the navigation side of 4).

- The basic rule is one code place per walk step, with its own explanation for that place; the walk's step order binds the reasoning together. Observed: one step with three places (declaring a build option; passing a choice on as a compiler definition; wiring in an optional dependency) where Next place kept the same shared text, leaving the reader to match text to code. These should be three steps whose explanations build on each other.
- Several places in one step only when necessary for understanding and the presentation really helps the reader compare them: a justified teaching exception, not a formatting variant. Places that need their own explanation and are visited in turn are separate steps.
- Implemented in walk generation and its structural checks, keeping coverage and valid references. Saved walks are not changed destructively and still open; new or explicitly regenerated walks follow the rule. A profile switch never changes a walk's structure, order, places or coverage.
- References to code inside the walk lead first to the walk step and its explanation. Necessary references outside the walk are clickable and open the right file, diff page and section of the diff view with the lines marked. Structured references where possible; no jump to a guessed place; an unresolvable reference, or code not in the current diff, says so plainly. File and line references are allowed where needed, and then they navigate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The walk prompt asks for one place per step; a step with several places must state why comparing them helps; the structural check sends unjustified multi-place steps into the existing single repair round and never loops
- [ ] #2 Saved walks open unchanged; coverage and reference checks unchanged; profile switch leaves structure untouched
- [ ] #3 Structured references to code inside the walk go to the matching step; others open the diff at the lines with them marked; unresolvable ones are shown as such, not as a link
- [ ] #4 The simulated provider writes one place per step plus one justified comparison step; tests and window trials cover links and the structure
<!-- AC:END -->
