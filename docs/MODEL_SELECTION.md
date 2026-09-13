# Task-aware model selection in the development loop

Proposal, 13 September 2026, based on Niclas's request. Implementation is tracked in [DSP-8](../backlog/tasks/dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md). This is a future improvement to the loop that builds DSpatch, not an implemented model selector or another requirement for product Phase 0.

## Goal and current state

The coordinator should select a model and reasoning level based on the assignment's character, complexity and uncertainty. A role defines responsibilities and permissions; it must not determine the model alone. The same Implementer may need different models for a simple text change and a difficult concurrency bug.

All five current specialist definitions use `model: inherit`. DSP-7 used this baseline, including pause and resume. This proposal activates no model switching. DSP-1 may proceed after DSP-7 without waiting for DSP-8.

## Proposed assessment before a call

Assess the choice within the coordinator's existing planning; do not add an agent call just to select a model. Use the assignment, available evidence and relevant earlier results.

| Assignment | Selection considerations |
| --- | --- |
| Clear local change with an unambiguous check | A faster model may suffice if it has demonstrated adequate quality on similar work. |
| Ordinary implementation across several components | Ability to understand dependencies and use tools, weighed against time and cost. |
| Architecture, difficult debugging or uncertain assumptions | More reasoning capacity and, where appropriate, higher effort from the first call. |
| Review | Uncertainty and consequences of missing a defect. A short diff is not automatically easy to review. |
| Research | Question difficulty, source quality, context needs and available tools. |

Choose among models available and permitted in the actual environment. Start with a few profiles for faster, balanced and deeper work, tied to verified model IDs and settings. Keep common role instructions together if several profiles are needed for one role. A profile is a testable choice, not a general model ranking.

Model names, marketing or a model's own confidence do not establish suitability. Consider context capacity, tool support, local experience and quality requirements. A different model for review is worth testing but does not replace independent evidence and verification.

Optimise the work through to an accepted result: quality, time, rework and cost together. A lower token price is not a saving if it requires several extra attempts. Expose unknown costs and missing measurements.

## Fixed model and increased capacity

Niclas can fix a model for a run or assignment; that choice overrides automation. Preserve it on resume unless he changes it or an already granted mandate permits a switch. Respect availability, permissions and resource limits; model selection grants no extra access.

When a result is inadequate, first distinguish faulty instructions, missing evidence, tool failure and a problem that plausibly needs more reasoning. Address the actual cause. A blocked MCP call or unknown outcome does not automatically call for a larger model.

A justified switch may apply to the next call or a bounded retry after reconciling the previous outcome. Preserve the working copy, candidate, reports and existing call/rework counters. Switching does not reset limits or repeat completed work. Give the new agent the context needed to continue.

## What Cursor support must demonstrate

[Cursor documents](https://cursor.com/docs/subagents#model-configuration) `model: inherit`, a specific model ID per agent definition and parameters such as effort. Account terms and model access may affect the outcome. Documentation was read on 13 September 2026.

This does not prove that the main agent's invocation tool accepts any model ID per call. DSP-8 must inspect the actual Cursor environment and test its supported path. If direct selection is unavailable, evaluate predefined agent profiles. Do not assume rewriting definitions during an active run works; discovery and loading must be verified if that approach is used.

If reliable automatic selection cannot be demonstrated, report the obstacle and retain a documented fixed model. A chat suggestion is not an executed model switch. DSP-8's automatic functionality then remains incomplete with a concrete next action recorded.

## Visibility and initial evaluation

Before a selected call, the journal should record role, assignment, proposed model/effort, short rationale and whether selection is automatic or fixed. Afterwards distinguish requested from confirmed actual model/effort, recording the source, call reference, outcome, time and available usage. Unavailable runtime details are unknown; the agent's self-reported identity is not independent confirmation.

Show a short explanation in the overview, such as "Deeper reasoning for uncertain concurrency dependencies". Put detailed measurements in the journal. Niclas should understand and change the selection without directing every call.

Compare a simple change, an uncertain task and a review against a fixed-model baseline. Keep inputs and criteria comparable and include two different assignments within the same role. Assess planning quality, verified results, necessary rework, elapsed time and available costs. Document limitations: a small trial does not establish a general winner.
