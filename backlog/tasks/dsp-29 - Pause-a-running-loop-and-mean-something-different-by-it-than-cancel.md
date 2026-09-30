---
id: DSP-29
title: 'Pause a running loop, and mean something different by it than cancel'
status: Review
assignee: []
created_date: '2026-09-17 19:43'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-26
priority: high
type: feature
ordinal: 15400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

DSpatch has one way to stop a loop today, and it is Cancel. Cancel means *abandon what is in flight*: the provider call is aborted, the files stay as they are, and what actually completed may be unknown. That is the right tool for a run going wrong, and the wrong tool for the far more common wish — let this step finish, then stop and let me look.

Without that distinction a person who wants to think has to either interrupt work that was going fine or sit and watch it continue. Both are bad, and the second is why a loop starts to feel like something that happens *to* the user.

### The honesty requirement

Pause is a request, not an event. Between asking and arriving there is a real interval in which the agent is still writing or the command is still running, and during that interval the product must say **pause requested**, never **paused**. A pause that claims to have happened while a provider call is still in flight is the same class of lie as a green badge over a failed run, and this project has already made that mistake once.

### Relationship to DSP-18

This realises part of DSP-18 criterion #4, which has stayed open through every increment so far. It does not replace that criterion; it is how it gets met.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A visible control requests that further autonomous work pause.
- [ ] #2 A pause requested during an agent call or a command normally lets that work step finish, and no new work step is started until the user chooses to continue.
- [ ] #3 The window shows first that a pause has been requested and then that the run is actually paused, and a pause is never described as confirmed while work is still in progress.
- [ ] #4 Cancel remains a separate action for work in progress, reusing the existing cancellation handling, and reports what was actually stopped and what is unknown.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Call 008 Implementer built DSP-29 and DSP-30 as one mechanism, at 568 tests across 77 suites from a measured baseline of 529/67, 0 of 596 baseline names absent, typecheck and tests exit 0, no provider turn, no commit or build. **Ten revert proofs, every one failing on the sentence a person would read.** Unverified.

**The honest transition is three lines and it is driven by the work, not by the request.** `controlPhase` answers `paused` only when `inFlight === null`, and `inFlight` is bracketed around the executor call in a `finally`, so a step that threw has still ended. There is no path from *pause pressed* to *paused* that does not go through the work actually stopping. Revert log `04` removes that rule and fails on *"while the agent was still writing, the run had not paused and must not have said it had"* — nine failing assertions.

**The wording carries its own test, separately.** The `pause-requested` text contains the word *paused* in no form at all, and log `05` proves the assertion bites. The reasoning is worth keeping: a sentence that has to explain it does not mean what it says gets skimmed as though it did.

**Two things about where the gate sits, and the position is the content.**

It is consulted **before `node-entered` is journalled**, because call 005's `nodeRunStates` marks a node `running` the moment that entry arrives — a held node drawn as running would be the picture claiming work that is not happening, the same untruth one layer down from a green badge over a failed run.

And **before `deadlineAt` is computed**, because a step must not spend its own `maxMinutes` sitting in a pause. Our `implementer` node is bounded at 90 minutes; a person who thinks for two hours must not cause a `step-timed-out` on work that then took one minute. **A pause that ate the budget would make pausing the expensive choice at exactly the moment it matters.** Log `07` fails on *"waiting for a person must not spend the step's bound. It faulted: step-timed-out"*.

**A hazard the Implementer went looking for and would otherwise have shipped.** A run waiting at a pause is not inside the executor, so a cancel pressed during a pause would have sat unheard until a step that was never going to start finished. The controller now watches the abort signal and the run ends without starting the held step. The cheaper fix — release the held step and let the executor notice the cancel — is **wrong for gate nodes**, because `loop-live.ts`'s gate branch does not check the abort signal before spawning, so a cancelled run would still have run the project's test command. Starting work after the user said stop is the thing this entire card is about.

