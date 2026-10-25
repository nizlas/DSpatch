---
id: DSP-125
title: Remove the folder help from the sidebar
status: Done
assignee: []
created_date: '2026-10-25 22:05'
updated_date: '2026-10-25 22:40'
labels: []
dependencies: []
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 25 Oct 2026: remove 'What these folders are' and its long text from the sidebar; the project tree shows folders and their controls. Keep the relevant information about working folders, agent access and rule loading in the existing documentation, checked against the code before it is moved. No new help view or replacement text panel. Actual file access and rule handling unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The sidebar shows no 'What these folders are' disclosure or its text; the tree and its controls are unchanged
- [x] #2 The information it carried that is true of the code (working directory, which folders a loop run and an ordinary chat message get, rule/skill/AGENTS.md loading, filesystem confinement) is in the existing documentation, each claim checked against the code
- [x] #3 No new help view or text panel; no change to file access or rule handling; scenarios that read the old text updated or the reading removed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (run 20261025-090000-send-anyway, base 3d79b07): remove the sidebar folder help; move its code-true content into the existing README.

Result (25 Oct 2026, run 20261025-090000-send-anyway): the sidebar disclosure 'What these folders are' and its text removed (App.tsx FolderSidebar, CSS, WorkspaceView.rootsNote and its builder, describeWorkingRootsForPerson and constants with their own tests); the tree and its controls unchanged; picture without the help in the run's logs. Moved into app/README.md as a 'Folders (the sidebar)' bullet under 'What the window shows', each claim checked against the code: the project is the working directory; all open folders and DSpatch's own working copy are searched for loop definitions (loopFolders()); a loop run hands every open folder to Cursor and measures each (unless no step may write); an ordinary chat message gets the working directory only; a folder's rules, skills and AGENTS.md are not loaded (no settingSources; SDK default all off; DSP-91 probe); no filesystem confinement by default (SDK insecure_none; DSP-1 observations). No new help view; file access and rule handling unchanged (describeWorkingRootsForAgent, describeUnobservedOutside, providerRootPathsFor, workingRootsFrom byte-identical). The stale roots scenario's note reader and seven note-only gate tests removed (DSP-123 owns that scenario). Verifier PASS, Reviewer ACCEPT.
<!-- SECTION:NOTES:END -->
