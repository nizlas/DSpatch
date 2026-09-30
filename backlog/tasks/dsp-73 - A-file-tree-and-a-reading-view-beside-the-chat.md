---
id: DSP-73
title: A file tree and a reading view beside the chat
status: Review
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-20 11:26'
labels: []
dependencies:
  - DSP-71
priority: medium
type: feature
ordinal: 15705
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A named collapsible root per open folder, subfolders and files opened progressively, a simple text view, adjustable sidebar width. Cost is entirely a function of never asking a question whose answer is proportional to the repository: one readdir with withFileTypes per expansion, nothing recursive ever - not for counts, not for badges, not for does-this-folder-have-children - no stat per child, a per-directory cap counted out loud rather than silently, and no filesystem watchers in this stage. A reading view is enough and the line should be held hard, because a small editor is how this story doubles. Selection is inert: clicking a file or highlighting a folder changes nothing about a run, which deserves its own criterion because it is the exact shape of the mistake INTERACTION_MODEL section 8 records - the interface quietly deciding the work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Expanding a directory reads that directory only.
- [ ] #2 A folder with many entries shows a counted cap rather than stalling.
- [ ] #3 Selecting a file during a run does not change the run's working roots.
- [ ] #4 A large or binary file is refused or truncated with a stated reason.
- [ ] #5 The chat keeps the main space.
- [ ] #6 Expansion time is measured on a real large folder rather than assumed.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, call 006. A collapsible named root per open folder beside the chat, the working one marked project, a reading view under the tree, sidebar draggable 180-560 px with the chat keeping min-width 0.

Progressive loading is held by COUNTING reads against a fake filesystem, not by observing that it felt fast: the assertion is an exact list of one listing per expansion, and the fake tree defines children two levels down and a 4000-entry node_modules, so any recursive read appends an entry and fails. The Verifier confirmed it would fail. Stronger than claimed on one point: no stat per child is guaranteed by the TreeIo interface having no stat method. In the window, 500 of 1200 entries drawn in about 110 ms with the count on screen, and nothing from the level below pulled in.

CRITERION 3 IS SHORT OF ACCEPTED, deliberately. Selecting a file not changing a run's working area was checked with a loop CHOSEN AND STANDING BY, not during a walking run - no run walks without a provider turn. The mechanism argument is strong: FolderSidebar holds selection in local state and the only bridge methods reachable inside it are two reads, so it cannot change a run's working roots by construction. The Verifier judged that carries the mechanism but not the criterion as written. Niclas to accept the mechanism argument explicitly or wait for a run with a provider turn.

Candidate sha256:872b85ca. UX acceptance HUMAN_PENDING - the reading view is narrow, about 40 characters at the default width. Known: no filesystem watcher, and an expanded directory's page is cached for the life of the window.
<!-- SECTION:NOTES:END -->
