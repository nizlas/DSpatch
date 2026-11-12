# DSP-200: the walk window's view preference save, and About DSpatch

Evidence for [DSP-200](../../../backlog/tasks/dsp-200%20-%20A-view-preference-save-in-the-walk-window-is-refused-for-key-order-and-the-window-says-the-review-is-not-saved-About-DSpatch-shows-the-app-and-host-versions.md). Recorded 12 November 2026 on Windows 11, from the working tree on top of 66c8447, with the build identity `a0bbfc5a42ddf372`. The provider is SIMULATED (the presentation adapter), so the walks are prepared by the product's own job, but no model wrote their text. Paths under the home folder are masked as `<home>`.

## What Niclas saw

This was in 0.1.22 on Linux, right after a newly generated walk had opened (Niclas's report, 12 November 2026):

> Not saved. Your latest changes exist only in this window and are saved again with the next change. Reason: Unknown preference value.

The walk carried instruction version 10 while the client was at 12, which means a host from 0.1.20 or 0.1.21 was still running. He restarted the host afterwards.

## Root cause (established in code and reproduced)

- **The only source of the text.** `Unknown preference value.` came only from `ReviewService.setPreferences`.
  - It normalised the object with `adoptPreferences`, then compared `JSON.stringify` of the result with `JSON.stringify` of what was sent.
  - JSON text follows key order, so valid fields sent in another order were refused.
- **Why the order differed.** The walk window (`ReviewView.savePreferences`) reads the stored preferences, then writes its own language and both widths over them with `{ ...rest, ...next }`.
  - Keys already stored keep their place; new keys go last.
  - `adoptPreferences` writes `language, explanationWidth, navigationWidth, explanationDetached, discussionPlace, explanationBounds`.
  - Any stored file that lacks a width, but has a field after it in that order, therefore gives a different order and is refused.
- **Which stored files have that shape.** These are files from before 0.1.10. Back then the main process saved the panel's place (`discussionPlace`) and its window (`explanationBounds`), and a person who had never dragged a divider had no widths.
  - 231fd75 (0.1.10) moved those to the client's window layout.
  - It left them in the host's file, where they are still read as a fallback.
  - A stored `navigationWidth` without `explanationWidth` does the same.
- **The refusal repeats.** A refused save writes nothing, so the file keeps its shape and every later save is refused too. "Saved again with the next change" was therefore not true.
- **Reproduced with the product's own service** on the 0.1.22 code (a scratch script against `ReviewService`):

  | Stored file | Sent order | Result |
  | --- | --- | --- |
  | `{language}` | language, explanationWidth, navigationWidth | saved |
  | language and both widths | same | saved |
  | `{language, discussionPlace}` | language, discussionPlace, explanationWidth, navigationWidth | **refused** |
  | `{language, explanationBounds}` | language, explanationBounds, explanationWidth, navigationWidth | **refused** |
  | `{language, navigationWidth}` | language, navigationWidth, explanationWidth | **refused** |

- **Reproduced in a real window** (`negative-control/`): the fix removed, the same trial run. Opening the walk wrote nothing and showed nothing. The first width dragged in the walk window was refused, and the host logged it. The picture shows the new message beside the header's "Saved", which is the review's own state.

## What is not established

- **What started the save in Niclas's run.** In 0.1.22 only three things call the save:
  - a pointer released on either column divider (a click without moving is enough);
  - the left or right arrow key on a focused divider;
  - the language choice.
- **Opening a walk alone saves nothing.** In both window trials it wrote no preferences and showed no message (`opening the walk wrote no preferences`).
- **So the trigger without interaction is not reproduced.** "Before he did anything" may have been a click or key on a divider, but that is a hypothesis.
- **The older host is not the cause.** Hosts from 0.1.15 to 0.1.22 have the same preference code (`git diff v0.1.15 v0.1.22` shows no change in `review-model.ts` or `review-service.ts`), so a 0.1.20 or 0.1.21 host refuses exactly as a 0.1.22 one does. The cause is the shape of the stored file.
- **Niclas's Linux file has not been read.** It is `~/.config/DSpatch/reviews/preferences.json`. Whether it has `discussionPlace` or `explanationBounds` without widths is the remaining check.

## The fix

- **The host checks field by field.** `refusedPreferenceFields` in `review-model.ts` compares each field, with nested keys sorted, so key order no longer matters. Unknown fields, invalid values and a missing language are still refused, and nothing is written. The refused field names go to the host log as `review host: review preferences not saved: Unknown preference value: <fields>.`
- **The window sends the canonical order.** `inPreferenceOrder` puts the fields in the host's order and drops nothing. A host from before the fix (0.1.15 to 0.1.22, still running until Restart host) then accepts the save too.
- **Other preferences are kept.** The window still reads what is stored and writes its own fields over it, so `discussionPlace` and `explanationBounds` survive.
- **The message says what failed.** A preference failure now says: "This window's language and column widths could not be saved. The review is not affected." A failed read says that the defaults are used.
  - The message no longer claims a later change saves it, and no reason is shown in the window.
  - A failed transport is logged by the main process.
  - The review's own save status ("Saved", or "Not saved … Reason") is separate and unchanged.

## About DSpatch

- **Help > About DSpatch** shows `DSpatch <app.getVersion()> (<commit>)` and `Running host: <version> (<commit>)`.
  - The app's version comes from the package (`app.getVersion()`, the same `package.json` the build identity reads).
  - The host's version is what the running host reported of itself during the connection handshake (`RemoteLink.build()`, read by the host from its own package). When no connected host has reported, it says "not known" and never shows the client's version.
  - **Copy version information** puts the same text on the clipboard.
  - The instruction version and the host contract are not shown.
- **The start window's title** is `DSpatch — <version>`. The page's own `<title>` no longer replaces it; other window titles are unchanged.
- **The host protocol is unchanged**, and no host method was added.

## Window trials (`scripts/prefs-trial.mjs`)

The trial runs real windows on an isolated profile. Its preferences start as DSpatch before 0.1.10 left them: `{language, discussionPlace: "walk", explanationBounds}`, with no widths.

| Run | Fix | Result |
| --- | --- | --- |
| `final/` | complete | 21 of 21 checks |
| `negative-control/` | host check and window ordering both removed | fails at the first width save; the window shows the new message and the host logs the refusal |
| `old-host-control/` | host check removed (a host from before the fix); window ordering kept | 21 of 21: the window's own ordering lets the old check accept the save |

The `final/` run checks the following:
- the start window's title is `DSpatch — 0.1.22`, and `app.getVersion()` is `0.1.22`;
- a newly prepared walk opens with no message and writes no preferences;
- a width dragged in the walk window shows no message and is saved as 420, with `discussionPlace` and `explanationBounds` kept;
- the host logs no refusal;
- the window, closed and opened again, has width 420 and shows no message;
- About opens, says `DSpatch 0.1.22 (66c8447c05ad)` and `Running host: 0.1.22 (66c8447c05ad)`, and offers Copy;
- Copy puts that text on the clipboard. The trial put the clipboard's earlier text back afterwards.

**How the trial's input works:** the divider is dragged with DevTools input into the page, not by the operating system. The About dialog is read through Windows UI Automation and its button pressed with the task dialog's `TDM_CLICK_BUTTON`, with no mouse or keyboard.

**On Linux,** Linux CI runs the same trial under `xvfb-run` in the `dock` job; the About part needs UI Automation and is left out there.

## Regression tests

- **`review-model.test.ts`:**
  - valid fields in another key order are taken;
  - an invalid width, a fractional width, an unknown field, bounds with an extra key, an invalid or missing language and a non-object are refused, by field name;
  - `inPreferenceOrder` drops nothing and its output passes the earlier JSON check.
- **`review-host.test.ts`:**
  - through the host, a save in the earlier merge order over a file from before 0.1.10 is taken, and the older fields are kept;
  - a later single-width save keeps the rest;
  - invalid and unknown fields are refused, with the file unchanged and the field names logged.
- **`about.test.ts`:**
  - the About text keeps the app and the host apart, and says "not known" for a host that has not reported;
  - the version and the title come from `package.json`.
