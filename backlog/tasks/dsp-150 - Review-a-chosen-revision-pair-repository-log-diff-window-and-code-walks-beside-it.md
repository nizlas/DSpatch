---
id: DSP-150
title: >-
  Review a chosen revision pair: repository, log, diff window and code walks
  beside it
status: Review
assignee: []
created_date: '2026-10-28 20:21'
updated_date: '2026-10-29 20:56'
labels:
  - review
dependencies: []
priority: high
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's decision of 28 October 2026: a reviewer chooses a repository in the workspace and a From/To revision pair from a Git log, reviews the diff in its own window (Files changed, side-by-side and unified), and opens existing code walks in a further window that shares review state but navigates independently. Changed lines (additions and deletions, not context) can be marked as manually reviewed or explicitly exempted, and agent review counts only when a registered agent review exists. Requirements decide what counts as handled; a file whose changed lines are all handled shows a checkbox instead of a percentage. No walk generation, no provider call, no change to provider integration, steering or loop execution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Review can be started from the main chat and from the loop editor; with several Git repositories in the workspace a list of folder names is shown (each repository once, no non-Git folders), with one it goes straight to its log
- [x] #2 The log shows message, hash, author and date; two clicks in any order choose two commits and Git's ancestry decides which is From (revised 29 Oct 2026; at first the first click chose From and the second To); the direction is visible and can be explicitly reversed; the review is of exactly those revisions and never of working-copy content
- [x] #3 A diff review opens in its own window without a prepared review definition and without a provider call, starting with Files changed; a file name opens its diff in side-by-side or unified form, with the file overview within easy reach; added, deleted and renamed files and files without a text diff read clearly
- [x] #4 Code walks open from the diff review in a separate window, reuse the existing walk view, explanations and discussion, belong to the same repository and revision pair, and do not move the diff view except through an explicit Show in diff; without walks the diff review still works and says so briefly; the DSP-116 example stays available
- [x] #5 Changed lines and contiguous ranges can be marked manually reviewed or explicitly exempted and the mark withdrawn; agent review appears only from a recorded agent review; the requirement decides what is handled
- [x] #6 Files changed shows the percentage of handled changed lines (deleted lines included, context excluded) and a checkbox once all are handled per the requirement; reviewed and exempted remain distinguishable; a file with no countable lines is not done by default
- [x] #7 The diff shows status in a narrow strip beside the line numbers (blue manual, violet agent, grey dashed exempted, none unhandled) on both sides and in unified view, with status text on hover and keyboard focus; manual wins over agent in the strip, both kept in details
- [x] #8 Marks, requirements and position are owned by the host, are bound to the revision pair, count each change once, survive reopening and restart, and reach a window opened later
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
28 Oct 2026: started. Focus: mapping existing review code (DSP-126, DSP-127, DSP-129) and the governing decisions (VISION.md 3.3-3.4, REVIEW_COVERAGE_AND_CODE_WALKS.md, TASK_MANAGEMENT_AND_WORKING_MEMORY.md section 11) before planning.
28 Oct 2026, implemented and verified in the real windows (local commit, not pushed). Governing decisions: Niclas's decision of this date, now recorded as "The decided review flow" in VISION.md section 3.4; VISION.md 3.3 (review is standalone: a repository and a revision pair, no orchestration); TASK_MANAGEMENT_AND_WORKING_MEMORY.md section 11 (records bound to identified content, human and agent review kept apart); REVIEW_COVERAGE_AND_CODE_WALKS.md (statuses; the counting rule now decided). The earlier sentence "No pilot is authorised now" in VISION 3.4 is superseded by that decision.

