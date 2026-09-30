---
id: DSP-48
title: 'Say which files moved, rather than how many'
status: Review
assignee: []
created_date: '2026-09-18 18:15'
updated_date: '2026-09-18 18:09'
labels: []
dependencies:
  - DSP-43
priority: high
type: bug
ordinal: 15593
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### What is actually true, and what the product says

DSP-43 routes a run on DSpatch's own comparison of the project before and after the work step, which is right: it is a measurement rather than the agent's account of itself. But the measurement is of **the tree**, not of the agent, and the agent is not the only thing that writes into a project while a turn is running. A compile server, a file watcher, an editor autosave, an antivirus, an indexer, or the user in another window all do.

Measured: with a separate process appending one line to `build/CMakeCache.txt` while the agent only read, the run took `work → check → done`, spawned a real command, and ended at the one ending that says something positive about the project. An otherwise identical run over a quiescent tree ended at `nothing-changed` and spawned nothing. The writer is the only difference.

So the sentence the increment rests on — *a mandate that only reads never meets a build* — holds **provided nothing else writes to the project while it runs**, and nothing in DSpatch establishes that or tells the user when it did not hold.

### Why naming the paths is the fix rather than a better measurement

The measurement cannot be made perfect and should not be chased. What can be fixed is the product claiming the measurement means more than it does. A person who reads *changed: `build/CMakeCache.txt`* recognises a false positive instantly; one who reads *1 changed file* cannot. The changed paths are already held in `inspection.changedFiles`, so this is additive rather than new machinery, and it makes the defect report itself.

### The skip set is backwards for a user's project

`snapshotTree` skips `.git`, `node_modules` and `artifacts` by directory name at any depth.

`.git` being skipped is load-bearing in the right direction: the mandate this increment was built for is *check that you can see the git repo*, an agent answering it runs `git status`, and that rewrites `.git/index`. Were `.git` counted, that exact mandate would measure as changed every time.

But `artifacts/` excluded while `build/` is counted is backwards outside the generated sample repository the skip set was written for. On a real project `artifacts/` is ordinary content and work done there is invisible, while `build/` is where a C++ project's churn actually lives. Do not simply add `build/`: a project that commits generated output would then hide real work. The skip set should stop being a constant shared with the experiment generator and become something a run can state.

### Also invisible, recorded so it is not rediscovered

An edit reverted within the same step; a read-only attribute flip; a directory junction. Each measures as unchanged. Symlink behaviour is unestablished — it needs Developer Mode or elevation and returned `EPERM`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run that took its branch because files changed names those files where the user reads the result, not only how many there were.
- [ ] #2 A person who sees a path they did not expect can tell that something other than the agent may have written it.
- [ ] #3 What the comparison does not look at is stated somewhere the user can find, rather than being a constant in the code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
#1 and #2 built in run `20260918-171500-shape`, call 004. **#3 is deliberately NOT_DONE** and remains open.

A run now names the paths it measured as changed, bounded at 8 with the remainder counted out loud, in three places: the step's own reason for its branch, the ending sentence, and — most importantly — at `done`, which is the one ending that says something positive about the project and the ending the third-party writer reached. The clause says where the paths come from: a comparison of the whole project folder, so anything else that wrote there while the loop was working is in the list too.

**#3 stays open on purpose.** The skip set is untouched and proved so by hash. Simply adding `build/` would hide real work in a project that commits generated output, so this needs a decision rather than an edit. The recommendation is that `RecordedSnapshots` gain a `notLooked` list written from the snapshot's own skip list, so the ending can say which directories the comparison did not look inside — making the blind spot self-reporting without deciding the policy. Niclas's answer is needed for the policy, not for the plumbing.

The README now names the three skipped directories, which is documentation and not a claim on #3: #3 asks that the **run** state it.
<!-- SECTION:NOTES:END -->

## Verification (call 006)

<!-- SECTION:NOTES:BEGIN -->
Verified on `candidate-6`. **#1 and #2 PASS in the record, the ending sentence and the step's own reason; HUMAN_PENDING on screen.** #3 remains NOT_DONE and out of scope, skip set proved unchanged by hash.

The clause naming changed paths fires at `done`, `not-checked` and `stopped`, bounded at 8 and counted out loud, and it also fires at the ending my own call 003 third-party-writer attack reached — so a false positive is now self-reporting.

Two warts worth one line each when this area is next touched. `Changed: none.` appears immediately before `found 1 added file` in the same paragraph of the step's reason, two sentences apart, saying apparently opposite things; it is the executor's older summary prefix, which counts `diff.changed` and not additions. And `snapshotAfter.fileCount` counts a build's output while `addedFiles` does not — both correct, neither annotated. The second folds naturally into #3's `notLooked` work.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Superseded in part. **Kept:** naming the files that moved rather than counting them, as corroborating evidence in the record. **Removed:** the routing half — those measurements no longer choose the run's branch. #3, the skip set, is unaffected and still Niclas's decision.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
