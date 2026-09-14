---
id: DSP-8
title: Test task-aware model selection in the development loop
status: To Do
assignee: []
created_date: '2026-09-13 11:56'
updated_date: '2026-09-13 20:16'
labels:
  - integration
  - reliability
dependencies:
  - DSP-7
documentation:
  - docs/MODEL_SELECTION.md
  - docs/DEVELOPMENT_LOOP.md
  - docs/loop/CALIBRATION.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Niclas wants the development loop to select models by task character and complexity. All five specialists currently use `model: inherit`, so a small local change and a difficult investigation normally use the main chat's model. Use enough capacity for good quality and assess time and cost through to a verified result.

### Scope and boundaries

This concerns the external Cursor loop building DSpatch. The concrete assignment, uncertainty and consequences of failure drive selection; the role alone must not determine it. Niclas can fix the model. Proposed behaviour and the first comparison are in docs/MODEL_SELECTION.md. Choose exact profiles and implementation when taking up the task, based on then-available models and actual Cursor functionality.

Cursor documents model selection in agent definitions. Arbitrary per-call selection is not verified locally. Calling automation functional requires an actual traceable model change; if unsupported, document the obstacle and next step while using a fixed model.

DSP-7 is the baseline and its model choice stays unchanged through calibration. Prioritise DSP-8 separately afterwards; it is not another gate for DSP-1 or Phase 0. Preserve flat coordination, existing mandates and resumption. Exclude an extra model-selecting specialist, an extensive benchmark platform and product GUI.

### Assessment

Assess quality achieved, clarity of selections, rework, elapsed time and available usage. Distinguish documented possibilities from locally verified behaviour, and small trial outcomes from general model rankings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cursor's actual task-aware selection path is documented and tested on Niclas's Windows environment. At least two different model IDs are used for bounded specialist assignments with independent runtime evidence; a requested model or self-reported identity is insufficient. Missing control or unconfirmed outcomes are reported and leave automation incomplete.
- [ ] #2 The coordinator considers assignment character, complexity, uncertainty, failure consequences, tool/context needs and resource limits. Two different assignments within one role show that the role name alone does not determine selection; simple and difficult work and fixed user selection have been tested.
- [ ] #3 Selection stays within available and permitted capacity. Fixed user choice is respected. Missing models, fallbacks and unconfirmed actual model/effort produce an explicit outcome within the mandate, not a reported successful switch to the requested model.
- [ ] #4 The journal and overview distinguish requested model/effort from confirmed actual model/effort and record source, brief rationale, call reference, result, time and available usage. Unknown values remain unknown; Niclas can understand why the choice was made.
- [ ] #5 A justified switch after an inadequate result, a tool failure/unknown outcome and resume have been tested. Switching follows reconciliation; earlier changes, candidate, evidence and existing call/rework limits are preserved. Completed work is not double-started.
- [ ] #6 A small comparable trial covers a simple change, uncertain work and review against a fixed-model baseline. The report includes verified quality, necessary rework, time, available cost and limitations. Instructions state what was actually introduced, how Niclas fixes a model and the next step justified by the results.
<!-- AC:END -->
