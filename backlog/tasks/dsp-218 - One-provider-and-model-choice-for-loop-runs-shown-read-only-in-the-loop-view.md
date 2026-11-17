---
id: DSP-218
title: One provider and model choice for loop runs, shown read-only in the loop view
status: Review
assignee: []
created_date: '2026-11-17 09:00'
updated_date: '2026-11-17 21:00'
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
- [x] #6 The steps' requirements, the refusal of a run and the workspace decision are answered by the run's agent; the drawing's target only checks the roles' form, and its change report says only that
- [x] #7 The loop view's model line is the run's own choice and names steps that fix or select their own model; during a run it shows the step just entered when its model is not the person's
- [x] #8 A cursor-labelled loop run through Copilot (real runtime, stand-in model) uses the Copilot adapter, the chat's model and Copilot's answers; the window seen
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
- First part committed as e6ccd53.

Niclas's decision of 17 November 2026 on the remaining uses of the target: checks of the actual run's capabilities, limits and workspace start from the provider and adapter that run it; the role-form check keeps the target where it is needed to validate a role source; a requirement or role the chosen provider cannot meet is said concretely; a cursor label must neither pass nor stop a Copilot run.

- Role form vs execution. A run DSpatch walks builds each role's instructions from its portable sections, never from a target block, so the target is not needed to interpret a role source on this path; it is what `role-does-not-support-target` checks (a role declares a form for the drawing's framework), and that check stays. The steps' requirements are answered from `RUN_PROVIDER_CAPABILITIES` for the run's agent (`checkLoopGraph`'s `runProvider`; messages name the agent, "Copilot, which runs this loop, …"). Without a known agent the editor says once that the requirements wait for it (`requirements-await-agent`); a caller that judges no run is not asked. Finding codes are kept.
- Runs. Both run handlers check the requirements against `agent.provider` after `prepareLoopRun` and refuse an unmet one before anything is recorded or claimed (`checkRunRequirements`, `requirementsRefusal`). `writeReachOf` takes the run's provider, and `runLiveGraph` passes its own, so whether the working folders are measured follows the agent's tools.
- The target-change report (Advanced) now names only roles without a form for the new framework; it no longer compares two targets' requirement answers, which described a run that never happens.
- Model line. The summary beside Run is the run's own model choice (`personModel`), not the entry step's. Before a run it adds "one step sets its own model" (or how many), with each step and model in the hover; during a run, when the step just entered runs a model that is not the person's (journal `node-entered`, S19), it says "now “step” on model (reason)". The announcement carries the provider (`agentProvider`) so the editor's requirement check follows the watched run.
- Checks: `tests/loop-graph.test.ts` (a cursor-labelled drawing via Copilot is judged by Copilot's answer, with an injected unmet answer refused in the run check too; a copilot-labelled drawing via Cursor is not stopped by the label; role form still checked; requirements wait when the agent is unknown; the workspace decision via Copilot ignores Cursor's enforcement), `tests/loop-provider.test.ts`, `tests/loop-model-select.test.ts`, `tests/delegated-review-view.test.ts`, and new `tests/loop-copilot-run.test.ts`: the bundled cursor-labelled chat loop with two requirements on its check step, run by `runLiveGraph` through the real Copilot SDK and runtime with a local stand-in model (no account, network or model): one Copilot adapter for a loop and no Cursor, every model request for claude-opus-5.5, every step's journal model copilot/claude-opus-5.5, the requirement notice in Copilot's words, the folders measured. Typecheck; build.
- Window (this checkout's build, headless, isolated profile, Copilot chosen and claude-opus-5.5 set through the chat's own calls, no model call): the bundled chat loop shows "Runs with Copilot · claude-opus-5.5" and no Target framework in the toolbar; a copy with a step fixing gpt-5-mini adds "one step sets its own model", the hover naming "Check the work: gpt-5-mini", and the requirement notice names Copilot; the Advanced section holds the role framework.
- Not seen: the line during a running loop in the window (no run was started; covered by the journal test only), and a real Copilot account. Not changed: `runnableHere` (a notice only the command-line runner asks for, which runs with Cursor).
<!-- SECTION:NOTES:END -->
