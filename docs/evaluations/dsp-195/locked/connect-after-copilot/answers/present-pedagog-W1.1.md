`whenSettled` takes a callback—a function for `Link` to call later—and `Outcome` limits its input to `'connected'` or `'gave-up'`. `startSession` registers that callback before it awaits `connect`, so the handler is in place when `Link` settles. It passes the resulting message to the caller-provided `report` function. Unlike the `await` below, registering the callback does not pause `startSession`; the next step shows where `Link` stores it.

<!-- dspatch:details -->
These are two separate reporting paths: the callback reports “session ready” or “offline mode,” while the code after the `await` reports “retrying later” when `connect` returns `'gave-up'`. The callback runs only if `Link` settles; if `transport.open` rejects, the code does not reach either `settle` call (see the rejection walk).

```dspatch-references
{"references":[{"label":"Callback registration and the post-await branch","path":"src/session.ts","side":"target","start":3,"end":7},{"label":"Outcome type and callback storage","path":"src/link.ts","side":"target","start":5,"end":15},{"label":"Connect and settlement paths","path":"src/link.ts","side":"target","start":17,"end":37},{"label":"Where the callback is stored","step":"W1.2"},{"label":"When transport.open rejects","step":"W3.1"}],"insufficient":false}
```