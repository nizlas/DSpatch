---
id: DSP-194
title: >-
  Essentials selects its own main picture: a locked-plan comparison and a fix
  where the over-detail arises, also when switching profile on a walk
status: In Progress
assignee: []
created_date: '2026-11-10 17:03'
updated_date: '2026-11-10 17:21'
labels:
  - review
dependencies:
  - DSP-192
priority: medium
type: enhancement
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's follow-up of DSP-192 (10 November 2026). The real-provider comparison showed Teacher improved but Essentials still close to Standard, especially as an alternative made by switching the reading profile on an existing walk, and loop-written Essentials too detailed in the simple example. Find what actually drives the selection in the loop's writer and reviewer, in the profile alternative, and in regeneration and follow-ups; fix it where it arises rather than stacking negative rules; Essentials should say what a mechanism achieves and keep only the conditions and consequences an accurate main picture needs. Keep Standard; Teacher needs no general rewrite. No planner–writer–reviewer loop for profile alternatives. Compare on one locked plan, revision, step boundaries and context, with one provider and model (Copilot when available, as Niclas tests through it), for a simple step and one with interacting mechanisms: Essentials written with the plan, Essentials after Standard, Standard before and after, Teacher as a control; first parts and Show more apart. Governing: CODE_WALK_UNDERSTANDING_AND_PROFILES.md sections 4 and 6 (raised to version 1.2 where a clarification is needed), VISION.md section 3.4 (DSP-192 and this entry), AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 1 (instructions explicit and inspectable). Preserve DSP-193's delegation fixes and the loop viewer; saved explanations and their history are kept and nothing is regenerated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The effective instructions and inputs of the loop's writer and reviewer, the profile alternative and regeneration are traced, and what drives Essentials' detail is established by a controlled variation where possible and otherwise named as a hypothesis
- [x] #2 The fix changes the sources where the detail arises, without stacking negative rules on contradictory instructions; Standard's and Teacher's readers are unchanged; the instruction version is raised; saved explanations are kept and nothing is regenerated
- [x] #3 The profiles are compared on one locked plan, revision and steps with one provider and model, for a simple step and one with interacting mechanisms, through the product's builders and adapter, with what the harness runs and does not run stated; Standard before and after and Teacher as a control are included; first parts and Show more are shown apart and judged on selection and abstraction
- [ ] #4 The reference and the runtime instructions stay consistent with no parallel definition; a profile switch changes no walk structure, puts nothing in Discussion and touches no review decision; regeneration and returning to a saved explanation are checked in real windows; relevant checks pass and a Linux pre-release is published
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
10 November 2026, Windows, main checkout.

**Traced.** The profile-switch prompt (`stepExplanationPrompt` through `buildEnvelopePrompt`) put the walk's own text under "Prepared explanation", then the profile's section, then the review question's "How to answer" last: `ANSWER_SHAPE_RULES` and `CODE_ANSWER_RULES` with content rules of their own (an uncertainty or risk said in the short part; cause and effect with real names; what could not be read named; established names kept), which every profile met outside its section. The loop writer's prompt carries the planner's brief for the step ("Brief: …"), written by a planner that is not told the profile, naming mechanics the step "must make comprehensible"; the role said only that the brief is not evidence. The reviewer's Essentials questions were not a driver in the records (it accepted at once). Regeneration uses the same profile section with the last explanation as material and the same answer format as present.

**Established by an ablation at version 8 with Copilot** (`docs/evaluations/dsp-194/`, one sample per variation): without the briefs, the writer's Essentials chose the purpose and the order ("so `startSession` can resume from its `await` first"); with them it listed the brief's operations. On the profile switch, without the answer format's content rules Essentials dropped the failure path and the rejection path it had added beyond Standard; without the walk's own text it did not select more, so anchoring to the original text is not supported with Copilot (with Claude `opus` it remains a hypothesis).

**Changed (instruction version 9; the reference's version 1.2).** The writer's step section labels the brief "The planner's brief, written for every profile", and the writer role says the brief is orientation written before the profile is known, neither evidence nor a list of what must be said, and the profile decides which of its points the reader needs. A profile's present or regenerate prompt gets `PRESENTATION_ANSWER_RULES` (the first part, the marker, no narration) and the references and revision rules, without the review question's content rules; review questions and the follow-ups keep theirs. Essentials' reader says what a mechanism achieves and what follows from it, not the calls, flags, loop steps, types, queues or guards that achieve it (the reference's section 4 says the same; section 6 says a brief and a general answer format must not act as a profile's content list). Standard's and Teacher's readers are unchanged. The planner's instruction is unchanged (a locked plan cannot test it).

**Compared** on one locked plan (DSP-192's real Standard run's planner answer), the connect case, W1.1 and W1.5, Copilot `copilot-default` through the product's adapter and builders (`app/scripts/profile-locked-compare.mjs`); and the profile switch through the real windows with Copilot (`app/scripts/profile-real-trial.mjs --switch-only`). At version 9 Essentials selects well on `settle` in both paths and in the product path; on the simple step it is uneven (the writer restates the code; the profile switch still adds the failure-path report and the base comparison). Standard and Teacher read as at version 8 within one sample's variation. Judgment in `JUDGMENT.md`.

**Checks.** Type checks clean; the prompt tests 88 of 88 with new assertions (the version, the answer form of a profile explanation, the brief's label and the role's sentence); `test:presentation` 317 of 317; `test:review` 349 of 350, the one failure the known Windows path-separator case in `review-context.test.ts`; the follow trial on Windows 73 of 73 with a new stage (New response as a regeneration at version 9 with the form-only answer format, back to the saved explanation with no call, nothing in Discussion, the walk's steps unchanged); the Copilot product-path trial 24 entries passed.

**Remaining.** One provider, model, change and pair of steps, one sample per cell; the simple step's Essentials is uneven; Copilot's Standard and Teacher are short in both versions; the planner's brief wording is unchanged; Claude was not rerun.
<!-- SECTION:NOTES:END -->
