After the successful branch reaches `settle` (W1.4), the outcome is returned by `connect` and also sent to the registered handler—but the handler is deferred, not called inline. This lets `startSession` resume after its `await` before the timer reports “session ready” in the next step (W1.6).

<!-- dspatch:details -->
The registration is consumed before scheduling, so a later settlement cannot invoke that same registration again; if no callback is registered, no timer is scheduled. A delay of `0` defers the callback to a later timer turn, not an exact zero-delay deadline. Unlike the base revision, where `connect` simply returned `transport.open`’s boolean, the target also settles a registered callback with an `Outcome`.

```dspatch-references
{"references":[{"label":"settle schedules the registered callback","path":"src/link.ts","side":"target","start":32,"end":38},{"label":"Successful connection reaches settle","step":"W1.4"},{"label":"startSession handles the later callback","step":"W1.6"},{"label":"Base connect returned the transport result","path":"src/link.ts","side":"base","start":8,"end":10}],"insufficient":false}
```