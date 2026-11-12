# DSP-201: a walk's Accept decides about exactly its marking

Niclas found in 0.1.22 that *Accept* in a walk step decided about far more than the step marked. In his example, a new file of 417 added lines had a step marking lines 151–159, but *Accept* was offered for lines 1–417 and recorded over all of them.

## Root cause (established from the code at v0.1.22)

- `HunkDecisions` in `app/src/renderer/ReviewView.tsx` took the place's focus, found the hunks its rows overlap, and offered one decision per hunk. `HunkDecision` saved it as `{ kind: 'hunk', hunkId }`, so the step's line range was lost at the button.
- Over a revision pair, `decide` turned that hunk into `hunkRanges(hunk)`: every changed line of the hunk, removed and added. It wrote those lines into the pair record that the diff window shares.
- `currentHunkDecisions` and `computeCoverage` in `app/src/shared/review-model.ts` then counted the decision as covering the whole hunk.
- A new file is a single hunk. Any place in it therefore accepted the whole file: 417 lines instead of 9.

The pair record itself already decided line by line (DSP-150). The scope was lost before the walk wrote to it.

## What changed

**One scope for the marking and the decision.** `markedChangedLines(rows, focus, ownSide)` in `review-model.ts` reads the place's changed lines from `referenceRows`, the same rows the marking is drawn from.
- Unchanged lines are never counted.
- Expanding context, *Whole file* or scrolling cannot widen the scope, because none of them is an input.
- A walk place marks only its own side (DSP-175), so a place at To decides about its new lines and a place at From about its old lines.
- A target range therefore never takes the removed lines of its hunk with it.
- A location opened outside the walk marks both sides of a replaced line, and decides about both.

**The Review section decides per place.** `PlaceDecision` in `ReviewView.tsx` shows one block per place, or one per place of a merged stop, never merged with another place.
- Each block has "Marked here: new lines 151–159 in big.js (9 changed lines)" and its status: accepted, exempted, partly decided with counts, or no decision.
- The buttons are "Accept new lines 151–159 in big.js…", "Exempt …" and "Withdraw the decision on …".
- The confirmation reads "Applies to new lines 151–159 in big.js, in the reviewed version (…)".
- *Mark this step walked through* is unchanged: a progress mark that approves no code.

**The decision model.**
- `DecisionScope` gains an exact `{ kind: 'lines', path, ranges }`.
- `ReviewDecision` and the pair record's `PairMark` gain an optional `origin`:
  - `walk` with step and place;
  - `opened`;
  - `diff`;
  - `kept` with the id of the earlier decision.
- `isDecisionScope` and `isDecisionOrigin` validate both. `checkStateForSave` refuses a malformed scope or origin.
- The host's mark request refuses a malformed origin without writing anything.
- A stored origin the current version cannot read is left out, and the mark itself still holds.
- The diff window sends `origin: diff`. A mark's hover text names the walk step it was made in.

**Coverage is per line.**
- `currentLineDecisions` gives the decision that holds for each changed line: the latest one, with withdrawals applied. Overlapping decisions therefore count a line once.
- `computeCoverage` counts accepted and exempted lines per hunk. A hunk decided in part shows "9 of 417 accepted, 408 without a decision".
- Over a pair, `lineDecisionsFromPair` and `pairHolds` in `review-pair-walk.ts` read the pair record line by line by the existing rule (DSP-193). An accepted delegated assessment still counts, attributed to its agent.

**Withdraw** clears exactly the place's lines. Decisions on other lines, including the diff window's, are untouched. The history keeps every entry.

