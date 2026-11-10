After W1.4’s successful path calls `settle('connected')`, `settle` schedules the registered callback instead of running it inside `connect`. This lets `connect` return and `startSession` resume after its `await` before the timer callback runs; W1.6 follows that order through to the reports.

<!-- dspatch:details -->
`settle` clears `onSettled` before scheduling, so the callback is used at most once; if no callback is registered, it schedules nothing. When called, the timer passes the same outcome to the callback.