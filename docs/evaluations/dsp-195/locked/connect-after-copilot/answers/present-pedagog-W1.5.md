`settle` takes the callback registered with `whenSettled` and clears the stored slot before scheduling anything. If there is a callback, `setTimeout` schedules it for a later timer turn; it does not call it inside `connect`. So after `connect` returns its outcome, `startSession` can continue through its `await` before the timer callback runs. The next step follows both paths. [W1.2] [W1.6]

<!-- dspatch:details -->
A delay of `0` does not mean “run immediately”: it makes the timer eligible to run later, and other work can delay it. If no callback was registered, the slot is still cleared, but no timer is scheduled.

```dspatch-references
{"references":[{"label":"settle schedules the callback","path":"src/link.ts","side":"target","start":32,"end":37},{"label":"Where the callback is registered","step":"W1.2"},{"label":"The caller's return path and timer callback","step":"W1.6"}],"insufficient":false}
```