---
id: DSP-198
title: >-
  Essentials gets one coherent writing task that replaces its current
  instructions, if a small comparison shows it helps
status: Review
assignee: []
created_date: '2026-11-11 18:46'
updated_date: '2026-11-11 18:50'
labels:
  - review
dependencies:
  - DSP-195
  - DSP-196
  - DSP-197
priority: medium
type: enhancement
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request (11 November 2026): Essentials still often explains configuration fields and code operations one by one. Try a simpler, coherent writing task for Essentials against today's full instruction: 'Explain this step to an experienced developer reading the code beside your text. Give them the purpose of this code and the main connection or consequence that helps them understand its place in the program. Choose that overview yourself from the code; ordinary syntax and configuration fields are already visible to the reader. Include a detail when leaving it out would make the overview misleading. Finish when the reader has that orientation.' It must replace Essentials' pedagogical instruction, not be stacked on it; keep code revision and access, the step's place, the walk's purpose and relevant transitions, the fact basis, the machine-readable answer and references, and review decisions. The planner owns the path through the code; the Essentials writer owns selection and level; the planner's prewritten detail is material, not a story to retell. No quotas, limits or clipping; Show more is optional. Loop and one-call generation do the same user task. Compare A (today's full product prompt) with B (the replacing task) on the same model, revision, access and locked steps, a simple configuration step and a step with interacting mechanisms and a decisive condition, on generic sample code. Judge the whole visible text including any summary and Why it matters. If B is not clearly better, stop and show the texts. If it is, make it the only active Essentials definition in all four paths (one-call, loop writer, profile switch, regeneration), update the reference coherently, leave Standard and Teacher unchanged, check the loop reviewer's influence, raise the instruction version, keep saved explanations, verify proportionately and release a Linux pre-release. Leave the task in Review for Niclas's pedagogical judgment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Today's active Essentials instructions in all four paths are saved as a baseline, and the content requirements outside the profile definition are identified
- [x] #2 A and B are compared on the same model, revision, access and locked steps for a simple configuration step and a step with interacting mechanisms and a decisive condition; the whole visible text is judged
- [x] #3 If B is not clearly better, the trial stops with the texts shown and nothing in the product changes
- [ ] #4 If B is better: it is the only active Essentials definition in the one-call path, the loop writer, the profile switch and regeneration, competing old wording is removed, the reference is updated, Standard and Teacher are unchanged, the instruction version is raised, saved explanations are kept
- [ ] #5 The loop reviewer's influence on a good Essentials text is shown before and after, and corrected for Essentials if it brings the inventory back, without weakening the fact check
- [ ] #6 Relevant tests and a targeted window trial of the whole visible base explanation pass; if delivered, commit, push and a Linux pre-release
- [ ] #7 Niclas judges Essentials' pedagogical quality
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Trial of 11 November 2026; material in docs/evaluations/dsp-198/ (JUDGMENT.md, texts.md, baseline/, compare/). Provider Claude, requested opus, reported claude-opus-5-5 for every call; the invented example app/tests/support/synthetic-exec-debug.ts on the DSP-196 locked plan.

- Baseline: the Essentials prompts at instruction version 11, built by the product with no model call, for the one-call preparation, the loop writer (first and later turn), the profile switch, regeneration and the loop reviewer (baseline/). The content requirements outside the Essentials definition are mapped in JUDGMENT.md section 1. They are: the shared task, the walk reading rules, the Show more contract, the writer role, the planner brief as an instruction, the writing and reading rules, session history, the one-call summary field, the profile switch framing and prepared text, the loop reviewer checks, and the planner summary shown first.
- Comparison: the loop writer, A (the product prompt) against B (the Essentials section replaced by the new writing task with the fact rules kept, Show more made optional, the role clause replaced, the brief shown as notes and the outline briefs removed). Steps W1.2 (a simple configuration step) and W1.7 (interacting mechanisms and a decisive condition), two samples each, 8 calls.
- Result: B is not a clear improvement. W1.2 lists the same fields in A and B, B puts the environment variables in bold and moves the port duplication into the first part with Show more empty. W1.7 goes flag by flag in both, and B's first part is longer in both samples. The decisive condition is kept in all eight texts. The planner summary shown first stays at the level of the fields.
- As asked, the trial stopped there: no product change, no reference change, no reviewer step (no good Essentials text to give it), no release, no further prompt round. The harness phases baseline-198 and compare-198 in app/scripts/profile-locked-compare.mjs are evaluation code only.
<!-- SECTION:NOTES:END -->
