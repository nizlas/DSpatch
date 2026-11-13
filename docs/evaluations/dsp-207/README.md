# DSP-207: every changed line through the walks, and the function as the walk's context

Niclas reported two things on 13 November 2026:
- an accepted walk step left an added blank line unmarked, so 100% could not be reached through the walks;
- walk panes opened a few lines around a change, with the function's name, signature and documentation hidden behind repeated "show 20 more lines".

There is no release; he assesses the result first.

Both examples were recreated in [`app/scripts/walk-reach-trial.mjs`](../../../app/scripts/walk-reach-trial.mjs), DSpatch's real windows over a generic C++ project:
- **Linux, under Xvfb:** 50 of 50 checks, in linux-verify's `dock` job (run 43468653156);
- **Windows, locally:** 50 of 50.

The provider is SIMULATED, so the trial shows scope and bookkeeping, not the quality of a walk or a review. The screenshots in [linux-xvfb/](linux-xvfb/) are from the Linux run.

## 1. The blank line and the changes no walk covers

### The cause

The walk place for the added if-block was a reference to new lines 128–130, as the preparation wrote it. A place's changed lines are the changed rows of its reference (`markedChangedRows`, DSP-201/202), so line 131, the blank line added after the block, was outside the place from the start. The line was never in the reference; it was not lost when the scope was computed, and not lost when the decision was saved. Lines that no place covers were counted in the total but could be decided only from the diff window, and the walk window had no way to reach them.

### The rule for blank lines

A changed line that holds nothing but whitespace belongs to the place whose nearest changed line with text, in the same hunk and in the diff's row order, is one of the place's own. On an equal distance, the line above wins.

- **What it covers.** The blank line after an added block, or before a removed one, is the block's. Removals and additions alike follow the rule.
- **Two places.** A blank line between two places in one hunk goes to one of them, deterministically.
- **No unchanged code crossed.** A hunk is changed rows only, so the rule never reaches across unchanged code.
- **Only blank lines move.** A changed line with text is never taken by the rule. That includes a change of indentation, which is a change with text.
- **A blank line with no owner.** One whose nearest change with text belongs to no place, or a hunk of blank lines alone, stays outside the walks. There it is listed, and decided by hand.
- **Fully visible.** A blank line that belongs to a place is drawn in the place's strong marking, counted in its line count, flashes with it, and is decided by its Accept, Exempt and Withdraw. Nothing is approved where it cannot be seen.

The rule lives in one place, `markedChangedRows` in [`shared/review-model.ts`](../../../app/src/shared/review-model.ts):
- The walk's marking, the Review section and Accept apply it to the file's text.
- Delegation and coverage apply it to the hunks alone. For that, the diff now records which changed lines are blank when it reads `git diff -U0` (`DiffHunk.blank`).
- A hunk read without that record takes no blank line.

DSP-201–203 still hold:
- **Exact lines.** Accept and new delegations cover exactly the marked lines.
- **Never more.** An overlapping hunk never approves the whole hunk or file, and unchanged context never counts.
- **Nothing decided in passing.** Navigation and preview decide nothing, and overlaps count once.
- **Old decisions stay as stored.** A decision made earlier keeps exactly the lines it stored: when a place grows by a blank line, that line waits for a decision.
- **Agent jobs and assessments.** Started agent jobs keep their stored mandate, and an agent's assessment stays beside the person's decision.

One expectation of DSP-202 changed with this rule:
- **The test.** A new function with added blank lines on both sides of it.
- **Before.** The function's place marked lines 6–8, and its blank lines 5 and 9 were drawn as other changes.
- **Now.** It marks, flashes and decides about lines 5–9.

The unit test and the walk marking trial say so (37 of 37 checks on Windows).

### What is left

The walk window's **Coverage** tab now opens with **What is left** ([07-what-is-left.png](linux-xvfb/07-what-is-left.png)).

- **A count.** It counts the changed lines that have a decision of the person's, or an accepted agent assessment, out of all of them, as a percentage rounded down.
- **In no walk.** The changes no walk place covers, from `changesOutsideWalks`: every changed line, less the union of every walk's marked lines, as runs on one side of one hunk. Each says whether it is blank lines only, and how much of it is decided.
- **In a walk, not decided yet.** The walk places with marked lines on which nothing holds yet. Each one opens its place in its walk.

The **Walks** tab says, under the walks, how many changed lines are in no walk, and links to the list.

Opening a change from the list ([08-a-blank-line-in-no-walk-opened.png](linux-xvfb/08-a-blank-line-in-no-walk-opened.png)):
- It shows the change beside its code, where an opened location is shown.
- The Review section decides about exactly its lines (`DecisionPlace.exact`), and exactly those are drawn strong.
- The same pane now draws strong exactly the rows its decision covers, for any opened location.

For that, the panel follows a location the walk window opened outside the walk (`PanelFollow.away`):
- Before this, the docked or separate Review panel followed only the walk's step, so a location opened from Coverage or the file tree showed no decision there.
- This changes the client's own window messages, not the host's contract.

Nothing is decided by being listed, nothing is rounded up, and blank lines stay in the total. Saved walks get What is left without being prepared again, because it is computed from the walk's places and the diff.

