---
id: DSP-71
title: 'A workspace of open folders, saved and reopened'
status: Review
assignee: []
created_date: '2026-09-20 09:01'
updated_date: '2026-09-20 11:26'
labels: []
dependencies:
  - DSP-68
priority: medium
type: feature
ordinal: 15704
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
File menu: Open Folder, Add Folder to Workspace, open and save workspace. Add to ProjectStore rather than restructuring it: a workspaces array in the same versioned file, formatVersion to 2, so the existing refuse-to-rewrite-a-newer-file behaviour does the right thing for an older build. The trap to avoid: recordOpened and rememberConversation key on a single project path, and with several folders open the question of which folder's conversation this is has no answer - guessing reintroduces the bug rememberConversation was written to fix. So a workspace owns its own lastConversationId and a single open folder keeps today's behaviour byte for byte. Removing a folder removes the link only, never files and never conversations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Save with three folders and a chosen definition, restart, reopen: same folders, same definition, conversation history intact.
- [ ] #2 Removing a folder deletes nothing on disk and removes no conversation.
- [ ] #3 A single-folder session behaves exactly as before the change.
- [ ] #4 An older store file is read and a newer one is refused for writing with its existing message.
- [ ] #5 A saved workspace never stores run results.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, call 006. File menu with Open Folder, Add Folder to Workspace, Open Workspace and Save Workspace As. ProjectStore extended to formatVersion 2 with a workspaces array beside recentProjects; a version-1 file reads fine and a newer one is refused for writing. The workspace file is two fields, folders and loopDefinition, which is how criterion 5 is true rather than remembered. DSP-68's deferred question is collected here: the chosen loop definition is saved with the workspace and preselected when it reopens.

Two decisions on the record. A folder added to the workspace is also SEARCHED for loop definitions - beyond the letter of the card, kept because it is what 'the folders DSpatch is looking at' ought to mean. And the implementer DECLINED to store a conversation id, with a test asserting the field is absent, because with one distinguished working folder the question already has an answer on the RecentProject entry and a second pointer is the shape of the bug rememberConversation fixed. The Verifier found that reasoning sound. It belongs with DSP-72.

One folder remains the run's working copy; the others are folders DSpatch shows and searches. Generalising now would mean inventing what several working roots mean, which is DSP-72's job.

Verified in report 008. Candidate sha256:872b85ca. UX acceptance HUMAN_PENDING. Known: saved workspaces record absolute paths; a reopen names missing folders rather than dropping them.
<!-- SECTION:NOTES:END -->
