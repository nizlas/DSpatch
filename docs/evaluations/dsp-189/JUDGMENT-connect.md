# Judgment: the "connect" change in the Standard profile

Judged against both revisions of `src/link.ts` and `src/session.ts` and sections 1–4 and 11 of the code-walk reference.

## 1 Correctness

No set misstates the mechanism. All three have the facts that matter right: the counter incremented before each `open`; the pause of 100/200/300 ms awaited after every `false`, including the third; `settle` clearing the slot before scheduling with `setTimeout(…, 0)`; the `await` continuation in `startSession` running as a microtask before that timer, so `'retrying later'` precedes `'offline mode'`; a rejected `transport.open` leaving `connect` with `settle` never called and the callback still in the slot. Every place line and every "← from" transition in both sets points at the right lines.

The errors are at the edges:

- Loop W1.4 Show more: "Only when `transport.open` returns a pending promise does control leave `connect`." False: `await` yields whatever the promise's state. The paragraph itself says nothing depends on it, and nothing does.
- Loop W2.2: "a failure of the transport is the only way out of the loop other than exhausting the attempts." Omits the success exit, and in the walk's own vocabulary a "failed attempt" is a `false`, which does not leave the loop. W1.4 and W2.3 state the exits correctly.
- Loop W1.1 Show more: "the function's own promise is unaffected by what `report` does." Over-general: the direct call at line 7 runs on `startSession`'s stack and a throw there rejects its promise, as the loop's own W2.5 says. The reviewer did not note this one.
- One call W1.3: "`attempts` and `onSettled` are written by `connect` and `settle`, so what one `connect` call does depends on what earlier calls left behind." `whenSettled` is the writer of `onSettled`, and `connect` resets `attempts`, so for sequential calls only the slot carries over. W1.4 repairs it, but a reader can leave W1.3 believing the counter leaks.
- One call W3.1: "gets one attempt, not three" holds only when the first call throws.
- *Explain this*: "which `settle` fires once via `setTimeout(..., 0)` and then clears" reverses the order; its details section has it right.

On the reviewer's two "loosely worded" sentences: I agree they do not change what the reader understands, but both are wrong rather than loose, and the second is the worse because it collides with the walk's own use of "failure". Both are one-clause fixes.

## 2 Following the course

The loop holds the reader throughout. Each step opens where the previous left it ("`connect`'s promise has resolved with `'connected'`, and `startSession` picks up again at its `await`", W1.6) and closes with what to carry forward. W1.2 announces its departure from execution order. W2.1 recalls the state before branching: "Everything before is the same: `startSession` registered its callback, `connect` reset `attempts`, incremented it to 1 and awaited `transport.open`." The callback is walked as executing code with its context named: "in the timer's context: on an empty call stack, with no `startSession` frame above it" (W1.7). This is section 1 of the reference realised. Its cost is W1.1, which asks the reader to take four forward references to `settle` on trust before any Link code has been seen.

The one call keeps the course but tells rather than walks at two points. The callback never gets a step: W1.8 says `'session ready'` "runs afterwards, from the `setTimeout` scheduled in `settle`", which is right, but the reader is never placed in the timer's context at line 4. And W2.4 is a transport step whose content is "the mechanics are those of the settle step in the first walk". Its return to the branch (W2.1) is as explicit as the loop's. One line the loop lacks: "Reading `startSession` top to bottom suggests the opposite order, since the callback is written first" (W2.5).

The rejecting transport: the one call's W3 makes a review-relevant hole visible in the walk list, and W3.1 states it best: "A transport that signals failure by throwing gets one attempt, not three." But W3.2 shows a lone field declaration and W3.3 revisits `startSession` a third time; one step would have done. The loop's placement, a Show more paragraph reached from W1.4's "that case is covered below", hides the fact from a reader who never opens deepenings. The walk should exist, shorter.

## 3 Explaining the shown place

At `connect`'s loop the loop's W1.4 explains at Standard level and adds judgement: "The counter means 'attempts started', not 'attempts failed'", "There is no timeout here: a transport that never resolves leaves `connect`, and with it `startSession`, pending indefinitely", and the fixed order of `settle` before `return`. The one call's W1.5–W1.6 cover reset, bound, increment-before-call and the two routes, correctly but with less consequence; its asset is the base `connect` shown beside the new one. Against *Explain this*, the loop's step is at least its equal and adds the timeout point; the one call matches it on what and falls short on why.

At `settle` both explain the deferral and the microtask-before-timer rule: the loop where the code is ("the order is fixed by the event loop's rules, not by luck", W1.5), the one call at the consequence (W1.8). Both give a Standard reader what decides the outcome.

At the branch both return explicitly and explain the pause arithmetic and the wasted final wait; the loop adds the 600 ms sum and the base contrast there, the one call defers the sum to W2.3. No place in either set is merely named and displayed. The loop does, however, put hypotheticals into first parts where Show more would serve better: W1.3's paragraph on two overlapping `startSession` calls and W1.2's on concurrent `connect` calls; the one call keeps that material in W1.5 Show more.

## 4 The deepening

The loop has Show more on all 13 steps and almost all continue: the type-only import (W1.1), parameter properties and `maxAttempts` of 0 (W1.2), rejection (W1.4), uncaught throws, clamping and the discarded handle (W1.5), the caller's own continuation (W1.6, W2.5), overlapping calls inflating the count (W2.3). Repetition creeps in late: W2.6's deepening restates W1.7's closure and uncaught-throw points, and W1.6's "In the earlier revision the function ended at the `await`" repeats W1.1.

The one call has Show more on two steps only (W1.4, W1.5), both genuine continuations. The other 14, including `settle`, the gave-up exit and all of W2 and W3, offer nothing further; a reader wanting depth at the central mechanism has nowhere to go.

## 5 What the loop added, and what it cost

In the loop and not the one call: the no-timeout observation; the throw asymmetry between `report` from the timer and from `startSession`'s stack (W1.5 SM, W2.5); the transport not being told it is a retry (W2.3); what two texts for one failure mean to a `report` implementation (W2.6); evidence labels at the ordering claim ("not from anything observed, since the repository has no tests and no caller", W2.5); the rounds table.

In the one call and not the loop: base code beside the target at two steps; a visible rejection walk; the "top to bottom" cue; the short "Why:" lines; and a text roughly two and a half times shorter before any deepening.

The reviewer read against the code (its two quoted sentences prove that) but produced confirmation, not correction: it found two inconsequential errors and did not treat them as findings, missed the W1.1 over-generalisation, and asked for no rewrites. Accepting was defensible, since a correction round for one-clause fixes would have cost more than it repaired, but the stage changed nothing a reader of the delivered walks can notice. The cost: 15 min 12 s against 4 min 53 s for the stand-in; the planner alone (5 min 21 s) took longer than the whole one call.

## 6 Net verdict

Both sets leave a Standard reader understanding the mechanism correctly, and neither contains an error that misleads about what the change does. The loop's walks are the better explanation: the reader is oriented at every transition, the callback is walked in its execution context, the shown places carry the consequences a reviewer needs, and depth is available at every step. That gain came from the planner's briefs and the per-step writer, not from the reviewer, whose acceptance changed nothing. The one call is adequate, faster, shows the old code beside the new, and made the better structural call on the rejecting transport, but it tells where the loop walks and has no depth where it matters most. The loop also overspends: hypotheticals in first parts, repeated deepenings late in W2, and a planner call longer than the one-call total. For a person who will read closely and open Show more, the loop is worth its wait; for one who wants orientation and reads first parts only, the one call delivers the same understanding in a third of the time.
