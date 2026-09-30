---
id: DSP-83
title: >-
  Show an agent's actual instructions in the node panel, and make the help
  readable
status: Review
assignee: []
created_date: '2026-09-20 18:14'
updated_date: '2026-09-20 19:09'
labels: []
dependencies:
  - DSP-82
priority: high
type: feature
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 20 September, after using the editor: selecting an agent node shows a path and the words 'Role description resolved', which tells a person nothing about what the agent will actually be told. The panel must lead with the node's task, the full role instruction rendered as Markdown, the material other steps hand it, and what it must leave - with technical settings folded away below. Purpose is the tooltip text and must be written as help a person can read, in the app's existing language, without inventing a second field for the same thing. Limits, outcomes and declared failures must say what they mean, in units, with the step an outcome leads to, rather than comma-separated code words; 'research needed - research needed' is not help. Inherited settings must not look switched off because a local box is empty, and a setting with no effect must not look as though it works. Separate rights the platform enforces from instructions an agent is merely asked to follow. The provider-independent role source stays the original and no competing set of short agent descriptions is created. And the role text must be followed from the source file to the actual adapter call to check the whole intended instruction is used rather than only the node's Purpose - the coordinator nodes in particular point at .cursor/skills/dspatch-loop/SKILL.md, which instructs an EXTERNAL Cursor coordinator to call specialists itself and is the wrong division of responsibility for a graph DSpatch walks. The working external Cursor workflow is preserved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Selecting an agent node shows its name, a readable description of the node's task, and the full role instruction as formatted Markdown, with the source named and openable.
- [x] #2 The general role, this node's task, and the material handed over by other steps are visibly three different things.
- [x] #3 Content actually included in the call is distinguished from files the agent is only told to read.
- [ ] #4 Purpose reads as help about what the node does in this graph, for every node kind, and no second tooltip field was added.
- [ ] #5 Task, role, incoming material and expected result come before technical detail; Advanced is collapsed by default.
- [x] #6 Limits, outcomes and declared failures are named in readable words with units, scope, the meaning of an empty value, and where an outcome leads.
- [x] #7 An inherited setting is shown as inherited and not as switched off; a setting with no effect does not look as though it works.
- [x] #8 The role text is traced from source file to adapter call and the whole intended instruction is used; any shortfall is fixed and reported.
- [x] #9 The runnable graph's coordinator nodes use a role fitting Maestro's division of responsibility, and the external Cursor workflow is unchanged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, call 021. Report: reports/021-implementer-the-panel-shows-what-the-agent-is-told.md. Candidate sha256:c8ea780e9b9b4bdd6524085a53393adaed4478cf5643a9e0863896b18605cef2, confirmed by the coordinator with --expect.

THE ROLE ALREADY REACHED THE AGENT WHOLE, and the implementer said so rather than inventing a defect to fix. Traced from docs/loop/roles/*.role.md through parseRoleSource, resolveRoleSource, ResolvedRole.instructions, chatRoleTextFor to chatPromptFor: the role's prose goes in between '===== role, as written =====' markers, BEFORE the mandate and the task, and purpose is sent as well rather than instead. What was a reading is now a test: for every agent node of the runnable graph, every non-empty line of the real role file must appear in the prompt, and the role block must close before the purpose text begins. A truncation anywhere in that chain fails.

ONE LATENT GAP LEFT ALONE: resolveRoleSource drops section headings and target blocks from instructions. No role source uses a target block today, so nothing is lost; a role that added one would have it silently omitted.

WHAT THE MESSAGE CONTAINS IS NOW STATED IN THE PANEL, split into carried and referenced. Carried: the role in full, the run/step/visit address, the folders when there is more than one, the mandate, the task, the declaration words, the outcome names. Named but not carried: a report another step filed as a file, because the file is the result and a copy could disagree with it. Never included: anything the role text links to, the project's code, and anything other steps said.

NEW MODULE loop-node-help.ts holds the readable half. Limits carry names, units, scope and the meaning of empty; requirements are standings that carry where they came from, so an inherited limit reads 'Nothing is set here, and the whole run's limit of 2 applies to this step' instead of as an empty box. Unhonoured now distinguishes three states rather than one: recorded and nothing acts on it, honoured with limits, and stated but not enforced. Failure kinds show their meaning and destination, which is what replaces 'research needed - research needed'.

A NEW ROLE FOR THE COORDINATOR INSIDE A RUN: docs/loop/roles/run/dspatch-run-coordinator.role.md, and both coordinator nodes of the runnable graph point at it. They pointed at the Cursor SKILL.md, which tells its reader to call five subagents and own a backlog card - all things the runner does. Under roles/run/ because roles:generate reads only the top level and this is not a Cursor project agent. Nothing under .cursor/ changed; roles:generate reports 0 written, 0 differing.

THE TRIAL REFUSES RATHER THAN SAVES a capture that would not show what it claims: it measures pixels of the role box inside the window and fails below 240. That check caught two faults in the instrument itself - measuring the element's own height, which is 384 whether or not it is on screen, and reading the header before React repainted. With it tightened the panel genuinely failed at 204px, which is why the purpose editor is three rows rather than five.

typecheck clean, fast 881 (from 867, +14), loop 433, live 62, all 0 fail. Coordinator re-ran typecheck and fast independently and looked at three of the captures.

CRITERION 4 AND 5 ARE LEFT UNCHECKED: the Purpose texts and the panel's order are exactly what Niclas has to judge by reading them. Evidence is in logs/021-implementer/.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-20 18:14
---
Focus: the node panel, the Purpose texts, the role-to-adapter trace, and a Maestro-side coordinator role for the runnable graph. Window trial and packaging are the coordinator's.
---

created: 2026-09-20 19:09
---
Coordinator verified: candidate-26 --expect matches, typecheck clean, fast passed, .cursor untouched. Looked at panel-implementer-advanced-closed.png, -limits.png and chosen-definition-work-advanced-closed.png: role text legible as Markdown, the inherited-limit sentence reads as intended, and the header names the loop.
---
<!-- COMMENTS:END -->
