---
id: DSP-188
title: >-
  Align the explanation instructions and the walk generation with the code-walk
  reference
status: To Do
assignee: []
created_date: '2026-11-09 21:29'
labels:
  - review
  - ux
dependencies:
  - DSP-181
  - DSP-184
  - DSP-185
priority: medium
type: enhancement
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to Niclas's adoption of docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md (9 November 2026). The reference defines code understanding, the walk's pedagogical flow and the explanation profiles. DSP-184, DSP-185 and DSP-186, decided the same day from his evaluation of 0.1.11, implemented parts of it: step explanations apart from the discussion, no instruction text in the reading flow, one code place per step with its own pane, central new functions as steps, references that lead to the step, and reviews as instances. Read against the code on main at 0.1.12 (`app/src/shared/presentation-profiles.ts` at instruction version 6, `app/src/shared/review-agent.ts`), these differences remain:

- Essentials is instructed to write "two plain, natural sentences" and to "name at most one or two identifiers", and Standard gets "about four to six sentences"; the reference wants no sentence quota and no identifier limit in any profile (sections 4 and 6) and lets the scope follow the step.
- The instruction set has grown into several rule lists (same facts, grounding, explanatory value, mechanisms, length, deepening, walk-relative writing, and per-profile manners of up to nine items); the reference asks for a shared task, a short addition per profile and the technical contract, at its own level of abstraction, with relevant exceptions inside the principle rather than stacked rules, and warns that overloaded instructions make explanations worse (section 6). The mechanism rules list what to cover; the reference keeps investigation scope apart from explanation scope (section 3).
- The walk generator says how a hop connects to the one before and gives central new functions their own step, but nothing about alternative branches as alternative paths that return to the branch point, workers and callbacks with the execution context being followed, or a teaching order that says when it differs from the execution order (section 1).
- External context: the reference wants its meaning explained and the source opened in the code view with its revision stated, never pasted into the reading flow, with version uncertainty stated once where it changes a conclusion (section 8); whether the current explanations and references do this has not been checked against it.
- Verification: 0.1.12 judged model-written answers on a synthetic example outside DSpatch's providers; the reference asks for all three profiles on several synthetic cases from the final request path, presented with their context, and for Niclas's judgment on real code (section 11).

The change is to the derived instructions and the product, not to the reference. Keep the agent's freedom to choose how to explain, and judge the result on actually generated explanations, not on type checks or prompt strings; a documentation change proves no better pedagogy. The decided behaviours of DSP-180, DSP-181 and DSP-184 to DSP-186 that the reference keeps (saved choice, the settle delay, latest-step-wins, late answers, cache, explicit retry, no call on opening, step explanations in Step, review instances) stand.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The instructions for Essentials, Standard and Teacher carry no sentence count and no identifier limit; each is a short addition to one shared explanation task, and the technical contract is kept apart from the pedagogical text; the instruction version is raised and older explanations stay viewable in their history
- [ ] #2 The walk generator's instructions cover transitions at alternative branches (returning to the branch point, never one run), at workers and callbacks (what starts the work and which execution context is followed) and a teaching order that says when it differs from execution, as judgment rather than mandatory items; the structural checks force no step per branch
- [ ] #3 External context in explanations is conveyed in meaning and opened in the code view with its revision stated; no header or source excerpt is pasted into the reading flow; version uncertainty is stated once where it changes a conclusion; verified in a real window or recorded as not established
- [ ] #4 Explanations in all three profiles for several synthetic cases (a simple setting, several significant calls, alternative branches, a worker with waiting and retries, a shared snapshot, external context) are generated from the final request path and presented with their context; the simulated provider verifies the interface, the prompt transfer and the data flow, and a real model's texts are judged by Niclas
<!-- AC:END -->
