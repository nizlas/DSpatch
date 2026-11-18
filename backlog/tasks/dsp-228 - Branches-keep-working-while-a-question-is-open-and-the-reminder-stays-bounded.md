---
id: DSP-228
title: Branches keep working while a question is open, and the waiting-message reminder stays bounded
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, parallelism, mailbox]
dependencies: [DSP-227]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow up the waiting observed in DSP-227's coordination pilot, within the existing mailbox. Read the traces to tell real idling (repeated checks, sleeps) from a deferred decision while work went on. Clarify the generated branch instructions: a sent question is no reason to wait; go on with independent work; check at natural work boundaries, never repeatedly or with sleep to wait; when necessary information is missing and nothing independent is left, report what is done and end with a structured open decision or blocker; never guess an answer or treat a proposed contract change as agreed; a branch ending is not the task ending, and the integrator gets the open questions. Keep using an answer that arrives while the branch works. Check that the reminder for unread messages is bounded, honours cancellation and limits, and keeps sent, delivered, acknowledged and acted on apart. Targeted tests; a small real-agent trial where the receiver has independent work before the answer arrives. No new protocol or scheduler; no release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 The pilot traces are read and what they show is recorded, correcting DSP-227's report where it was wrong.
- [x] #2 The generated branch instructions and mailbox tool descriptions say the points above, in both the mailbox and the control variant where they apply.
- [x] #3 The reminder runs at most once per branch visit, within the visit's remaining time, and stops on cancellation; tested.
- [x] #4 Every branch's open decision or blocker reaches the integrator whole, even when its reply is clipped; tested.
- [x] #5 A small real-agent trial shows whether the receiver keeps working and later uses the answer.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 18 November 2026. Governing decisions: DSP-209 mission decisions 9 (no wait tool) and 23 (delivery only at check_messages); DSP-227's mailbox guidance and reminder turn; Niclas's assignment of 18 November (no new messaging protocol, no scheduler, no general ban on dependencies or coordination). Result (18 November 2026).

**What the traces showed.** The Claude sessions' own transcripts of all DSP-227 mailbox runs: no branch called sleep or polled, none checked more than twice. B sent its suspicion and went straight on (implementation, tests, its own arithmetic fixes); it put off the decision, carried as an unconfirmed assumption, not the work. DSP-227's report said B "waited"; corrected in docs/loop/pilots/branch-messaging-pilot.md.

**Found and fixed.** The fan-out result clipped each reply at 2000 characters from its start, and branches write their open decision last, so it could be cut off before the integrator. `openDecisionsIn` (loop-run.ts) now quotes every section headed "Open decision" or "Blocked" whole under "Open decisions and blockers from the branches", with the sentence that a branch ending finished its slice, not the task.

**Instructions** (loop-live.ts, generated for every branch). With the mailbox: a sent question is no reason to stop; go on with independent work and use a reply that arrives meanwhile; check at natural boundaries; never call check_messages again and again or sleep or poll for a reply. In both variants (`OPEN_DECISION_RULE`): do not guess a needed answer or treat a proposed contract change as agreed; say what rests on something unconfirmed; with information missing and nothing independent left, report what is done and end with "Open decision" or "Blocked" naming what, from whom, why and what is left; the integrator resolves it. Tool descriptions for check_messages and acknowledge_message say the same; "acknowledged" means read and handled by the branch's own statement, and the branch list says what it changed is in its result and commit. No ban on dependencies or coordination.

**Reminder.** Already once per branch visit, only with time left, aborting with the run; now says it is the only one. Tested.

**Verified.** tests/branch-waiting.test.ts (4, simulated adapter, real worktrees): one reminder only though mail still waits after it; a branch with nothing waiting gets none; undelivered mail recorded as undelivered, never as delivered or acknowledged; cancel during the reminder ends the run as cancelled; a clipped reply's open decision reaches the joiner whole; the instructions in both variants; heading extraction. Related suites pass. Real trial (2 runs, Claude, export branch given an independent second part): B finished all independent work without idling or guessing, ended with an open decision, and on the reply checked it against the repository and converted; integrated results correct. It did not check at a mid-work boundary: the reminder delivered the reply both times. The remaining-time bound of the reminder is in code, not covered by a test.
<!-- SECTION:NOTES:END -->
