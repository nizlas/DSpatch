---
id: DSP-186
title: >-
  Reviews as independent instances with their own identity: new, close,
  reopen and delete, several on one codebase
status: Review
assignee: []
created_date: '2026-11-09 13:00'
updated_date: '2026-11-09 13:00'
labels:
  - review
dependencies:
  - DSP-150
  - DSP-152
priority: high
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's evaluation of 0.1.11, 9 November 2026 (point 6). Observed: after closing an old review and starting a new one on the same codebase, an old code walk could be opened at once in the new one.

Cause (investigated 9 November 2026): a review has no identity of its own. Its key is the repository plus the two commits (`pairKeyOf`, app/src/host/review-pairs.ts), and End review only sets `endedAt`; a new review of the same pair is the same record, with the same generated walks (`generated/<pairKey>/`), discussion (`<pairKey>.discussion.json`, which also gathers every earlier discussion over the same pair) and status. There is no delete, and job results are written back by the pair key.

Decided behaviour (Niclas, 9 November 2026; replaces VISION 3.4's "Ongoing reviews … choosing the same two commits opens it again"):
- Every review has its own persistent identity; the codebase path is not enough.
- A new review starts without earlier reviews' walks, discussions or review status and uses the current generation settings.
- Closing keeps the review for reopening; reopening restores exactly that review's data.
- Deleting removes the review and its own walks, explanations, discussions and status, and affects neither other reviews nor the source code.
- Several reviews of one codebase can be active and used independently.
- Late generation answers never recreate a deleted review or land in another.
- A review records its material and comparison base and the relevant generation settings, shows when the material has become stale, and never quietly reuses old results in a new review.
- Existing data is migrated carefully with a way back, tried on copies or synthetic data, never on Niclas's real reviews.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reviews have ids; new review is empty; close/reopen/delete behave as decided; two reviews of one pair are independent, also after a restart
- [x] #2 Late job results for a deleted or other review are dropped and never recreate files
- [x] #3 Existing pair records open as reviews without data loss, with a backup taken before the first change; tested on synthetic data
- [x] #4 Material, base and generation settings recorded; stale settings shown; nothing reused silently
- [x] #5 Tests and a Linux window trial with isolated data pass, limits stated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementer, 9 November 2026 (uncommitted, main checkout; DSP-184 worked in parallel on its own files).

**Identity and record.** A review id is either a legacy pair key (24 hex, `pairKeyOf`, for records written before ids: they keep their file names) or `r-` + 24 random hex for every review started since (`newReviewId`, `isReviewId`/`isLegacyReviewId` in `shared/review-pair.ts`). `PairRecord` is version 2 in memory and on every write: `id`, `createdAt`, `startedWith.instructionVersion` (the instruction version current at start) and `generation` (provider, model, profile, instruction version and time of the latest walk preparation, set when a walks job starts; derived from the jobs for a v1 record). `adoptPairRecord` reads version 1 and 2. `OpenPair.key` is the review id, so every window, job, event and IPC call that already carried `key` now names the review.

**Per-review artefacts**, all under the id: `reviews/pairs/<id>.json`, `generated/<id>/`, `discussion/<id>.review.json`, `<id>.discussion.json`, `<id>.explanations.json` (DSP-184's store), `discussion-cwd/<id>/`, `context/<id>.json`, the walk-window records of the review's own definitions, the review windows (`panels`, `lastFollows`, diff-window reuse in review-windows.ts) and job write-back. `reviewOfDefinition` maps a definition under `generated/<id>/` or `discussion/<id>.review.json` to its review; `walksFor`, `adoptChecks` and `stepOf` refuse another review's walks, so neither the review host's recent.json nor another window can offer them. `earlierDiscussion` gathers pair-wide history only for a legacy id, never `r-` discussions; a new review's discussion starts with its own explanations only. A walk window joins the review main names (the window's `pairKey`), else the review its definition belongs to, else the legacy pair-key review of a walk opened from a file.

**Lifecycle.** `reviewPair.open` with `{ review }` reopens exactly that review (a closed one becomes open); with a pair it always starts a new, empty review written at once. The way into review lists every review (Open and Closed sections: repository, commits, started, progress, a note when walks were prepared with earlier settings) with Close review / Reopen and Delete… (inline confirmation). New contract method `reviewPair.delete` (the host contract digest changes) and bridge `delete(review)`; `end(review)` now takes the id. Delete: main closes the review's windows and panel first (each saving its view), the host removes the record (tombstone from then on), stops and fences the review's live jobs (`forgetReview`), lets its discussion go, removes `reviewArtefacts(...)` and the review host's recent entries for its definitions. Nothing outside `userData/reviews`, nothing of another review.

**Late results.** `ReviewAgentJobs.accepts(live)` (review not deleted, open, record file present for an `r-` id, job still running in it) is checked before the walk definition, the checks file, the context record and the delegated-review write; `setJob` writes nothing for a deleted review or a job its record does not hold; `ReviewPairs.write` refuses a tombstoned id and an `r-` id whose record is gone.

**Migration.** Before the first write in a user-data dir that holds a version 1 record, `reviews/pairs/` (records and recent.json) is copied once to `reviews/backup-<time>-pre-review-ids/`; an existing backup folder means never again; a failed copy refuses the write. A record that is not valid JSON is moved to `<id>.json.corrupt-<time>` instead of being overwritten.

**Staleness.** Shown, never acted on: the diff window says when the walks were prepared with an older instruction version or another profile than the one now chosen; the list marks such reviews. The walk window (ReviewView.tsx, DSP-184's file) does not show it yet.

**Tests** (synthetic data): new `tests/review-instances.test.ts` (10 tests, review group); updated tests that pinned the replaced one-record-per-pair rule: `review-pairs.test.ts` (openApp reopens by id; restart and position tests reopen by id; "ends a review … opening it again resumes it" became "closes … reopening it by its id resumes it"; `storedRecord(id, pair)`), `review-pair-discussion.test.ts` (legacy key gathers, an `r-` review does not), `review-context.test.ts` and `copilot-review-questions.test.ts` (`holdForDiscussion(key, pair, holder)`, discussion key = review id).

Remaining: Linux window trial with isolated data not run by the implementer (AC #5); walk-window staleness notice; `ReviewDiscussions.forget(key)` is reached through its private map until DSP-184 adds it; `reviews/revisions/<id>` snapshots are left to the existing sweep at start.
**Review fixes, 9 November 2026 (implementer).** Deleting a review no longer lets a late answer or step explanation recreate its discussion or explanations file: both services are sealed on dispose (see DSP-184's note; tests in `review-discussion-service.test.ts`). `forgetDiscussion` in `project-host.ts` calls the typed `ReviewDiscussions.forget`. Deleting a review recorded before review ids now records the deletion in `reviews/deleted-legacy-reviews.json` (`recordLegacyDeletion`, `deletedLegacyReviews`, `ReviewPairs.legacyDeletedAt`; the deletion is refused if it cannot be recorded); the pre-pair per-walk discussions only inferred to be its own are not deleted, and `earlierDiscussion` no longer gathers anything from them dated up to the deletion into a later legacy review of the pair, across restarts (test in `review-instances.test.ts`).

Released in 0.1.12 (DSP-187), 9 November 2026; verification there. In Review for Niclas's assessment in the app.
<!-- SECTION:NOTES:END -->
