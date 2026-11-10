After the successful branch calls `settle('connected')`, `settle` takes the registered callback and clears `onSettled` before scheduling it. That makes the callback one-shot; if none is registered, nothing is scheduled.

<!-- dspatch:details -->
`setTimeout(..., 0)` queues the callback for a later timer task rather than running it inside `connect`. `connect` can return `'connected'`, and `startSession` can resume after its `await`, before that timer task runs. The next step follows that callback when it reports `'session ready'`.