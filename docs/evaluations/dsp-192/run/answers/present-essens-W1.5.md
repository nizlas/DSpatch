`settle` is where `connect` tells the listener registered through `whenSettled` how the attempt ended; both of `connect`'s exits go through it, and here it is reached from the success exit with `'connected'`. The whole listener path (`whenSettled`, `onSettled`, `settle`) is new at target: at base, `connect` only returned the transport's boolean and nothing else was told.

Two choices in `settle` decide what the reader must expect from that path:

- **One registration serves one `connect`.** The slot is emptied before the call is arranged, so the same registration cannot fire twice, and a later `connect` on the same `Link` without a fresh `whenSettled` reports to nobody: with an empty slot `settle` does nothing, silently. Whether a listener is registered is the only condition here, and in this walk one is, from `startSession` (W1.1).

- **The report is queued, not delivered.** The callback goes on a zero-delay timer, so when `settle` returns to `connect` nothing has reached the listener yet. `connect` returns `'connected'` as we saw in the previous step, `startSession` resumes in the next step, and only the step after that is the timer's turn, when `report('session ready')` actually runs.

The consequence to judge: the return value and the callback are two channels for the same outcome, and the return value arrives first. Whoever awaits `connect`, and whoever awaits `startSession`, resumes before the callback has run. This follows from the event loop's rules, not from timing; the rule is below.

<!-- dspatch:details -->

Why the order is a rule. A timer callback is a task; the resumption of `startSession` after `await link.connect(address)`, and the resumption of whatever awaits `startSession`, are promise continuations, which the event loop drains before it takes the next task. So `startSession` finishes its own code, and its promise settles, before the timer fires, however long each step takes. The zero delay says "as soon as a task slot is free", never "now".

What the timer holds. The closure captures the local `callback` and `outcome`, not the field, so a `whenSettled` made after `settle` but before the timer fires does not redirect this report; it arms the next `connect`. No timer handle is kept, so nothing in `Link` can cancel a queued report once `settle` has run.

Where an error would go. Because the call happens inside the timer's callback, an exception thrown by the listener, here by `report`, propagates to the timer host, not to `connect` or to `startSession`'s `await`. A `try` around `link.connect(address)` would not see it.

The other exit, as an observation. On the `'gave-up'` exit the same deferral applies, so `startSession`'s own `report('retrying later')` (the branch W1.6 shows) runs before the queued `report('offline mode')`: two reports, in that order. That is what the rules give; this walk does not go there.

Callers. `private` restricts `settle` at compile time only; in the two source files at target it is called from exactly the two exits of `connect`, and nothing else was readable.

```dspatch-references
{"references": [
  {"label": "settle: empty the slot, then queue the call", "path": "src/link.ts", "side": "target", "start": 32, "end": 38},
  {"label": "The success exit that reaches settle here, then returns 'connected'", "path": "src/link.ts", "side": "target", "start": 22, "end": 25},
  {"label": "The gave-up exit, the only other caller of settle", "path": "src/link.ts", "side": "target", "start": 28, "end": 29},
  {"label": "The Outcome type and the onSettled slot", "path": "src/link.ts", "side": "target", "start": 5, "end": 9},
  {"label": "Where startSession registers the listener", "step": "W1.1"},
  {"label": "whenSettled keeps one callback", "step": "W1.2"},
  {"label": "startSession resumes before the timer", "step": "W1.6"},
  {"label": "The timer fires: report('session ready')", "step": "W1.7"},
  {"label": "At base, connect only returned the transport's boolean", "path": "src/link.ts", "side": "base", "start": 8, "end": 10},
  {"label": "At base, startSession awaited connect and told nobody", "path": "src/session.ts", "side": "base", "start": 3, "end": 5}
], "insufficient": false}
```
