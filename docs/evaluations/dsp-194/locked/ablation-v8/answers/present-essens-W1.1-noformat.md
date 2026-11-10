`startSession` now accepts a `report` callback and registers an outcome handler before calling `connect`. When the handler runs, it reports “session ready” for `'connected'` or “offline mode” for `'gave-up'`; registering it does not report immediately. `startSession` then waits for `connect` to return. The next step shows how `whenSettled` stores the handler (W1.2).

<!-- dspatch:details -->

These are separate reporting paths: if `connect` returns `'gave-up'`, `startSession` also reports “retrying later” after the `await` (W2.5); the settle handler is deferred to a timer (W1.5). If `transport.open` rejects instead, `connect` rejects, so this code does not reach either report path (W3.2).

```dspatch-references
{"references":[{"label":"New reporter parameter and settle-handler registration","path":"src/session.ts","side":"target","start":3,"end":5},{"label":"Earlier startSession signature","path":"src/session.ts","side":"base","start":3,"end":5},{"label":"Report after connect returns gave-up","path":"src/session.ts","side":"target","start":6,"end":8},{"label":"whenSettled stores the callback","step":"W1.2"},{"label":"settle defers the callback","step":"W1.5"},{"label":"Failure reports","step":"W2.5"},{"label":"Rejected open leaves startSession without a settled outcome","step":"W3.2"}],"insufficient":false}
```