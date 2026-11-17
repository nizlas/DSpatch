---
id: DSP-223
title: An app-wide setting for model classes per provider, reached from the graph editor
status: Review
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
- [x] #1 For each provider and class the setting offers the chat's model list and "Use chat model", saves through the existing configuration and shows when several classes share a model.
- [x] #2 It opens from the graph editor's model line and from the note on unmapped classes; the graph format is unchanged.
- [x] #3 A changed mapping applies from the next run; a run in progress keeps the mapping it started with.
- [x] #4 Verified in the interface and through the runtime; whether a real provider was tried is reported separately.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (18 November 2026): store functions and host calls, then the dialog in the graph editor.

Result (18 November 2026). **Model classes…** in the graph editor's toolbar, beside the model line; it reads *Set model classes…* in the warning colour when the line says classes are unmapped or a class's model is not listed, and the same link sits in the graph panel's agent line and in a class step's model section. The dialog has a tab per agent (the one running graphs marked), a row per class with **Use chat model (the chat's model)** and the agent's list from `listModels`, the chat's own call; a saved model the list does not hold stays, marked "not in the list read now"; an empty list is said. Classes sharing a model are named. Each change saves at once through `writeModelClass` (`app/src/main/model-choice-file.ts`), which keeps the chat's model choice in the same file; the editor then re-reads its line. The line now names the real step: the editor sends the steps that offer classes, and a class mapped to an unlisted model refuses with "runs class small, set to the model …, which Copilot does not offer this account. Choose another model for that class in Model classes, or Use chat model." No provider is switched anywhere.

A run reads the setting once, when it is prepared, and walks with that copy.

Checks (runtime, simulated adapter): set and clear per class with the chat's choice kept and shared models found; a mapping written while the first Implementer visit was in flight left the run on its starting mapping (`first-small`, `first-medium`) and the next preparation read the new one; an unlisted class model refuses naming the step and the class. Type check and generic-agent-network (41), loop-provider, loop-model-select, loop-provider-agnostic, model-choice and loop-graph-write pass. In the window (this checkout's build, headless, isolated profile, no model call): the warning button and the link before mapping; the dialog with Use chat model and the empty-list note (Copilot lists only its default row without an account here; Cursor and Claude report not set up); two classes on one model named as shared; *Use chat model* chosen through the dialog's select written to the file; the refusal naming "Implementer: implementer". Not tried: choosing a named model from a real account's list, and any run with a real provider.
<!-- SECTION:NOTES:END -->
