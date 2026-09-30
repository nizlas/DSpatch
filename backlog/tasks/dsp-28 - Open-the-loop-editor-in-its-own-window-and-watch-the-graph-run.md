---
id: DSP-28
title: Open the loop editor in its own window and watch the graph run
status: Review
assignee: []
created_date: '2026-09-17 18:45'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-26
priority: high
type: feature
ordinal: 15300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

The graph editor currently replaces the chat in the same window. Niclas met the consequence directly on 17 September 2026: he opened the editor, came back, and his project was gone. That was repaired by keeping the chat mounted and hidden, which works but is a workaround for a structural mistake — an editor and a conversation are two things a person wants side by side, not two views competing for one window.

The second half is what the editor is for during a run. A graph that shows which node is active turns an opaque delegation into something a person can follow, which is the whole argument for building the editor in the first place.

### The trap to avoid

A highlight that guesses is worse than no highlight. It must follow the recorded run state from DSP-26, so a finished or cancelled step cannot keep looking active, and a late event from an earlier run cannot light up a node in a graph the user is now looking at for a different reason. The same discipline applies to the window itself: opening and closing a view is an act of looking, and looking must never start, stop or duplicate work.

### Accessibility, deliberately stated

Motion may carry emphasis but never meaning on its own. Waiting, active, finished and failed must be distinguishable when the animation is absent, ignored or unwanted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Edit agent loops opens a separate, non-modal window, and the main window's chat and any running loop keep working while it is open.
- [ ] #2 During a run the graph view can show exactly the graph version being executed, locked against editing.
- [ ] #3 The active node is marked with a clear border and may carry a discreet slow pulse, while waiting, finished and failed states are also distinguishable without relying on animation alone.
- [ ] #4 The marking follows the recorded run state, so finished or cancelled steps do not continue to look active, and a late event from an earlier run never marks the wrong graph or the wrong node.
- [ ] #5 Opening, closing and reopening the graph view never starts, cancels or duplicates work, and the existing editor and run handling is reused rather than replaced.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Call 005 Implementer delivered all five criteria, at 498 tests across 62 suites from a measured baseline of 468/53, typecheck and tests exit 0, no provider turn, no commit or build. Eight revert proofs, each failing on the user-visible assertion. **Unverified:** the Verifier has not seen this yet.

**The addressing rule is the substance here.** Every run event now carries both a run id and the graph version id, and a view marks a node only when both match. `applyRunEvent` returns the *same object* when the address does not match, so a stale entry is not merely invisible — it changes nothing the window holds, which is a property a test can assert rather than a promise. On the sending side the run audience clears the current run only if it is still that run, so a slow `finally` from a cancelled run cannot tell a window about a run that started after it ended.

**One state model, and a second one removed rather than a third added.** `nodeRunStates` folds the runner's own journal entries and nothing else — no timers, no "it has been a while", no second opinion about the outcome, and `runOutcomeFrom` is untouched. The editor previously drew the walk from `runResult.path` after a run and from journal entries during one: two derivations of one thing. That is the exact shape of the defect Niclas met when a badge and the sentence beside it disagreed, and it is now gone.

**Three decisions recorded because they are judgement, not mechanics.** Opening the editor twice focuses the existing window instead of making a second, since two drawings of one file have no way to reconcile and the second Save would silently overwrite the first author's work. The run view **stays locked after the run ends**, because what is on screen then is still that run's drawing and not the author's copy — becoming editable the instant a run stopped would let someone edit what looks like a record. And a fifth state, `stopped`, was added for a node the run was inside when it was cut off: the card names four states that must be distinguishable and five satisfies that, while avoiding calling a cancelled step "finished" or "failed", neither of which anybody measured.

A dry run has no content hash to offer, and says `canvas-unversioned` rather than inventing one; the sentence a person reads calls it *the unsaved drawing in this window, which was never read from a file and so has no content version*.

