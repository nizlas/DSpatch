---
id: DSP-160
title: Default to the larger loop and remove confusing duplicates
status: Review
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
Implemented 1 November 2026; awaits independent verification and review.

- Default: `defaultChoiceFrom` prefers a saved choice, then definition id `dspatch-development-loop-runnable` (the shipped row when a project holds a copy), then the chat loop, then the first usable row. The host's own default is now read off the listing, so the highlighted row and the row a send walks are one answer.
- Automatic against explicit: the saved record has only `loopDefinitionKey`, with no marker. The defect behind the ambiguity was found and closed: `loop.prepareChatLoop` recorded the key the window sent, and since DSP-85 the chat has no chooser, so ticking Use loop saved the default as a choice. Only `loop.chooseDefinition` records now. Old records cannot be told apart: a saved chat-loop key may be automatic (likely, since re-picking the preselected row fires no change event) or a real switch back. Decision: it stays chosen, because the evidence does not show it was automatic. An empty key takes the new default. Niclas may decide otherwise; the record itself is unchanged either way.
- Counterparts (`app/src/main/loop-definition-counterparts.ts`): same definition `id`, one row from the shipped folder (`ownRoot`, new origin kind `shipped`, shown as `comes with DSpatch`) and one from elsewhere. Name is not evidence. Provably the same (declaration fields, graph, resolved roles; line endings and BOM ignored) collapses to one row: the saved file when the choice names it, otherwise the shipped row, which names the copy left out. Different or uncomparable stays as two rows, and `display.variant` says so. Only the list changes; no file or saved key is touched.
- Choice stays in the host's `dspatch-projects.json`; nothing is client-side.

Checks: `npm run test:loop` in `app/` passes apart from 4 failures that also fail on clean HEAD on Linux (two `C:` path fixtures, two role CRLF byte comparisons). Window trial on Xvfb in a networkless container, isolated data dirs, packaged layout built from HEAD plus this change: new installation, upgrade with chat key, upgrade with empty key, external identical, external different, all as above; a preview left an empty key empty.

Not verified: Windows; a real installer from `package:client`; a remote host; the closed `<select>` truncates long names, so `variant` is readable in the open list only. With a shared host data folder (DSP-161), a saved key is a path on one host, so on the other it is listed as unreadable and the default applies; the key itself is kept.
<!-- SECTION:NOTES:END -->
