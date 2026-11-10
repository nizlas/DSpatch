---
id: DSP-196
title: >-
  Calibration trial: what each explanation profile organises its explanation
  around, and when Essentials' base explanation is done
status: Review
assignee: []
created_date: '2026-11-10 21:21'
updated_date: '2026-11-10 22:50'
labels:
  - review
dependencies:
  - DSP-195
priority: medium
type: spike
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request (10 November 2026, after 0.1.20): after DSP-195 Essentials and Standard are more proportionate in length, but Essentials still goes through roughly the same code operations and side issues as Standard, compressing rather than summarising at a higher level. A bounded calibration trial, with no product change and no release: check whether a positive definition of what each profile organises its explanation around (Essentials: the code's task and main effect in the flow, several operations summarised into one meaningful action; Standard: how the central mechanism achieves the effect and how the parts work together; Teacher: the understanding the reader must build to grasp the mechanism) and a natural completion condition for Essentials agree with docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md; then compare the product's instructions with an isolated variant on invented sample code (a task that starts a debugger in an existing container), one locked plan, revision and context, three steps (simple, interacting mechanisms, a condition or failure path the main picture needs), the loop writer and the profile switch, one provider and model. Judge what the reader sees before Show more. Deliver the texts and a proposal for discussion; no automatic implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Compatibility of the proposed definitions and completion condition with the reference is stated, with concrete contradictions if any; nothing in the reference or the product instructions is changed
- [x] #2 Baseline and variant are run on the same locked plan, revision content and context, for three steps of the stated kinds, with the loop writer and the profile switch; the exact instruction differences, provider, reported model and scope are recorded
- [x] #3 The full text before Show more (with summary and Why it matters where present) and the deepening are shown apart, grouped by example and profile, with a judgment against the five questions of the request
- [x] #4 The trial material is kept apart from the product instructions; no release; no saved walks or reviews of Niclas are changed
- [x] #5 A concrete proposal for the reference and the product, for Niclas to decide after reading the texts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Trial made on 10 November 2026; material and judgment in `docs/evaluations/dsp-196/` (`JUDGMENT.md`, `texts.md`). Product instructions and the reference are unchanged; the variant exists only in `app/scripts/profile-locked-compare.mjs --phase calibration-196`. The invented example is `app/tests/support/synthetic-exec-debug.ts`.

- **Provider and model:** Claude, requested `opus`, reported `claude-opus-5-5` for every call. That is the agent and model chosen in DSpatch on this machine, and the one Niclas's walk preparations here used. His latest run on Linux is not known.
- **Plan:** a Standard loop by Claude on the example, its planner's answer locked for every call. Steps: W1.2 (simple: the pre-launch task), W1.7 (interacting mechanisms: the detached start under debugpy waiting for a client), W1.3 (a condition and failure path: the running check).
- **Variant:** each profile's reader replaced by the proposed definition of what the explanation is organised around, with the completion condition inside it, and one sentence added to the shared scope rule; two lines per prompt, nothing else.
- **Scope:** 48 calls (writer and profile switch, baseline and variant, Essentials twice per cell) and a 6-call diagnostic: the Essentials writer under the variant without the planner's briefs.
- **Compatibility:** the definitions agree with sections 4 and 6. "The decisive consequence" should read "condition or consequence". The completion condition should also hold for Show more. The planner's brief conflicts with section 6 in the implementation: the planner role asks for "what the step must make comprehensible", and the briefs come out as lists of operations to explain.
- **Result:** the variant made Essentials organise around the step's role in the condition step (both paths), but not in the simple step or the mechanism step, where every text still goes operation by operation, following the brief's items. Standard keeps the mechanism and Teacher builds concepts with both instructions. No profile left out the readiness gap or the failure path. With the variant, the deepening grew into lists of the facts the first part no longer carried. Without the briefs, Essentials organised W1.2 and W1.3 around the step's role, W1.7 still went flag by flag, and once the decisive point moved behind Show more. In the loop path, the planner's operation-level step summary is shown first in every profile.
- **Proposal (for discussion, not implemented):** the reference's section 4 opens each profile with what it is organised around and says no profile goes on because the material holds more facts, also behind Show more. The planner writes briefs and step summaries as orientation, which is a correction of the implementation. The new reader definitions are adopted only together with that, after one more round over three examples, including the one-call path. No further Essentials rules.

**Round 2 (Niclas's follow-up the same evening):** the planner's brief and step summary as orientation, Essentials first. Same code, steps, places and model. One call rewrote each step's summary and brief as orientation, keeping the facts as separate notes given to the writer as material. B (oriented brief, product readers) and C (oriented brief, proposed readers), two samples per step, compared with round 1's A (current brief, product readers) and D (current brief, proposed readers). 13 calls; material in `docs/evaluations/dsp-196/round-2/` and `texts-round-2.md`, judgment in section 7 of `JUDGMENT.md`.

- The oriented brief made no difference on its own. W1.2 is unchanged in every cell. In W1.3, B listed strict mode again, following the rewritten brief's own words. In W1.7, one B sample moved the readiness gap behind Show more and brought a new fact from the notes (the exposed debug port) into the first part.
- The proposed reader definition helped a little, as in round 1: W1.3 as a gate, and W1.7's decisive consequence in bold in the first part. C is not clearly better than D.
- The step summary shown first stays at the operations in every cell.
- The notes kept the facts available but became a second content list that turned up behind Show more as an inventory.
- The outcome is weak, so the check of Standard, Teacher and the one-call path was not made and no further prompt round is proposed.
<!-- SECTION:NOTES:END -->