## 2. The function a place lies in

### The cause

The walk's context level ("The context") showed only:
- the unit the preparation named for a place (`place.unit`, for TypeScript found by parsing when the material was prepared);
- or the context it listed.

Otherwise it showed four lines around the change. For C++, and for any place prepared without a unit, that is a few lines. The user's W3.2 opened at a try block, with the function's head 600 lines up.

### How the default context is found

[`renderer/code-structure.ts`](../../../app/src/renderer/code-structure.ts) reads the structure from each revision's own text, with comments and strings set aside by the syntax highlighter (DSP-206). A brace or a keyword in a comment or a string never counts.

- **Brace languages** (C, C++, C#, Java, JavaScript, TypeScript, Go, Rust, Kotlin, Swift, PHP, CSS):
  - The enclosing function or method: its documentation comment, attributes and template line, its whole signature (also over several lines), its body and its closing brace.
  - The innermost control structure around the change.
  - A function the place itself begins is shown whole.
  - In a class but not in a method, the class when it is short, else the member declaration.
  - Outside functions, the declaration with the lines around it up to blank lines.
- **Python:** the `def` or `class` with its decorators and comments, its whole signature, the body by indentation, and the control structure.
- **YAML, INI and TOML, Markdown:** the section or heading the place is in.
- **No known structure:** the lines around the place up to blank lines, at most twelve on each side. These are marked as not reliable: no fold claims a function name.

**At each side.** The structure is found at both sides of the diff, from the base's text and from the target's. A function whose signature or ends changed is shown in Before, After and Before → After ([04-W3.1-before.png](linux-xvfb/04-W3.1-before.png), [05](linux-xvfb/05-W3.1-before-after.png)).

**Short and long units:**
- **Up to 30 lines,** a unit is shown whole ([02-W1.2-short-function.png](linux-xvfb/02-W1.2-short-function.png)).
- **A longer one** keeps its documentation and signature, the change with its control structure, and its end in view.
- **The parts between** fold into "show the rest of `<name>` (n lines)". A gap of up to 12 lines is shown rather than folded.
- **Examples:** [01](linux-xvfb/01-W1.1-if-block-blank-line-and-function-head.png) and [06](linux-xvfb/06-W3.2-long-function.png).

**Where the pane opens.** When the head and the change fit in the pane together, the pane opens with the head at the top; otherwise the change is centred, as before. This happens only where a pane is placed anyway: on arrival and when the level or the view changes. A remembered scroll position, the person's level, expansions and pane sizes are kept.

**Shown context decides nothing.** It never widens Accept, a delegation or the coverage. The trial checks that the place decides about exactly 128–131 at the change, context and whole-file levels. Only the place's own changed rows are strong, other changes are weak and unchanged code is plain. The arrival flash and the syntax colours are as before.

## Verification

**The trial,** on Linux and on Windows, checks:

| Case | What was seen |
| --- | --- |
| An earlier decision of 128–130, made in the diff window | Kept as stored |
| The place over 128–130 | Marks, draws strong and decides about exactly 128–131, at every level. Accept records 128–131 beside the diff's 128–130 |
| Arrival at W1.1 | The function's documentation and two-line signature are in view, the body is folded and named, and the end is drawn |
| A short function | Shown whole |
| A declaration outside functions | Shown with the lines around it |
| Two places in one hunk | The first takes the lines it replaced and the blank line between them; the second keeps its own line |
| A file in an unknown language | The lines around, claiming no function |
| A changed signature | Drawn from each side |
| The user's W3.2 | Arrival shows the head of the 470-line function, with the loop, try and if around the change, and its end |
| Delegating the first walk | Mandates its marked lines, line 131 with them, and no line outside the walk |
| What is left | Lists the whitespace change, the lone blank line ("blank lines only"), the substantive change and the new file's rest. Each was opened and decided about exactly, with exactly those rows strong |
| The undecided walk places | Each was opened and accepted |
| The end | 327 of 327 changed lines have a decision (100%), every one the person's, and the same after a restart |

**Unit tests:** `tests/walk-reach-and-context.test.ts`, 11 tests, in the `review` group. On Linux the group passed 390 of 390 (run 43468659094).

**Existing trials,** in the same Linux run:
- Accept scope: 32 checks;
- walk delegation: 23;
- review threads: 110;
- syntax colours and views: 62.

All passed. After its DSP-202 expectation above, the walk marking trial passed 37 of 37 on Windows and on Linux. That Linux run, dock run 43471913630, passed every trial of the dock job again, this one's 50 of 50 among them.

## Not established

- **The structure finder is a reader of the text, not a compiler's parser.**
  - A call that takes a lambda can look like a function header.
  - Macros that open blocks can mislead it.
  - The trial covers the shapes listed above, not every codebase.
- **Very large files** (over 1 MB) are not highlighted, so their comments and strings are not set aside when the structure is read.
- **The older coverage table** below What is left still counts by hunk ("in a walk … changes partly"), as it did; What is left is the exact count.
- **Other window managers, Wayland** and **Linux distributions other than the runner's** are not tried.
