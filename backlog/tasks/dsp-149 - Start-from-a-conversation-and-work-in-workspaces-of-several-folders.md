---
id: DSP-149
title: Start from a conversation and work in workspaces of several folders
status: Review
assignee: []
created_date: '2026-10-27 20:04'
updated_date: '2026-10-27 21:47'
labels: []
dependencies:
  - DSP-111
priority: high
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's product decisions of 27 Oct 2026, recorded here as given. One connected user flow: a clean start page, Recent projects as workspaces, real workspaces of one or more folders (possibly from different Git repositories), and a conversation that can begin before a workspace is chosen and follows the person into it. Chat can create, name, open and extend workspaces through DSpatch's own workspace functions, exposed to the agent through each SDK's supported tool mechanism; this does not replace the agent's own file and command tools or its inner loop, and the agent never writes DSpatch's internal configuration files. Builds on the host-client boundary (DSP-111): workspace and provider logic live on the host. Out of scope: SSH, Copilot, steering, live provider calls, new provider installations, buttons for remote functions that do not exist yet.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The start page holds only: a discreet provider dropdown at top left, a way to start chatting without a workspace, an Open Project button, and Recent projects with View all. No git information, timestamps, per-row Open/Forget buttons, explanatory paragraphs, sample project, conversation archive, diagnostics, export or file actions, or standing warnings remain on it, also below the visible area
- [ ] #2 Recent projects: the workspace name opens it (folder name by default), a discreet location that does not break the layout with the full path on demand, sorted by last opened, the last three months topped up with older ones to five, at most ten on the start page, View all with search, one entry per workspace however many folders, Remove from recent in a secondary menu removing only the entry
- [ ] #3 A workspace has a persistent identity, a name and a collection of folders; Open Project creates or reopens the workspace of its first folder without an extra dialog; File > Add Folder to Workspace adds further folders; name, folders, history and relevant settings survive a restart. The existing workspace model is extended, not duplicated
- [ ] #4 The agent can work in every workspace folder under Claude and Cursor through each SDK's own mechanism; chat and loops use the right set of folders; command records, change evidence and the check step do not treat the first folder as the whole workspace; existing permission boundaries and the review discussion's tool-free policy are kept
- [ ] #5 A conversation can start on the start page with no provider assumed on a new installation, never silently uses DSpatch's repository or the process's working directory as the user's project, is saved before a workspace exists and survives a restart, and continues as the same visible conversation in a workspace when one is opened; opening an existing workspace makes it a chat of its own there with older chats kept separately; a new provider session gets the needed context through existing mechanisms and is not called the same session; opening or switching a workspace sends nothing and starts no work by itself
- [ ] #6 Through the chat DSpatch can take a workspace name and folders from the conversation, find existing folders under a stated place on the current host, ask when something is ambiguous or missing without inventing paths, create, name and open the workspace with all its folders, add folders to the current one, and keep it in Recent, using the same host functions as the menus
- [ ] #7 Older and stand-alone conversations are reached from a history view in the menu, with export and file information as secondary actions for a chosen conversation; a missing project folder is reported when the person tries to open it; the bundled review example still opens from the menu; sample projects remain only in test and development flows
- [ ] #8 Tests use isolated user data; whether earlier automated runs wrote into the real user data is investigated and any confirmed cause fixed, without deleting or hiding existing entries because their path contains Temp
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 27 Oct 2026. Current focus: reading the decided design (DSP-71, DSP-72, DSP-111, the agent-behaviour and content-exclusion documents) and the code that ties a chat session, its conversation and Recent projects to one folder; then the store model, the start page, multi-folder SDK wiring, the carried conversation and the workspace tools.

Result, 27 Oct 2026 (local commit, not pushed). Status Review: the UX criteria are Niclas's to judge; no criterion is ticked by agent tests.

