When `connect` reaches this point after a successful open, `settle` takes the registered callback and queues it on a zero-delay timer instead of calling it inline. The callback receives `'connected'`; clearing it first means this registration cannot be used for a later settlement. In the next step, `startSession` handles the returned outcome and the timer callback reports the session status.

```dspatch-references
{"references":[{"label":"The success branch calls settle","step":"W1.4"},{"label":"The callback is registered","step":"W1.2"},{"label":"The caller and timer callback continue","step":"W1.6"},{"label":"settle schedules and clears the callback","path":"src/link.ts","side":"target","start":32,"end":38}],"insufficient":false}
```