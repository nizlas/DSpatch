---
id: DSP-160
title: Default to the larger loop and remove confusing duplicates
status: In Progress
assignee: []
created_date: '2026-11-01'
labels: [loop]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make DSpatch development loop (runnable subset) the default when no loop was explicitly chosen, keep explicit choices and Simple chat loop as an option, and tell an earlier automatic default from a real choice where possible. Identify counterparts by loop identity and origin, not by display name, so that a previously chosen external declaration and the same loop bundled with the installation do not appear as confusing duplicates. External files and own modified loops are never deleted; a real difference is shown. Older runs' graph versions stay readable.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus: started 1 November 2026 as part of the pass towards the first non-prerelease.
<!-- SECTION:NOTES:END -->
