---
id: DSP-19
title: 'Choose models in DSpatch, interactively and per loop step'
status: To Do
assignee: []
created_date: '2026-09-15 19:26'
labels: []
dependencies:
  - DSP-2
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Niclas stated the requirement on 15 September 2026: we want to choose models **both** in the loop that builds DSpatch **and** in DSpatch itself — interactively for ordinary chat, and specified per step for a Maestro loop.

Only the first of those was in the backlog. [DSP-8](dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md) covers the external development loop, the machinery in Cursor that builds DSpatch, and its [proposal](../../docs/MODEL_SELECTION.md) says so in its first line. Nothing covered the product. This task is the product half, and the two must not be confused: DSP-8's user is the coordinator, this task's user is Niclas sitting in DSpatch.

### Scope

Two halves, which share the persistence and reporting problem but not the interaction.

**Interactive.** Show which model is about to answer, and let the user change it. A model that is unavailable or not permitted on the account must say so rather than fall back silently — the same honesty rule the rest of the product follows. Read what is available from the actual environment; a hard-coded list goes stale and misleads.

**Per loop step.** A Maestro loop specifies a model per step, inspectable before the run rather than only discoverable afterwards. [DSP-18](dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md) defines the loop; whether it ships with fixed models and gains this later is a sequencing decision, not a reason to leave the requirement unrecorded.

### What the loop has already learned, and should not be relearned here

[VISION section 9.2](../../docs/VISION.md) already requires each adapter to report whether it supports model selection, and that missing support stays visible rather than being hidden behind a common view. `docs/MODEL_SELECTION.md` adds three rules worth carrying across even though it is about the other loop: a model's name or its own confidence does not establish suitability; a requested model is not a confirmed model, and self-reported identity is not independent evidence; and a fixed human choice overrides automation and survives resumption.

### Out of scope

Automatic task-aware selection inside the product. This task is about the user choosing and the record being truthful. Whether DSpatch should ever pick a model on the user's behalf is a separate question, and the answer may differ from the one DSP-8 reaches for our own loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 In interactive chat the user can see which model is about to answer and choose another. The list comes from what the environment actually offers, not from a hard-coded set, and an unavailable or unpermitted model is stated plainly rather than silently replaced.
- [ ] #2 The model that actually answered is recorded with each stored message and survives restart. Requested model and confirmed actual model are distinguished wherever the provider reports it; a model's self-reported identity is not confirmation.
- [ ] #3 A Maestro loop can specify a model per step. The specification is inspectable before the run and recorded per attempt afterwards, so a completed run shows which model did which work.
- [ ] #4 A fixed choice by the user overrides any automatic selection, including on resume, until the user changes it. Selection grants no capability or access the user does not already have.
- [ ] #5 Cost and usage are attributed per model where the provider exposes them, and recorded as unknown where it does not. No invented figures.
<!-- AC:END -->
