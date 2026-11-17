---
id: DSP-223
title: An app-wide setting for model classes per provider, reached from the graph editor
status: In Progress
assignee: []
created_date: '2026-11-18'
labels: [loops, models, ui]
dependencies: [DSP-222]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An app-wide setting maps the model classes small, medium and large to a concrete model, separately for Cursor, Claude and Copilot, from the same model list the chat uses, saved in the existing model configuration (`modelClasses` in `dspatch-model-choice.json`). Each class takes a model or "Use chat model"; classes sharing a model are pointed out. Never switches provider. Reached from the graph editor's model line, above all when it names unmapped classes. Graphs keep naming only classes. No parallelism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 For each provider and class the setting offers the chat's model list and "Use chat model", saves through the existing configuration and shows when several classes share a model.
- [ ] #2 It opens from the graph editor's model line and from the note on unmapped classes; the graph format is unchanged.
- [ ] #3 A changed mapping applies from the next run; a run in progress keeps the mapping it started with.
- [ ] #4 Verified in the interface and through the runtime; whether a real provider was tried is reported separately.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (18 November 2026): store functions and host calls, then the dialog in the graph editor.
<!-- SECTION:NOTES:END -->