**What exists now**
- **Way in.** *Open review* in the chat and *Review changes* in the loop editor open a diff window. The host lists the Git repositories of the session's folders, each by folder name and once; a folder holding repositories names each of them, and folders without Git are left out. With one repository the window goes straight to its log.
- **Log and pair.** The log is written like a traditional `git log`: the commit line, the author with address, git's own date and the whole message indented. Each commit block is one button. The first click chose From and the second To, a swap was offered, and a From newer than To was pointed out (replaced on 29 October 2026: see the note of that date). The log offers the last pair again. Text is read with `git cat-file` at the two commits only.
- **Diff window.** *Files changed* lists status, path (rename as old → new), +/− and handled. A file opens side by side or unified, with a file sidebar, previous and next, and long unchanged runs folded. Binary files, pure renames and mode changes say so in plain words.
- **Marks.** Changed lines are selected by their strip or number, with Shift extending; Enter or Space works on the focused strip. They can be marked reviewed or exempted, or cleared; whole-file actions cover a file at once, and a file with nothing to count is finished only by a decision about the file. The strip is blue for reviewed, violet for agent-reviewed and grey dashed for exempted, on both sides and in the unified view, with status text on hover and focus. *Files changed* shows the handled percentage, rounded down, and a checkbox once the file is done, labelled "exempted" or "partly exempted" when the person did not review all of it. A requirement selector chooses between "your review or a recorded agent review" and "your review only".
- **Walks.** *Code walks* lists the walk definitions over exactly this repository and pair: the bundled example, the recent ones and those open. *Open a walk file…* opens one from disk and refuses one over other revisions. The walk window reads and writes the same pair record: its hunk decisions are decisions over the hunk's changed lines, and its views read them back. *Show in diff* is the only thing that moves the diff view, and it opens the diff window when none is open. A step change in the walk does not move it. Without walks the diff review says "No code walks for these revisions."
- **Host and records.** `host/review-pairs.ts` owns git, repository discovery, the log, the diff (`-M`, renames and binaries), file reads and `userData/reviews/pairs/<key>.json`. That record is keyed by repository and both full hashes and holds marks as an append-only history, agent reviews, the requirement and the diff position. Changes are broadcast to every review window over the pair (host event target `review-pair`), so a window opened later reads the current record. The renderer goes through `window.dspatchReviewPair`, under the same review-window sender guard. The review discussion is untouched and stays tool-free.

**Verified, isolated userData, no provider call** (`DSPATCH_CHAT_RUN=pair-review`, two processes over a seeded kit with repositories `app` and `lib` and the folder `notes`; clicks and keys dispatched to the real elements of the real windows):
1. `first`:
   - Open review from the chat listed `app` and `lib`.
   - From and To were chosen by clicks, then swapped and swapped back.
   - *Files changed* showed seven changes at 0%, "–" for the binary file, the pure rename and the mode change, and no checkboxes.
   - In keep.ts the strip sat on exactly the five changed lines. Two added lines were marked by click and Shift-click (40%), the same marks showed in the unified view, and one was withdrawn by Enter (20%). After exempting two deletions and reviewing the rest, keep.ts was done with 3 reviewed and 2 exempted, and *Files changed* showed a checkbox.
   - The deleted file showed only base lines. The binary file was not done until "Mark file reviewed". The pure rename was explained.
   - A walk was opened through *Open a walk file…* and joined the same pair. A step change in the walk left the diff where it was. The walk showed the diff's marks as "Accepted by you", *Show in diff* took the diff to the walk's line, and a withdrawal in the walk reached the diff.
   - The diff window was closed and reopened from the chat: the log offered the last pair, and the file, layout and marks came back. A withdrawal in the still-open walk reached the newly opened diff window.
2. `again` (restart):
   - The loop editor's *Review changes* opened the review with both repositories.
   - The last pair was offered, and position, marks, the strip and the binary decision survived.
   - The `lib` pair had no walk, and the diff review said so and worked normally.

