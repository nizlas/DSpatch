---
id: DSP-129
title: Bundle the DSP-116 walk as a portable example review
status: Review
assignee: []
created_date: '2026-10-26 10:11'
updated_date: '2026-10-26 10:51'
labels: []
dependencies:
  - DSP-126
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 26 Oct 2026: make the existing DSP-116 review (5e445c3 -> 73aaddc, three walks, 22 steps, corrected definition sha256 9c6119d8414cea16bd83bac9efe7cf6a0594b930aaf7c2ab4db4f12f0f741ee3, from the DSP-116 review preparation) a bundled, portable example that a second reviewer can open from the main app to assess the code view. Not the integrated demonstration's fixture (c660667 -> 0cea464). A local DSpatch clone holding the two revisions is an acceptable dependency; no new snapshot format. Out of scope: general walk generation, live probes, provider resume changes, a new integration or general UX round, copying trial records or sealed material, reading the answer key.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The definition is in the repository at a dedicated example location; its Swedish and English explanations, code references and walks are unchanged; origin and any new SHA-256 are documented
- [x] #2 An 'Open example review' action in the main app opens it through the existing review integration, without test mode or provider calls; the ordinary Open review flow and general review are unaffected
- [x] #3 The repository path resolves from the current clone; no dependency on absolute paths, old worktrees, Temp folders or test kits
- [x] #4 When the needed history is missing the app explains it plainly and never substitutes another revision pair or working-copy code
- [x] #5 The user's review state is stored apart from the bundled example, starts empty and survives close and app restart
- [x] #6 Verified from a clean clone at another path with isolated userData: the right revisions and corrected explanations, code panes, function context and the whole diff, position and note kept after restart, no provider call on open or navigation; regression tests, independent review and a rendering check
- [x] #7 No new Windows-only dependency (Linux is next)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (run 20261026-160000-example-review, base d867bd7): coordinator plan - place the definition in the repository with only repository changed to resolve to the clone root; an Open example review action through ReviewWindows.open from the app's own clone; plain explanation when history is missing; Implementer, then Verifier from a clean clone at another path, then Reviewer.

Result (run 20261026-160000-example-review, candidate 002 sha256:0ba5f154...3b18 on d867bd7): Implementer calls 1 and 4; Verifier PASS from a clean clone at another path (reports 002, 005); Reviewer REWORK (003) then ACCEPT (006).

Implemented: examples/review/dsp-116.review.json - the DSP-116 definition with only repository changed from repo to ../.. (original sha256 9c6119d8414cea16bd83bac9efe7cf6a0594b930aaf7c2ab4db4f12f0f741ee3; bundled LF e05d684f6f1d0ec201f86bf66a412cdf6795c4a2ca47e9f6f718fdbd20e54873, CRLF checkout 5290652ed25562ffe9b74d3bb1702196473ce19b6d9a2f26dfb3ad63d796ad56; LF hash pinned by a fast test) and examples/review/README.md; Open example review button beside Open review (needs an open project) and File > Open Example Review (no project needed), resolving the definition from the running app's own clone (ownRepositoryRoot) and opening it through ReviewWindows.open with remember: false, so it never becomes a project's last review. Missing history is said plainly by cause (missing folder, git not on PATH, not a git repository, git cannot read the repository, shallow clone, missing revision) with git's text behind a closed Details; never another revision pair or working-copy code.

Technically verified (Windows, presentation mode, clean clone under %TEMP% with isolated userData and no access to the original Temp material): the button opens 5e445c3 -> 73aaddc with W1/W2/W3 10/8/4 steps, all 22 steps' corrected explanations in English and Swedish, code panes with function context, all 11 files of the diff; position, step mark and note kept across a full app restart; recent.json unchanged; no provider send through open, navigation and reopen; shallow clone and git-missing explanations with Details closed; test:review 68/68, test:fast 1225/1225, review-window and review-discussion exit 0.

Not run: a click on File > Open Example Review itself (its handler exercised through the same IPC; an agent's UI Automation attempt was denied), the packaged or moved copy, Linux, an ordinary non-presentation launch. HUMAN_PENDING: the second reviewer's assessment of whether the code view is useful - not performed; agent checks do not stand in for it. Follow-ups in DSP-130 (pre-existing sideways scroll of the code pane and narrow diff column at ~1000 px; Details wrapping; fallback Details).
<!-- SECTION:NOTES:END -->