What a person can do now:
- Start on a clean start page (agent choice, wordmark, Open Project, inactive Remote Session, Recent projects with View all, a composer), with the approved graphite and blue-turquoise look; the decoration is SVG and CSS layers behind the content.
- Talk before choosing a workspace. That conversation runs in an empty folder DSpatch owns under userData, has only DSpatch's workspace tools, is saved, and comes back after a restart.
- Open Project creates or reopens the workspace of a folder; File > Add Folder to Workspace adds more. A workspace has an identity, a name and its folders, and keeps its chats; the sidebar shows its name, folders and chats with New chat.
- Ask the chat to find folders under a place on this computer and create, name, open or extend a workspace. The tools are the host's own functions, through Claude's in-process MCP server (createSdkMcpServer, mcp__dspatch__*) or Cursor's local.customTools, and are listed word for word in the session details. The workspace opens when the reply ends; nothing is sent and no work starts.
- Opening a workspace from a conversation without one moves it there as the same visible conversation, in a new provider session with DSpatch's disclosed recap. Opening an existing workspace makes it a chat of its own there, with the older chats kept beside it.
- Every folder reaches the agent in the chat and in loops: Claude through additionalDirectories, with the policy's anchored Read and Edit rules restated per folder as absolute // rules; Cursor through cwd plus dirs, resumed with the new list when a folder is added. Change reports and command snapshots cover every folder. The one-folder refusals for Claude (adapter and loop preparation) are gone. The review discussion stays tool-free.
- Conversation History (Session menu) lists every conversation; export and file information sit under More. Recent Projects (menu and View all) has search; Remove from recent hides the entry only. A missing primary folder is reported when someone tries to open it. Sample projects are a development-only menu item. The example review still opens from the File menu.

Temp entries in the real Recent list: ten dspatch-loop-choice-* entries from 20 Sep came from scripted loop-choice runs started without an isolated user-data folder; the guard was opt-in. A scripted run now has to name DSPATCH_CHAT_EXPECT_USERDATA or it exits 25 before writing anything. The entries were left as they are.

