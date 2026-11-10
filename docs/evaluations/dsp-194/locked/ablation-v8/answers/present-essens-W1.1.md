Here `startSession` installs a report callback before starting `connect`: settlement reports “session ready” for `'connected'` and “offline mode” for `'gave-up'`. It still awaits `connect`, then reports “retrying later” if the connection gave up. Compared with the base revision, this adds outcome reporting; registering the callback does not report immediately.

`Link` schedules that callback only when it settles [W1.2, W1.5]. If `transport.open` rejects before settlement, `startSession` rejects without this callback reporting [W3.1].

```dspatch-references
{"references":[{"label":"Callback registration and handling of the returned outcome","path":"src/session.ts","side":"target","start":3,"end":8},{"label":"Link callback registration and settlement","path":"src/link.ts","side":"target","start":8,"end":15},{"label":"Connection attempts and settlement","path":"src/link.ts","side":"target","start":17,"end":38},{"label":"Previous startSession behavior","path":"src/session.ts","side":"base","start":1,"end":5},{"label":"Callback storage","step":"W1.2"},{"label":"Deferred callback","step":"W1.5"},{"label":"Rejection before settlement","step":"W3.1"}],"insufficient":false}
```