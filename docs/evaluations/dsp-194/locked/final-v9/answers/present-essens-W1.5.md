On the successful path, `settle` schedules the registered notification for a later timer turn rather than running it inline. `connect` can return `'connected'` first; then `startSession` resumes after its `await`, and the callback reports `'session ready'` in the next step (W1.6).

<!-- dspatch:details -->
`settle` clears the registration before scheduling, so that callback is used at most once. The timer closes over this call’s `outcome`; if no callback is registered, no timer is scheduled.

```dspatch-references
{"references":[{"label":"Settlement and deferred callback","path":"src/link.ts","side":"target","start":32,"end":38},{"label":"Callback registration","step":"W1.2"},{"label":"Successful connection reaches settle","step":"W1.4"},{"label":"Session-ready report","step":"W1.6"}],"insufficient":false}
```