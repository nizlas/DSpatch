---
id: DSP-37
title: Notice a cancel between two steps before starting the next one
status: Done
assignee: []
created_date: '2026-09-18 08:31'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-29
priority: high
type: bug
ordinal: 15450
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The walk in loop-run.ts never reads the abort signal. Cancellation is noticed only by whatever the executor happens to check, and the gate branch in loop-live.ts spawns the project test command without checking it at all.

So a cancel pressed after an agent step has produced and before the next node is entered is not noticed. It crosses the node-produced record, the routing decision and any router node, none of which check anything. If the next node is a gate, DSpatch runs the project build or test command after the user said stop.

Call 008 found the same hazard from a different direction and routed around it: it rejected the cheaper fix for cancel-during-a-pause precisely because the gate branch does not check the signal before spawning. Call 009 verified that reasoning against the branch and found this second route into it.

This is pre-existing rather than introduced by either call, and it is the same class of harm as a pause that claims to have happened: the product doing work after the person asked it to stop.

It is cheap to close. One check at the top of the gate branch, or one in the walk loop before entering a node.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A cancel pressed between two steps is noticed before the next step starts, so no command is spawned and no agent is called after it.
- [ ] #2 The run reports what was actually stopped and what is unknown, without claiming an outcome it did not observe.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed in call 012, together with [DSP-38](dsp-38%20-%20Release-the-loop-control-on-every-path-out-of-a-run-handler.md). 574/79 → 580/81, 653 → 661 passing names with 0 absent, typecheck and tests exit 0, no provider turn, no commit or build. Unverified.

**The open question had a clean answer: no new fault kind and no vocabulary change.** The walk already had a cancellation outcome to reuse. The `release.kind === 'cancelled'` branch — reached when a *held* step's wait ends in a cancel — already returned `no-outcome-delivered`, which is in the closed `RUNTIME_FAULT_KINDS` list, which `runOutcomeFrom` already reads, and which `withAbort` in `loop-editor-run.ts` independently picks for the same situation. **So the vocabulary for "the operator cancelled before this step started" existed in two places already; this is a third caller of it rather than a fourth idea.** `loop-record.ts` was never opened.

**Why the control did not save us, which is the part worth remembering.** `awaitStepRelease` reads the abort signal only inside its *waiting* loop, and its first line returns early when the control says start — so in autonomous mode, the ordinary live shape, the control answers *start* without consulting the signal at all. A cancel pressed after an agent produced was therefore seen by **nothing**: it crossed the `node-produced` record, the routing decision and any router on the way, and the gate then spawned the command. Carded as [DSP-39](dsp-39%20-%20Let-the-control-notice-a-cancel-on-its-fast-path.md), because the walk's new check is now the only thing standing between an autonomous run and a cancel it would otherwise ignore, and that is a silent dependency rather than a defect.

**Measured on reverted code**, the walk after Cancel ran all the way through `implementation-review` — the gate — to the final human node. In a live run, entering that branch *is* spawning whatever is in the window's Command field. The test fails with the user-visible fact: *"DSpatch ran the project's own command after Cancel was pressed."*

**Four placement decisions, each with a reason.** The check is in the **walk** rather than the gate branch, so it protects agents, gates, routers, externals and human nodes in one place — with a test for the router case specifically, because that is the claim that would otherwise be only an argument. It sits **after** the control's question, so a run cancelled while *held* still ends through the existing branch and still reports how long it waited and what held it. A **terminal is not reached**, deliberately: a run whose walk is over has no work left to stop, and calling it cancelled would be less true than calling it finished. And the two cancellation paths now share one `neverStarted` builder whose sentences are **byte-identical** to what the held-step path produced before — which is why call 010's existing assertion on that sentence still passes unchanged, and why the two paths cannot drift into describing one event differently.

**Deliberately omitted and pinned rather than assumed:** the editor's Dry-run is not wired to the signal. It calls no provider and runs no command, `withAbort` already refuses the next step there, and wiring it would change a journal shape an existing test asserts for no user-visible gain. A test asserts that a run with **no** signal walks the whole graph exactly as before.

**The negative control that matters here:** a companion test requires the *uncancelled* run to reach the gate and run its command. Without it, asserting "no commands ran" would pass on a product that runs the command every time.

**A logging trap caught in the act, from a new direction.** `npm test --reporter=tap` silently produces spec output, because `--reporter` goes to npm and never reaches node. The Implementer caught it on zero TAP `ok` lines and re-ran through `node --test --test-reporter=tap`. This is the same hazard that cost call 011 a detour, arriving by a different route, and the correct invocation is now recorded in the log header.
<!-- SECTION:NOTES:END -->
