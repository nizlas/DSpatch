---
id: DSP-6
title: Improve the main friction and assess the complete development workflow
status: Done
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-16 19:13'
labels:
  - ux
  - ui
milestone: m-0
dependencies:
  - DSP-3
  - DSP-4
  - DSP-5
documentation:
  - docs/VISION.md
  - BACKLOG.md
  - docs/REVIEW_RESEARCH.md
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Use feedback from actual use to make a small improvement for Niclas, then assess all of Phase 0. After DSP-6 he should make real code changes through chat, review diffs and run builds/tests, with cancellation, error handling and saved history in place.

### Scope and proposed approach

Define the improvement from DSP-5's most important observation. State the specific behaviour change and assessment criteria before implementation. Keep it small; additional wishes get separate tasks. If the trial found nothing to fix, document that and proceed to the whole-workflow assessment rather than inventing a feature to fill the plan.

Phase 0's complete conventional diff is the review baseline for this assessment. It does not choose the permanent code-view layout, navigation, rendering approach or explanation mechanism. Preserve real changes and revision-linked evidence for future views; do not introduce speculative frameworks to anticipate them. Advanced review ideas remain hypotheses for later discovery.

Test the combined DSP-2–4 result and any UX improvement. Niclas should open a repository, discuss a small task, let the agent change code, review the complete text diff and run a relevant build/test with a clear result for the correct code version. Follow-up/rework, cancellation, understandable recovery and continuing after restart must work. Earlier changes and results remain without duplicate execution.

### Verification and continuation

Report technical results for the delivered version, including successful and failing commands, cancellation and restart after file changes. Niclas assesses the same version and personally completes a bounded change from request to diff and test result. Remaining obstacles must be resolved or explicitly accepted; an agent cannot mark his assessment complete.

Niclas can remain in the human-interactive mode in subsequent increments. His decision on 14 September 2026 is to continue through DSP-6 and then take stock before further product implementation. Hand Phase 0 observations and unresolved needs to [DSP-11](dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md), the user-needs story in [discovery milestone m-1](../milestones/m-1%20-%20Review-and-Maestro-discovery.md). DSP-12 and DSP-13 cover the independent tool and HCI/UI surveys, DSP-14 compares concepts, and DSP-15 records the joint direction decision. Discuss the next direction for review features and Maestro with Niclas using that evidence. Discovery is subsequent work, not a new completion requirement for DSP-6.

### References

