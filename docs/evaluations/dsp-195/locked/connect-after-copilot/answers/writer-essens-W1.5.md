On the successful path, `connect` calls `settle('connected')` before returning. `settle` schedules the registered callback on a timer instead of running it inside `connect`, so `startSession` resumes from its `await` before the callback runs; the next step follows that order.

<!-- dspatch:details -->
`settle` takes the callback from `onSettled` and clears the field before scheduling it. This makes the registration one-shot, and if no callback is registered, no timer is scheduled. The `setTimeout` callback runs later as a timer task.