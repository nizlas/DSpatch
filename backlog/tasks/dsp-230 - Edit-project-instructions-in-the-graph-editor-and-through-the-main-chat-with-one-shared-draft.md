---
id: DSP-230
title: Edit project instructions in the graph editor and through the main chat, with one shared draft
status: Review
assignee: []
created_date: '2026-11-19'
labels: [loops, graph, editor, instructions, chat]
dependencies: [DSP-229]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Builds on DSP-229 (8d9b15a): its project instructions model, file and assembly are reused. The graph editor's right panel shows a "Project instructions" section for a selected agent node of a project graph (common, role, this step, and document references grouped by level, with what is inherited and the scope of each level said), and the graph panel gives access to the common instructions when no node is selected; a built-in template without customization offers "Apply to repository…" and is never changed. The panel and the customization window edit one draft kept by the host, distinct from the saved file on disk and from the agent's not yet applied proposals. Save and Discard changes follow the editor's pattern; a run started with unsaved draft changes asks to save first or to run the saved version; a run in progress keeps what it started with; saving checks the file on disk and shows a conflict instead of overwriting. "Discuss project instructions" focuses the main chat with the graph, repository, node, role and current draft as context; the chat agent proposes structured changes (level, steps affected, reason, sources) that the person applies to the draft or rejects, and a proposal made against an older draft is detected. Previews use the runtime assembly on the draft and say when they show unsaved changes. No VS Code import, no ReID migration, no release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 The right panel shows and edits common, role and step additions and their document references for a selected agent node, with inherited levels and scopes stated; the graph panel reaches the common instructions; a template offers Apply to repository… instead.
- [x] #2 The panel and the customization window share one host-kept draft; saved, draft and proposals are distinct; Save, Discard changes, closing and switching graphs do not lose work silently; save detects changes on disk.
- [x] #3 A run with unsaved draft changes asks to save first or run the saved version; a running run is unaffected.
- [x] #4 "Discuss project instructions" gives the main chat the graph, repository, node, role and draft; the agent proposes structured changes that are applied to the draft or rejected, with stale proposals detected.
- [x] #5 Previews use the runtime assembly on the draft and are labelled as unsaved when they are.
- [x] #6 Verified on a synthetic project (simulated agent and, where stated, a real provider); older graphs and graphs without instructions behave as before; the tutorial covers panel editing, chat proposals, draft versus saved and later additions.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result (19 November 2026). Governing: DSP-229's format, file and single assembly (`projectInstructionsText`, `stepProjectText`), reused unchanged; AGENT_BEHAVIOUR_AND_ORCHESTRATION.md §2–3 (every added instruction visible and inspectable); the graph proposals' rule that the chat never writes or runs anything (DSP-209 S23a/b); the editor's unsaved-drawing question at run start (DSP-86). No change to the repository format.

**Draft.** `main/project-drafts.ts` keeps one draft per project graph in DSpatch's data folder (`project-instruction-drafts/`), never in the repository: saved version and sha, draft, revision, proposals. Edits are per level (`common`, `role:<id>`, `node:<id>`), so the panel and the window never overwrite each other; every change is broadcast (`dspatch:project-draft`). Save is refused when the file changed on disk since the draft was based on it; "Take in the change on disk" merges level by level, keeping the person's levels; a clean draft follows the file silently. Discard changes returns to the file. Pure rules in `shared/project-draft.ts`.

**Panel and window.** `renderer/ProjectInstructionsPanel.tsx`: for a selected agent node, Common (inherited from the project), Role (inherited from the role) and This step, each with text and documents, the scope said ("Applies to all 4 steps using …"), unsaved levels marked; status line with Save and Discard changes; preview by the runtime assembly, labelled when unsaved; the node brief's project part is the draft and says so. Graph panel: common level and which levels have additions. A built-in workflow shows Apply to repository…. The customization window's maintenance mode edits the same draft; closing it keeps the draft.

**Chat.** "Discuss project instructions" focuses the main chat with a removable notice; the host builds `discussionContext` from the draft when the message is sent and puts it in front of the person's words, kept as `projectContext` on the message. Tools `read_project_instructions` and `propose_project_instructions` (host/project-instruction-tools.ts): changes per level with reason and sources, each recording the level as it was; Apply to draft refuses a change whose level was edited since (stale). Cards in the chat at their turn and in the panel.

**Run.** The run reads the saved file (unchanged). Starting a chat run with unsaved draft levels asks Save and run / Run the saved version / Cancel; a run in progress keeps what it pinned.

**Verification.** Unit (`tests/project-graph.test.ts`, 13 pass, 5 new; one new in chat-service.test.ts): role vs node reach, two editors, save equals run text, run pinning, disk change, take-in, discard, tool proposal, stale, restart persistence, strict parsing. Related suites pass (conversation-store, graph-authoring-tools, loop-chat, loop-recap). Window trial `scripts/project-draft-trial.mjs` (headless, isolated profile, SIMULATED agent): panel, shared draft with the window, long text and narrow window, discussion, proposal apply/stale, disk change, save, discard, run question, built-in template, restart. Real provider (`scripts/project-discussion-probe.ts`, Claude through the chat service): 21 s, one proposal adding two rules from an earlier VS Code agent definition at role level (2 steps) with sources noting the file may be outdated, the outdated kronor rule left out; draft, file and repository unchanged.

**Limits.** Role headings show the role id (DSP-229's outline has no role title). Recommendations stay in the window. Not tried on Windows, a remote host, Copilot or Cursor. No VS Code import (by design).
<!-- SECTION:NOTES:END -->
