---
id: DSP-94
title: >-
  Show the instructions an agent actually received, in the inspection we already
  have
status: Review
assignee: []
created_date: '2026-09-22 17:19'
updated_date: '2026-09-22 19:24'
labels:
  - architecture visibility
dependencies: []
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Registered from the DSP-92 review, not started. Follows the call-contract corrections and precedes the observation policy in DSP-93. The behaviour is right and a reader cannot see it, which is what AGENT_BEHAVIOUR_AND_ORCHESTRATION.md sections 2 and 3 are about: the runtime contract must be visible in the graph editor beside the role, it must be possible to inspect the assembled message for an actual call, and a separately maintained summary must not stand in for the real instruction. Findings F4, F5, F6 and F7 in docs/research/dsp-92-architecture-against-agent-behaviour.md, plus the visibility half of F8. F4: ENGINE_PREAMBLE and ROLE_PROVENANCE are the two strongest sentences DSpatch adds and appear on no screen, while the node panel shows a separately written paraphrase of that part of the message. F5: the whole assembled prompt is already stored per step on RecordedAgentReply.prompt and no user-facing surface reads it. F6: toolPolicy is hardcoded per run and invisible everywhere. F7: the model note says a node's choice is recorded and not applied, which is true of every node except the entry node, whose choice silently sets the model for the whole run. F8: a person's mid-run message is carried verbatim and is not a BriefPart. All of these are existing values shown in existing surfaces. Do not reintroduce the chat information panels removed in DSP-87 and DSP-90; the place for this is the node inspector, the run view's step entries and the existing diagnostics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The node panel shows the literal text of the runtime instructions DSpatch adds, not a separately maintained description of them
- [x] #2 The prompt stored for a step can be read verbatim from the run view without opening a file outside the application
- [x] #3 The model note and the tool policy state what actually governs a run, including the entry node's effect on every step
- [x] #4 No information panel removed in DSP-87 or DSP-90 returns to the chat
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried over from DSP-96, 22 September 2026.

A third runtime instruction now needs showing. TASK_PRECEDENCE in loop-chat.ts states, to every agent step, that the person's words are the assignment and another step's account does not replace them, that a later message from the person updates the part it concerns and leaves the rest standing, that a role's ordinary routine gives way to a limit the task states, and that none of it widens what the agent may actually do. It is deliberately exported as a constant so this card can render the literal string. DSP-96 added no BriefPart for it and wrote no summary of it, because a separately maintained paraphrase is the thing section 3 of the guideline forbids; it only extended the existing mandate brief part by one clause so the panel is not silently wrong. So the list for this card is now ENGINE_PREAMBLE, ROLE_PROVENANCE and TASK_PRECEDENCE, all three shown as their own text.

F6 is more load-bearing than when it was written. toolPolicy is still a hardcoded provider-default invisible everywhere, and the capability table now names toolPolicy: 'text-only' as the mechanism that is not selected. A reader who wants to know whether a step could touch a file has to read one line of the main process to find out.

Implementer, 22 September 2026. Built, and reported in full at .dspatch-loop/runs/20260920-104500-folders/reports/033-implementer-show-what-the-agent-was-told.md.

Where the four things are. The node panel's "What the message to this step contains" now prints ROLE_PROVENANCE, ENGINE_PREAMBLE and TASK_PRECEDENCE as text, read from the constants the prompt builder uses — briefParts carries the strings, and roleHeadlineFor is now the one source of the role headline for both the prompt and the panel. Under it, "What the step may do while it works" states the run's tool policy from LOOP_RUN_TOOL_POLICY, the constant the adapter is actually given. The model box on the entry node says a fixed choice there opens every step's session with it, and is marked "applied — to every step"; every other node keeps "recorded, nothing acts on it". In the conversation, each agent reply carries a closed disclosure, "The message this step was sent", naming the node, the visit and the run, holding RecordedAgentReply.prompt verbatim. A paragraph above the panel's list says in one sentence that the panel is the drawing as it stands and a run that has walked kept the version it started with.

Checks. typecheck, build, and the fast, loop, chat and presentation groups pass. Two window trials: loop-result, where both disclosures were closed by default and their characters equalled the prompts in the run record on disk; and one-view, where the three instruction blocks, the tool-policy sentence and the entry-node model note were read off the panel before and during a run. Binding to a revisit is covered by a unit test in loop-record.test.ts, not by a run: the saved artefacts under logs/030-implementer never revisit a node, and no walk was made to manufacture one.
<!-- SECTION:NOTES:END -->
