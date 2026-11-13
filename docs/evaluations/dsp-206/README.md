# DSP-206: syntax colours, the folded agent report and the Discussion field

Niclas asked for three improvements of the code and review views on 13 November 2026, with no release; he assesses the result first. Each change below was checked in DSpatch's real windows by [`app/scripts/view-trial.mjs`](../../../app/scripts/view-trial.mjs):
- on Linux under Xvfb in linux-verify's `dock` job, run 43459863352 (62 of 62 checks);
- on Windows, locally (62 of 62).

The provider in the trial is SIMULATED, so its walks and agent reviews are bookkeeping, not a model's reading.

The screenshots in [linux-xvfb/](linux-xvfb/) are from the Linux run.

## 1. Syntax colours in the walk panes and the diff view

**Before.** The review surface had its own small lexer (`highlightLines` in `shared/review-model.ts`).
- It knew only TypeScript and JavaScript, by file extension, and only comments, strings, numbers and keywords.
- A C or C++ file, or any other language, was drawn in one text colour.

**Now.** [`app/src/renderer/syntax.ts`](../../../app/src/renderer/syntax.ts) uses [highlight.js](https://highlightjs.org/) 11.12.0 (BSD-3-Clause, no dependencies).

What it colours:
- **Languages:** its bundle of common languages, plus CMake and Dockerfile. That covers C, C++, C#, Java, JavaScript, TypeScript, Python, Go, Rust, Kotlin, Swift, Ruby, PHP, shell, SQL, YAML, JSON, XML/HTML, CSS, Markdown and Makefiles, among others.
- **Choosing the language:** the language is chosen from the file name, never guessed. `.h` is read as C++.
- **Plain text:** an unknown language, and a file over 1 MB, are shown plain.

How each revision is coloured:
- **The whole file of its own side.** highlight.js runs over the whole file of each revision. The result is read back into tokens per line, and a token that spans lines is split at each line break. A visible place that starts inside a block comment is therefore coloured as the comment it is in, and base and target are never mixed.
- **Exact text.** Each line's tokens join to exactly the line; otherwise the file is shown plain.
- **Worked out once.** A file's tokens are computed once while its lines stay the same. Scrolling, panning and switching panes do not compute them again.
- **Where it applies.** The walk panes and the diff view use the same tokens.

What is coloured, in one theme for the dark look:

| Kind | Colour |
| --- | --- |
| Comments | blue-grey, italic |
| Strings | green |
| Keywords | violet |
| Types and class names | yellow |
| Function names, declared or called | blue |
| Numbers and literals | orange |
| Preprocessor lines | cyan |

Operators, variables and parameters keep the plain text colour.

- **Readable on every background.** Each colour has a contrast of at least 4.5:1 on the darker diff backgrounds (plain, panel, weak red and green, the diff view's light blocks).
- **Lifted on strong backgrounds.** On the strong backgrounds the same hues are lifted towards white to keep that contrast: a walk place's own rows, and the diff view's whole-block and changed-word marks.
- **The arrival flash.** While an arriving place flashes gold, its tokens take the plain text colour, as all its text had before.
- **Backgrounds unchanged.** They are exactly DSP-202's.

The trial measures this from the computed colours of every token drawn, 2,772 tokens across:
- the unified diff, the whole file and side by side;
- the walk in Before → After, Before, After and the file level;
- the walk after the flash.

No token was below 4.5:1. The lowest was 4.57, a comment on the diff view's strong added-word mark.

**Where highlight.js's grammars have limits:**
- In C++, `std::string` and other qualified names are not marked as types.
- `const` and `static` are coloured as types, which is how highlight.js classifies them.
- A call is a function name only where the grammar recognises it.

| Screenshot | What it shows |
| --- | --- |
| [01-diff-unified.png](linux-xvfb/01-diff-unified.png) | The diff starts at line 22, inside the block comment, and colours it as comment. The removed `/* The old way: … */` lines are comment; the added `int legacy = compute(); // now real code` is code. The changed words keep their stronger shade. |
| [02-diff-whole-file.png](linux-xvfb/02-diff-whole-file.png) | Whole file: `#include` lines and the comment from its first line. |
| [03-diff-side-by-side.png](linux-xvfb/03-diff-side-by-side.png) | Side by side: base and target each coloured from their own file. |
| [04-walk-before-after.png](linux-xvfb/04-walk-before-after.png), [05](linux-xvfb/05-walk-before.png), [06](linux-xvfb/06-walk-after.png) | The walk in Before → After, Before and After. The place's own rows are strong; the other change in the pane (the label) is weak; context is plain. |
| [08-walk-arrival-flash.png](linux-xvfb/08-walk-arrival-flash.png) | The next place arriving: only its own rows flash gold, and their text is plain while they do. |

**Unchanged:** the flash, the marked rows and Accept still cover the same exact lines. In the trial:
- the first place marks old lines 34–35 and new line 34;
- Accept's confirmation names old lines 34–35 and new line 34;
- the record holds exactly those, and the diff draws exactly those as the person's;
- the arriving place's flash covers exactly its own marked rows (old and new line 32).

The existing Accept scope, walk marking, walk delegation and review thread trials (DSP-202's rule) pass unchanged in the same run.

## 2. The folded agent report in the diff view

**The cause.** The reports sit above the code in the file view's flex column. Their block (`.rv-agent-reviews`) has a height cap with its own scrolling (`overflow: auto`). For such a flex item the automatic minimum height is 0, so the block shrank together with the diff when the code needed room. A folded report's line was cut at the bottom, and the code started where the block was cut.

**The fix.** `flex: none` on that block, in [`review.css`](../../../app/src/renderer/review.css). The block takes its content's height, up to its existing cap of 40% of the window, and the code starts below it. Nothing is hidden and no height is fixed: a long walk title wraps, and the folded line grows with it.

The trial reproduced the fault by putting the old rule back on the element for a moment, in a diff window at its minimum width (720) at 150% zoom. The block was 28 pixels high for 152 pixels of content, the first report's line was cut mid-title, and the code began at 221 pixels ([17-reports-with-the-old-rule.png](linux-xvfb/17-reports-with-the-old-rule.png)).

With the fix, in the same window ([18-reports-folded-narrow-zoomed.png](linux-xvfb/18-reports-folded-narrow-zoomed.png)):
- **Folded:** both folded reports are whole, with the walk's long title and the state wrapping over three lines. Each can be clicked where it is drawn, and the code starts at the block's bottom.
- **Opened** by a click ([19-report-open-narrow-zoomed.png](linux-xvfb/19-report-open-narrow-zoomed.png)): it starts whole, the block scrolls within its cap, and the code is still below.
- **Through an update:** after an update of the record (the person accepting the assessment in the open report), the open report stays open and the other stays folded.

Reports start folded, as before.

## 3. The Discussion field

**The cause.** The field was a three-row textarea that could only be resized by hand. Its own rule never applied in full:
- `.rv textarea` outweighed `.rv-discussion-composer`;
- that rule's `font: inherit` reset the line height to `normal`;
- its background and padding won as well.

**Now:**
- **Sized from its content.** The field sizes itself from its content (`field-sizing: content`, as the start page's field already did).
- **One line when empty,** even when the hint would wrap.
- **Grows with every line,** typed, pasted or wrapped by the panel's width.
- **A cap,** at 40% of the window's height. Above it the field scrolls inside, so the conversation, the agent controls and the send key stay in reach.
- **Back to one line** when its text is removed or a sent question clears it.
- **Recomputed by the browser** on a new width, window height, zoom or place, without touching the draft, the caret or the selection.
- **Rule weight.** The rule now outweighs `.rv textarea`; the field's colours, border and padding are those it already had.
- **Shortcuts unchanged.** Enter sends; Shift+Enter inserts a line break.

What the trial measured:

| Situation | What was seen |
| --- | --- |
| Empty, and one typed line | One line, focused |
| Shift+Enter | One line more each time, about 20 pixels, without sending |
| A long line | Wrapped by the panel's width onto 3–4 more lines |
| Thirty pasted lines (Ctrl+V) | At the cap (40% of the window), scrolling inside, the caret's line in view |
| A narrower window | More wrapped lines and a taller field; draft, focus and selection (characters 2–7) kept |
| 150% zoom | Sized again within the cap; draft, focus and selection kept |
| Docked in the diff, in its own window, back in the walk | Draft kept and sized in each place |
| Select all and Backspace | One line |
| A question sent with Enter | One line again after the field clears |

Screenshots:
- [09-discussion-empty.png](linux-xvfb/09-discussion-empty.png): empty.
- [10-discussion-several-lines.png](linux-xvfb/10-discussion-several-lines.png): several lines.
- [11-discussion-at-its-cap.png](linux-xvfb/11-discussion-at-its-cap.png): at the cap.
- [12-discussion-narrower.png](linux-xvfb/12-discussion-narrower.png): narrower.
- [14-discussion-docked-in-diff.png](linux-xvfb/14-discussion-docked-in-diff.png): docked in the diff.
- [15-discussion-own-window.png](linux-xvfb/15-discussion-own-window.png): in its own window.
- [16-discussion-after-sending.png](linux-xvfb/16-discussion-after-sending.png): after sending.

A failed send keeps the draft, as before: the field is cleared only when the send succeeded. The trial did not make a send fail.

## Checks

- **The highlighter's unit tests:** `tests/syntax.test.ts`, in the `review` group (10 tests). They cover:
  - C and C++ kinds;
  - a place inside a block comment;
  - base and target apart;
  - twelve other languages;
  - unknown languages and the size limit;
  - exact text with escaped characters, tabs, CR and non-ASCII;
  - computing once.
- **The review model's tests** pass with the old lexer removed.
- **Type checks** pass.
- **Linux CI.** linux-verify's `dock` job runs the trial on every dispatch.

## Not established

- **Other window managers and Wayland.** The trial ran on X11 under Xvfb and on Windows.
- **The grammars' accuracy beyond the examples tried.**
- **Very large files.** Above 1 MB they are plain; below it, highlighting a large file is done once when it is read, but its time was not measured.
- **A failed send in a real window.**
- **The file head at the extreme.** At the diff window's minimum width and 150% zoom, its title row and the row of selection actions above the reports crowd each other. This was seen in the screenshots, was there before this change, and was left as it is.
