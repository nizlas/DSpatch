`settle` takes the registered callback out of `onSettled` and clears the field before scheduling it. If no callback was registered, it schedules nothing; otherwise, `setTimeout` moves the callback out of `connect`’s execution, so it cannot run as part of the success branch that called `settle`.

<!-- dspatch:details -->
`connect` returns `'connected'` after `settle` schedules the timer. Its promise then resolves, and `startSession`’s `await` continuation runs as a microtask before the timer callback runs as a later task. The next step follows those two paths to their reports.