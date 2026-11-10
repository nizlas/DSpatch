`settle` is the private method `connect` called in the previous step, here with the outcome `'connected'`. It is short and synchronous, and it does three things in a fixed order:

1. It copies whatever the `onSettled` slot holds into a local `callback`.
2. It empties the slot by assigning `null` to `onSettled`.
3. If the copy was not `null`, it hands `setTimeout` a small arrow function that will call `callback(outcome)`, with a delay of `0`.

Two consequences of this shape carry the rest of the walk.

**The slot is emptied before `settle` returns, and the scheduled call uses the local copy, not the slot.** As we saw in step W1.2, `whenSettled` keeps exactly one callback in `onSettled`. `settle` takes it out and leaves `null` behind, so the callback `startSession` registered can be delivered at most once: if `connect` is run again on the same `Link` and reaches `settle` again, it finds nothing and schedules nothing, unless `whenSettled` has been called again in between. The arrow function given to `setTimeout` closes over the local variables `callback` and `outcome`, not over `this.onSettled`, which is why clearing the field does not disarm the call that was just scheduled. JavaScript runs each piece of synchronous code to completion on a single thread, so no other code can read or write the slot between the copy and the clearing; there is no concurrent writer to race with, and the pair acts as one take-and-empty.

**`setTimeout(..., 0)` postpones the call; it does not make it.** A JavaScript runtime takes work from a queue one task at a time (the event loop). `setTimeout` puts a new task on that queue to run no sooner than the delay has passed, and `0` only means "as soon as the loop gets round to it"; it never runs the function during the task that is executing now. So `settle` returns at once, `connect` goes on to its `return 'connected'`, and at that moment the `report` sink in `startSession` has not been called: the report exists only as a queued timer. Had the method written `callback(outcome)` directly, `report('session ready')` would have run inside `connect`, before the caller even saw the return value; the timer turns that order round, and the two following steps follow the two continuations in the order the runtime serves them, first the resumed `await` in `startSession`, then the timer.

The same `settle` is also what `connect` calls when it has used up its attempts, then with `'gave-up'`; the clearing and the deferral are the same for both outcomes.

<!-- dspatch:details -->

What "later" means here, more precisely. The code after an `await` in an `async` function is queued as a promise continuation (a microtask), and the runtime drains all pending microtasks before it takes the next ordinary task such as a timer. The order is therefore fixed by the language and host rules, not by luck: the synchronous rest of `connect` and its `return`, then the continuation in `startSession`, then the timer with the report. The next step rests on that ordering. The `0` is a minimum, not an exact delay; hosts may round it up to a millisecond or a few when timers nest, and nothing here depends on the figure, only on "not in this task".

Cases that change what happens:

- Nothing registered: `onSettled` is `null`, the `if` skips, and `connect` still returns its `Outcome`. A caller that only wants the return value can use `Link` without `whenSettled`.
- `whenSettled` called again after `settle` but before the timer fires: the new callback goes into the now-empty slot and waits for the next `settle`, while the already-queued call still runs with the old callback, because the timer holds its own reference. `Link` discards the handle `setTimeout` returns, so it has no way to cancel a queued report.
- Re-registering from inside the callback: because the slot is already empty when the callback runs, a callback that calls `whenSettled` on the same `Link` installs itself for the next `connect` and is not wiped afterwards. The code allows this; nothing in this change does it.
- Two `connect` calls overlapping on one `Link`: there is one slot, so whichever call reaches `settle` first takes the callback and the other finds `null`.
- An exception thrown by the callback, for example from `report`, is thrown inside the timer task, after `connect` and `startSession` have both finished. Neither can catch it, and it does not reject the promise `startSession` returned. That is a consequence of the deferral worth weighing when judging the change.

On the types: `onSettled` is declared as either a function from `Outcome` to `void` or `null`, a union type, and TypeScript requires the explicit `!== null` test before the call is allowed. `private` is checked by the compiler, not enforced at run time; in this revision the only callers of `settle` are the two in `connect`.

Against the From side: there `Link` had neither the slot nor `settle`, and `connect` returned the transport's boolean, which was the only way a caller heard the result. Both the callback and its deferral are new with this change.

References: `settle` and its two callers, src/link.ts (target) lines 32–38, 23 and 28; the `onSettled` field and `whenSettled`, src/link.ts (target) lines 9 and 13–15; the registration and the `report` sink, src/session.ts (target) lines 3–4; the earlier `connect`, src/link.ts (base) lines 8–10.