**A paused run is a waiting run, not a stopped one.** `awaitStepRelease` returns a promise the runner sits on inside `runLoopGraph`, so the journal, counters, mandate and graph version stay in that closure. Continuing is the same call returning, which makes "no new run, no step repeated" structural rather than promised.

**Vocabulary added, not changed:** `run-held` and `run-released` appended; the nine existing kinds keep their places, asserted by listing them, so a record written before DSP-29 still parses. No new `RunStatus`, no new fault kind, `runOutcomeFrom` untouched. Delivery reuses call 005's *audience* but not its addressed channel, so the addressing rule and report 007's "no window consumes both transports" both still hold.

**Two process notes from the call that are worth more than they look.** Two reverts initially failed on a boolean rather than on the user-visible sentence, because a weaker assertion came first in the test; they were reordered, on the principle that **a revert failing on the wrong assertion proves the wrong thing**. And three multi-line reverts reported `ANCHOR MISSING` because the harness matched `\n` against a CRLF repository — it announced itself, but it would not have if a missed anchor had been counted as a pass.

**Third call in a row where a comparison that matched nothing looked exactly like one that passed:** a PowerShell summary reported all ten reverts as NOT RESTORED while the harness reported all ten restored. The pattern contained an em dash and matched nothing; the harness was right.

**Named by its author rather than left to be found.** A paused run may still walk a router or a terminal — the Implementer's own first test found this and failed on it. Holding a router would freeze the run halfway along an edge and holding a terminal would keep a finished run open, so *paused* means no **work** is in flight, which is the claim criterion #2 actually makes. It is now an asserted rule, but **the picture can advance by a router's width after the pause arrives, and Niclas should see that once and say whether it reads as honest.** Also: the fault kind for a cancel during a wait is `no-outcome-delivered`, whose name is imprecise for a step that never started; it was chosen to match the existing cancel-before-start path rather than add vocabulary, and the `detail` and `reconcile` sentences are precise about it.

`app/dist/` and `app/release/` hold the first delivery and none of this work. A trial of pause needs a rebuild.

---

**Call 009 Verifier: #3 FAILS. The second delivery is held.** #2 passes, #1 is HUMAN_PENDING, #4 passes on the single-run path and fails in the overlap. The suite reproduces at 568/77 with all 645 test names identical, and the whole verified foundation is byte-identical by hash.

**The lie exists and it was made to happen.** With the `implementer` agent step genuinely in flight — asserted at the instant of reading, not afterwards — the product reported headline **Paused**, detail *"No work step is running"* and note *"The run is paused: nothing was in flight"*. All three. A negative control with the one attacking line removed produced the honest *Pause requested* instead, so the harness discriminates and the difference has exactly one cause.

**`controlPhase` is not the defect.** The three lines call 008 rests on are correct, and reverting them is exactly as fatal as report 008 says. The lie comes from something else clearing `inFlight` while the work runs: `LoopRunController.beginRun` calls `controlForNewRun` unconditionally, so a **second run starting** resets the control state while the first run's agent is still writing. `controlPhase` then answers honestly from inputs that have become false. **This is a coverage failure of the `inFlight` bracket, not a failure of the rule — which is precisely the shape a revert proof cannot reach**, and the reason the handoff asked for this attack specifically.

**It is reachable through the ordinary UI, which is what decides the verdict.** The two run handlers in `main.ts` guard only their own abort variable and never each other: the chat run sets `chatLoopAbort`, `editorLoopAbort` is still null, so the editor's run is accepted. The renderer does not stop it either, because `runBlocked` reads that window's *own* local `runBusy`. Open the editor, start a chat loop, press Live run, press Pause.

**The second consequence is arguably worse than the first.** `attachAbort` replaces the previous signal, so **the first run stops hearing its own Cancel** — observed: run A held at a work step, its own abort fired, and it never settled. Call 008 went out of its way to make Cancel reach a waiting run, and the overlap undoes exactly that. This is the same family as the stop message caught at call 004: a control the person pressed that achieved nothing while the product carried on.

