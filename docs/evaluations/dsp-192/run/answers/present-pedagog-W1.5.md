`settle` is where the registration made in `startSession` (W1.1) is consumed. It does not deliver the report: it takes the callback out of `Link`'s one slot and asks the host to run it in a later turn. Two guarantees follow, and the rest of the walk rests on both.

**The registration is single-use.** `onSettled` is a field that holds either one function or `null` (W1.2). Here it is copied into the local `callback` and set back to `null`, in the same uninterrupted stretch of code that queues the report. JavaScript runs on one thread and runs each turn to completion, and a timer callback can only start in a later turn, so by the time anything else runs on this `Link` the slot is already empty. That is what makes the registration single-use: a second `connect` on the same `Link` reaches `settle` with `null`, and the `if` then makes `settle` do nothing rather than fail. Note that the order of the two lines, clear then queue, is not what prevents a double call; the clearing before `settle` returns is.

**The report is deferred, not made.** `setTimeout(fn, 0)` asks the host (Node or a browser) to run `fn` as a separate task no sooner than 0 ms from now. It never runs `fn` inside the current turn, and before the host starts the next task it drains every pending promise continuation first. So the small arrow function `() => callback(outcome)` is only queued here: `settle` returns, `connect` returns `'connected'` as we saw in the previous step (W1.4), and because `startSession` is waiting on `connect`'s promise, its continuation runs as one of those promise continuations, before the timer. The next step (W1.6) therefore shows `startSession` resuming with the report still unsent; the timer firing is a later step (W1.7). Think of it as posting a note rather than tapping someone on the shoulder: by the time it is read, the sender has long since returned to what it was doing.

What the queued function will do is also fixed here. An arrow function keeps the variables it mentions: `callback`, a `const` that cannot be reassigned, and the `outcome` argument. It does not read `onSettled` again, so neither the `null` written just above nor a later `whenSettled` can change which function runs or with which outcome.

For judging the change: `settle` returning, and `connect` resolving to `'connected'`, mean that the report has been queued, not that `report` has run. Nothing in `Link` waits for it, and nothing catches what it may throw.

<!-- dspatch:details -->

**What the host allows between queueing and firing.** The 0 is a minimum, not a promise of promptness. Tasks already queued, timers from elsewhere or I/O completions, may run before the report; `pause`, which spaces the retries in `connect`, uses the same `setTimeout` queue with a computed delay. Only the order relative to `startSession`'s continuation is settled by the language: that continuation is a promise reaction, and promise reactions always drain before the next task.

**Both branches of `connect` go through `settle`.** The failure branch calls `settle('gave-up')` just before returning `'gave-up'`. The same two guarantees hold there, which is why, on that path, `startSession`'s own `'retrying later'` comes before the deferred `'offline mode'`, with nothing coordinating the two.

**No listener is required.** Nothing makes `whenSettled` a precondition of `connect`; a `Link` driven without a listener passes both `settle` calls with the slot empty. Within these two files, the only place that registers is `startSession`, and the only callers of `settle` are the two places in `connect`.

**Re-registration between queue and fire.** If `whenSettled` is called again after `settle` has run but before the timer fires, the new function sits in the slot, untouched by the queued report, and fires only if `connect` reaches `settle` again. Two overlapping `connect` calls on one `Link` share both `attempts` and the single slot: whichever settles first takes the callback, the other finds `null`. The code allows this; it does not guard against it.

**Exceptions.** There is no `try`/`catch` around the callback. If `report` throws, it throws inside the timer's own turn, after `connect` and `startSession` have moved on; it cannot reach them, and the host treats it as an uncaught exception.

**Compared with the base revision.** At base, `Link.connect` returned the raw boolean from `transport.open` and `startSession` simply awaited it; there was no `onSettled`, no `whenSettled` and no `settle`. The deferred, single-use notification is introduced whole by this change. Why the outcome now travels both ways, as `connect`'s return value and through the callback, is not something these two files explain.

```dspatch-references
{"references": [
  {"label": "settle: take the callback, clear the slot, queue the report", "path": "src/link.ts", "side": "target", "start": 32, "end": 38},
  {"label": "The one-function slot onSettled", "path": "src/link.ts", "side": "target", "start": 9, "end": 9},
  {"label": "whenSettled fills the slot", "step": "W1.2"},
  {"label": "Success branch: settle, then return 'connected'", "step": "W1.4"},
  {"label": "Failure branch: settle('gave-up'), then return 'gave-up'", "path": "src/link.ts", "side": "target", "start": 28, "end": 29},
  {"label": "pause uses the same timer queue for the retry delay", "path": "src/link.ts", "side": "target", "start": 41, "end": 43},
  {"label": "startSession registers the callback that becomes the report", "step": "W1.1"},
  {"label": "startSession resumes before the timer fires", "step": "W1.6"},
  {"label": "The timer fires: 'session ready'", "step": "W1.7"},
  {"label": "Base: connect returned the transport's boolean, no callback", "path": "src/link.ts", "side": "base", "start": 8, "end": 10},
  {"label": "Base: startSession only awaited connect", "path": "src/session.ts", "side": "base", "start": 3, "end": 5}
], "insufficient": false}
```
