# DSP-202: a walk pane marks its own place's changed lines, and only they flash on arrival

Niclas found the following in the walk's code panes:

- the gold arrival flash covered a place's whole reference, unchanged context included;
- unchanged rows inside the reference got a grey plate;
- the next pane showed its place only in the diff's faint colours until it became active;
- the faint green and red were barely visible.

His decision of 12 November 2026 replaces the DSP-175 rule that only the active place is marked. [VISION.md section 3.4](../../VISION.md#review-threads-recommendations-ask-from-every-text-and-the-workspace-as-read-context-niclass-decision-5-november-2026) records it under *One diff for one change in a walk step*.

## Root causes (from the code before this change)

- **The marking followed the whole reference, unchanged rows included.** `ReviewTimeline.tsx` classed rows by `inShown`, which is every row `referenceRows` gives for the place's focus. The active place's rows were drawn with `rv-old`, `rv-new` or, for unchanged rows, `rv-neutral-focus` (the grey plate). All of them got the amber edge and `rv-arrive` (the gold flash).
- **Strong colours only in the active pane.** Strong colours required `isActive`. Inactive panes drew their places' rows with `rv-*-faint` or `rv-neutral-faint`, and `.rv-pane-inactive` lowered the opacity to 0.9.
- **Faint colours too weak.** The tokens mixed 11–12% green or red into the background, which is barely distinguishable from unchanged code. The active colours (40% green and 46% red) were not of the same lightness.

## What changed

- **One definition of a place's changed rows.** `markedChangedRows(rows, focus)` in `app/src/shared/review-model.ts` takes the added and removed rows of `referenceRows` for the focus.
  - `markedChangedLines`, which *Accept*, *Exempt* and *Withdraw* use (DSP-201), is built from it.
  - So are each pane's marking, the amber edge and the arrival flash.
  - Unchanged rows are never among them. Context, *Show more*, *Whole file*, scrolling and other places are not inputs.
- **Removed rows, symmetric with added ones.** A place's changed rows include the old lines that a replacement it lies on put the new ones in place of, exactly as `referenceRows` pairs them, and lines removed strictly inside it.
  - In case A, a place at To on the new if line therefore marks, flashes and accepts both replaced old if lines.
  - Other removals of the same hunk are not the place's.
  - DSP-201 had taken only the place's own side; this corrects it.
- **Every pane marks its own places.** `TimelinePane` draws the changed rows of every place the pane shows as `rv-old` or `rv-new`, active or not.
  - Other changed rows are drawn `rv-old-faint` or `rv-new-faint`, and unchanged rows get no class, so they keep the code view's background.
  - Only the arriving place's changed rows carry `rv-focus-active` (the amber edge) and `rv-arrive` (the gold flash). For a stop that shows a From place and a To place together, the changed rows of both carry them.
  - The flash starts only when the pane becomes active for a place, as before. A pane that is merely drawn, and a re-render, do not start it.
- **Colours** (`review.css`):
  - own rows: red 50% and green 40%, of about the same lightness;
  - other changed rows: red 24% and green 20%;
  - the same in active and inactive panes, with the inactive opacity removed;
  - token colours lifted on own rows for readability.

  The diff window (Gerrit view) uses its own `rv-pair-*` classes and is not affected. The walk window's opened-location pane uses the same tokens and so has the stronger colours too; its rows are otherwise unchanged.
- **Unchanged:** navigation, panning, Shift + drag and scrolling. No automatic scrolling was added.

The colours say which lines belong to a place, not that they are reviewed. Showing or navigating decides nothing and counts nothing.

## Verification

- **Targeted tests** (`app/tests/walk-decision-scope.test.ts`, 8 tests): cases A–D at the model level, and DSP-201's tests updated to the corrected removed-line rule.
  - A: both replaced if lines and the new one; the block after is context. Accept decides about the same three rows.
  - D: the removal and addition outside the place are not its rows.
  - B: a function inside a larger added block is its place's 3 rows.
  - C: a second place in the same hunk keeps its own line.

  `review-model`, `review-pairs` and `walk-panes` also pass: 106 tests in all.
- **The walk marking trial** (`app/scripts/walk-marking-trial.mjs`): Linux under Xvfb in CI, run 43244158263, 37 of 37, evidence in [linux-xvfb/](linux-xvfb/); also 37 of 37 on Windows. It checks the drawn rows and their computed colours:
  - **A.** Both replaced if lines are light red and the new line light green. The unchanged block in the reference has the same background as unchanged code outside it. The amber edge is on base 2, base 3 and target 2 only.
  - **D.** The removed note and the added constant outside the place are a weaker red and green.
  - **B.** The next pane is drawn while the first place is active, and its function (lines 6–8) is already light green. The lines added around it are a weaker green.
  - **The flash.** Caught 150 ms after arriving, it covers only `worker.js` 6–8 and is gold. After it, the rows settle into light green and the previous pane keeps its light red and green. Wrapping lines and back starts no flash.
  - **C.** The two places of one hunk are in separate panes. Each marks its own lines and shows the other's weaker. Arriving at the second place flashes its one line only.
  - **Whole file** changes neither the marking nor the place's scope.
  - **Navigating** decided nothing: no marks, and none in the diff window.
  - **Accept at the second place** reviews exactly `worker.js` line 10 in the diff window.
  - **Colours as drawn** ([linux-xvfb/colours.json](linux-xvfb/colours.json)), as relative luminance, with plain code at 0.006:

    | | Own rows | Other changed rows |
    | --- | --- | --- |
    | Green | 0.063 | 0.026 |
    | Red | 0.059 | 0.023 |
    | Text contrast | 7.6 and 7.9 : 1 | 11.4 and 11.7 : 1 |

    Judged by eye in the screenshots too: the weaker colours are clearly seen, and the light red and green read as equally strong.
- **The Accept scope trial** (DSP-201) still passes: 32 of 32 on Windows and on Linux under Xvfb. In the same Linux run, the preference and About trial passes 20 of 20.
- **Screenshots** in [linux-xvfb/](linux-xvfb/):
  - `01-first-place-and-next-pane.png`: the current and the coming pane together;
  - `02-arrival-flash-in-progress.png`: the flash while it lasts;
  - `03-settled-at-the-next-place.png`;
  - `04-whole-file.png`;
  - `00-diff-window-before.png` and `05-diff-window-after-accept.png`: the diff window.

## Not done or not established

- **The thread trial** (`scripts/thread-trial.mjs`) checks the old rule that inactive panes carry no strong colour. Its expectations were changed to the new rule, but it was not run.
- **The colour judgement** rests on the screenshots and the computed values on one display path (Chromium under Xvfb and on Windows). Niclas's own reading on his screen is still to come.