**Where the wrong assumption is written down, in two places, in almost the same words.** `loop-run-audience.ts` says *"the editor refuses a second live run while one is in progress and the chat loop does the same"*, and report 008 says two concurrent runs are unsupported *"which matches both bindings refusing an overlap"*. Each binding refuses an overlap **with itself**. Neither refuses one with the other. The audience was written to tolerate that, which is survivable for a picture; the control cannot, because replacing the state is what produces the untruth.

**The fix is confined and does not reopen the design.** One shared condition for "a run is walking" that both handlers refuse on — `loopControl.report().runId !== null` already is that fact — and `beginRun` refusing rather than silently replacing when a run is active, so the invariant is defended where it lives rather than only at two call sites. The second alone closes the untruth even if a third caller appears later.

**The budget property is now measured rather than reasoned, and it holds.** The `implementer` step was held while the clock advanced **600** minutes against its 90-minute bound: no fault, and the deadline after release was exactly 5 400 000 ms from the release instant — the *whole* bound, not a remainder. Its negative control burns the same 600 minutes *inside* the step and duly faults with `step-timed-out`, which is what makes the first measurement mean anything. The Verifier also checked that no run-level clock exists to be eaten: `maxMinutes` is per-step and the other limits are counts, which a wait cannot spend.

**Call 008's reasoning about the gate branch is verified correct** — it really does spawn without checking the abort signal, so releasing the held step would have run the project's test command after the user pressed stop. But the same hazard reaches that branch by another route, now carded as [DSP-37](dsp-37%20-%20Notice-a-cancel-between-two-steps-before-starting-the-next-one.md).

**One more consequence named rather than left to be found:** because the brackets cover *work* steps only, `inFlight` is null while a human node's executor call runs, so a pause during one reads as `paused`. That sits inside the definition call 008 states and defends, and belongs on the same short list as the router question for Niclas to look at once.

---

**Call 010, rework round 2 of 2: E1 closed at its cause. Unverified.** 568/77 → 574/79, 0 of 645 baseline names lost, typecheck and tests exit 0, no provider turn. `loop-control.ts` was not opened at all — `controlPhase`, `decideNextStep`, `applyControlAction` and every sentence in `describeControl` are byte-for-byte what call 008 left. The design was not reopened; only the coverage of `inFlight` was.

**`beginRun` refuses rather than resets**, which is the part that matters most: the invariant "one run holds the control" now lives in the object that owns the control, so a third caller added later inherits it instead of having to remember it. It returns a result rather than throwing, because refusing an overlap is an ordinary answer a person reads, not a fault. **A second call with the same run id is also refused** — nothing legitimately starts a run twice, and the reset underneath a running step is exactly what must not happen.

The refusal names the run, the step in flight, the window it was started from and the graph, and says what did *not* happen: no step begun, nothing reset, the walking run undisturbed.

**One shared condition in `main.ts`**, and the reasoning for its shape is worth keeping: it asks the control first, because the control is the fact itself and is shared, so it knows about a run whichever window started it — but the two abort variables stay in the condition because a handler between claiming its controller and reaching `beginRun` is also a run that has started.

**The claim moved before the announcement.** A refused run now never announces itself to the windows, so the audience's documented tolerance of a second `start` is never exercised by an overlap. In the chat handler the record is opened earlier, so the refusal path closes it through the existing `closeChatLoopRecord` rather than leaving a half-written record on disk — a path that is unreachable today and exists **because a caller assuming the control was granted is precisely how this defect got in.**

**Dry-run was deliberately left alone.** It walks the canvas, touches no control and spends nothing, so blocking it during someone else's run would be a restriction nobody asked for.

**The captured failure is on the sentence, not on a boolean:** the reproducing test presses the second window's Run inside the `implementer` agent step of a real run of the real graph, then presses Pause, and asserts the headline, detail and note before anything structural. Unfixed, it reported `actual: 'Paused'`; 13 of the 15 tests in the same file still passed, so the harness discriminates.

