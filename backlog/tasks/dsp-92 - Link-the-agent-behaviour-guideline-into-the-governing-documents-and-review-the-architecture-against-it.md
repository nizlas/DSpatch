---
id: DSP-92
title: >-
  Link the agent behaviour guideline into the governing documents and review the
  architecture against it
status: Review
assignee: []
created_date: '2026-09-22 16:48'
updated_date: '2026-09-22 17:06'
labels:
  - docs architecture
dependencies: []
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas added docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md on 22 September 2026. It defines the boundary between what an agent instruction decides, what the graph's workflow decides and what Maestro owns in execution, and it requires every instruction DSpatch introduces to be explicit and inspectable. It also carries proposals for editing instructions in the graph editor and for switching from a loop to interactive work, which are recommended designs rather than approved features. Two pieces of work, in order. First, reference the guideline from the places in the existing structure that actually need it, chosen by that structure rather than added everywhere, without copying its principles into other documents, without turning its proposals into settled requirements through link wording, and reporting rather than quietly settling any conflict with existing governing text. Second, review the actual code, graph definitions and agent instructions after DSP-91 against the principles: where an agent's way of working is decided, what the graph editor actually shows of that, where responsibility for the run and its results sits, how a task's use of the project is decided, and what already exists for the proposed capabilities. Earlier reports are entry points, not evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The guideline is referenced from the places in the existing document structure that need it, with a short statement of what it governs, and its principles are not copied into those documents
- [x] #2 Link wording preserves the document's distinction between agreed principles and proposed designs
- [x] #3 Any conflict between the guideline and existing governing documents is reported rather than silently resolved; unambiguously outdated wording is corrected
- [x] #4 A written analysis assesses the implementation against the principles, giving for each finding the principle, a concrete source in the implementation, the practical consequence and the smallest reasonable next action
- [x] #5 The analysis separates behaviour that breaks a principle from poor visibility and from proposals not yet built, and separates what is established in code from what was observed in a run and what is still unknown
- [x] #6 The analysis ends with at most three prioritised next steps and changes no product code, role behaviour or graph routing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Part 1, linking. Five references chosen by where the guideline actually bears, plus one reverse pointer. README.md's Start here table (document overview); AGENTS.md reading order as item 3, conditioned on changing what the product's agents are told; MAESTRO_ORCHESTRATION.md section 3, where the flow/method split is already stated and the guideline carries it down to the level a call is built at; INTERACTION_MODEL.md's opening precedence paragraph, so the two do not compete over responsibility; docs/loop/ROLE_FORMAT.md, where one-source-per-instruction is already the subject; and VISION.md section 8, which the guideline says it supplements. Every link names the editor and interactive-switch material as proposed design. No principle was copied. Deliberately not linked: .cursor/skills/dspatch-loop/SKILL.md and the five top-level role sources, since AGENTS.md is read by those agents anyway and the role sources generate the external Cursor specialists.

One correction inside the guideline itself: it referenced 'DSpatch vision och styrdokument v1', the Word export. Repointed to VISION.md with anchors to sections 7 and 8, and named which documents govern where they differ. Nothing else in Niclas's text was altered; its US spelling and the BEHAVIOUR/behavior split between filename and heading are left alone.

Part 2, review. Filed at docs/research/dsp-92-architecture-against-agent-behaviour.md. Verdict ACCEPT for DSP-91's seven changes as an answer to what report 029 traced. Seventeen properties hold, fourteen findings, every claim labelled established in code, observed in a run, or unknown. The reviewer had no shell on this machine and ran nothing, so no finding is first-hand run evidence.

A documented conflict, not resolved here: the guideline says permission for a role to write does not mean the current task uses the project, while DSP-91 conditioned the snapshot on exactly whether any step in the drawing may write. The review assesses the tension in F12 and introduces no new solution, as the assignment required. It also found an older and larger automatic read the DSP-91 condition cannot reach (F13, the workspace baseline taken when a project is opened), and that the loop still uses the crude whole-tree snapshot when a bounded git-aware one is already written and tested (F14).
<!-- SECTION:NOTES:END -->
