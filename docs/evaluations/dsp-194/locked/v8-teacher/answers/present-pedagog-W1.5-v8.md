When `connect` succeeds, it calls `settle('connected')` before returning (W1.4). Here, `settle` consumes the registered callback by clearing `onSettled`, then schedules that callback with the outcome rather than calling it immediately. This makes that registration one-shot and lets `connect` return without waiting for the notification.

<!-- dspatch:details -->
A zero-delay timer means “run later when the runtime can,” not “run exactly now.” The scheduled function retains the callback and outcome even though `onSettled` has been cleared. In the next step, `startSession` resumes after `connect` returns, and the timer callback reports `session ready` (W1.6).

```dspatch-references
{"references":[{"label":"Successful connection calls settle","step":"W1.4"},{"label":"The callback is reported by startSession","step":"W1.6"},{"label":"settle consumes and schedules the callback","path":"src/link.ts","side":"target","start":32,"end":38},{"label":"startSession awaits connect and reports the outcome","path":"src/session.ts","side":"target","start":4,"end":8}],"insufficient":false}
```