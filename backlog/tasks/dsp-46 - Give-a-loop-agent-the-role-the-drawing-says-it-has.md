---
id: DSP-46
title: Give a loop agent the role the drawing says it has
status: In Progress
assignee: []
created_date: '2026-09-18 17:25'
updated_date: '2026-09-18 18:09'
labels: []
dependencies:
  - DSP-23
priority: high
type: bug
ordinal: 15596
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Every agent node in a graph names a role, and validation refuses a reference that resolves to nothing — on the stated ground that an agent with no description is an agent that will be handed whatever the runner happens to have. The live runner then hands the agent whatever it happens to have: the prompt is the mandate plus the node's purpose, and the role's text is never sent. So the refusal protects a property the runner does not provide.

The graph format's own principle is that an attribute nothing honours yet says so, and six attributes are listed as recorded-and-unhonoured for exactly this reason. `role` is not among them, so nothing says it. A reader of a validated graph has every reason to believe the role is in force.

### The second half, which is the same mistake as the build gate

The roles the chat loop points at are `.cursor/agents/dspatch-*.md` — our own development specialists. They talk about candidates, run journals, backlog cards and this repository's conventions. Aiming them at a person's own project is our working method promoted to product behaviour, which is precisely how the mandatory build got there. A loop a person runs on their own project needs roles written for that.

### Why it is worth doing before the verification step, not after

A verification step is only a verification step because of what its role says. Adding the node while the role text goes nowhere would produce a drawing that claims a Verifier and a run that has none.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An agent step in a loop is given the role the graph names for it, and what the agent was actually told can be read afterwards from the run record.
- [ ] #2 The roles the chat loop uses are written for working on a person's own project, not for developing DSpatch.
- [ ] #3 Where a graph attribute is recorded but not yet acted on by the runner, the product says so, as it already does for the others.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in run `20260918-171500-shape`, call 005. All three criteria PASS.

`role` had **no row at all** in `ATTRIBUTE_SUPPORT` — validated, then ignored, by the very table whose only purpose is to disclose exactly that. Every optional field of `LoopNode` and `LoopGraph` now has a row, and `AttributeSupport` gained a `caveat`, because `role` is honoured on the chat path and not on the editor's Run or a dry run: both `true` and `false` would have been false.

`ResolvedRole.instructions` now carries the role's prose, and `chatPromptFor` puts it before the mandate between explicit markers. `RecordedAgentReply` gained `prompt`, `roleId` and `roleSourcePath`, so what a step was actually told is readable afterwards rather than inferred.

New roles at `docs/loop/roles/project/`, written for working on someone else's project rather than on DSpatch. The subdirectory is load-bearing: `role-generate.test.ts` reads `docs/loop/roles/` for the five development specialists, and these are not specialists. A test asserts the resolved prose does not read as a DSpatch development role, and another resolves the shipped graph and fails if any agent node's role has no prose.
<!-- SECTION:NOTES:END -->

## Verification (call 006)

<!-- SECTION:NOTES:BEGIN -->
Verified on `candidate-6`. **#1 and #2 PASS. #3 is PARTIAL — the verifier does not reproduce the implementer's PASS, and the reason is measured.**

#1: the role's prose reaches the prompt, 2 943 and 3 606 characters of it in prompts of 3 878 and 4 232, with a negative control at 513 containing none of it. Worth knowing that `roleId` and `roleSourcePath` in the record are copied from the node's declaration, so they say what the drawing *named*; **`prompt` is the only field that evidences delivery**, and it is the one the criterion needs.

#2: both roles open by addressing the person's own project, and neither prompt contains any of the four DSpatch-development markers tested.

**#3 PARTIAL.** `role` is disclosed well and the new `caveat` is a genuine improvement. But the rows already in the table were not checked, and **`limits` is declared `honoured: false` while the runner enforces it.** Proved with a negative control: two runs of the shipped drawing differing only in `work.limits.maxMinutes`, one completing at `nothing-changed` and one faulting with `step-timed-out`. The shipped graph therefore tells every reader that the bound protecting them from a hung provider call does not exist — and the chat graph's own `notes` say the opposite, in the same file.

This is DSP-46's own defect mirrored: `role` was validated and then ignored by the table whose only purpose is to disclose exactly that; `limits` is honoured and then disclaimed by it. The table was made complete without being made true. Now **DSP-52**, with the fix being a corrected row and a test that *executes* each unhonoured attribute rather than asserting its row exists.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Superseded in part. **Kept:** #1 and #2 — the role's own text must reach the provider, and the chat loop's roles must be written for the person's project. **Removed:** the role prose those criteria were verified against, which instructed the agent **not to run** builds or tests. A role states responsibility, not method. #3 was already PARTIAL for an unrelated measured reason and is tracked as DSP-52.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
