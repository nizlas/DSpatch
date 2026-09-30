---
id: DSP-15
title: Agree the next direction for review and Maestro
status: To Do
assignee: []
created_date: '2026-09-14 20:13'
labels:
  - ux
milestone: m-1
dependencies:
  - DSP-14
documentation:
  - docs/VISION.md
  - docs/REVIEW_RESEARCH.md
  - BACKLOG.md
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

After Phase 0 and discovery, we should deliberately choose the next useful increment instead of automatically proceeding through an old roadmap or building every promising concept.

### Scope

Review the needs, tool survey, research findings and concept trials with Niclas. Consider code-review features and Maestro loop orchestration together: what work should be delegated, what the user needs to understand, and what goals, attempts, revisions, tests or decisions must remain inspectable.

**This story decides the direction; it does not design the loop.** Defining and running a bounded Maestro loop is [DSP-18](dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md), split out on 15 September 2026 because Niclas observed that a discovery story and an orchestration build have very different focus, and because sitting behind DSP-14 left "define an agent loop" blocked by an HCI literature review it does not need. What stays here is the fork in the road: a decision story that knew only one of the two options would not be a decision at all. If DSP-18 is prioritised before this story runs, record that as the direction decision rather than letting this story claim a choice already made.

The existing Maestro proposal in PR #7 is discussion material, not an implementation prerequisite. Assess whether the next increment should improve human understanding, introduce a bounded orchestration workflow, or combine a small amount of each. Keep prolonged human-interactive work available.

Splitting the work does not split the obligation between them: whatever is delegated must stay inspectable, which is why DSP-18 carries that as an acceptance criterion of its own.

Record Niclas's decision, rationale, alternatives and deferrals. Update the roadmap and propose small implementable follow-up stories with clear value and assessment criteria. This story plans the next increment; it does not authorise or implement all later product phases.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### The direction was chosen on 15 September 2026, ahead of this story

Niclas decided, in his own words, "Vi gör detta" — build a rudimentary agent loop, edit it in a graph editor shaped like [the reference figure](../../docs/assets/agentloop_generisk.png), realise its rules in code, run it on something small, and iterate on what worked. He was told beforehand, twice, that prioritising orchestration ahead of this story *is* the direction decision, and he prioritised it anyway. **Recording it here so the choice is his and dated, rather than something the loop drifted into.**

The decision came after the discovery this story depends on had partly happened: [DSP-12](dsp-12%20-%20Survey-smart-tools-and-interaction-designs.md) and [DSP-13](dsp-13%20-%20Review-HCI-and-UI-research-for-code-understanding.md) were delivered the same evening, and he read enough of both to discuss them. It came before [DSP-11](dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md) and [DSP-14](dsp-14%20-%20Compare-and-try-code-review-concepts.md).

**Review features are deferred, not dropped.** The discovery output stands and is unusually well placed to be argued with later: DSP-13 found that the nearest measured interaction to a generated walkthrough steers attention without improving high-severity findings, and that preference and benefit come apart in both directions, which is a reason to think harder before building review features rather than a reason to abandon them.

### What remains of this story

The fork is resolved for now, so what is left is the part that was always this story's own: recording the rationale and the deferrals, keeping the roadmap truthful, and coming back to the review direction once the loop work has produced experience to judge it by. Its criteria below are unchanged and still apply; #2 is now partly answered.

Three cards carry the chosen direction: [DSP-21](dsp-21%20-%20Define-the-agent-loop-graph-format.md) for the format, [DSP-22](dsp-22%20-%20Build-a-graph-editor-for-agent-loops.md) for the editor, and [DSP-18](dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md) for the runner.
<!-- SECTION:NOTES:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A concise decision packet combines the user needs, tool/research findings and concept results, including uncertainties and alternatives.
- [ ] #2 Niclas has discussed review features and Maestro orchestration and explicitly selected the next product direction; pending decisions remain open until provided.
- [ ] #3 The decision and roadmap explain intended user value, bounded scope, dependencies, assessment criteria and explicit deferrals, while preserving human-interactive work.
- [ ] #4 Concrete follow-up story proposals reflect the decision without treating a prototype, the original phase order or all five seeds as mandatory implementation.
<!-- AC:END -->