**The negative control that refused itself is the best evidence in the call.** The name comparison's first version read UTF-16LE logs as UTF-8, parsed zero names, and **exited 2 with "one side parsed no names at all" rather than reporting a clean match.** It also declines to compare any log whose own summary reports failures, so "names that ran" cannot be passed off as "names that passed". That is the fifth encounter with this hazard in this run and the first time the instrument caught itself.

**Still read rather than pressed:** that the `main.ts` refusal reaches a person. The controller's refusal sentence and the editor button's wording are asserted directly; the main-process note is covered by typecheck and reading only. That link needs a build and a trial and belongs on the trial list rather than holding anything.

**DSP-37 not taken**, on time rather than on judgement, and the report is precise about what is known: `loop-run.ts` has no reference to the abort signal at all, so the check must be passed into the walk or read from the control port. The cheap-looking version sits in the executor, whose return then has to become *something* — which is where "if it needs a new fault kind, leave it" applies. **Which of the two it is was not established.**

---

**Call 011 Verifier, on candidate-9, confirmed at both ends: E1 is closed, closed at its cause, and closing it broke nothing. #3 and #4 PASS as far as code can take them; the visible halves stay HUMAN_PENDING.** 574/79 reproduced, typecheck clean, 645 → 653 names with 0 absent.

**The call 009 attack was re-run unchanged and now yields the honest answer on all three fields** — headline *Pause requested*, and a detail sentence that names the step still writing. The reasons to believe it are as important as the reading: the negative control still shows the honest sentence, so the fix did not simply break the harness; the in-flight assertion still holds, so this is a live reading and not a stale one; and the two tests now **fail because the product started telling the truth**, reporting `actual: 'pause-requested', expected: 'paused'`. A fix that had broken the harness would have failed differently. The detached-signal probe also settles now — run A hears its own Cancel again.

**Three further routes to the same lie were attacked, each with a control, and none exists.** A stale `step-ended` was tried against all three identity fields — a different `callId`, a different `occurrence`, a different `nodeId` — and each left the phase at `pause-requested`, with the *real* step ending as the control reaching `Paused`, which is what proves the attacks were aimed at a working mechanism rather than a dead end. A foreign `endRun` leaves the walking run alone. A step whose executor throws still releases the control, because `stepEnded` sits in a `finally` — the same line that also means the opposite lie, a pause that can never arrive, does not exist here.

**One finding, carded as [DSP-38](dsp-38%20-%20Release-the-loop-control-on-every-path-out-of-a-run-handler.md), not held.** Both handlers claim the control outside the `try` whose `finally` releases it. The Verifier measured what a wedge would cost: pause, continue, both mode changes, Cancel and a foreign `endRun` all fail to recover it, and every later run is then refused **with a sentence naming a run that does not exist**. Not reachable today — both gaps are atomic and every statement in them is pure or internally guarded — and the Verifier named plainly that this last link is reasoning rather than measurement, which is exactly the link that decides card versus hold.

**Two method notes worth keeping.** Call 010's `06-final.tap` is spec-reporter output under a `.tap` name — 0 TAP lines, 653 tick lines — so a name comparison against it is impossible. The Verifier did not fake one: it compared against its own call 009 TAP capture instead, which independently reproduces the 645 → 653 delta on both sides rather than trusting either end. And it re-captured its own TAP through `cmd` redirection after PowerShell's code page turned every em dash into mojibake and produced 15 phantom missing tests — fixing the capture rather than explaining the mismatch away, because *"15 tests disappeared, but trust me, it's encoding"* is exactly the sentence a real regression would hide behind.

**Call 010's central claim is now proved by content:** `loop-control.ts` is hash-identical to the version verified at call 009, as are the record format, the badge functions, the addressing rule, the runner, the record store, the chat send path, the live executor and turn routing.
<!-- SECTION:NOTES:END -->