The DSP-126 and DSP-127 walk scenarios (`review-window`, `review-discussion`) were adapted to this way in: Open review leads to a diff window, and the walk opens from its *Code walks*. Their walk-window checks are unchanged, and both pass; `review-discussion` runs at its intended pace (`DSPATCH_PRESENTATION_DELTA_MS=200`, `DSPATCH_REVIEW_PRESENTATION_SEND=markers`). The second walk in `review-discussion` is now opened from P1's diff review, because a walk belongs to its repository and revision pair. Tests: new `review-pairs.test.ts` (real git), the preload channel test for the pair channels, the review group (112) and the host group pass, and the typechecks and the build are clean.

**Not established, or left for a decision**
- **Agent review.** Nothing records an agent review yet: the existing model reserves delegated agent review and refuses to save it. The violet strip and the requirement setting work on recorded data (unit-tested), but no agent review can be produced in the product today.
- **Requirement granularity.** One requirement per revision pair, defaulting to "your review or a recorded agent review". A per-file or per-range requirement was not asked for and is not built.
- **Older walk records.** Hunk decisions saved in a walk's own record before this change are kept there as history and are not imported into the pair record.
- **Walk generation.** Not specified, and not built.
- **Look and feel.** Agent-run readings only. The look, including the one added colour (blue for reviewed), is Niclas's to judge.

28 Oct 2026, diff readability (follow-up, local commit). The removed and added line colours are stronger, mixed from the palette's red and green (30% and 27% over the background), and the numbers and sign of a changed line a shade deeper. Words changed inside an edited line are marked with a stronger shade: the removed and added lines are paired as the side-by-side view pairs them, compared with diffWordsWithSpace from the existing `diff` dependency (`intralineRanges` in shared/review-pair.ts), and left unmarked when most of both lines changed. Pure additions and deletions carry the line colour only. − and + have a column of their own between the numbers and the code. The review strip keeps a dark gap and background of its own, so the blue, violet and dashed grey bands read on red and green rows. The same applies in both layouts, with wrapping text, selection and keyboard focus. Review rules, counting, record format and layout are unchanged. Verified with pair-review in the real windows, with isolated userData and pictures of a long wrapped line with a one-word change in both layouts, keep.ts with an edited line, pure additions and a deletion, marks, a selected line and strip focus. The scenario asserts which words are marked in each layout and that pure additions carry none. The fixture's renamed file gained a long line, so after.ts counts +2 −2. The scripted capture now repaints and takes a second frame, because the first could be the frame before the last change.

29 Oct 2026, change marks as Gerrit draws them (follow-up, local commit). Niclas asked for the marks to follow Gerrit's actual behaviour after the word marks proved confusing where three removed lines were replaced by one: some words of the first line were strong and the rest had only the line colour.

Reference: Gerrit v3.14.4 (commit 6d038645483357e8f72df648dcb2c4d7aa1914c9), public source read: `IntraLineLoader.compute`, `CharText`, `DiffInfoCreator` (`edit_a`/`edit_b`), `DiffContentCalculator`, `DiffPreferencesInfo` defaults, `GitFileDiffCacheImpl` (Histogram line diff), and in the web UI `gr-diff-processor`, `gr-diff-group` (`isTotal`) and `gr-diff-styles`, with `IntraLineLoaderTest`. Gerrit is Apache 2.0 and DSpatch MIT; no code was copied, the behaviour was written anew.

