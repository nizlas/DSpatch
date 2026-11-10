Here the Link uses the callback that `whenSettled` stored in `onSettled` (step W1.2), and the way it uses it decides how the new report channel behaves: the callback is detached first and then deferred, not called.

`settle` copies `onSettled` into the local `callback`, sets the field to `null`, and only then hands the copy to `setTimeout`. The local copy is what makes that order work: the closure given to the timer holds the callback itself, so emptying the field loses nothing. **One registration therefore yields at most one report.** The next time `connect` reaches `settle` on the same Link, it finds `null`, the `if` is false and nothing is scheduled; a report comes again only if `whenSettled` has been called in between, as `startSession` does before each `connect` (step W1.1).

The zero delay is the second thing to read. `setTimeout(..., 0)` does not run the callback now; it queues it for a later turn of the event loop, after the code currently running has finished. `settle` itself returns synchronously, and `connect` continues straight to `return 'connected'` (step W1.4). So at the moment `connect`'s promise resolves, `report` has not been called: the `'connected'` value travels back to the caller first, and the `'session ready'` text is still waiting in the timer. Which outcome the timer will deliver is fixed here, because the closure captures the `outcome` argument `settle` received.

What to take onward: when `connect` returns, nothing has been reported yet. The next step follows the caller's side; the timer gets its turn in step W1.7.

The code shows the deferral but not its reason. One reading is that the caller is then sure to see `connect`'s return before any report, whatever the callback does; that is an interpretation, and the code states no such intent.

<!-- dspatch:details -->

`settle` is reached from two places in `Link`: here, on the first successful `open`, and after the attempt loop is exhausted, with `'gave-up'` (`src/link.ts`, target, line 28). This walk follows only the first, but the mechanism is the same for both, so what the single slot and the deferral mean here holds for the gave-up report as well.

Special cases that follow from the slot and the null check:

- If `whenSettled` was never called, `onSettled` is still `null` here and nothing is scheduled. A Link used without a callback connects silently: no error, no default report.
- If `whenSettled` is called after `connect` has already settled, the new callback sits in the slot until a later `connect` settles; the finished attempt is not reported to it. Registration has to precede the attempt it is meant to observe, which `startSession` ensures by its line order (step W1.1).
- Because `whenSettled` is a plain assignment into one field (`src/link.ts`, target, lines 13–15), two registrations before one `connect` leave only the second; the first is dropped without ever being scheduled.

What the timer does and does not guarantee. `setTimeout` places the callback in a later event-loop turn; promise continuations already queued, such as the `await` resuming in `startSession`, run before timers. That is a rule of the runtime, not something this code enforces, and the next step takes it up. The code thus allows a caller to finish everything it does after `await link.connect(...)` before `'session ready'` arrives; whether that order is intended is not written anywhere in the code. The timer also moves any exception the callback throws out of `connect`'s reach: `settle` returns `void`, `connect` never awaits the callback, and a throw inside it surfaces from the timer, not from the `connect` call.

The earlier revision had nothing to settle: `Link.connect` returned the transport's boolean straight to its caller (`src/link.ts`, base, lines 8–10). Delivering the same `Outcome` twice, once as a return value and once through a deferred callback, is introduced in this method and the two calls to it.
