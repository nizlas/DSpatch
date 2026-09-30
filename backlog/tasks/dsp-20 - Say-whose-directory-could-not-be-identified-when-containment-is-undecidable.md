---
id: DSP-20
title: Say whose directory could not be identified when containment is undecidable
status: To Do
assignee: []
created_date: '2026-09-15 19:55'
labels:
  - security
dependencies:
  - DSP-16
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Found by Verifier call 010 of run `20260915-174013-p6qd`, which rendered a refusal nobody had seen before. It is a wording defect on a path that **fails closed**, so nothing here is a security hole; it is the product telling the user something unhelpful at the one moment it has refused to do what they asked.

`describeUndecidableContainment` serves two different failures with one text. The chosen folder cannot be identified — where "choose it again by its ordinary path" is good advice. Or a directory **above DSpatch's own working copy** cannot be identified — where the chosen folder is perfectly ordinary, re-choosing it changes nothing, and the message names a directory the user has never seen and asks them to make it readable. The Verifier reached the second branch, which it judges the likelier of the two, and it read the message saying exactly that about a directory that did not exist.

The README has the same gap: its account of the undecidable case does not say whose directory might be unidentifiable, and its framing reads as though the question concerns the folder you picked.

### Also here, because it is the same paragraph

Two smaller things from the same report. The pointer "the paragraph below says so" names the wrong paragraph — the link limit is two below, with the undecidable case in between. And the claim that an unenumerated spelling costs nothing is unqualified, while what makes it true is that two spellings of one directory report the same `dev` and `ino`.

That last one is the only item here worth a judgement rather than an edit. Containment now rests on filesystem identity, measured true for a UNC administrative share, a mapped network drive, a `subst` drive, an 8.3 short name and both extended-length prefixes — all on one machine. **A genuine remote share on a second machine is unmeasured.** If a redirector there reported a different `dev`, the guard would fail open silently: no refusal, no message, the directory above DSpatch opened. Nothing suggests it does; nothing rules it out. Stating what the guarantee rests on is cheap and is what the paragraph headed *The reach, stated exactly* exists to do.

### Scope

Wording and the test that reaches the second branch. `own-repository.ts`'s verdict already carries `unresolved`, so distinguishing the two causes is small. Do not change what the refusal decides — it is correct, and Verifier 010 established that by an A/B on one folder in one window: with the link present the folder opened, with it removed the same folder was refused.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The undecidable containment refusal distinguishes its two causes. When the chosen folder cannot be identified it may advise choosing it again by an ordinary path; when a directory above DSpatch's own working copy cannot be identified it must say so and must not advise re-choosing a folder that is not the problem.
- [ ] #2 The message never asks the user to make a directory readable when the recorded failure is that the directory does not exist.
- [ ] #3 The README's 'reach, stated exactly' paragraph says that the directory named by this refusal may be one above DSpatch rather than the folder the user chose, and the pointer to the link limit names the correct paragraph.
- [ ] #4 The README states what the containment guarantee rests on: that two spellings of one directory report the same filesystem identity. Measured cases are named, and a genuine remote share on a second machine is recorded as unmeasured rather than covered.
- [ ] #5 A test reaches the ancestor branch of the refusal, not only the chosen-folder branch, and asserts the wording difference between them.
- [ ] #6 The two summary strings that count unacknowledged attempts count them per attempt kind, as the gate does. A restored or saved conversation whose only unacknowledged attempt is a command no longer claims that the next message waits, when sending in fact works.
- [ ] #7 When an ancestor of DSpatch's own working copy cannot be identified, the refusal says that no other folder will open either and that the problem is DSpatch's own location. The startup log makes that state visible rather than leaving it to be discovered one refusal at a time.
- [ ] #8 The README says in which configuration the identity dependency actually bites — DSpatch's own working copy reachable through a share — so a reader does not conclude that opening projects over a share is unsafe, which it is not.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Criteria #6 to #8 were added by Reviewer call 011 of run `20260915-174013-p6qd`, findings F1, F2 and F3.

**#6 is a new defect and the most interesting of the three**, because it is the residual of this run's own fix rather than something the fix missed. Three product strings were corrected by deriving them from the same value the gate reads, which is the right mechanism. But the gate is per attempt **kind** — `mayRepeat(kind)` filters by kind and `report()` publishes `agentTurn` and `command` separately — while `describeReconciliation` in `chat-service.ts` and `unacknowledgedAttemptCount` in `conversation-store.ts` aggregate across both. So a conversation whose only unacknowledged unresolved attempt is a command, which you get by running a test and closing the window while it runs, tells the user the next message waits for confirmation while `Send` is enabled. The per-row text is already correct, because it takes the kind. The lesson the Reviewer drew is worth keeping: deriving from the same value is not enough if it is read at a different granularity.

**#7 follows from a design consequence the Reviewer checked and accepted.** When an ancestor of DSpatch's own root cannot be identified, the containment question returns `undecidable` for *every* chosen folder the spelling test does not settle, so the chooser refuses everything. Refusing is correct — the chosen folder was already examined successfully, so the failure means DSpatch cannot examine the tree it is running from, and no walk can prove the negative from there. But it makes the message the only guidance a user has in a state where nothing they pick will open.

**Also worth fixing while in the file:** `README.md:130`'s sample startup log still shows `identity=b4a87678dd5203cd`, the superseded DSP-5 trial build (F6).

**Not a criterion, but recorded so it is not lost** (F5): `ChatServiceOptions.ownRepoRoot` is optional, so a future caller that omits it loses the containing refusal silently and still typechecks. Making it a required `string | null` keeps "unknown" expressible while turning omission into a type error. A one-line hardening for whenever `chat-service.ts` is next opened, not worth a call of its own.
<!-- SECTION:NOTES:END -->
