`startSession` has a new third parameter, `report`, a sink that takes one line of text for the user; the earlier revision took only the `Link` and the address and did nothing but await `connect`. The first thing the new version does, before any connection is attempted, is hand the Link a callback through `whenSettled`. The callback closes over `report` and translates the Link's `Outcome`, `'connected'` or `'gave-up'`, into the user-facing `'session ready'` or `'offline mode'`.

**Registering runs nothing.** `whenSettled` only keeps the callback (the next step shows the single slot it goes into); the Link, not `startSession`, decides when it is called. So after this line nothing has been reported, and `'session ready'` can only ever reach the user through this callback: the code of `startSession` after the await knows only the text `'retrying later'`.

The order is the point to notice: the callback is in place before `connect` is called, which happens right after. `connect` settles the callback internally before it returns (a later step), so a registration placed after the await would be too late for this attempt and the outcome would go unreported.

<!-- dspatch:details -->

`report` is typed `(text: string) => void`: it is called synchronously and its result is ignored. Nothing in these two files calls `startSession`, so who supplies `report` and what it does with the text cannot be seen here. What can be read is that the Link calls the callback from a timer it sets (a later step), after `startSession`'s own promise may already have resolved, so `report` has to stay safe to call once the caller has moved on.

The callback maps both outcomes, so on the gave-up path the user receives two lines for one failure: `'offline mode'` from the callback and `'retrying later'` from the check after the await. The ternary tests only for `'connected'`; any outcome that is not that word lands on `'offline mode'`, which is harmless while `Outcome` has two values but would silently absorb a third.

Each call to `startSession` registers afresh on the Link it is given. Because the Link keeps one callback (the next step), a second `startSession` on the same Link before the first has settled replaces the first call's callback, and the first `report` never hears its outcome. That is what the code allows; whether any caller does it cannot be established from these files.
