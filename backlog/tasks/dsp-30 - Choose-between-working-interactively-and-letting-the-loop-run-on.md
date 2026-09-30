---
id: DSP-30
title: Choose between working interactively and letting the loop run on
status: Review
assignee: []
created_date: '2026-09-17 19:43'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-29
priority: high
type: feature
ordinal: 15500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

The vision says human-interactive work is a full operating mode for the whole project, for as long as the user wants it, and that autonomy can be switched on or off while context and history are preserved. Today the loop has exactly one mode: it runs to its end or it is cancelled. Choosing to be involved means choosing not to run a loop at all.

### What the two modes mean

**Autonomous**: the loop continues within the graph rules and the mandate it already has. **Interactive**: it waits before each work step that starts an agent or a command. Internal bookkeeping and deterministic routing do not need a click — a person asked to approve the graph walking along an edge would learn nothing and would stop reading the prompts, which is worse than not asking.

An explicit human node always waits for its answer, in either mode. That is what makes it a human node rather than a comment.

### The property that makes it trustworthy

Switching mode is a change of who decides the next step, and nothing else. The mandate, the frozen graph version, the history, the results and the budgets already consumed all survive it. It must not create a new run and must not re-run a completed step. If switching mode could quietly restart work, nobody would dare switch it at the moment they most want to.

### Relationship to DSP-18

This realises the core of DSP-18 criterion #4. It does not replace that criterion; it is how it gets met.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The current way of working is visible during a run and can be changed while the run is in progress.
- [ ] #2 In autonomous mode the loop continues within the graph rules and the existing mandate; in interactive mode it waits before each work step that starts an agent or a command, while internal bookkeeping and deterministic routing need no separate click.
- [ ] #3 An explicit human node always waits for its answer, including in autonomous mode.
- [ ] #4 Changing mode preserves the mandate, the graph version, the history, the results and the budgets already consumed, creates no new run, and restarts no step that has already been carried out.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in call 008 together with [DSP-29](dsp-29%20-%20Pause-a-running-loop-and-mean-something-different-by-it-than-cancel.md), which carries the shared numbers and the process notes. Unverified.

**They are one mechanism, which was the point of combining them.** Pause and the mode are two inputs to a single `decideNextStep`, and every sentence and every enabled button in both windows derives from that one state. Built as two flags they could have disagreed — paused but autonomous, running but interactive — and the disagreement would have been visible to Niclas before it was visible to us.

**#4 is where the evidence is strongest, and the method is the reason.** A mid-run, mid-step mode switch is compared *whole* against an identical autonomous run: run id, status, path, edges, terminal, limits reached, all five usage counters and the full journal shape. Plus no step performed twice, and `usage.calls` identical after switching twice. **That comparison carries its own negative control inside the test** — the same `shapeOf` is pointed at a run of the same graph with one edge redirected and required to report a difference. Without it, a `shapeOf` that returned a constant would have made the strongest claim in the report mean nothing.

**#2 is asserted by name, not by count.** The held nodes on the ordinary path must be exactly `coordinator, implementer, verifier, implementation-review, coordinator-report`. A count would still pass if a router started asking and an agent stopped — which is precisely the failure that would make a person click past the prompts that matter.

`stepWorkFor` maps **every node kind the format has**, so a seventh kind cannot be added later and fall silently into "never waits".

**#3 holds by the existing mechanism, and the seam for DSP-31 is deliberate.** `decideNextStep` answers `human-node` *before* it looks at the pause or the mode, so no release token can let one through — asserted over every combination. But the runner does not gate human nodes: they already wait through the executor's untouched `awaiting-human` path. DSP-31 should resolve that wait by making `decideNextStep` answer differently rather than by adding a second rule beside it. Gating them here would have hung the run, because this increment collects no answer.

**The mode selector is enabled during a run and outside one, deliberately:** the moment a person most wants to take over is the middle of a run.

**No new colour.** The control bar is built entirely from the approved palette properties; `styles.css` still contains exactly the eight palette definitions.

**Named rather than left to be found.** A mid-step mode change is not journalled — holds and releases are recorded against their node, and a switch while a step is in flight reaches the windows live but leaves no line in the record; the `hold` field on `run-released` shows which mode was in force at each wait, which is less than a full history. The graph view shows the controls only while watching a run, so before a run the editor window offers no selector while the chat always does: defensible, not obviously right. Two concurrent runs are not supported, which matches both bindings refusing an overlap but is now an assumption in the control as well. And a paused run does not survive quitting DSpatch — it lives in the runner's closure, so a restart loses it and the record reads as interrupted. That is existing behaviour and it is what DSP-33 is for.

---

**Call 009 Verifier: #2 and #4 PASS, #3 passes as a rule, #1 is HUMAN_PENDING.** This card is not what holds the second delivery — [DSP-29](dsp-29%20-%20Pause-a-running-loop-and-mean-something-different-by-it-than-cancel.md) #3 is.

**#4 passes, and the useful part of the verdict is how far the evidence actually reaches.** The negative control inside `shapeOf` is real and better guarded than it needed to be: it asserts that edge `e08` exists before redirecting it, so a renamed edge cannot silently turn the control into a comparison of two identical runs. But a redirected edge changes `path` and `edgesTaken`, so the control proves `shapeOf` is sensitive to **the walk** — not to `status`, `limitsReached`, `usage` or `history`. `usage.calls` is separately asserted, which covers the field that matters most.

What `shapeOf` omits, measured against `RunResult`: `graphId`, `dryRun`, the timestamps, `fault`, `awaiting`, `refusal`, and every journal entry's `message` and `data`. Two of those are worth stating. **`fault` is not compared**, so two runs failing for different reasons would compare equal. And **the graph version is not compared at all** — it is not on `RunResult` — so that clause of the criterion is a *reading*, true because the graph is a parameter in `runLoopGraph`'s closure with no path that reloads it. Sound reasoning, but the report presents this criterion as where its evidence is strongest, and the graph-version half of it is not measured.

**No fresh allowance on a mode switch**, and the structural reason is better than the assertion: the counters are locals in `runLoopGraph`'s closure and are not in `LoopControlState` at all, so there is nothing for a control change to reset.

**#2's instrument is right.** Holding is asserted by node name rather than by count — a count would pass if a router started asking and an agent stopped, which is exactly the failure that would train a person to click past the prompts that matter. And `stepWorkFor`'s test genuinely **enumerates**: it iterates `NODE_KINDS` imported from `loop-graph.ts` and compares the whole mapping, so a seventh node kind fails this test rather than falling silently into "never waits".

**Attacked from the over-eager side, nothing legitimate can be made to wait.** One note rather than a card: the IPC handlers do not re-check the offer they published, so a renderer ignoring `disabled` could leave a release token that the next interactive step spends. Unreachable through the UI, worst case one step starting unasked.

**An observation the Verifier recorded as unattributed, settled here:** the four changed `backlog/tasks/` files between candidate-6 and candidate-7 are the coordinator's, written before each candidate was captured under the standing process rule. Report 008's claim to have edited no backlog file stands. The Verifier was right that a snapshot cannot separate two authors and right to say so rather than assume.
<!-- SECTION:NOTES:END -->