The decision is recorded in [VISION.md section 3.4](../../VISION.md#the-decided-review-flow-niclass-decision-28-october-2026) as Niclas's decision of 12 November 2026.

## Older decisions

Neither record can tell what an older whole-change decision was meant for:
- A 0.1.22 walk's *Accept* over a pair wrote marks over every changed line of the hunk, with no origin.
- The diff window's *Mark file* and line selections write marks of the same shape.
- A walk without a pair saved `{ kind: 'hunk' }`.

The intended scope therefore cannot be established, and the handling is as follows:

- **Kept and counted as recorded.** Coverage figures from before the fix do not change. Where an older walk *Accept* covered a whole hunk, those figures overstate what the person meant to accept, by however many lines the hunk had beyond the marking. Nothing is narrowed or rewritten.
- **Flagged in the walk.** A decision with no origin, or a `hunk` or `file` scope, that holds on a place's lines and reaches beyond them is flagged under the place. For example: "Accepted by you earlier over new lines 1–417 in big.js, 408 lines beyond the marking here. It was recorded before a walk's Accept followed its marking, so whether it was meant for all of those lines is not known."
- **Two choices for the person.**
  - *Keep it as recorded* writes the same outcome over the lines it still holds on, with origin `kept`.
  - *Withdraw it* clears exactly those lines, after which the place can decide about its own lines.

  Both act only on lines where that decision still holds, so a later decision over part of it is untouched.
- **No exact range is made up** from the walk that happens to be shown.
- **Diff window decisions after this fix** carry `origin: diff` and are not flagged. The uncertainty is limited to decisions made before it.

## Verification

### Targeted tests (`app/tests/walk-decision-scope.test.ts`, 7 tests, in the `review` group)

- **The 417-line regression.** Marking 151–159 gives 9 accepted lines and 408 remaining (2.2%). Lines 1–150 and 160–417 hold no decision. The result is the same after saving and reading back, in the walk record and in the pair record; reading the pair record back again stands in for a restart. Withdrawing affects only those lines, and a diff-window decision over 300–310 stays.
- **Context and expansion.** Unchanged lines inside a marking are not counted. A marking over unchanged code decides about nothing.
- **Places in one hunk.** Two places in one hunk give 14 lines, and withdrawing one leaves the other. Overlapping places give 15 lines, not 20.
- **Removed and mixed changes.** A place at To leaves the replaced old lines alone, and a place at From decides about exactly its own old line. An opened location covers both sides of a replaced line. A pure deletion is covered only by a span around it. A mixed hunk counts 2 accepted, 1 exempted and 3 remaining.
- **Older decisions.** A whole-hunk decision is kept (417), flagged as uncertain with 408 lines beyond, and can be kept or withdrawn. A pair mark with no origin is uncertain, and one with `origin: diff` is not. A later partial decision leaves the earlier one holding only on the rest.
- **Validation** of scope and origin.

### Other test changes

- `review-pairs.test.ts`: the host keeps the origin across a restart and refuses a malformed origin without writing.
- The bridge tests now read line by line.
- `review-model.test.ts`, `review-host.test.ts`, `review-service.test.ts` and `project-host-boundary.test.ts` pass unchanged.

### The `review` test group on Windows

Everything passes except `review-context.test.ts` › "reads lib as context…". That test also fails on a clean checkout of `1e4bdab`, without these changes: the test joins a path with `\` while the recorded read uses `/`. It is unrelated to this task.

### Real-window trial (`app/scripts/accept-scope-trial.mjs`)

This run is in [final/](final/), masked. It ran on Windows over an isolated profile, a generic project with a new 417-line file, and a prepared walk: step W1.1 marks 151–159 and step W1.2 marks 200–204. All 32 checks passed:

- **The marking and the offer.** The walk marks exactly rows 151–159, and the Review section offers "Accept new lines 151–159 in big.js…". With *Whole file* chosen (30 rows drawn, then 184), the marking and the offer stay the same.
- **The saved decision.** The confirmation names exactly those lines. The saved mark is `target 151–159` with `origin: walk W1.1`.
- **The diff window** draws exactly lines 151–159 of 417 as reviewed, and its hover text says "in walk step W1.1".
- **The second place** accepts its own 5 lines, so the diff window draws 14. Withdrawing it leaves the first place's 9.
- **Persistence.** The result is the same after closing and reopening the walk window, and after restarting the app and its host.
- **An earlier whole-file mark with no origin** (as 0.1.22 wrote it) is read as 417 lines. The walk flags it as uncertain, with 408 beyond. Withdrawing it returns 417 lines, and accepting the place again gives 9 of 417. The file list shows 2% and "9 of 417 changed lines handled", and the history keeps the earlier mark.

## Not established or not done

- **No negative control in a real window.** The window trial was not run against 0.1.22's code. That 0.1.22 recorded the whole hunk is established from its code (above), not observed in a window here.
- **Linux.** The trial ran on Windows only. It is not in the Linux CI job.
- **Delegating a walk** still names the whole hunks the walk covers (DSP-152). That is the agent's mandate, not an acceptance, and is unchanged.