**A test that earned its keep during its own call.** The check that each state draws the node body with something other than an animation **passed** the first two attempts at reverting it, because a static colour on the word beside the node satisfied a looser reading. The assertion was wrong, not the code, and it now looks at the node's own body — which is the assertion someone tidying the CSS later will trip over, and the reason to write it that way.

**Carried in the same call, from report 004:** the stop message no longer claims DSpatch stopped a command it cannot know it stopped, and is now built by an exported `describeStoppedCommand` so the words can be tested without spawning anything; a sub-minute bound no longer reads "0 minutes"; and the lone UTF-8 BOM is gone. One existing assertion, `doesNotMatch(sentence, /exited/)`, had to be narrowed to `/exited \d/` because the honest sentence contains "an intermediate that has already exited" — flagged rather than quietly widened.

**For the Verifier, named by its author rather than left to be found:** the chat's own journal and reply channels still go to `event.sender` while the audience broadcasts the same entries, which is a second transport of one history and was not measured with two windows open; two real windows were never open at once; nothing here opened a window at all, so criterion #1's visible half and the entire look of the highlight are readings; `prefers-reduced-motion` is written but was not exercised; and the graph-could-not-be-drawn branch is typechecked but unreachable without faking it. **Criterion #1 and the visual half of #3 are HUMAN_PENDING for Niclas.**

Also left deliberately: a run started in another window does not grey out this window's Run button — the main process refuses the overlap with an honest sentence instead. Cross-window busy state belongs with DSP-29 to DSP-33.

`app/dist/` still predates this entire run, so nothing launched from it contains any of this work. A build is required before any trial.

---

**Call 007 Verifier, on candidate-6 `sha256:b7830367…`, confirmed with no drift at either end. #2, #4 and #5 PASS; #3 passes on its non-visual half; #1 and the look of the highlight are HUMAN_PENDING. Nothing found should hold the package.** 529/67 exit 0 reproduced, typecheck clean, 560 baseline test names with 0 absent.

**The double transport was the thing most worth checking, and the claim holds.** No window consumes both: the chat subscribes to the chat journal and reply channels and never to `onLoopRunEvent`; the editor subscribes to `onLoopRunEvent` and never to the chat channels. During a chat-started run the main window really does receive each journal entry twice over IPC, but the second has no listener there and Electron discards it. **A wasted message, not a second history.** Double registration cannot double-deliver either, because the audience is a `Set`.

An asymmetry the Verifier checked before deciding it was correct: an editor-started run broadcasts only, so the chat's ticker says nothing while it walks. That is not a disagreement — there is no loop turn in the transcript for it to attach to, and silence is the honest output. The two surfaces are describing different things rather than one thing differently.

**Untouched proved by hash across all six candidates rather than by promise:** `runOutcomeFrom`, the badge functions, the record format and its append semantics, the journal entry types, turn routing and `workflow-script.ts` are all byte-identical to before calls 005 and 006. The named exception is `loopBusy` / `sendGeneration`, which live in `App.tsx` and so cannot be proved this way — recorded as NOT_RUN rather than implied.

**Carried as [DSP-36](dsp-36%20-%20Decide-what-a-finished-run-in-the-editor-does-when-a-new-run-starts.md):** the `started` event deliberately bypasses the addressing rule, which is right while a run is live and reads differently once the watched run has ended and the view stays locked. Two intended decisions interacting in a way neither call considered.

**Two smaller findings, not carded.** The handoff trail's word ban constrains `handoffTrail`'s own template but not the node labels interpolated into it, so a graph node labelled `Bypassed` would put `passed` into a sentence with no test failing — latent, not reachable with the current five roles. And `loop-editor.css` carries around 40 raw hex colours rather than palette properties: most arrived with DSP-22 and call 005 added its five run-state colours in the same style. The approved palette itself is untouched and `styles.css` is byte-identical on every palette definition, but the editor window will show Niclas colours that are not among the approved ones. **His eye during the trial, not a correctness defect.**
<!-- SECTION:NOTES:END -->
