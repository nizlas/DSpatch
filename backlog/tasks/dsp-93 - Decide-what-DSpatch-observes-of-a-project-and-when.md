---
id: DSP-93
title: 'Decide what DSpatch observes of a project, and when'
status: To Do
assignee: []
created_date: '2026-09-22 17:06'
updated_date: '2026-09-22 18:20'
labels:
  - architecture observation
dependencies: []
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Recorded from the DSP-92 review, not started and not decided. AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 2 says automatic hashing reads file contents and must therefore be covered by a documented policy for observing project changes, that permission for a role to write does not mean the current task uses the project, and that how observation is selected for each run needs a separate design which must not become a hidden classification process that starts inventorying the project before assessing the need. Three findings in docs/research/dsp-92-architecture-against-agent-behaviour.md belong to that one design and would each get a partial answer if taken separately. F12: DSP-91 conditioned the loop snapshot on whether any step in the drawing may write, which is the only property available before a run but is not the question the guideline asks; the saving is also unreachable today since every shipped drawing may write, and the one drawing that would skip is the one where the read-only guarantee is weakest. F13: opening a project already hashes it in full and retains up to 64 MB of its bytes in the main process before any task exists, so the loop's condition cannot deliver the property on the path a person actually uses; those retained bytes are what the chat's own diff is built on and must not simply be removed. F14: the loop still hashes whole trees including build output through snapshotTree, while the bounded git-aware snapshotWorkspace is already written and tested. Holding this against the principle that an agent narrative is not evidence is the substance of the decision: the before-and-after hash is the only thing in the product that can contradict an agent claiming it changed nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A written policy says what DSpatch reads of a project on its own account, when, and what it retains, covering both the workspace baseline taken at project-open and the loop's per-step snapshot
- [ ] #2 The selection of observation for a run is decided without reading the project to make the decision and without classifying the mandate's text
- [ ] #3 A run that observes less says so in its record, in the register that not observed is not the same as none
- [ ] #4 The policy states how it preserves the ability to contradict an agent that claims it changed nothing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Status clarification from Niclas, 22 September 2026. This supersedes the wording of the DSP-96 carry-over below where the two differ.

Describe the write-protection correction correctly: the product stopped claiming a technical protection exists. A working protection was not removed. Nothing an agent could previously not do became possible; only the claim changed.

The absence of technical write protection does not make full hashing a permanent requirement. What the product does today is the existing observation policy, in force while this design work is pending, and not a commitment. One legitimate future choice is to observe nothing and record explicitly that changes were not measured, in the register that not observed is not the same as none. That choice does not require a sandbox to be built first. Weigh it against the need for evidence of change here, in this card, and not in any preceding increment.

--- DSP-96 carry-over, 22 September 2026, report at .dspatch-loop/runs/20260920-104500-folders/reports/031-implementer-ask-only-for-what-the-contract-offers.md ---

On the path DSpatch walks, a loop agent has no technical write protection: the sandbox policy derives from cwd alone and defaults to the SDK's insecure_none, dirs loads configuration without confining anything, and tools: [] is only passed under a toolPolicy the live path never selects. Three surfaces now read not enforced where they read enforced.

writeReachOf no longer lets role prose stop a project being hashed, so the snapshot skip is currently unreachable for any drawing with an agent step. That was intentional under the policy in force: the skip would otherwise have fired exactly where the read-only guarantee is weakest. It is not a permanent position and this card may change it.

Unchanged and still standing: F13, opening a project hashes it in full and retains up to 64 MB of bytes before any task exists; and F14, the loop still uses snapshotTree rather than the bounded git-aware snapshotWorkspace.

One correction made alongside that a reviewer may want to look at separately: background-execution and fixed-model-selection were split by path too, because their Cursor entries also named agent-definition fields.
<!-- SECTION:NOTES:END -->