[VISION.md, sections 1.1, 14 and 15](../../docs/VISION.md#14-implementation-phases).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The selected improvement is traceable to DSP-5 and has concrete criteria, or there is a justified decision that no such change is needed.
- [x] #2 The improvement is verified against its purpose. The combined workflow makes a real code change, shows affected files and the full text diff, and runs a relevant build/test with results tied to the correct code version. Cancellation, error handling and restart preserve work without automatic repetition.
- [x] #3 Niclas has personally completed and assessed all of Phase 0 on an identified version, including code change, diff, build/test and continuing after restart. Remaining obstacles are resolved or explicitly accepted by him.
- [x] #4 Results and lessons are documented for the planned post-Phase-0 HCI/prior-art study and direction review with Niclas. BACKLOG.md identifies that next focus without fixing advanced review features, interaction design, editor technology or Maestro topology. Completing that later study is not required to finish DSP-6.
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Current focus: substep 1, the four changes below, defined from Niclas's trial of 15 September 2026 and approved by him the same day.

### The selected improvement, traceable to DSP-5

Each item names the DSP-5 finding it comes from and the behaviour that must change. Three are friction he met; the fourth is a statement the window makes that turned out not to be true.

**1. Acknowledge an unresolved attempt once per conversation, not once per message (DSP-5 friction 1).**
An attempt whose outcome can never become known currently blocks every later message in that conversation. Niclas met the same gate for the same dead attempt three times in twelve minutes, the third time in a new provider session where a duplicate run is no longer possible. After the change, acknowledging once must let the conversation continue, and the attempt must remain recorded as unresolved in the ledger and in Execution state. Reviewer 011 asked for the same thing before the trial. Do not weaken the first gate: the first message after an unknown outcome must still stop and explain.

**2. Point at the composer correctly (DSP-5 friction 2).**
`App.tsx:2009` says "Use the composer above" while the composer renders below the restored panel. Say where it actually is, or remove the direction.

**3. Let the remembered-projects list be pruned (DSP-5 friction 3).**
Nine of ten entries were throwaway `%TEMP%` repositories from overnight verification, some no longer on disk. Provide a way to remove an entry, and show which recorded paths no longer exist. Removing an entry must not touch the project or its saved conversations.

**4. Stop claiming the held-run block clears itself (DSP-5 defect).**
The small print states as fact that the block "disappears on its own" once the run reports an end. Niclas measured eleven minutes with no change after killing a turn. Either remove the promise or state it as a possibility that has not been observed, and make continuing in a new provider session read as the way out rather than one of two. A bounded probe of how long Cursor holds a run whose client vanished mid-stream is worth doing, and whatever it shows is what the window should say.

### Criteria for the improvement

Each change carries a test that fails if the change is reverted, except the wording items, which are checked by reading the rendered text in the packaged application. Nothing here may weaken the honesty of the record: unresolved attempts stay unresolved, and no wording may claim a behaviour that has not been observed.

### Out of scope here

Containment of the chosen project moved to [DSP-16](dsp-16%20-%20Contain-the-agent-to-the-chosen-project.md). Conversation file size and test-command suggestion for non-Node projects are recorded in DSP-5 without proposed work. Splitting `chat-service.ts` and `App.tsx` is carried as a separate concern and is not required by this substep.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### All four changes are implemented and independently measured, 15 September 2026

Run `20260915-174013-p6qd`. Implementer call 001 made the changes; Verifier 004 found two statements that had not caught up with the behaviour; Implementer 006 corrected those and a third the Verifier had not named; Verifier 007 measured the last untested half live. What each change turned out to be:

1. **Acknowledgement once per attempt.** The defect was not what the plan guessed. `acknowledge()` was writing `acknowledgedAtUtc` and `mayRepeat()` was never reading it, so the acknowledgement was durable and inert. It is now read and persisted, and Verifier 007 measured both directions in a running window: in a conversation whose attempt was already acknowledged the composer had no gate and a real message went through, answered by the provider, while the same message in a conversation nobody had confirmed was still held with *Send* disabled. The gate is paid once, not removed, and the attempt stays recorded as unresolved rather than being marked done.
2. **The composer direction** is corrected and the panel named. Measured at 1265 and 1584 pixels below the panel and off screen at rest, which is why the old sentence misled.
3. **The projects list** gained per-row *Forget* and *Forget all N missing*, with folders and saved conversations proven untouched afterwards.
4. **The held-run promise** is replaced by measurement. A bounded probe severed a client mid-run and was refused at all fifteen once-a-minute checks over 15 minutes, while a new session over the same repository was accepted immediately. The window now says what was measured and that self-clearing is unknown, rather than promising it clears itself.

Three further product strings were found to be promising a confirmation step that item 1 had removed, and were corrected with the same rule the gate uses, so they cannot drift from it again.

### AC#3 is now Niclas's, and the artifact exists

`app/release/win-unpacked` carries build identity **`a75ae56759fc9cad`**, built 15 September 2026 at 21:20 local from git `3d44171` plus uncommitted work, replacing `b4a87678dd5203cd` — the build he tried during DSP-5, which has none of the above. The artifact was confirmed to start, report its identity, offer the project chooser and reach the provider. Nothing else in it was exercised by the Implementer; a Verifier pass on the artifact as a product was running when this note was written.

AC#3 is his own assessment of the whole of Phase 0 on an identified version, and no agent measurement substitutes for it.

### AC#3 closed 16 September 2026, evening — Niclas's own words

He declined a second walkthrough of packaged identity `a75ae56759fc9cad`. The Phase 0 trial of 15 September (identity `b4a87678dd5203cd`, his project `MiniDAWLab-spike01`) is the assessment. His judgement, 16 September 19:12 local, recorded verbatim in sense:

> This was a functional test. The design of where things should be found in menus and the like needs a great deal of iteration. It feels like one big debug window.

Accepted remaining obstacle: information architecture and placement are not done. Phase 0 is accepted as a working function, not as a finished workspace. That need goes to [DSP-11](dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md) criterion #5 (re-read DSP-12/13 against this feedback) and does not reopen this card. DSP-16, DSP-20 and DSP-18 stay on their own cards.

#1 and #2 were already technically verified in run `20260915-174013-p6qd`. #4 is the existing handoff into m-1; BACKLOG.md already names that next focus.
<!-- SECTION:NOTES:END -->