What Gerrit does, and what differed:
- *Replaced blocks.* Gerrit compares the removed lines and the added lines of one change as one text, character by character with the line breaks included, then tidies the result: edits up to five characters apart on one line become one span, identical ends are dropped, a span slides past a repeated run but not across a line break, a span covering a line up to its break takes the break, and if tidying broke the edits the whole block is marked. DSpatch paired removed line *n* with added line *n* and compared words; that was the cause of the confusing case. Now `intralineBlock` in shared/review-pair.ts does Gerrit's comparison over the hunk.
- *Two strengths.* Lines of a compared block keep the light colour with the changed characters strong; a line may have no strong part. A block with only removed or only added lines (`isTotal`) is strong throughout, as is a block Gerrit could not compare. DSpatch gave pure additions and deletions the light colour only; they are now strong throughout (`rv-pair-whole`, the existing strong tone).
- *No threshold.* Gerrit never drops marks for a line that changed too much; DSpatch dropped them above 60 %. A rewritten line is now strong throughout.
- *Characters, not words.* Gerrit marks characters: `3` → `30` marks the added `0`, and `line` → `range` marks `lin`/`rang` with the common `e` light.
- *Whitespace.* Gerrit's default `ignoreWhitespace` is `IGNORE_NONE`; whitespace counts like any character, so an indentation change marks the removed spaces. DSpatch already counted whitespace (unchanged).
- *Wrapping.* The comparison works on the file's lines; how a line wraps on screen plays no part (as before; now asserted with the window's code column narrowed).
- *Both layouts.* Gerrit's side-by-side pairs a block's lines by position and its unified view shows the removed lines then the added, with the same marks. DSpatch already did both; the marks now come from one map per file (`changeMarksOf`, keyed by side and line from the hunks), read by both layouts.

