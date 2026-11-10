After `connect` succeeds (W1.4), `settle` takes the callback registered earlier (W1.2) and schedules it instead of invoking it inline. `connect` returns `'connected'` separately, so the notification does not delay its result; `startSession` reports `'session ready'` when the timer runs in the next step (W1.6). Clearing `onSettled` consumes that callback, and if none is registered, no timer is scheduled.

```dspatch-references
{"references":[{"label":"Schedules the settled callback","path":"src/link.ts","side":"target","start":32,"end":38},{"label":"Successful connection calls settle","step":"W1.4"},{"label":"Callback registration","step":"W1.2"},{"label":"Timer reports session ready","step":"W1.6"}],"insufficient":false}
```