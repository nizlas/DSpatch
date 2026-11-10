Compared with the base revision, `startSession` now accepts a `report` callback and registers an outcome-specific notification before connecting. A `connected` outcome reports “session ready”; the other `Outcome`—currently `gave-up`—reports “offline mode”. Separately, once `connect` resolves, `gave-up` also triggers “retrying later”, so those are distinct reports.

The next step shows how `whenSettled` stores the callback [W1.2].

```dspatch-references
{"references":[{"label":"Session callback registration and post-connect report","path":"src/session.ts","side":"target","start":3,"end":8},{"label":"Outcome type and callback registration","path":"src/link.ts","side":"target","start":3,"end":15},{"label":"Previous startSession implementation","path":"src/session.ts","side":"base","start":3,"end":4},{"label":"Callback storage","step":"W1.2"}],"insufficient":false}
```