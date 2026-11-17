---
id: DSP-218
title: One provider and model choice for loop runs, shown read-only in the loop view
status: Review
assignee: []
created_date: '2026-11-17 09:00'
updated_date: '2026-11-17 11:00'
labels:
  - loops
  - ui
dependencies: []
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request of 17 November 2026: the loop editor showed "Target framework: cursor" next to Run while a loop started from the chat ran with Copilot and Claude Opus 5.5. Make the chat the source of the provider and model choice for a loop run, show the run's actual provider and model in the loop view as read-only information without a competing chooser, move the drawing's target to where it has a function or remove it, and let the editor's Run use the same choice.

Governing decisions: DSP-138 and DSP-139 (a graph's `target` is a label of the drawing and does not choose the run's provider; the run uses the open session's provider, else the chosen agent; capability answers for a walked run come from the run's provider); loop-graph.ts "The target is stored in the file" (the file keeps its target, never migrated); DSP-149 and DSP-209 S19 (a step that fixes its model keeps it; otherwise the person's choice for that agent).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Investigated from the code and a run record which provider and model a run uses and what `target` controls
- [x] #2 The loop view shows the provider and model of the watched run, else of a run started now, read-only beside Run, saying the choice is made in the chat; no target chooser in the toolbar
- [x] #3 The drawing's target sits only in an advanced section about checking roles and requirements, never worded as the agent
- [x] #4 The editor's Run uses the chat's provider and model, the same choice a chat run uses
- [x] #5 Targeted tests; typecheck
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
State on 17 November 2026:

- Investigation. A loop run's provider is `resolveLoopProvider`: the open chat session's provider, else the agent chosen in the chat (`prepareLoopRun`, `loop-run-agent.ts`); its model is the chat's choice for that provider unless a step fixes one. The drawing's `target` takes no part. The run record keeps both apart: a chat-loop record on the Windows host (15 November, `chat-loop-2026-11-15T09-15-54-946Z`) has `identity.provider: "claude"`, `modelRequested: "opus"` in its header and the drawing's `target: "claude-code"` only in the run-started journal data. The Copilot run Niclas saw was not on that host (its newest run is from 15 November) and was not read.
- What `target` does: role validation (a role must declare a form for it), the requirement check on DSpatch's walked path, `writeReachOf`'s hashing decision, the run-started journal and the target-change report. Generated agent files are written from each role's own declared targets, not from a graph. So it has a function, but not the agent's.
- Loop view: the toolbar's "Target framework" chooser is gone. Beside Run, read-only, "Runs with" (or "Running with" while a run walks) and the provider and model: the watched run's own (`agentSummary` in its announcement, from the same preparation the run walks with), else what a run started now would use. Its hover holds the full agent line and says the choice is made in the chat. The agent line no longer names the drawing's target.
- The drawing's target is under the graph panel's "Advanced: framework the roles are checked for", changed through the same report as before (DSP-22 #8's "visible while editing" now means visible there).
- The editor's Run takes the chat's choice for Cursor's model too (the open session's model, else the one chosen for Cursor), where it used to take `defaultLiveModel()`; the provider was already the chat's.
- Checks: `tests/loop-provider.test.ts` (a Copilot session with claude-opus-5.5 builds the Copilot adapter for the loop and the line and summary name Copilot and that model; the editor's Run reads the chat's model; both run announcements carry the summary), `tests/loop-model-select.test.ts`, `tests/delegated-review-view.test.ts`: 51 pass; typecheck; build. Not tried: the window itself, and a live Copilot run.
- Open, for Niclas's decision: the requirement check on the walked path and `writeReachOf` still answer from the drawing's target rather than from the run's provider (`RUN_PROVIDER_CAPABILITIES`, DSP-139), so under Copilot a drawing marked cursor is checked against Cursor's answers.
<!-- SECTION:NOTES:END -->