Verified (Windows, home computer, isolated user data, no provider call):
- typecheck (node, renderer, tools) and the Claude SDK shape check against the installed SDK 0.3.306; build.
- The whole suite: 1620 pass, 1 skipped. The skipped one is the opt-in real-SDK check, run separately with DSPATCH_REAL_SDK_CHECK=1: the installed SDK's own createSdkMcpServer built the server from DSpatch's tools with the installed zod.
- The real host process: open, add a folder, restart, the same name and folders in Recent, Remove from recent, the folder-less conversation's folder, and a missing-folder refusal.
- Window scenario workspace-flow, run as two processes over one user-data folder:
  - first process: the start page, then a conversation with no workspace;
  - a workspace of two folders made through the chat's tools, the conversation carried in, the session given both folders;
  - a third folder added and given;
  - second process (the restart): Recent with long entries, a new conversation carried into the existing workspace as a chat of its own beside the earlier one, all three folders, the history view, and Remove from recent;
  - screenshots of the start page at normal, narrow (720 px, the window's minimum) and low (560 px) sizes, empty and with entries, scrolled to the end too.
- Regression scenarios: presentation, loop-result, stop-asked, errors, switch first and again, resume-choice refused, failed and ok, review-window and review-discussion, all exit 0. Several were adapted to the new start page: the connection wait, the sample project through the development menu, and saved conversations through the history view.
- folders still fails. It was already stale before this change: it waits for a loop chooser (loop-definition) that HEAD does not draw either.

Simulated: every provider answer, and the tool calls in the window scenario, which the presentation adapter makes when a prompt names them (only from the person's new text, not from a recap). No model chose a tool. Not run: any real Claude or Cursor turn; Cursor's resume with a changed dirs list; a real loop walk with several folders under Claude.

Open, needing Niclas: DSpatch's existing refusal of its own working copy applies to every workspace folder, so a workspace with the DSpatch clone that runs it is refused (the example in the request). A conversation without a workspace has no file or command tools; that is a choice made here, and can be changed.

Remaining departures and limits:
- Recent shows the full primary path, cut at its start, not ~/...;
- the wordmark is real text in Segoe UI Variable Display or Segoe UI, not a drawn logo;
- an added folder's change baseline is in memory and starts afresh after a restart; the primary's is kept as before;
- the primary folder cannot be removed from a workspace (existing rule).

27 Oct 2026, rework after Niclas's manual trial: context carried automatically with no recap panel (his decision, replacing the visible recap at workspace transitions), turn diagnostics out of the conversation into Session details, a model choice per provider from SDK model discovery, Recent as a history of workspaces actually opened, and a one-off cleanup of the confirmed test entries in the real Recent list (approved by Niclas).

Rework result, 27 Oct 2026 (after Niclas's trial; local commit, not pushed). Status back to Review.

Fixed:
- Context follows automatically. A conversation moving into a workspace gets a new provider session with DSpatch's complete record of it in front of the next message: every message, in full, up to 400 000 characters, and the conversation says so in one line if even that cuts. There is no new-session panel, no "summary will be sent", no Remove summary, and no per-turn summary disclosure. Added folders stay in the same provider session. The recap and its statement are under Session details (Turns). The recovery rules after an uncertain ending (DSP-121) are unchanged.
- Technical noise is out of the conversation. No "streaming..." badge, and "How this turn arrived" is moved to Session details > Turns; the facts are still recorded. A working dot and a Stop button show while the agent works.
- Model choice per agent, beside the agent choice on the start page and by the composer:
  - the list is the SDK's own: Claude's Query.supportedModels() on a query that is sent no message, Cursor's Cursor.models.list();
  - the choice is kept in dspatch-model-choice.json and given to the open session from its next turn (setSessionModel in both adapters);
  - no choice means the provider's default, and the fixed claude-haiku-4-5 is gone;
  - a model the account is not offered is refused before sending;
  - the review discussion and loops use the same choice;
  - a loop step's fixed model is kept, and refused with a reason only when Claude's list is known and lacks it.
- Recent is the history of what was opened. A workspace is recorded only after a successful opening; one the chat creates is unopened until it opens; Remove from recent stays removed until an explicit opening.
- Cleanup, approved by Niclas: the eleven confirmed test entries were removed from the real Recent list (format 3, both lists). They are the ten dspatch-loop-choice-* entries of 20 Sep (run 20260920-104500-folders) and dspatch-repro-packaged-fixed of 19 Sep (run 20260919-194000-upkeep). The backup is dspatch-projects.backup-before-test-cleanup-20261027.json beside the file. MiniDAWLab-spike01 and every folder, conversation and run record were kept.

Verified (isolated user data, no provider call):
- typecheck, the SDK shape check (SDK ModelInfo and Query.supportedModels fit), build;
- the suite: 1624 pass, 1 skipped (the opt-in real-SDK check);
- the host process: a removed entry stays removed through a background start;
- workspace-flow in two processes:
  - the context arrived with 2 earlier messages and no panel or summary text on screen;
  - the working dot and Stop showed, with no streaming label;
  - the turn facts are in Session details;
  - the chosen model id reached the adapter;
  - an unoffered model was refused with its reason and nothing was sent;
  - the model choice and the workspace survived a restart;
  - Remove from recent worked;
- regressions: presentation, loop-result, stop-asked, errors, switch first and again, resume-choice x3, review-window and review-discussion, all exit 0;
- the real profile was untouched by every run since the cleanup.

Simulated: every provider answer and the model list (the presentation adapter's fixed list, labelled SIMULATED in its source). Not run: Claude's live model discovery (it starts Claude Code and authenticates; earlier constraints forbid live probes here); Cursor's list (the account is closed). Both are items for Niclas's manual trial.
<!-- SECTION:NOTES:END -->
