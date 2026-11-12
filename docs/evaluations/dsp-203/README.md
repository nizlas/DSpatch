# DSP-203: delegating a walk mandates its exact changed lines, with remaining lines as the default

Niclas found in 0.1.23 that delegating a walk mandated far more than the walk covers. A walk over lines 151–159 of a new 417-line file delegated all 417 lines.

## Root cause (from the code at v0.1.23)

`walkScope` in `app/src/renderer/ReviewView.tsx` built the mandate from `coverage.hunks`. It took every hunk that a step of the walk planned, `plannedBy`, and turned each whole hunk into line ranges with `pairRanges(hunkLocations(hunk))`. A new file is one hunk, so any walk in it delegated the whole file.

The host was not where it went wrong:
- `readReviewAnswer` already keeps only lines inside the mandate's ranges, and only changed lines.
- The prompt names exactly the mandate's ranges.
- The report counts its denominator from them.

The wide mandate came from the window and was carried faithfully through every later step.

## What changed

**The mandate is the walk's exact lines.** `walkChangedLines(walk, files)` in `app/src/shared/review-model.ts` takes the union of every place's `markedChangedLines`. Those are the lines its *Accept* decides about (DSP-201) and that its marking draws (DSP-202).
- It reads them over `diffSkeletonRows`: the hunks' rows with kinds and line numbers but no text. Which rows a reference covers depends on nothing else.
- Overlapping places count once.
- The other walks' places, context places and references are not among them.
- Removed lines come only as `referenceRows` pairs them with a place, never every removal of a hunk.
- A place in a file the diff does not change covers nothing.

**Two choices before anything starts.** They appear under *Delegate this walk to the agent…* in the walk's Review section, each with its count:
- **Review remaining lines in this walk (N of M changed lines)** is the default. `undecidedLines` keeps the lines on which nothing holds: no decision of the person's (accepted or exempted) and no delegated assessment the person accepted. An assessment still awaiting the person counts nothing.
- **Review all lines in this walk (M changed lines)** is a complementary review that changes no decision.

When no line remains, the default is disabled and nothing is selected, so the agent picker does not appear until *all lines* is chosen. No empty job can start.

**The stored mandate.**
- The scope is computed when the job starts and saved with it, with `basis: 'remaining' | 'all'` on `DelegationScope`.
- The host's `scopeFrom` refuses a malformed basis, and `jobFrom` reads it back.
- The stored scope governs the instruction to the agent, `readReviewAnswer`'s clipping, the recorded `agentReviews`, the report's count and denominator, and coverage.
- A finding may point at context outside the mandate; it is kept as a finding and counts nothing.

**The person's decisions stand.**
- The pair record keeps the person's marks and the agent's assessments apart, as before. `lineStatusOf` lets a person's decision hold first, and an accepted assessment counts only where the person has no decision. This holds for a decision made while the job runs, too.
- New: in the diff window's strip the person's band stays the main mark. An agent's assessment of the same line is a thin left edge beside it: dotted while it awaits the person (`rv-pair-strip-also-awaiting`), solid once accepted (`rv-pair-strip-also-accepted`). Hovering says both.
- In the walk's Review section, a place says "The agent also assessed N of these lines acceptable, awaiting your decision; your decision stands."
- Withdrawing the acceptance of an agent's report changes no decision of the person's.

**Older jobs.** A walk delegated before this has no `basis`. Its stored whole-change ranges are kept and counted as they are. Its report says "Delegated before a walk's mandate followed its exact lines: its scope is the whole changes the walk passed, as recorded then." No narrower mandate is inferred for it.

**Governing documents.** [VISION.md section 3.4](../../VISION.md#the-decided-review-flow-niclass-decision-28-october-2026) records the decision, and [REVIEW_COVERAGE_AND_CODE_WALKS.md](../../REVIEW_COVERAGE_AND_CODE_WALKS.md) refers to it.

## Verification

**Targeted tests** (`app/tests/walk-delegation-scope.test.ts`, 8 tests, in the `review` group):
- **The 417-line case.** A walk over 151–159 mandates 9 lines, where its hunks would be 417.
- **An answer naming the whole file** records only the mandate's 9 lines, says so in the adjustments, and keeps a finding at line 12 as context that counts nothing.
- **Overlapping places.** Two places of one hunk, overlapping, give their union of 15 lines plus a third place: 18 in all.
- **Sides and removals.** A place at To on a replacement takes its replaced old lines, but not unchanged line 8 or a removal elsewhere in the file.
- **Remaining lines** leave out the person's 151–155, then an accepted assessment of 156–157, then the exempted 158–159, until none remain. An assessment awaiting the person leaves them in.
- **All lines with half decided by the person.** While the assessment awaits the person: 5 handled and 4 assessed. Once accepted: 9 handled, 5 by the person and 4 through the delegation, with the person's decision still the one on 151–155. With the acceptance withdrawn, the person's 5 lines remain.
- **Decisions while a job runs.** The mandate was fixed at 156–159. An exemption and an acceptance made during the job stand, with where they were made, when the result arrives and is accepted.
- **Older jobs and saving.** An older job keeps its 417-line scope and gets no basis. A new one keeps its basis across saving and reading back, and an unknown basis is not kept.

`review-pairs`, `review-agent-jobs`, `delegated-review-view`, `review-model` and `project-host-boundary` also pass: 139 tests with the DSP-201 and DSP-203 tests. Linux CI's tests job (run 43248650068) passed.

**The real-window trial** (`app/scripts/walk-delegation-trial.mjs`): 23 of 23 on Windows ([windows/](windows/), masked) and on Linux under Xvfb (dock job, run 43248641922). It uses a generic new 417-line file and a walk with places 151–155 and 156–159; the reviewing agent is simulated.
1. **Half the walk accepted by the person.** The person accepts the first place, 5 lines.
2. **The choices.** Delegating offers "Review remaining lines in this walk (4 of 9 changed lines)", checked, and "Review all lines in this walk (9 changed lines)".
3. **The remaining review.** Its stored mandate is exactly `target 156–159` with `basis: remaining`, and everything the agent assessed lies there. While it awaits the person, the diff window draws 151–155 as the person's and 156–159 as assessed. Once the person accepts it, 156–159 count through the delegation and 151–155 stay the person's.
4. **The all-lines review.** Delegating again offers 0 remaining, disabled, and all 9, which the person chooses. The stored mandate is `151–159` with `basis: all`.
5. **Both reviews together.** 151–155 are still the person's, each with a dotted agent edge (awaiting). The hover reads "Reviewed by you …; in walk step W1.1; also assessed acceptable by …, awaiting your decision". The file stays at 2%, "9 of 417 changed lines handled", with nothing counted twice. The walk says the person's decision stands.

**Screenshots** in [windows/](windows/):
- `delegate-remaining-4.png`: the two choices with their counts;
- `delegate-all-9.png`: the second delegation, with nothing remaining;
- `02-diff-person-and-agent-together.png`: the person's blue band on 151–155 with the dotted violet edge, and the violet band on 156–159;
- `03-walk-person-and-agent.png`.

The same trials ran in the same Linux run: Accept scope 32/32, walk marking 37/37, preferences and About 20/20, dock 54/54.

## Not done or not established

- **The agent was simulated** (the presentation adapter). What the trial shows is the mandate and the bookkeeping, not a review's quality.
- **The diff window's own *Delegate file…* and line delegation are unchanged.** Their mandate is what the person selects.
- **The agent edge is thin** (2 px). Whether it reads well enough on Niclas's screen is his judgement.