Remaining differences, known:
- Gerrit uses JGit's Myers for characters; DSpatch uses the `diff` package's. Minimal comparisons are not unique, so where two are equally short the marks can sit a few characters apart. One case seen (`IntraLineLoaderTest.preferInsertAtLineBreak1`) is matched by joining two additions or removals that a common run separates; all nine cases with expected results in that test now give Gerrit's ranges (two more are recorded there as known failures of Gerrit's own), but other ties may still differ. Java is not installed here, so JGit itself was not run.
- Gerrit's 5 s timeout is replaced by a fixed size (`INTRALINE_LIMITS`: 20 000 characters, 2 000 edits), past which the block is strong throughout, so a change always looks the same.
- Gerrit joins two line changes separated only by a blank or brace line, or one starting a block (`combineLineEdits`); DSpatch does not, because that would change which lines count as changed, a review rule this follow-up must not change. DSpatch's lines come from `git diff -U0` with Git's default algorithm (or the user's `diff.algorithm`), Gerrit's from Histogram; in the check repository both gave the same hunks.
- Gerrit's default whitespace-error marking and tab markers (`showWhitespaceErrors`, `showTabs`) are not adopted: they are not change marks.

Verified (isolated userData, SIMULATED provider for the one explanation, no live calls, real profile untouched): `tests/review-pairs.test.ts` 30/30, with Gerrit's test cases as ranges, the three-for-one block, per-hunk marks and the size limit; `npm run typecheck`; build. New scenario `diff-marks` over `tests/support/marks-fixture.ts` (`seed-pair-kit --fixture marks`) in the real window: each file in both layouts with identical marks; `3` → `30`, the three-for-one block, a rewritten line, an indentation change, a removed and an added function strong throughout, an import line replaced by five with `Any, Dict, ` strong, and a long wrapped prose line; a mouse selection over marked code explained with the highlight shown and the marks unchanged while the panel narrowed the column; a line selected and marked as reviewed with the strip beside the marks. `pair-review` (both phases) passes with its expectations updated to character marks. Not established: Niclas's judgement of the look and contrast in use, and JGit's own output for ties.

29 Oct 2026, after Niclas's first real trial (with DSP-152): *Files changed* is now the diff window's whole-width overview with who handled each file and open findings beside the check, a file's diff goes back to it with ↑ at the list's position, *Code walks* opens the review's one walk window directly (dimmed with "No code walks yet" while there is none), the walk-file chooser is gone from the flow, and the way into review lists ongoing reviews to resume or end. Recorded in VISION.md section 3.4 (clarifications) and in DSP-152's notes, with the verification (scenario `review-flow`, both phases; `pair-review` adapted and passing).

### Direction of the pair and the diff's column widths (29 Oct 2026)

Niclas's decision of this date, after his trial: he clicked the newest commit first, it became From, and the diff and its walks described added functions as removed. Recorded in VISION.md section 3.4 ("Choosing the revision pair", "Diff columns"); it replaces the first click as From. The original plan is unchanged. His earlier MiniDAWLab pair b87f042 → 8c7d41b was such a backwards pair (8c7d41b is the ancestor).

**What changed**
- Two clicks in any order choose two commits; a first click shows *Chosen* without a role. The host answers `reviewPair.direction` with `git merge-base --is-ancestor` both ways: the ancestor is From. Neither an ancestor (separate branches) asks the person to choose between the two directions before *Review changes* is enabled; a shallow clone, a missing commit or a failed git read says the order could not be decided and asks the same. No dates, no log position, no merge base. *Reverse direction* swaps From and To, says "Reversed", and is never undone by itself. Every change of the chosen commits counts up, so a late answer about an earlier choice is dropped; *Review changes* pressed before the answer waits for it. `openPair`, records and keys are unchanged: a reviewed pair keeps its exact direction and a reversed pair is a review of its own.
- Diff columns: with `table-layout: fixed` the browser took the column widths from the first row, which is often a fold whose one cell spans every column; the columns then all got an equal share (an eighth each side by side), and the code a fraction of the window. Each table now has a `colgroup`: strip 14 px, sign 1.6rem, numbers `digits ch + 0.8rem` from the file's largest line number, code the rest. Wrapping was not the cause and stays on.
- Walk window (DSP-152): a row's gutter is `LineGutter` — both numbers as wide as the pane's largest number needs (`--rv-digits`), and a one-character −, + or ↳ mark with its word as tooltip and screen-reader text — sticky as one unit. It was 6rem of numbers plus a 3.4rem word column.

**Verified** (SIMULATED presentation agent where an agent appears, isolated user data, real profile and MiniDAWLab working copy untouched, no live provider):
- `review-pairs` 39/39, including a new history fixture (`tests/support/history-fixture.ts`: a descendant dated nineteen years before its parent, a branch dated last, a merge): ancestor From in both argument orders, separate branches `unrelated`, a two-deep shallow clone and a missing commit `unknown`, one commit twice refused, a reversed pair opened with its own key. `review-model` 33/33. Typecheck and build clean.
- `review-flow` phase `direction`, real clicks on `history`: the log opened with nothing chosen; the first click showed *Chosen* and no From; descendant-first and ancestor-first both gave From b836fb3 → To cba76c2; *Reverse direction* still reversed 2 s later; two branch commits asked for the direction with *Review changes* disabled, and the choice was shown; with each git answer held 4 s (`DSPATCH_PAIR_DIRECTION_DELAY_MS`, presentation mode only) the stale answer for an earlier choice never appeared and the newer choice won; *Review changes* pressed while deciding opened root → ahead; forward and reversed pairs were two ongoing reviews, and resuming the reversed one changed neither; 0 prompts.
- `review-flow` phase `columns`, Niclas's file `src/app/MidiEditorPresenter.h` at e15b426 → 9993113 in a clone, the newer commit clicked first (gave e15b426 → 9993113). Measured cell widths of the first changed row (strip, numbers, sign, code): side by side at 1280 px 14/31/26/561 per side, at 2200 px 14/31/26/1029; unified 14/31/31/26/1162 and 14/31/31/26/2097; with the explanation panel 369 per side at 1280 and both layouts at 2200, always the exact rest; ProjectIoCoordinator.cpp (four digits) numbers 37 px. Walk window panes: numbers 85 px for five-digit lines, mark 19 px. Screenshots reviewed.
- Regression: `pair-review` (both phases), `review-flow` `first` and `again` (now with the trial pair forwards), `diff-marks`, `selection-explain` (both): pass.

**Not established**
- UX acceptance of the choice, the wording and the widths: Niclas's.
- A review that is opened and left within a quarter second is not saved and so not listed as ongoing (the position save waits 250 ms); unchanged by this work.
- Linux.
<!-- SECTION:NOTES:END -->
