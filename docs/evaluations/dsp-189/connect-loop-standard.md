# connect · planner, writer and reviewer · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, the walk loop drawing, its roles, the run engine and the run record) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:16:45.186Z, ended 2026-11-10T02:31:58.413Z; job done: 2 walk(s) and 0 reading(s), 13 step(s). 11 changed line(s) are in none of them. The reviewer accepted the walks at once.

Loop: status **delivered**, path plan → write → review → delivered; correction rounds 0; 15 provider turns; 15 min 12 s in all; usage not reported (unknown). Graph dspatch-walk-loop graph-8e84007492c1b56f; roles walk-planner, walk-writer, walk-reviewer.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | plan-walks | file-1 | 5 min 21 s | 16255 |
| 2 | write-step | file-2 | 1 min 54 s | 3623 |
| 3 | write-step | file-2 | 34 s | 3576 |
| 4 | write-step | file-2 | 24 s | 2058 |
| 5 | write-step | file-2 | 34 s | 3256 |
| 6 | write-step | file-2 | 38 s | 3801 |
| 7 | write-step | file-2 | 24 s | 2350 |
| 8 | write-step | file-2 | 22 s | 2282 |
| 9 | write-step | file-2 | 28 s | 2629 |
| 10 | write-step | file-2 | 24 s | 2324 |
| 11 | write-step | file-2 | 24 s | 2069 |
| 12 | write-step | file-2 | 28 s | 2151 |
| 13 | write-step | file-2 | 24 s | 2451 |
| 14 | write-step | file-2 | 18 s | 2211 |
| 15 | review-walks | file-3 | 2 min 33 s | 1901 |

Sum of answer times: 15 min 10 s.

## The plan (the planner's first answer)

**Summary:** Link.connect no longer makes a single attempt and returns the transport's boolean. It now tries up to maxAttempts times (3 by default), pausing 100 ms times the attempt number after each failed attempt, and returns an Outcome of 'connected' or 'gave-up'. A Link also accepts one settled callback through whenSettled, which connect fires once through settle: the callback is cleared and scheduled with setTimeout 0 rather than called directly. startSession gains a report callback: it registers a settled callback that reports 'session ready' or 'offline mode', awaits connect, and additionally reports 'retrying later' when connect gave up.

**Background:** Both public signatures change for callers: connect returns Outcome instead of boolean, and startSession takes a third, required report parameter. The repository holds no other caller of either function and no tests at either revision, so everything in the walks is read from the code, not observed running.

Two consequences the walks make visible: the pause is awaited after every failed attempt, including the last, so giving up comes after a final wait; and because settle defers the callback with a timer while connect's return resumes startSession as a promise continuation, on the gave-up path 'retrying later' is reported before 'offline mode'.

### W1 (walk): Connecting on the first attempt

*Purpose:* How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once. · *Question:* What happens when startSession is called and the transport opens on the first try?

- **W1.1 startSession registers the settled callback** — The entry point now takes a report callback and hands Link a settled callback before connecting.
  - startSession's new signature and the registration: `src/session.ts` target 3–4
  - brief: Entry point. Make comprehensible the new third parameter `report` and that line 4 stores in the Link a callback that maps the outcome to 'session ready' or 'offline mode'; it is registered before connect because settle only notifies the callback stored at that moment (step 5). Nothing is reported here yet. The reader takes to the next step that the Link now holds a callback and is about to be asked to connect.
- **W1.2 What a Link now carries** — The Outcome type, the attempts counter, the stored callback and the maxAttempts bound.
  - Outcome, the new fields and the constructor: `src/link.ts` target 5–11
  - brief: A pause in the execution order to look at the state the next steps use: the Outcome union, `attempts` as instance state rather than a local, `onSettled` holding at most one callback or null, and the constructor's `maxAttempts` with default 3, which no caller in the repository overrides. The reader takes these four names to the steps that write and read them.
- **W1.3 whenSettled stores the callback** — The callback is kept in onSettled; nothing is called yet, and a later call replaces it.
  - whenSettled: `src/link.ts` target 13–15 ← from startSession calls link.whenSettled (`src/session.ts` 4–4)
  - brief: Reached from session.ts line 4. Make comprehensible that this only stores the callback in the `onSettled` field from step 2, that a second call replaces rather than adds, and that nothing runs until settle reads the field. The reader takes to the next step that startSession now awaits connect.
- **W1.4 connect makes its first attempt, and it succeeds** — attempts is reset, the loop opens the transport once, and open is true: settle('connected'), then return 'connected'.
  - connect: the attempt loop and the success branch: `src/link.ts` target 17–25 ← from startSession awaits link.connect (`src/session.ts` 5–5)
  - brief: Reached from session.ts line 5. Make comprehensible the loop's shape: attempts reset to 0, the bound `attempts < maxAttempts`, the increment before each `transport.open`, and the branch at line 22. This walk follows `open` being true: settle is called first (next step) and only then does connect return. Line 26 is not reached on this path; the second walk starts again at line 22 for `open` false. The reader takes to the next step that settle runs before the caller sees the result.
- **W1.5 settle hands the outcome to a timer** — The stored callback is taken, the field cleared, and the callback scheduled with setTimeout 0 instead of being called directly.
  - settle: `src/link.ts` target 32–38 ← from connect calls this.settle('connected') (`src/link.ts` 23–23)
  - brief: Reached from line 23. Make comprehensible three things: the callback is read and `onSettled` cleared, so it fires at most once per registration; nothing happens when no callback was registered; and the callback is not called here but scheduled as a timer with delay 0, so it runs in a later macrotask, after the promise continuations that connect's return triggers. The reader takes to the next step that connect now returns while the notification is still pending.
- **W1.6 startSession resumes with 'connected'** — The await resumes as a promise continuation, the gave-up branch is skipped, and startSession completes.
  - startSession after connect returns: `src/session.ts` target 5–8 ← from connect returns 'connected' (`src/link.ts` 24–24)
  - brief: Reached when connect's promise resolves with 'connected' (line 24); the continuation runs as a microtask, before the timer from step 5. Make comprehensible that on this path the `if` is false, so startSession reports nothing itself and its own promise resolves. The reader takes to the next step that the only report on this path is still to come, from the timer.
- **W1.7 The timer fires: 'session ready'** — The callback registered in step 1 runs from the timer and reports 'session ready', after startSession has already completed.
  - The settled callback body: `src/session.ts` target 4–4 ← from the timer scheduled by settle calls callback('connected') (`src/link.ts` 36–36)
  - revisit: Step 1 showed this line as the registration; now it is the callback body executing with outcome 'connected'.
  - brief: A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context, not in startSession's. Make comprehensible that this is where `report` is called on the success path, with 'session ready', and that it happens after startSession's promise has resolved. The reader leaves the walk knowing the success path yields exactly one report, delivered asynchronously.

### W2 (walk): Giving up after every attempt fails

*Purpose:* How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'. · *Question:* When the transport never opens, how many attempts are made, how long does connect wait, and what does the caller hear, in which order?

- **W2.1 Back at the branch: open is false** — The if at line 22 is not taken; connect pauses attempts times 100 ms before the loop comes round.
  - The untaken branch and the pause: `src/link.ts` target 22–27
  - brief: Starts again at the branch point of the first walk's step 4, with the same entry and registration; this time `transport.open` resolved false. Make comprehensible that the `if` is skipped and `pause(this.attempts * 100)` is awaited: 100 ms after the first failure, 200 after the second, 300 after the third. The pause is awaited after every failed attempt, including the last one, because the loop condition is only checked at the top. The reader takes to the next step what pause does with that number.
- **W2.2 pause waits on a real timer** — A module-level helper resolving a promise from setTimeout; connect resumes when the timer fires.
  - pause: `src/link.ts` target 41–43 ← from connect awaits pause (`src/link.ts` 26–26)
  - brief: Reached from line 26. Make comprehensible that this is a plain timer with no cancellation and no injected clock, so the wait is real elapsed time, and that connect's continuation resumes in the timer's context when it fires. The reader takes to the next step that after the wait the loop condition is checked again.
- **W2.3 The loop comes round for another attempt** — attempts < maxAttempts still holds, so attempts increments and the transport is opened again.
  - The loop condition and the next attempt: `src/link.ts` target 19–21
  - brief: Make comprehensible that each round increments `attempts` before calling `transport.open`, and that with the default maxAttempts of 3 (first walk, step 2) the body runs at most three times. This walk follows every attempt failing, so each round returns to step 1's pause; after the third failure and its 300 ms pause the condition is false. The reader takes to the next step that the loop exits without having connected.
- **W2.4 connect gives up** — After the loop, settle('gave-up') schedules the notification and connect returns 'gave-up'.
  - The gave-up exit of connect: `src/link.ts` target 28–29
  - brief: Reached when the while condition fails. Make comprehensible that settle (first walk, step 5) runs with 'gave-up' exactly as with 'connected': it clears onSettled and schedules the callback on a timer with delay 0; then connect returns 'gave-up' and its promise resolves. The reader takes to the next step that two things are now pending: the caller's continuation and the timer.
- **W2.5 startSession reports 'retrying later' first** — The await resumes as a promise continuation, sees 'gave-up', and calls report before any timer runs.
  - startSession's gave-up branch: `src/session.ts` target 5–8 ← from connect returns 'gave-up' (`src/link.ts` 29–29)
  - brief: Reached from line 29. Make comprehensible, from the code, that this continuation is a microtask and runs before the timer settle scheduled, so 'retrying later' is the first text report receives on this path; startSession's promise then resolves. Say this follows from how promise continuations and setTimeout are ordered, not from a test, since the repository has none. The reader takes to the next step that the stored callback has not run yet.
- **W2.6 The timer fires: 'offline mode'** — The callback from the registration runs from the timer and reports 'offline mode', after startSession has completed.
  - The settled callback body: `src/session.ts` target 4–4 ← from the timer scheduled by settle calls callback('gave-up') (`src/link.ts` 36–36)
  - brief: A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context. Make comprehensible that this is the second report on this path, that it arrives after startSession has already returned, and that because settle cleared onSettled, another connect on the same Link would notify nobody unless whenSettled is called again. The reader leaves the walk with the sequence: three attempts, three pauses, 'retrying later', then 'offline mode'.

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:31 UTC, through the planner, writer and reviewer loop. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7). The planner planned the walks, the writer explained each step in its own call, and the reviewer judged them against the code and accepted them without a correction round. The reviewer is an agent: its acceptance approves nothing of the code.

### W1 (walk): Connecting on the first attempt

*Purpose:* How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.

#### W1.1 startSession registers the settled callback

- startSession's new signature and the registration: `src/session.ts` target lines 3–4

`startSession` is the only entry point of this change, and its contract with the caller has changed in one visible way: it now takes a third argument, `report`, a function that receives short status texts. `startSession` still resolves to nothing, so `report` is the caller's only way of learning how the connection went. Before this change the function simply awaited `link.connect` and dropped its boolean result; nobody was told anything.

The line to understand here is the call to `link.whenSettled`. Before the Link is asked to connect, `startSession` hands it a callback. That callback takes an `Outcome` (a two-member string union, `'connected' | 'gave-up'`, defined in the Link module and shown in the next step) and translates it into words for the caller: `'connected'` becomes `'session ready'`, and the only other outcome, `'gave-up'`, becomes `'offline mode'`. The Link never sees `report` itself and knows nothing about these texts; it only holds the wrapper. **The Link decides the outcome; `startSession` decides the words.**

Nothing is reported at this point. `whenSettled` only stores the callback in the Link (shown two steps on), and the callback runs only when the Link's `settle` later picks it up and schedules it. The order of the two statements is what matters: `settle` notifies whichever callback is stored at the moment it runs, and on the path this walk follows `connect` settles before it returns. A registration placed after the `await` would arrive when `settle` had already looked and found nothing. So the callback must be in place first, and it is.

What the reader carries into the next steps: the Link now holds exactly one callback that closes over `report`, and the very next statement asks that Link to connect.

**Show more:**

`report` is called from two places in this function: inside the callback registered here, and directly in the branch after the `await` (a later step). On the success path only the callback fires; the direct branch is for `'gave-up'`. The callback's `outcome === 'connected'` test with a ternary means every outcome that is not `'connected'` yields `'offline mode'`; with `Outcome` limited to two members that is precisely `'gave-up'`, but a future third member would silently land in `'offline mode'` as well.

The import `import { Link, type Outcome } from './link'` brings `Outcome` in as a type-only import: it exists for the type checker and is erased from the emitted JavaScript. The annotation `(outcome: Outcome)` on the arrow function matches the parameter type `whenSettled` declares, so TypeScript checks that the callback accepts exactly the union the Link will pass.

Two consequences of registering a callback rather than reporting inline are worth having in mind when judging this line. First, the Link runs the callback from a timer, not from within `startSession` (the `settle` step shows this), so a `report` implementation that throws would raise an uncaught exception in that timer rather than rejecting `startSession`'s promise; the function's own promise is unaffected by what `report` does. Second, the registration is unconditional on every call and the Link keeps at most one callback, so what happens when the same Link is started twice depends on `whenSettled`'s replacement behaviour, which the step on `whenSettled` covers.

Nothing else in the repository calls `startSession` or supplies a `report`; the two source files are all there is, and there are no tests. Who provides `report` and what it does with `'session ready'`, `'offline mode'` and `'retrying later'` is outside this change and cannot be read here.

#### W1.2 What a Link now carries

- Outcome, the new fields and the constructor: `src/link.ts` target lines 5–11

This step leaves the execution order for a moment. `startSession` has just handed the Link a callback and is about to ask it to connect; before following that call, it helps to see what a Link now keeps between calls, because the next steps all read or write this state. In the earlier revision a Link held only its `Transport` and passed the transport's boolean straight through; now it is an object with a small life of its own.

Four names matter:

- **`Outcome`** is an exported two-member string union, `'connected' | 'gave-up'`. It replaces the boolean that `connect` used to return: it is `connect`'s return type, the parameter type of `settle`, and the argument type of the callback `whenSettled` accepts, which is why `startSession` imported it in the previous step. There is no third member; "still trying" is not an outcome a caller can ever be handed.
- **`attempts`** is a private instance field starting at 0. Only `connect` writes it (it resets it on entry and increments it once per round) and only `connect` reads it, in the loop condition and in the length of the pause between rounds. Keeping it on the instance rather than as a local inside `connect` changes one thing: there is one counter per Link, shared by every `connect` call on it. The reset at the start of `connect` means a fresh call does not inherit the previous count, but two `connect` calls in flight on the same Link would be counting on the same field; nothing in the code prevents that.
- **`onSettled`** holds either one callback taking an `Outcome`, or `null`, and starts as `null`. It is a single slot, not a list. `whenSettled` writes into it (next step) and `settle` reads it and clears it (a later step). What `startSession` registered in the first step will sit here.
- **`maxAttempts`** is a second constructor parameter with default 3, declared `private readonly`, so it is fixed when the Link is created and bounds how many times `connect` will call `transport.open`. No code in the repository constructs a Link at all, so nothing here overrides the default; whether a caller outside the change does is not something this code can show.

The reader takes these names onward: the next step shows `onSettled` being written, and the `connect` step shows `attempts` and `maxAttempts` in use.

**Show more:**

The constructor uses TypeScript parameter properties: `constructor(private readonly transport: Transport, private readonly maxAttempts = 3)` both declares the two fields and assigns them from the arguments, so there is no separate field declaration or assignment to look for. `readonly` is enforced by the type checker only, as is `private`; neither is a runtime barrier. Within the two files of this repository nothing besides `Link`'s own methods touches any of the four fields, but that is a statement about this code, not a guarantee the language gives.

The default of 3 is a plain parameter default, so a caller can pass any number. A `maxAttempts` of 0 or less would make the `while` condition in `connect` false before the first round, and `connect` would settle and return `'gave-up'` without ever calling `transport.open`. The code does not validate the value; this is what it allows, not something any caller in the repository does.

Because `onSettled` holds a reference to the closure `startSession` created, and that closure captures `report`, a Link that has been given a callback but never asked to connect keeps that callback, and whatever `report` closes over, reachable for as long as the Link itself lives. The slot is only emptied by `settle`.

#### W1.3 whenSettled stores the callback

- whenSettled: `src/link.ts` target lines 13–15 ← from startSession calls link.whenSettled (`src/session.ts` 4–4)

Back in execution order: `startSession`'s registration line calls into the Link, and this is all that call does. `whenSettled` assigns the callback to the `onSettled` slot seen in the previous step and returns. It is synchronous, returns nothing, and neither calls, wraps nor checks the callback. The callback `startSession` built, the one that turns an `Outcome` into `'session ready'` or `'offline mode'`, now sits in the Link, and nothing will run it until `settle` reads the slot (two steps on).

The one thing to judge here is that this is a plain assignment, not an addition to a list. **A second `whenSettled` call replaces the first callback, and the replaced callback is simply dropped: it is never notified.** The Link can have at most one listener at a time, and there is no way to remove a listener except `settle` clearing the slot, and no handle is returned that would let a caller undo its own registration.

That matters because of how `startSession` uses it: every `startSession` call registers unconditionally. Two `startSession` calls on the same Link, the second arriving before the first has settled, would leave only the second caller's callback in the slot; the first caller would never receive its `'session ready'` or `'offline mode'`. The code allows this; nothing in the repository does it, and there are no tests exercising it.

From here control returns to `startSession`, which next awaits `link.connect`.

**Show more:**

Nothing like this method existed in the earlier revision; the whole notification channel, the slot and the method that fills it, is new in this change.

Because `settle` reads the slot only at the moment it runs, the assignment here is also effective if it happens while a `connect` is already in flight on the Link: whatever is stored when `settle` runs is what gets notified. So the order `startSession` chose, register then connect, is sufficient for its own callback to be the one found, but it is not protected against a later registration from elsewhere overwriting it during the attempts.

#### W1.4 connect makes its first attempt, and it succeeds

- connect: the attempt loop and the success branch: `src/link.ts` target lines 17–25 ← from startSession awaits link.connect (`src/session.ts` 5–5)

`startSession` now awaits `link.connect`, and this is where the change does its real work. In the earlier revision `connect` was a one-line pass-through, `return this.transport.open(address)`, and the caller got the transport's boolean. Now `connect` owns the retrying and translates the boolean into an `Outcome`. The `Transport` interface itself is unchanged, so a transport written for the old Link still fits; what changed is how often it is asked and what the caller hears back.

The loop's shape, in the order it executes:

1. `attempts` is reset to 0, so each `connect` call starts counting afresh regardless of what an earlier call left behind.
2. The `while` condition `attempts < maxAttempts` is checked; with the default bound of 3 (as we saw in the state step) it is true.
3. `attempts` is incremented **before** `transport.open` is called, so during the first call it already reads 1. The counter means "attempts started", not "attempts failed".
4. `connect` awaits `transport.open(address)`. The transport does the actual opening; the Link only waits. There is no timeout here: a transport that never resolves leaves `connect`, and with it `startSession`, pending indefinitely.

This walk follows `open` resolving `true` on that first call. The `if` is taken, and two things happen in a fixed order: `this.settle('connected')` runs to completion, and only then does `return 'connected'` resolve `connect`'s promise. **The caller cannot see the result before `settle` has done its work**; what that work is, and why it is not the same as calling the callback, is the next step. The `pause` after the `if` is never reached on this path, and the loop does not come round again. The second walk returns to this same branch with `open` false.

One thing the reader should notice for judging the function: `open` is a boolean, and only `false` counts as a failed attempt. A transport that rejects instead of resolving is not caught anywhere in `connect`; that case is covered below.

**Show more:**

Because `connect` is an `async` function, everything up to its first `await` runs synchronously inside the caller's call: the reset, the condition check, the increment and the call into `transport.open` all happen before `startSession`'s own `await` yields. Only when `transport.open` returns a pending promise does control leave `connect`. The language guarantees this order; nothing in the code depends on it, but it is what the reader would see when stepping through.

Nothing in `connect` handles a rejected promise from `transport.open`. If the transport throws, the rejection propagates out of `connect` unchanged: `settle` is never called, so `onSettled` keeps the callback `startSession` registered, and `startSession`'s `await` throws, rejecting `startSession`'s promise. The caller then hears neither `'session ready'` nor `'offline mode'` nor `'retrying later'`, and the stale callback would be the one picked up by whichever `connect` next settles on that Link. Whether any transport in use rejects cannot be read here; the interface promises a boolean, and the code is written as if it always gets one.

After a successful first attempt `attempts` is left at 1 until the next `connect` resets it; nothing reads it in between.

#### W1.5 settle hands the outcome to a timer

- settle: `src/link.ts` target lines 32–38 ← from connect calls this.settle('connected') (`src/link.ts` 23–23)

`connect` calls `settle('connected')` synchronously, in the moment it knows the outcome and before it returns. `settle` is the only place that ever reads the `onSettled` slot, and it is where the callback `startSession` registered is finally used. Three things happen, and each one shapes what the caller will experience.

1. **The callback is taken out of the slot, and the slot is cleared, before anything else.** `settle` copies `onSettled` into a local and sets the field to `null`. From this moment the Link has no listener. Whatever is done with the local copy, the registration has been consumed: one `whenSettled` yields at most one notification, and a second `settle` on the same Link, for example from a later `connect`, would find nothing unless someone registers again.
2. **If nothing was registered, nothing happens.** The `null` check means a Link used without `whenSettled` settles silently; `connect` still returns its `Outcome`, so the return value is the channel that always works and the callback the one that works only when asked for.
3. **The callback is not called here. It is handed to `setTimeout` with a delay of 0.** The arrow `() => callback(outcome)` captures the outcome value as it is now, so the callback will be told `'connected'` whatever happens to the Link in the meantime. But it will be told later: a timer callback runs as a separate macrotask, and the host runs every pending promise continuation (microtask) before it starts any timer. The continuation that `connect`'s `return` creates in `startSession` is such a microtask. So the order is fixed by the event loop's rules, not by luck: `connect` returns, `startSession` resumes and runs to the end, and only after that does the timer fire the callback.

What the reader carries to the next step: `connect` is about to return `'connected'` to `startSession` while the `'session ready'` notification is scheduled but not yet delivered.

**Show more:**

Why the deferral is there is not written in the code; what the code shows is its effect. Calling the callback directly would run `report` inside `connect`'s own call stack, where a throw from `report` would reject `connect` and with it `startSession`, and where the callback would observe the Link before `connect` has returned. With the timer, the callback runs on an empty stack: an exception thrown by `report` there becomes an uncaught exception in the host (an `uncaughtException` in Node, a window error in a browser), not a rejection that any `await` can catch. Nothing in `settle` or the timer closure catches it.

A delay of 0 is a lower bound, not a promise of immediacy: Node clamps it to at least 1 ms, and browsers may clamp further. The code relies only on the relative ordering, timer after microtasks, which holds for any clamping. It does not rely on, and cannot give, any particular elapsed time.

The timer's handle is discarded, so once `settle` has scheduled the callback it cannot be cancelled. Replacement through `whenSettled`, as we saw earlier, only affects a callback still in the slot; a callback that `settle` has already taken will fire even if the Link is dropped or re-registered before the timer runs.

Because the slot is cleared synchronously here, a callback that calls `whenSettled` again from inside the timer registers for the next settle, not this one, and its registration survives. In the second walk `settle` is reached from the other call site with `'gave-up'`, and the same deferral is what puts `'retrying later'` ahead of `'offline mode'`.

`setTimeout` is used as a global, with no clock or scheduler passed in, so the deferral is real host time in every environment this module runs in; there are no tests in the repository, and testing this ordering would need the host's timers or fakes of them.

#### W1.6 startSession resumes with 'connected'

- startSession after connect returns: `src/session.ts` target lines 5–8 ← from connect returns 'connected' (`src/link.ts` 24–24)

`connect`'s promise has resolved with `'connected'`, and `startSession` picks up again at its `await`. That resumption is a promise continuation, a microtask, so it runs before the timer `settle` scheduled in the previous step; the callback is still waiting when these lines execute.

On this path there is little to do. `outcome` is `'connected'`, the `if (outcome === 'gave-up')` is false, and the branch that would call `report('retrying later')` is skipped. `startSession` reaches its end and its own promise resolves, with nothing. **`startSession` itself reports nothing on the success path.** The only text the caller will receive, `'session ready'`, is the callback's, and it has not run yet.

That is the point to hold on to when judging the function's contract: the direct branch after the `await` is only for the failed outcome, while the success text travels solely through the callback registered in the first step and arrives after `startSession` has completed. A caller that awaits `startSession` and then expects to have heard `'session ready'` already would be wrong; the resolution of `startSession`'s promise says only that `connect` returned.

Next, the timer fires and the callback delivers the one report of this walk.

**Show more:**

Whoever awaits `startSession` resumes in a microtask of their own, queued when `startSession`'s promise resolves here. That continuation also runs before the timer, because the host drains the whole microtask queue, including continuations queued by other continuations, before it starts a timer callback. So not only `startSession` but also its caller's code after `await startSession(...)` runs before `'session ready'` is reported. This follows from the event loop's rules, not from anything observed; the repository has no caller and no tests.

The two tests `startSession` makes point in opposite directions: the callback tests for `'connected'` and treats everything else as `'offline mode'`, while this branch tests for `'gave-up'` and treats everything else as success. With `Outcome` having exactly two members the two agree; they would diverge if a third member were ever added.

In the earlier revision the function ended at the `await` and discarded the boolean; the branch here and the texts are all new, and the second walk shows the path on which the branch is taken.

#### W1.7 The timer fires: 'session ready'

- The settled callback body: `src/session.ts` target lines 4–4 ← from the timer scheduled by settle calls callback('connected') (`src/link.ts` 36–36)

The walk returns to the line it started on, but now as code that runs rather than code that registers. The timer `settle` scheduled has fired, and the host calls `callback('connected')`; `callback` is the arrow function `startSession` passed to `whenSettled` in the first step. It executes in the timer's context: on an empty call stack, with no `startSession` frame above it, after `startSession`'s promise has resolved and after whoever awaited it has resumed. Nothing about where the arrow was written changes where it runs.

The body is the one mapping: `outcome === 'connected'`, so `report` is called with `'session ready'`. This is the only call to `report` on the success path, and it is the first thing the caller hears about the connection, arriving after `startSession` is already done. `report`'s return value is ignored, and the Link's `onSettled` slot is already empty, so nothing further is pending on this Link.

**The success path yields exactly one report, `'session ready'`, delivered asynchronously after `startSession` has completed.** That is the behaviour the reader should check against what the caller expects: a function that resolves silently and reports a moment later through a callback it was given, not through its return.

**Show more:**

`report` is reachable here only because the arrow function closed over `startSession`'s parameter; the function has returned, but its closure keeps the reference alive until the timer has run. This is ordinary closure behaviour and the reason the Link never needed to be told about `report`.

The callback has no `this` and touches no Link state, so running it late is harmless to the Link. If `report` throws, the exception leaves the timer callback uncaught; `settle` wrapped nothing in a handler, and no promise is involved at this point, so no `await` anywhere can catch it.

The whole walk in one line, in execution order: register the callback, start `connect`, first `transport.open` resolves `true`, `settle` takes and clears the callback and schedules it, `connect` returns `'connected'`, `startSession` resumes and resolves, its caller resumes, then the timer fires and `report('session ready')` runs. The second walk follows the same registration into a `connect` whose every attempt fails.

### W2 (walk): Giving up after every attempt fails

*Purpose:* How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.

#### W2.1 Back at the branch: open is false

- The untaken branch and the pause: `src/link.ts` target lines 22–27

This walk begins where the first one branched. Everything before is the same: `startSession` registered its callback, `connect` reset `attempts`, incremented it to 1 and awaited `transport.open`. The difference is the value that came back: `open` is `false`. The `if` is skipped, so neither `settle` nor `return` runs, and `connect` falls through to the line after it.

That line is `await pause(this.attempts * 100)`. The argument is computed now, from the current count: `attempts` is 1 after the first failure, so `connect` waits 100 ms; it will be 200 ms after a second failure and 300 ms after a third. The delay grows in a straight line with the attempt number, the 100 is a literal in the code, and there is no cap and no randomisation. What `pause` does with that number is the next step; for now, `connect` is suspended at this `await` with the Link's state untouched: `attempts` holds the count, and `onSettled` still holds the callback.

The structural point to notice for judging the loop is **where the pause sits: inside the body, after the failed attempt, with the exit condition checked only at the top of the `while`.** So the pause is awaited after every failure, including the last one. After the third failure `connect` still waits its 300 ms before the loop comes round, finds `attempts < maxAttempts` false, and gives up. That final wait precedes nothing; no further attempt follows it. With the default bound the pauses alone add up to 600 ms before a caller can hear `'gave-up'`, on top of whatever time the three `transport.open` calls take.

In the earlier revision a `false` from the transport went straight back to the caller as the return value. Now a failure is absorbed into retrying, and the caller is told nothing about it until the loop has finished.

**Show more:**

Because `Outcome` has no member for "failed, retrying" and `attempts` is private, a caller cannot tell a connection that opened on the third try from one that opened at once; the count is used only for the pause length and the bound, and is never reported.

The multiplication reads `this.attempts` at the moment `pause` is called, so the delay is fixed when the wait starts. The 600 ms is a lower bound rather than a measurement: each `setTimeout` delay is a minimum the host honours, and the repository contains no test or run that observes how long `connect` actually takes.

While `connect` sits at this `await`, the Link is in the same state a caller sees between the registration and the first attempt, so a `whenSettled` call arriving during a pause would replace the stored callback just as described earlier.

#### W2.2 pause waits on a real timer

- pause: `src/link.ts` target lines 41–43 ← from connect awaits pause (`src/link.ts` 26–26)

`pause` is the small helper `connect` awaits after a failed attempt. It is a module-level function, not exported and not a method of `Link`, and `connect` is its only caller. It does one thing: it creates a promise and passes that promise's `resolve` function straight to `setTimeout` as the timer callback, with the requested delay. When the timer fires, the host calls `resolve` with no arguments, the promise resolves with `undefined`, and `connect`'s continuation is queued as a microtask and runs in that timer's turn.

Three properties of this code decide what the wait means for the loop:

- **The wait is real elapsed time.** `setTimeout` is the host's global, with no clock or scheduler passed in, so the 100, 200 and 300 ms from the previous step are honoured by the host's timer, not by anything the Link controls.
- **There is no way to cut it short.** The timer handle is discarded and the promise has no reject path, so once `connect` is waiting, nothing in this code can wake it earlier; a caller that no longer wants the connection has no handle to cancel through.
- **The promise cannot fail.** `pause` never rejects, so the `await` in `connect` always resumes normally; a failure of the transport is the only way out of the loop other than exhausting the attempts.

When the timer fires, `connect` resumes on the line after its `await`, which is the end of the loop body, and the `while` condition is checked again; that is the next step.

**Show more:**

Nothing of this existed in the earlier revision, which never waited. `pause` and `settle` both use the global `setTimeout`, but for different reasons: `settle` uses a delay of 0 purely for ordering, letting promise continuations run first, while `pause` uses the delay for its duration. Because `pause` is a private module function and the timer is the global, a test could only shorten these waits by replacing the global timer functions; the repository has no tests, so how, or whether, that is done is not something this code shows.

In Node an active timer keeps the event loop alive, so a process whose only pending work is a `connect` in one of these pauses stays running until the pause ends. `setTimeout` treats its delay as a minimum, so each pause is at least the requested time, and the actual resumption can be later under load.

#### W2.3 The loop comes round for another attempt

- The loop condition and the next attempt: `src/link.ts` target lines 19–21

The pause's timer has fired and `connect` resumes at the end of the loop body, which brings it back to the `while` condition. `attempts` is 1 and `maxAttempts` is 3 by default, so `attempts < maxAttempts` holds, the body starts again, `attempts` becomes 2, and `transport.open(address)` is awaited a second time. The transport receives exactly the same call as before: the same address and nothing else. **The Link does not tell the transport that this is a retry**, and the `Transport` interface has no close or reset, so whether a transport can be asked to open again after answering `false` is entirely the transport's affair.

This walk follows every attempt failing, so each round runs the same sequence: increment, `open` resolves `false`, the `if` is skipped, pause. With the default bound:

| Round | `attempts` during `open` | Result | Pause after |
| --- | --- | --- | --- |
| 1 | 1 | `false` | 100 ms |
| 2 | 2 | `false` | 200 ms |
| 3 | 3 | `false` | 300 ms |

After the third pause the condition reads 3 < 3, which is false, and the loop ends. `transport.open` is called at most `maxAttempts` times, three here, and there are only two ways out of the loop: `open` resolving `true`, which the first walk followed, or the bound being reached. The reader takes to the next step that `connect` leaves the loop without having connected and still has the registered callback in its slot.

**Show more:**

The condition reads the instance field `attempts`, not a local, so the bound is only as reliable as that field. A second `connect` call on the same Link while this one is pausing would reset `attempts` to 0 and begin its own count on the same field; each loop would then see the other's increments and the total number of `transport.open` calls could exceed three. The code allows this; nothing in the repository makes overlapping calls, and nothing guards against them.

A transport that rejects rather than resolving in any round leaves the loop by exception, as noted in the first walk; that path reaches neither the pause nor the gave-up exit.

#### W2.4 connect gives up

- The gave-up exit of connect: `src/link.ts` target lines 28–29

The third pause has ended, the `while` condition has read 3 < 3 and failed, and `connect` continues after the loop. Two statements remain, and they mirror the success branch exactly: `settle` first, then `return`, with a different literal.

`settle('gave-up')` does what it did in the first walk: it takes the callback out of `onSettled`, empties the slot, and hands `callback('gave-up')` to `setTimeout` with delay 0. The value is captured in the timer's closure now, so the callback will be told `'gave-up'` regardless of what happens next. Then `return 'gave-up'` resolves `connect`'s promise, which queues `startSession`'s continuation as a microtask.

**Giving up is a normal return, not an error.** No exception is thrown and no reason travels with the outcome; the transport said `false` three times and the caller learns only the word `'gave-up'`. The Link itself schedules nothing further: `attempts` is left at 3, the slot is empty, and no retry is pending anywhere in this code. A fresh `connect` on the same Link would start the count again, but would notify nobody unless `whenSettled` is called first.

The reader takes to the next step that two things are now queued at once, the caller's continuation and the timer, and that the host's rules decide which runs first.

**Show more:**

The two exits of `connect` are built the same way on purpose, as far as the code shows: in both, `settle` runs synchronously before the `return`, so the caller never sees an `Outcome` whose notification has not already been scheduled, and in both the deferral through the timer is what separates the return value from the callback. On this path four host timers have been involved by now, three for the pauses and this one for the notification; only the last carries the callback.

In the earlier revision a transport that answered `false` once made `connect` resolve `false` at once and `startSession` ignored it. Now the same transport is asked three times over at least 600 ms before `'gave-up'` is produced, and the result reaches the caller twice, through the return value and through the callback, in the order the next two steps show.

#### W2.5 startSession reports 'retrying later' first

- startSession's gave-up branch: `src/session.ts` target lines 5–8 ← from connect returns 'gave-up' (`src/link.ts` 29–29)

`connect`'s promise has resolved with `'gave-up'`, and `startSession` resumes at its `await`. As in the first walk, that resumption is a promise continuation, a microtask, and the host runs every queued microtask before it starts any timer. The timer `settle` just scheduled is therefore still waiting when these lines run. **This ordering is what makes `'retrying later'` the first text `report` receives on this path**; it follows from how promise continuations and `setTimeout` are ordered by the language and the host, not from anything observed, since the repository has no tests and no caller.

This time the branch is taken: `outcome === 'gave-up'` is true, and `startSession` calls `report('retrying later')` directly, synchronously, in its own context. Then the function ends and its promise resolves. So on this path the caller hears something before `startSession` completes, which it never does on the success path, and this report is the one `startSession` makes itself rather than through the Link.

Two things about this branch are worth weighing. First, `report` is called on `startSession`'s own stack here, so a `report` that throws rejects `startSession`'s promise; the callback's call to `report`, running from a timer, cannot do that. The two calls to `report` in this function thus fail differently. Second, the words `'retrying later'` describe nothing the code does: neither `startSession` nor the Link schedules any further attempt after `connect` has given up. The text is a message to the caller, and whether anything retries later is outside this change.

The reader takes to the next step that the callback `settle` took from the slot has not yet run, and that a second text is still to come.

**Show more:**

The caller's own continuation, the code after `await startSession(...)`, is queued when `startSession`'s promise resolves here and also runs before the timer, for the same reason: microtasks queued by microtasks are drained in the same pass. So a caller sees, in order, `report('retrying later')`, its own resumption, and only then the timer's report.

The same `'gave-up'` thus produces two texts, `'retrying later'` from this branch and `'offline mode'` from the callback, through two channels with different timing. The code shows that both are sent; it does not show what a `report` implementation is expected to make of receiving both for one outcome, and no caller in the repository answers that.

#### W2.6 The timer fires: 'offline mode'

- The settled callback body: `src/session.ts` target lines 4–4 ← from the timer scheduled by settle calls callback('gave-up') (`src/link.ts` 36–36)

The timer `settle` scheduled at the gave-up exit fires, and the host calls `callback('gave-up')`. The callback is the same arrow function `startSession` registered at the start of both walks; it runs here in the timer's context, on an empty stack, after `startSession` has resolved and after its caller has resumed. The mapping takes its other branch: `outcome === 'connected'` is false, so `report` is called with `'offline mode'`.

This is the second text the caller receives for one failed connection, and the later one. `'retrying later'` came from `startSession` itself, before it returned; `'offline mode'` comes from the Link's deferred notification, after. A `report` implementation that treats each text as the current state will end on `'offline mode'`; one that acts on the first text it sees will act on `'retrying later'`. The code sends both and fixes their order; it does not say which one is meant to count.

The Link is now spent as a notifier. `settle` emptied `onSettled` before scheduling this timer, so **a further `connect` on the same Link would produce an `Outcome` but notify nobody unless `whenSettled` is called again first.** `startSession` always does call it, so going through `startSession` again is safe in that respect; calling `connect` directly after this point is not.

The whole path, in execution order: three calls to `transport.open`, each answered `false`; three pauses of 100, 200 and 300 ms, the last one before nothing; `settle` takes the callback and schedules it; `connect` returns `'gave-up'`; `startSession` reports `'retrying later'` and resolves; its caller resumes; the timer fires and `report('offline mode')` runs.

**Show more:**

As on the success path, `report` is reachable only through the closure, and an exception it throws here is uncaught in the timer rather than visible to any `await`. The text `'offline mode'`, like `'retrying later'`, names a state the code does not itself enter or maintain: the Link keeps no mode, and after this callback nothing in either file runs again until some caller acts. What a caller does with the two texts, and whether anything retries, lies outside the two files of this change and cannot be read here.

## The reviewer

### First verdict (turn 15)

**Verdict:** accept

**Assessment:** A Standard reader can follow both courses from startSession's registration (src/session.ts target 4) through whenSettled (src/link.ts target 13-15), the attempt loop (target 17-27), settle's copy-clear-and-schedule (target 32-38) and the two exits (target 22-24, 28-29), and back into startSession's branch (src/session.ts target 5-8) and the deferred callback (target 4). Every shown place is explained with its role in the change, the branch in W2 returns explicitly to the point where W1 took the success path, the departure from execution order in W1.2 is announced, and the teaching-order claims hold: settle runs before each return, the await continuation in startSession is a microtask and so precedes the 0 ms timer, the pause at line 26 is awaited after every failed attempt including the third, and the delays are 100, 200 and 300 ms from this.attempts * 100. The Show more parts deepen (type-only import, parameter properties, overlapping connect calls on the shared attempts field, rejection from transport.open leaving the callback in the slot, uncaught throws from report in the timer) rather than repeat. Two sentences are loosely worded but do not mislead: W1.4's Show more says control leaves connect only when transport.open returns a pending promise, whereas an await yields regardless, and the paragraph itself says nothing depends on it; W2.2's 'a failure of the transport is the only way out of the loop other than exhausting the attempts' omits the success exit the reader has just followed, and W2.3 states the two exits correctly in the next step. Neither changes what the reader understands of the mechanism, so nothing significant falls short and the walks are accepted as written.


## Every prompt the product sent, whole

### Turn 1: plan-walks (file-1)

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: plan-walks

## Your role: walk-planner
Plan a review's code walks so a reader can follow the change as the program runs: the steps, the one code place each shows, and how each is reached. Derived from docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.0, sections 1 to 3.

Plan the walks a person reads to understand and review one change between two revisions. A walk follows a behaviour or a review question through the code the way execution moves: an entry point, calls, returns, alternative outcomes, work handed to a worker or a callback. Its steps are the places where a reader needs to stop and understand something, in an order that carries the reasoning.

Read the revisions with your tools before you plan: the changed lines first, then what they call, who calls them, the types and the state they share, and what waits for or carries out what they ask. Decide from the code which behaviours or questions deserve a walk, where each enters, and where it goes.

Give every step one code place and its own purpose. A new or substantially changed function that is central to the course gets a step of its own at the point where the reader needs it; a side deepening gets a reference. An alternative outcome is a path of its own that starts again at the branch point. Work that moves to a thread or a callback is a step that says what starts it and which context is followed. Where the teaching order differs from the execution order, the brief says so.

Write a brief for the writer on every step: what the step must make comprehensible, how it is reached and what the reader takes to the next step. The writer explains the step with your whole plan and the code; your brief is its orientation, not its text.

On a later visit you are given a reviewer's findings about the structure. Act on each one and change nothing else: a step you keep keeps its title and places, so its explanation can be kept.

You write no explanation text; the writer does. You approve nothing and decide nothing about the review. Do not invent a direction or a call chain to fit the walk form, do not add steps to touch every changed line, and never present a path you read as one you observed running.

One JSON object in a fence, in the shape the call describes: the change's summary and background, the walks and readings, their steps with title, summary, brief and places, each place with a path, a side and lines that exist at that revision. DSpatch checks every place against the commits and asks you once to correct what does not exist.

## What to produce
Items around behaviours, questions or coherent changes the change touches, for example "What happens when the user cancels?", not a file-by-file listing.
Each item has a plain title and a purpose: one short sentence on what it helps the person understand. Its steps have concrete code references, across files where the behaviour goes.
A step may point at unchanged code when it is needed to understand the change: the definition a changed line calls, a caller, the test that exercises it, the configuration that switches it on. Point at it where it is, at the side it is read from.
Error handling, tests, configuration and removed behaviour may need items of their own.
An item is not a review and approves nothing.

## Code walks and readings
- Choose the form of each item from what changed. A change can get code walks, readings, or both.
- A **code walk** ("kind": "walk") follows a relevant execution path from a concrete entry point or event: a button press, a request, a call, a test. Go through calls, conditions and data roughly as the program runs. Include unchanged code where it is needed to understand the change. Show the relevant steps, not every call.
- At each hop of a code walk, say briefly how the step is connected to the one before (what calls it, what data it receives). When a place is reached from a call or reference you show elsewhere, give the call or reference as the `from` field of that place.
- Where the path forks, each alternative is a path of its own: after following one outcome, return to the branch point and say which condition applies in the one you follow now. Never present alternatives as if they ran one after another in a single run.
- Where work moves to another thread, a worker or a callback, say what starts or triggers it and which execution context the next step follows. That a step comes next in the walk does not mean its code is called from the step before, nor that the work only starts there.
- Teaching order may differ from execution order: when you follow one path first and then switch to another, look at a failure path, or take a mechanism apart on its own, say so in the step's explanation. For configuration, data types and tests, a dependency or a use may be the natural route through the code; do not force a fictional execution sequence.
- A code walk describes code you read. You did not run it: never say a flow was executed, observed or verified unless a test result in the material shows it.
- A **reading** ("kind": "reading") is for documentation and other text where following execution means nothing. It takes one coherent change of text in its context: what changes, and what it means.
- One reading per coherent change, not one per paragraph or diff block. Independent changes of text are separate readings.
- A reading jumps to another place only when there is a real connection: a definition, a reference, or a contradiction.
- Never invent a direction or a call chain to fit the walk form, and do not add steps only to touch every changed line. Changed lines no item covers are shown to the person as not covered; that is better than an empty step.

## One place per step
- Each step normally shows **one code place**, with an explanation written for that place. The order of the steps carries the reasoning: a later step builds on the earlier ones ("in the previous step…", "as we saw earlier").
- Places that each need their own explanation and are visited in turn are separate steps. For example, declaring an option, passing it on and using it are three steps, each explaining its own place, not one step with three places and one shared text.
- The old and the new lines of the same change, From and To, are one place, not two.
- Put several places in one step only as an exception, when seeing them side by side is what helps the reader understand, for example to compare two implementations of the same thing. Then give the step a "together" field: one short sentence on why seeing these places together helps. A step with several places and no "together" is asked to be split.
- A place is not treated because it is in a step or because its function is named: every central mechanism a step shows is explained in that step, at the reader's level. When one step would have to treat several such places in passing, they are separate steps.

## A coherent path
- A code walk is a coherent path through the important connections of what it explains. For each new or substantially changed function the path calls, judge whether it is central: if understanding the main course needs its implementation, give it a step of its own at the point in the reasoning where the reader needs it; if it is a relevant side deepening, point at it with a reference the reader can follow.
- Choose by what the reader needs to understand the behaviour and its risks, not by call order, and do not follow every call mechanically. A self-explanatory name is not a reason to leave out an important new implementation.
- That a function is explained in another walk is no reason to leave out an explanation this walk needs: give it a focused step here, or point at that walk's step when that is the right deepening.
- Check facts in the code rather than assuming them from names: for example, that a start function returned does not mean the service it starts is connected or initialised; read what it does.
- Do not add a step that shows the same caller code again only to travel between two functions it calls: the caller's step stays as orientation, and the next step's explanation makes the short transition ("after starting the worker, the caller subscribes…"). Show a place again only with a new purpose, and then say what is new to see there in the step's "revisit" field.

## For the writer
A writer explains each step in a call of its own, with this whole plan and the code. You write no explanation: each step carries a "brief" for the writer, one to three sentences on what the step must make comprehensible, how it is reached (a call, a return, back at a branch point, a worker or callback and the context followed) and what the reader takes to the next step. A step's "summary" is the one line the person reads in the overview.

## About the change
- "summary": a short paragraph a person reads first: what the change does and why.
- "background": only when there is more worth knowing (context, history, consequences), in short Markdown paragraphs. Leave it empty rather than repeating the summary.
- Write in English.

## Answer format
When you have examined what you need, answer with one JSON object in a ``​`json fence and nothing else:
``​`json
{
  "summary": "A short paragraph: what the change does and why.",
  "background": "Optional: more context, in short Markdown paragraphs. Empty when the summary says it.",
  "walks": [
    {
      "kind": "walk",
      "title": "A behaviour or question",
      "question": "The question the item answers",
      "purpose": "One short sentence: what the person will understand.",
      "steps": [
        {
          "title": "Short step title",
          "summary": "A short line: what happens here.",
          "brief": "For the writer: what this step must make comprehensible, how it is reached and what the reader takes to the next step.",
          "places": [
            {
              "label": "What this place is",
              "path": "src/file.ts",
              "side": "target",
              "start": 10,
              "end": 14,
              "anchor": "a short exact text from those lines",
              "from": {
                "label": "Optional: the call that leads here",
                "path": "src/caller.ts",
                "side": "target",
                "start": 40,
                "end": 40
              }
            }
          ],
          "together": "Only for a step with several places: one short sentence on why seeing them side by side helps. Leave it out otherwise.",
          "revisit": "Only for a step that shows a place an earlier step of the walk already showed: what is new to see there now. Leave it out otherwise."
        }
      ]
    },
    {
      "kind": "reading",
      "title": "A coherent change of text",
      "question": "What changes in it, and what it means",
      "purpose": "One short sentence.",
      "steps": [
        "…"
      ]
    }
  ]
}
``​`
Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side; so does "from" when given. "anchor", when given, is text that occurs on those lines. DSpatch checks every place against the commit. Write no "body" and no "details": the writer writes them.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit 62ff871b335f1442c3d0f1e94cd43d9ce41775f9
- `target/` is To, commit 189fb0f3633de8828762469c5262faaef5485db0
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: connect
From: 62ff871b335f1442c3d0f1e94cd43d9ce41775f9 (base commit)
To: 189fb0f3633de8828762469c5262faaef5485db0 (target commit)
Line numbers are 1-based; "base" is From and "target" is To.

## Changed lines (machine-readable)
``​`json
[{"path":"src/link.ts","side":"base","start":6,"end":6},{"path":"src/link.ts","side":"base","start":8,"end":9},{"path":"src/session.ts","side":"base","start":1,"end":1},{"path":"src/session.ts","side":"base","start":3,"end":4},{"path":"src/link.ts","side":"target","start":5,"end":6},{"path":"src/link.ts","side":"target","start":8,"end":15},{"path":"src/link.ts","side":"target","start":17,"end":29},{"path":"src/link.ts","side":"target","start":31,"end":42},{"path":"src/session.ts","side":"target","start":1,"end":1},{"path":"src/session.ts","side":"target","start":3,"end":8}]
``​`

## Changed files
- modified src/link.ts
- modified src/session.ts

## Diff (orientation)
``​`diff
diff --git a/src/link.ts b/src/link.ts
index fb384c7..5aa3be3 100644
--- a/src/link.ts
+++ b/src/link.ts
@@ -2,10 +2,42 @@ export interface Transport {
   open(address: string): Promise<boolean>;
 }
 
+export type Outcome = 'connected' | 'gave-up';
+
 export class Link {
-  constructor(private readonly transport: Transport) {}
+  private attempts = 0;
+  private onSettled: ((outcome: Outcome) => void) | null = null;
+
+  constructor(private readonly transport: Transport, private readonly maxAttempts = 3) {}
+
+  whenSettled(callback: (outcome: Outcome) => void): void {
+    this.onSettled = callback;
+  }
 
-  async connect(address: string): Promise<boolean> {
-    return this.transport.open(address);
+  async connect(address: string): Promise<Outcome> {
+    this.attempts = 0;
+    while (this.attempts < this.maxAttempts) {
+      this.attempts += 1;
+      const open = await this.transport.open(address);
+      if (open) {
+        this.settle('connected');
+        return 'connected';
+      }
+      await pause(this.attempts * 100);
+    }
+    this.settle('gave-up');
+    return 'gave-up';
   }
+
+  private settle(outcome: Outcome): void {
+    const callback = this.onSettled;
+    this.onSettled = null;
+    if (callback !== null) {
+      setTimeout(() => callback(outcome), 0);
+    }
+  }
+}
+
+function pause(ms: number): Promise<void> {
+  return new Promise((resolve) => setTimeout(resolve, ms));
 }
diff --git a/src/session.ts b/src/session.ts
index e2703e3..4c16d70 100644
--- a/src/session.ts
+++ b/src/session.ts
@@ -1,5 +1,9 @@
-import { Link } from './link';
+import { Link, type Outcome } from './link';
 
-export async function startSession(link: Link, address: string): Promise<void> {
-  await link.connect(address);
+export async function startSession(link: Link, address: string, report: (text: string) => void): Promise<void> {
+  link.whenSettled((outcome: Outcome) => report(outcome === 'connected' ? 'session ready' : 'offline mode'));
+  const outcome = await link.connect(address);
+  if (outcome === 'gave-up') {
+    report('retrying later');
+  }
 }
``​`
```

</details>

<details><summary>Answer</summary>

```text
``​`json
{
  "summary": "Link.connect no longer makes a single attempt and returns the transport's boolean. It now tries up to maxAttempts times (3 by default), pausing 100 ms times the attempt number after each failed attempt, and returns an Outcome of 'connected' or 'gave-up'. A Link also accepts one settled callback through whenSettled, which connect fires once through settle: the callback is cleared and scheduled with setTimeout 0 rather than called directly. startSession gains a report callback: it registers a settled callback that reports 'session ready' or 'offline mode', awaits connect, and additionally reports 'retrying later' when connect gave up.",
  "background": "Both public signatures change for callers: connect returns Outcome instead of boolean, and startSession takes a third, required report parameter. The repository holds no other caller of either function and no tests at either revision, so everything in the walks is read from the code, not observed running.\n\nTwo consequences the walks make visible: the pause is awaited after every failed attempt, including the last, so giving up comes after a final wait; and because settle defers the callback with a timer while connect's return resumes startSession as a promise continuation, on the gave-up path 'retrying later' is reported before 'offline mode'.",
  "walks": [
    {
      "kind": "walk",
      "title": "Connecting on the first attempt",
      "question": "What happens when startSession is called and the transport opens on the first try?",
      "purpose": "How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.",
      "steps": [
        {
          "title": "startSession registers the settled callback",
          "summary": "The entry point now takes a report callback and hands Link a settled callback before connecting.",
          "brief": "Entry point. Make comprehensible the new third parameter `report` and that line 4 stores in the Link a callback that maps the outcome to 'session ready' or 'offline mode'; it is registered before connect because settle only notifies the callback stored at that moment (step 5). Nothing is reported here yet. The reader takes to the next step that the Link now holds a callback and is about to be asked to connect.",
          "places": [
            {
              "label": "startSession's new signature and the registration",
              "path": "src/session.ts",
              "side": "target",
              "start": 3,
              "end": 4,
              "anchor": "link.whenSettled"
            }
          ]
        },
        {
          "title": "What a Link now carries",
          "summary": "The Outcome type, the attempts counter, the stored callback and the maxAttempts bound.",
          "brief": "A pause in the execution order to look at the state the next steps use: the Outcome union, `attempts` as instance state rather than a local, `onSettled` holding at most one callback or null, and the constructor's `maxAttempts` with default 3, which no caller in the repository overrides. The reader takes these four names to the steps that write and read them.",
          "places": [
            {
              "label": "Outcome, the new fields and the constructor",
              "path": "src/link.ts",
              "side": "target",
              "start": 5,
              "end": 11,
              "anchor": "private readonly maxAttempts = 3"
            }
          ]
        },
        {
          "title": "whenSettled stores the callback",
          "summary": "The callback is kept in onSettled; nothing is called yet, and a later call replaces it.",
          "brief": "Reached from session.ts line 4. Make comprehensible that this only stores the callback in the `onSettled` field from step 2, that a second call replaces rather than adds, and that nothing runs until settle reads the field. The reader takes to the next step that startSession now awaits connect.",
          "places": [
            {
              "label": "whenSettled",
              "path": "src/link.ts",
              "side": "target",
              "start": 13,
              "end": 15,
              "anchor": "this.onSettled = callback;",
              "from": {
                "label": "startSession calls link.whenSettled",
                "path": "src/session.ts",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "connect makes its first attempt, and it succeeds",
          "summary": "attempts is reset, the loop opens the transport once, and open is true: settle('connected'), then return 'connected'.",
          "brief": "Reached from session.ts line 5. Make comprehensible the loop's shape: attempts reset to 0, the bound `attempts < maxAttempts`, the increment before each `transport.open`, and the branch at line 22. This walk follows `open` being true: settle is called first (next step) and only then does connect return. Line 26 is not reached on this path; the second walk starts again at line 22 for `open` false. The reader takes to the next step that settle runs before the caller sees the result.",
          "places": [
            {
              "label": "connect: the attempt loop and the success branch",
              "path": "src/link.ts",
              "side": "target",
              "start": 17,
              "end": 25,
              "anchor": "const open = await this.transport.open(address);",
              "from": {
                "label": "startSession awaits link.connect",
                "path": "src/session.ts",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "settle hands the outcome to a timer",
          "summary": "The stored callback is taken, the field cleared, and the callback scheduled with setTimeout 0 instead of being called directly.",
          "brief": "Reached from line 23. Make comprehensible three things: the callback is read and `onSettled` cleared, so it fires at most once per registration; nothing happens when no callback was registered; and the callback is not called here but scheduled as a timer with delay 0, so it runs in a later macrotask, after the promise continuations that connect's return triggers. The reader takes to the next step that connect now returns while the notification is still pending.",
          "places": [
            {
              "label": "settle",
              "path": "src/link.ts",
              "side": "target",
              "start": 32,
              "end": 38,
              "anchor": "setTimeout(() => callback(outcome), 0);",
              "from": {
                "label": "connect calls this.settle('connected')",
                "path": "src/link.ts",
                "side": "target",
                "start": 23,
                "end": 23
              }
            }
          ]
        },
        {
          "title": "startSession resumes with 'connected'",
          "summary": "The await resumes as a promise continuation, the gave-up branch is skipped, and startSession completes.",
          "brief": "Reached when connect's promise resolves with 'connected' (line 24); the continuation runs as a microtask, before the timer from step 5. Make comprehensible that on this path the `if` is false, so startSession reports nothing itself and its own promise resolves. The reader takes to the next step that the only report on this path is still to come, from the timer.",
          "places": [
            {
              "label": "startSession after connect returns",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "const outcome = await link.connect(address);",
              "from": {
                "label": "connect returns 'connected'",
                "path": "src/link.ts",
                "side": "target",
                "start": 24,
                "end": 24
              }
            }
          ]
        },
        {
          "title": "The timer fires: 'session ready'",
          "summary": "The callback registered in step 1 runs from the timer and reports 'session ready', after startSession has already completed.",
          "brief": "A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context, not in startSession's. Make comprehensible that this is where `report` is called on the success path, with 'session ready', and that it happens after startSession's promise has resolved. The reader leaves the walk knowing the success path yields exactly one report, delivered asynchronously.",
          "places": [
            {
              "label": "The settled callback body",
              "path": "src/session.ts",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "'session ready'",
              "from": {
                "label": "the timer scheduled by settle calls callback('connected')",
                "path": "src/link.ts",
                "side": "target",
                "start": 36,
                "end": 36
              }
            }
          ],
          "revisit": "Step 1 showed this line as the registration; now it is the callback body executing with outcome 'connected'."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "Giving up after every attempt fails",
      "question": "When the transport never opens, how many attempts are made, how long does connect wait, and what does the caller hear, in which order?",
      "purpose": "How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.",
      "steps": [
        {
          "title": "Back at the branch: open is false",
          "summary": "The if at line 22 is not taken; connect pauses attempts times 100 ms before the loop comes round.",
          "brief": "Starts again at the branch point of the first walk's step 4, with the same entry and registration; this time `transport.open` resolved false. Make comprehensible that the `if` is skipped and `pause(this.attempts * 100)` is awaited: 100 ms after the first failure, 200 after the second, 300 after the third. The pause is awaited after every failed attempt, including the last one, because the loop condition is only checked at the top. The reader takes to the next step what pause does with that number.",
          "places": [
            {
              "label": "The untaken branch and the pause",
              "path": "src/link.ts",
              "side": "target",
              "start": 22,
              "end": 27,
              "anchor": "await pause(this.attempts * 100);"
            }
          ]
        },
        {
          "title": "pause waits on a real timer",
          "summary": "A module-level helper resolving a promise from setTimeout; connect resumes when the timer fires.",
          "brief": "Reached from line 26. Make comprehensible that this is a plain timer with no cancellation and no injected clock, so the wait is real elapsed time, and that connect's continuation resumes in the timer's context when it fires. The reader takes to the next step that after the wait the loop condition is checked again.",
          "places": [
            {
              "label": "pause",
              "path": "src/link.ts",
              "side": "target",
              "start": 41,
              "end": 43,
              "anchor": "setTimeout(resolve, ms)",
              "from": {
                "label": "connect awaits pause",
                "path": "src/link.ts",
                "side": "target",
                "start": 26,
                "end": 26
              }
            }
          ]
        },
        {
          "title": "The loop comes round for another attempt",
          "summary": "attempts < maxAttempts still holds, so attempts increments and the transport is opened again.",
          "brief": "Make comprehensible that each round increments `attempts` before calling `transport.open`, and that with the default maxAttempts of 3 (first walk, step 2) the body runs at most three times. This walk follows every attempt failing, so each round returns to step 1's pause; after the third failure and its 300 ms pause the condition is false. The reader takes to the next step that the loop exits without having connected.",
          "places": [
            {
              "label": "The loop condition and the next attempt",
              "path": "src/link.ts",
              "side": "target",
              "start": 19,
              "end": 21,
              "anchor": "while (this.attempts < this.maxAttempts)"
            }
          ]
        },
        {
          "title": "connect gives up",
          "summary": "After the loop, settle('gave-up') schedules the notification and connect returns 'gave-up'.",
          "brief": "Reached when the while condition fails. Make comprehensible that settle (first walk, step 5) runs with 'gave-up' exactly as with 'connected': it clears onSettled and schedules the callback on a timer with delay 0; then connect returns 'gave-up' and its promise resolves. The reader takes to the next step that two things are now pending: the caller's continuation and the timer.",
          "places": [
            {
              "label": "The gave-up exit of connect",
              "path": "src/link.ts",
              "side": "target",
              "start": 28,
              "end": 29,
              "anchor": "this.settle('gave-up');"
            }
          ]
        },
        {
          "title": "startSession reports 'retrying later' first",
          "summary": "The await resumes as a promise continuation, sees 'gave-up', and calls report before any timer runs.",
          "brief": "Reached from line 29. Make comprehensible, from the code, that this continuation is a microtask and runs before the timer settle scheduled, so 'retrying later' is the first text report receives on this path; startSession's promise then resolves. Say this follows from how promise continuations and setTimeout are ordered, not from a test, since the repository has none. The reader takes to the next step that the stored callback has not run yet.",
          "places": [
            {
              "label": "startSession's gave-up branch",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "report('retrying later');",
              "from": {
                "label": "connect returns 'gave-up'",
                "path": "src/link.ts",
                "side": "target",
                "start": 29,
                "end": 29
              }
            }
          ]
        },
        {
          "title": "The timer fires: 'offline mode'",
          "summary": "The callback from the registration runs from the timer and reports 'offline mode', after startSession has completed.",
          "brief": "A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context. Make comprehensible that this is the second report on this path, that it arrives after startSession has already returned, and that because settle cleared onSettled, another connect on the same Link would notify nobody unless whenSettled is called again. The reader leaves the walk with the sequence: three attempts, three pauses, 'retrying later', then 'offline mode'.",
          "places": [
            {
              "label": "The settled callback body",
              "path": "src/session.ts",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "'offline mode'",
              "from": {
                "label": "the timer scheduled by settle calls callback('gave-up')",
                "path": "src/link.ts",
                "side": "target",
                "start": 36,
                "end": 36
              }
            }
          ]
        }
      ]
    }
  ]
}
``​`

```

</details>

### Turn 2: write-step (file-2) · W1.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## Your role: walk-writer
Explain each step of a planned walk to the reader of the chosen profile, beside the code, from your own reading of it. Derived from docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.0, sections 2 to 4 and 6.

Write the explanation a person reads beside each step's code: what the code does here and why it matters for the change, how it connects to what the reader has seen and will see, and what the reader must understand to judge it. The plan tells you where the step sits; the profile tells you whom you help; the code tells you what is true.

Read the code the step rests on before you write it: callers, types, the other code that reads or writes the same state, and what waits for or carries out what this code asks. The plan's brief is orientation; it is not evidence, and your text rests on the code.

Keep the whole walk in view while you write one step. Say how the step is reached and what the reader takes onward where that would otherwise be unclear; recall what an earlier step established in a line rather than deriving it again; give a later step one sentence of orientation at most. Alternatives are alternatives, and a path you read is not a path you observed running.

Write for the reader the profile names: quick orientation at the right level of abstraction, the mechanism made understandable, or the concepts and intermediate reasoning built where the reader needs them. The scope follows the code and the reader: a simple step takes a few words, a step where several mechanisms interact takes the room understanding needs. The first part stands on its own; what goes after the marker continues it and does not repeat it.

On a later visit you are given a reviewer's findings about particular steps, or a changed plan. Write again only the steps named, acting on each finding; keep what was right.

Do not change the plan: its walks, steps, places and order are the planner's. Do not narrate your investigation, do not refer to the plan or these instructions in the text, and add no claim the code does not support. A walk is not a review: approve nothing and decide nothing about the review.

For each call, the explanation of that one step in Markdown and nothing else: the first part, then, when there is real depth to add, the marker line and the deepening.

## The walks
The plan below is the whole of what the person will read, in this order. You write one step per call, beside its code; the plan tells you what came before and what comes after.

### W1 (walk): Connecting on the first attempt
Purpose: How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Question: What happens when startSession is called and the transport opens on the first try?
- W1.1 startSession registers the settled callback — The entry point now takes a report callback and hands Link a settled callback before connecting.
  - startSession's new signature and the registration: src/session.ts (To) lines 3–4
  - Brief: Entry point. Make comprehensible the new third parameter `report` and that line 4 stores in the Link a callback that maps the outcome to 'session ready' or 'offline mode'; it is registered before connect because settle only notifies the callback stored at that moment (step 5). Nothing is reported here yet. The reader takes to the next step that the Link now holds a callback and is about to be asked to connect.
- W1.2 What a Link now carries — The Outcome type, the attempts counter, the stored callback and the maxAttempts bound.
  - Outcome, the new fields and the constructor: src/link.ts (To) lines 5–11
  - Brief: A pause in the execution order to look at the state the next steps use: the Outcome union, `attempts` as instance state rather than a local, `onSettled` holding at most one callback or null, and the constructor's `maxAttempts` with default 3, which no caller in the repository overrides. The reader takes these four names to the steps that write and read them.
- W1.3 whenSettled stores the callback — The callback is kept in onSettled; nothing is called yet, and a later call replaces it.
  - whenSettled: src/link.ts (To) lines 13–15 — reached from startSession calls link.whenSettled (src/session.ts target 4–4)
  - Brief: Reached from session.ts line 4. Make comprehensible that this only stores the callback in the `onSettled` field from step 2, that a second call replaces rather than adds, and that nothing runs until settle reads the field. The reader takes to the next step that startSession now awaits connect.
- W1.4 connect makes its first attempt, and it succeeds — attempts is reset, the loop opens the transport once, and open is true: settle('connected'), then return 'connected'.
  - connect: the attempt loop and the success branch: src/link.ts (To) lines 17–25 — reached from startSession awaits link.connect (src/session.ts target 5–5)
  - Brief: Reached from session.ts line 5. Make comprehensible the loop's shape: attempts reset to 0, the bound `attempts < maxAttempts`, the increment before each `transport.open`, and the branch at line 22. This walk follows `open` being true: settle is called first (next step) and only then does connect return. Line 26 is not reached on this path; the second walk starts again at line 22 for `open` false. The reader takes to the next step that settle runs before the caller sees the result.
- W1.5 settle hands the outcome to a timer — The stored callback is taken, the field cleared, and the callback scheduled with setTimeout 0 instead of being called directly.
  - settle: src/link.ts (To) lines 32–38 — reached from connect calls this.settle('connected') (src/link.ts target 23–23)
  - Brief: Reached from line 23. Make comprehensible three things: the callback is read and `onSettled` cleared, so it fires at most once per registration; nothing happens when no callback was registered; and the callback is not called here but scheduled as a timer with delay 0, so it runs in a later macrotask, after the promise continuations that connect's return triggers. The reader takes to the next step that connect now returns while the notification is still pending.
- W1.6 startSession resumes with 'connected' — The await resumes as a promise continuation, the gave-up branch is skipped, and startSession completes.
  - startSession after connect returns: src/session.ts (To) lines 5–8 — reached from connect returns 'connected' (src/link.ts target 24–24)
  - Brief: Reached when connect's promise resolves with 'connected' (line 24); the continuation runs as a microtask, before the timer from step 5. Make comprehensible that on this path the `if` is false, so startSession reports nothing itself and its own promise resolves. The reader takes to the next step that the only report on this path is still to come, from the timer.
- W1.7 The timer fires: 'session ready' — The callback registered in step 1 runs from the timer and reports 'session ready', after startSession has already completed.
  - The settled callback body: src/session.ts (To) lines 4–4 — reached from the timer scheduled by settle calls callback('connected') (src/link.ts target 36–36)
  - Revisit: Step 1 showed this line as the registration; now it is the callback body executing with outcome 'connected'.
  - Brief: A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context, not in startSession's. Make comprehensible that this is where `report` is called on the success path, with 'session ready', and that it happens after startSession's promise has resolved. The reader leaves the walk knowing the success path yields exactly one report, delivered asynchronously.

### W2 (walk): Giving up after every attempt fails
Purpose: How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Question: When the transport never opens, how many attempts are made, how long does connect wait, and what does the caller hear, in which order?
- W2.1 Back at the branch: open is false — The if at line 22 is not taken; connect pauses attempts times 100 ms before the loop comes round.
  - The untaken branch and the pause: src/link.ts (To) lines 22–27
  - Brief: Starts again at the branch point of the first walk's step 4, with the same entry and registration; this time `transport.open` resolved false. Make comprehensible that the `if` is skipped and `pause(this.attempts * 100)` is awaited: 100 ms after the first failure, 200 after the second, 300 after the third. The pause is awaited after every failed attempt, including the last one, because the loop condition is only checked at the top. The reader takes to the next step what pause does with that number.
- W2.2 pause waits on a real timer — A module-level helper resolving a promise from setTimeout; connect resumes when the timer fires.
  - pause: src/link.ts (To) lines 41–43 — reached from connect awaits pause (src/link.ts target 26–26)
  - Brief: Reached from line 26. Make comprehensible that this is a plain timer with no cancellation and no injected clock, so the wait is real elapsed time, and that connect's continuation resumes in the timer's context when it fires. The reader takes to the next step that after the wait the loop condition is checked again.
- W2.3 The loop comes round for another attempt — attempts < maxAttempts still holds, so attempts increments and the transport is opened again.
  - The loop condition and the next attempt: src/link.ts (To) lines 19–21
  - Brief: Make comprehensible that each round increments `attempts` before calling `transport.open`, and that with the default maxAttempts of 3 (first walk, step 2) the body runs at most three times. This walk follows every attempt failing, so each round returns to step 1's pause; after the third failure and its 300 ms pause the condition is false. The reader takes to the next step that the loop exits without having connected.
- W2.4 connect gives up — After the loop, settle('gave-up') schedules the notification and connect returns 'gave-up'.
  - The gave-up exit of connect: src/link.ts (To) lines 28–29
  - Brief: Reached when the while condition fails. Make comprehensible that settle (first walk, step 5) runs with 'gave-up' exactly as with 'connected': it clears onSettled and schedules the callback on a timer with delay 0; then connect returns 'gave-up' and its promise resolves. The reader takes to the next step that two things are now pending: the caller's continuation and the timer.
- W2.5 startSession reports 'retrying later' first — The await resumes as a promise continuation, sees 'gave-up', and calls report before any timer runs.
  - startSession's gave-up branch: src/session.ts (To) lines 5–8 — reached from connect returns 'gave-up' (src/link.ts target 29–29)
  - Brief: Reached from line 29. Make comprehensible, from the code, that this continuation is a microtask and runs before the timer settle scheduled, so 'retrying later' is the first text report receives on this path; startSession's promise then resolves. Say this follows from how promise continuations and setTimeout are ordered, not from a test, since the repository has none. The reader takes to the next step that the stored callback has not run yet.
- W2.6 The timer fires: 'offline mode' — The callback from the registration runs from the timer and reports 'offline mode', after startSession has completed.
  - The settled callback body: src/session.ts (To) lines 4–4 — reached from the timer scheduled by settle calls callback('gave-up') (src/link.ts target 36–36)
  - Brief: A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context. Make comprehensible that this is the second report on this path, that it arrives after startSession has already returned, and that because settle cleared onSettled, another connect on the same Link would notify nobody unless whenSettled is called again. The reader leaves the walk with the sequence: three attempts, three pauses, 'retrying later', then 'offline mode'.

## How to explain the step (Standard)
Instruction version: 7
Every explanation:
- Explain this code to a person reviewing the change, who reads your text beside the code itself. Say what the code does here and why it matters for the change, how it connects to what the reader has seen and will see, and what the reader must understand to judge it: a condition that decides the outcome, a risk, work that is only requested or reused rather than done.
- Read the code you rest on before you write: callers, types, the other code that reads or writes the same state, and what waits for or carries out what this code asks. Do not infer the architecture from names, and do not present what you have not read. The code decides, also where the prepared explanation or an earlier answer says more than the code supports; then say plainly what the code does.
- Add understanding beyond what the lines and their comments already say: do not retell statements in prose, and keep what the code shows apart from an interpretation of why it is written so. Be exact about guarantees: a lock protects only the accesses under it, a notification is not a completed hand-over, a private method is not proof that nothing else calls it. When a part cannot be read, explain the general concept and say what cannot be established about this implementation.
- Let the scope follow the code and the reader: a simple step is said in a few words in every profile, and a step where several mechanisms interact takes the room understanding needs. There is no length to hit and no required form; use a paragraph, a list or a small code excerpt where it helps, and let every sentence add understanding. Point at the code you rest on with references, so the person can open it.
- A profile changes how the step is presented, not what is true of the code or what is reviewed or approved: keep every fact, risk, uncertainty, finding and recommendation the code supports, add none it does not, and change no decision of the review. A new observation of yours is an observation, not a verified fact.
- Present this step; do not start a new broad review and do not retell the whole discussion or every finding of the review. An important objection may be summarised in one line that points to its thread.

Standard:
- The reader knows programming but not this code: make the central mechanism understandable, how the parts work together and why their relationship matters, from a natural entry point into what makes the behaviour understandable rather than the parts in source order. Place a project-specific name the first time it matters, and explain a language detail where the reader needs it to interpret the code; you need not teach every concept, nor add facts to be longer.

Every step is read beside its code, in the walk's order:
- The walk shows the code of each step beside its explanation: in the prose, name functions, types, variables and settings rather than file names, paths or line numbers; the references block, when one is asked for, still names files and lines.
- Write relative to the walk: "here" for this step's code, and "in the next step", "in a later step" or "as we saw earlier" only where the walk's order makes it true. A short orientation about what a later step shows is often needed, normally one sentence with a reference to that step; do not repeat that step's explanation here. What an earlier step established is recalled in a line with a reference to that step, not derived again: this step adds what is new here.
- Make a transition comprehensible where it would otherwise be unclear: what this step is reached from and what the caller needs from it; on a return, where the caller continues and what is now known; for an alternative outcome, that the walk is back at the branch point and which condition applies now; for a worker or a callback, what starts or triggers it and which execution context is being followed. When the teaching order differs from the execution order, say so. What follows from the language's or the library's rules, such as a specified order or a type, is stated as a fact; what depends on timing, scheduling or callers outside the change is stated as what the code allows, never as something observed to run.
- Write only from what the reader can see: do not refer to the prepared explanation, the instructions or other text given to you but not shown (no "the prepared summary says"); where the code contradicts it, simply say what the code does.

## How to write (Write in English.)
- Write so that a developer who did not write this change understands it.
- Each step says what happens, why it happens or is needed, and what is worth noticing in the code. Give the needed context before the details.
- Use concrete language and say who does what: the user, DSpatch, the provider, or a named component.
- Explain cause and effect. Do not write that something "appears" or "happens" without saying why.
- Keep the relevant class names, methods and established terms such as inheritance and subclass. Explain them when needed instead of replacing them with vague simplifications.
- Use short paragraphs. Use bullets for alternative cases and numbering for an actual order.
- Emphasise sparingly with **bold**: only the central connection or consequence.
- Prefer plain words to advanced ones, but keep the real names of classes, methods, files and objects.
- Keep apart what the code is meant to do, your own conclusions, and test results that were actually observed. You have observed no test run here: you can read code, not run it.
- Do not narrate your investigation ("I read…", "Then I searched…"). Give the explanation, and point at the code it rests on.

## Answer format
Answer with the explanation of the step only, in Markdown: no JSON, no heading with the step's title or id, no restatement of the places. First the part the person reads at once. When there is real depth to add, put it after a line holding only <!-- dspatch:details -->; the person opens it with Show more.
- After the marker line comes the deepening only, in the same manner and at the same level as the first part: the mechanisms behind what it says, special cases that change the outcome, longer evidence and more references, readable even when long. It continues the first part rather than restating it: nothing said above the line is said again below it, also not in other words or under a heading of its own, and the comparison with the earlier revision is made once. Leave the line out when there is nothing to add.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit 62ff871b335f1442c3d0f1e94cd43d9ce41775f9
- `target/` is To, commit 189fb0f3633de8828762469c5262faaef5485db0
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## This step: W1.1 startSession registers the settled callback
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: The entry point now takes a report callback and hands Link a settled callback before connecting.
- startSession's new signature and the registration: src/session.ts (To) lines 3–4
Brief: Entry point. Make comprehensible the new third parameter `report` and that line 4 stores in the Link a callback that maps the outcome to 'session ready' or 'offline mode'; it is registered before connect because settle only notifies the callback stored at that moment (step 5). Nothing is reported here yet. The reader takes to the next step that the Link now holds a callback and is about to be asked to connect.
The step after: W1.2 What a Link now carries — The Outcome type, the attempts counter, the stored callback and the maxAttempts bound.
```

</details>

<details><summary>Answer</summary>

```text
`startSession` is the only entry point of this change, and its contract with the caller has changed in one visible way: it now takes a third argument, `report`, a function that receives short status texts. `startSession` still resolves to nothing, so `report` is the caller's only way of learning how the connection went. Before this change the function simply awaited `link.connect` and dropped its boolean result; nobody was told anything.

The line to understand here is the call to `link.whenSettled`. Before the Link is asked to connect, `startSession` hands it a callback. That callback takes an `Outcome` (a two-member string union, `'connected' | 'gave-up'`, defined in the Link module and shown in the next step) and translates it into words for the caller: `'connected'` becomes `'session ready'`, and the only other outcome, `'gave-up'`, becomes `'offline mode'`. The Link never sees `report` itself and knows nothing about these texts; it only holds the wrapper. **The Link decides the outcome; `startSession` decides the words.**

Nothing is reported at this point. `whenSettled` only stores the callback in the Link (shown two steps on), and the callback runs only when the Link's `settle` later picks it up and schedules it. The order of the two statements is what matters: `settle` notifies whichever callback is stored at the moment it runs, and on the path this walk follows `connect` settles before it returns. A registration placed after the `await` would arrive when `settle` had already looked and found nothing. So the callback must be in place first, and it is.

What the reader carries into the next steps: the Link now holds exactly one callback that closes over `report`, and the very next statement asks that Link to connect.

<!-- dspatch:details -->
`report` is called from two places in this function: inside the callback registered here, and directly in the branch after the `await` (a later step). On the success path only the callback fires; the direct branch is for `'gave-up'`. The callback's `outcome === 'connected'` test with a ternary means every outcome that is not `'connected'` yields `'offline mode'`; with `Outcome` limited to two members that is precisely `'gave-up'`, but a future third member would silently land in `'offline mode'` as well.

The import `import { Link, type Outcome } from './link'` brings `Outcome` in as a type-only import: it exists for the type checker and is erased from the emitted JavaScript. The annotation `(outcome: Outcome)` on the arrow function matches the parameter type `whenSettled` declares, so TypeScript checks that the callback accepts exactly the union the Link will pass.

Two consequences of registering a callback rather than reporting inline are worth having in mind when judging this line. First, the Link runs the callback from a timer, not from within `startSession` (the `settle` step shows this), so a `report` implementation that throws would raise an uncaught exception in that timer rather than rejecting `startSession`'s promise; the function's own promise is unaffected by what `report` does. Second, the registration is unconditional on every call and the Link keeps at most one callback, so what happens when the same Link is started twice depends on `whenSettled`'s replacement behaviour, which the step on `whenSettled` covers.

Nothing else in the repository calls `startSession` or supplies a `report`; the two source files are all there is, and there are no tests. Who provides `report` and what it does with `'session ready'`, `'offline mode'` and `'retrying later'` is outside this change and cannot be read here.

```

</details>

### Turn 3: write-step (file-2) · W1.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.2 What a Link now carries
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: The Outcome type, the attempts counter, the stored callback and the maxAttempts bound.
- Outcome, the new fields and the constructor: src/link.ts (To) lines 5–11
Brief: A pause in the execution order to look at the state the next steps use: the Outcome union, `attempts` as instance state rather than a local, `onSettled` holding at most one callback or null, and the constructor's `maxAttempts` with default 3, which no caller in the repository overrides. The reader takes these four names to the steps that write and read them.
The step before: W1.1 startSession registers the settled callback — The entry point now takes a report callback and hands Link a settled callback before connecting.
The step after: W1.3 whenSettled stores the callback — The callback is kept in onSettled; nothing is called yet, and a later call replaces it.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This step leaves the execution order for a moment. `startSession` has just handed the Link a callback and is about to ask it to connect; before following that call, it helps to see what a Link now keeps between calls, because the next steps all read or write this state. In the earlier revision a Link held only its `Transport` and passed the transport's boolean straight through; now it is an object with a small life of its own.

Four names matter:

- **`Outcome`** is an exported two-member string union, `'connected' | 'gave-up'`. It replaces the boolean that `connect` used to return: it is `connect`'s return type, the parameter type of `settle`, and the argument type of the callback `whenSettled` accepts, which is why `startSession` imported it in the previous step. There is no third member; "still trying" is not an outcome a caller can ever be handed.
- **`attempts`** is a private instance field starting at 0. Only `connect` writes it (it resets it on entry and increments it once per round) and only `connect` reads it, in the loop condition and in the length of the pause between rounds. Keeping it on the instance rather than as a local inside `connect` changes one thing: there is one counter per Link, shared by every `connect` call on it. The reset at the start of `connect` means a fresh call does not inherit the previous count, but two `connect` calls in flight on the same Link would be counting on the same field; nothing in the code prevents that.
- **`onSettled`** holds either one callback taking an `Outcome`, or `null`, and starts as `null`. It is a single slot, not a list. `whenSettled` writes into it (next step) and `settle` reads it and clears it (a later step). What `startSession` registered in the first step will sit here.
- **`maxAttempts`** is a second constructor parameter with default 3, declared `private readonly`, so it is fixed when the Link is created and bounds how many times `connect` will call `transport.open`. No code in the repository constructs a Link at all, so nothing here overrides the default; whether a caller outside the change does is not something this code can show.

The reader takes these names onward: the next step shows `onSettled` being written, and the `connect` step shows `attempts` and `maxAttempts` in use.

<!-- dspatch:details -->
The constructor uses TypeScript parameter properties: `constructor(private readonly transport: Transport, private readonly maxAttempts = 3)` both declares the two fields and assigns them from the arguments, so there is no separate field declaration or assignment to look for. `readonly` is enforced by the type checker only, as is `private`; neither is a runtime barrier. Within the two files of this repository nothing besides `Link`'s own methods touches any of the four fields, but that is a statement about this code, not a guarantee the language gives.

The default of 3 is a plain parameter default, so a caller can pass any number. A `maxAttempts` of 0 or less would make the `while` condition in `connect` false before the first round, and `connect` would settle and return `'gave-up'` without ever calling `transport.open`. The code does not validate the value; this is what it allows, not something any caller in the repository does.

Because `onSettled` holds a reference to the closure `startSession` created, and that closure captures `report`, a Link that has been given a callback but never asked to connect keeps that callback, and whatever `report` closes over, reachable for as long as the Link itself lives. The slot is only emptied by `settle`.

```

</details>

### Turn 4: write-step (file-2) · W1.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.3 whenSettled stores the callback
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: The callback is kept in onSettled; nothing is called yet, and a later call replaces it.
- whenSettled: src/link.ts (To) lines 13–15 — reached from startSession calls link.whenSettled (src/session.ts target 4–4)
Brief: Reached from session.ts line 4. Make comprehensible that this only stores the callback in the `onSettled` field from step 2, that a second call replaces rather than adds, and that nothing runs until settle reads the field. The reader takes to the next step that startSession now awaits connect.
The step before: W1.2 What a Link now carries — The Outcome type, the attempts counter, the stored callback and the maxAttempts bound.
The step after: W1.4 connect makes its first attempt, and it succeeds — attempts is reset, the loop opens the transport once, and open is true: settle('connected'), then return 'connected'.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
Back in execution order: `startSession`'s registration line calls into the Link, and this is all that call does. `whenSettled` assigns the callback to the `onSettled` slot seen in the previous step and returns. It is synchronous, returns nothing, and neither calls, wraps nor checks the callback. The callback `startSession` built, the one that turns an `Outcome` into `'session ready'` or `'offline mode'`, now sits in the Link, and nothing will run it until `settle` reads the slot (two steps on).

The one thing to judge here is that this is a plain assignment, not an addition to a list. **A second `whenSettled` call replaces the first callback, and the replaced callback is simply dropped: it is never notified.** The Link can have at most one listener at a time, and there is no way to remove a listener except `settle` clearing the slot, and no handle is returned that would let a caller undo its own registration.

That matters because of how `startSession` uses it: every `startSession` call registers unconditionally. Two `startSession` calls on the same Link, the second arriving before the first has settled, would leave only the second caller's callback in the slot; the first caller would never receive its `'session ready'` or `'offline mode'`. The code allows this; nothing in the repository does it, and there are no tests exercising it.

From here control returns to `startSession`, which next awaits `link.connect`.

<!-- dspatch:details -->
Nothing like this method existed in the earlier revision; the whole notification channel, the slot and the method that fills it, is new in this change.

Because `settle` reads the slot only at the moment it runs, the assignment here is also effective if it happens while a `connect` is already in flight on the Link: whatever is stored when `settle` runs is what gets notified. So the order `startSession` chose, register then connect, is sufficient for its own callback to be the one found, but it is not protected against a later registration from elsewhere overwriting it during the attempts.

```

</details>

### Turn 5: write-step (file-2) · W1.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.4 connect makes its first attempt, and it succeeds
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: attempts is reset, the loop opens the transport once, and open is true: settle('connected'), then return 'connected'.
- connect: the attempt loop and the success branch: src/link.ts (To) lines 17–25 — reached from startSession awaits link.connect (src/session.ts target 5–5)
Brief: Reached from session.ts line 5. Make comprehensible the loop's shape: attempts reset to 0, the bound `attempts < maxAttempts`, the increment before each `transport.open`, and the branch at line 22. This walk follows `open` being true: settle is called first (next step) and only then does connect return. Line 26 is not reached on this path; the second walk starts again at line 22 for `open` false. The reader takes to the next step that settle runs before the caller sees the result.
The step before: W1.3 whenSettled stores the callback — The callback is kept in onSettled; nothing is called yet, and a later call replaces it.
The step after: W1.5 settle hands the outcome to a timer — The stored callback is taken, the field cleared, and the callback scheduled with setTimeout 0 instead of being called directly.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`startSession` now awaits `link.connect`, and this is where the change does its real work. In the earlier revision `connect` was a one-line pass-through, `return this.transport.open(address)`, and the caller got the transport's boolean. Now `connect` owns the retrying and translates the boolean into an `Outcome`. The `Transport` interface itself is unchanged, so a transport written for the old Link still fits; what changed is how often it is asked and what the caller hears back.

The loop's shape, in the order it executes:

1. `attempts` is reset to 0, so each `connect` call starts counting afresh regardless of what an earlier call left behind.
2. The `while` condition `attempts < maxAttempts` is checked; with the default bound of 3 (as we saw in the state step) it is true.
3. `attempts` is incremented **before** `transport.open` is called, so during the first call it already reads 1. The counter means "attempts started", not "attempts failed".
4. `connect` awaits `transport.open(address)`. The transport does the actual opening; the Link only waits. There is no timeout here: a transport that never resolves leaves `connect`, and with it `startSession`, pending indefinitely.

This walk follows `open` resolving `true` on that first call. The `if` is taken, and two things happen in a fixed order: `this.settle('connected')` runs to completion, and only then does `return 'connected'` resolve `connect`'s promise. **The caller cannot see the result before `settle` has done its work**; what that work is, and why it is not the same as calling the callback, is the next step. The `pause` after the `if` is never reached on this path, and the loop does not come round again. The second walk returns to this same branch with `open` false.

One thing the reader should notice for judging the function: `open` is a boolean, and only `false` counts as a failed attempt. A transport that rejects instead of resolving is not caught anywhere in `connect`; that case is covered below.

<!-- dspatch:details -->
Because `connect` is an `async` function, everything up to its first `await` runs synchronously inside the caller's call: the reset, the condition check, the increment and the call into `transport.open` all happen before `startSession`'s own `await` yields. Only when `transport.open` returns a pending promise does control leave `connect`. The language guarantees this order; nothing in the code depends on it, but it is what the reader would see when stepping through.

Nothing in `connect` handles a rejected promise from `transport.open`. If the transport throws, the rejection propagates out of `connect` unchanged: `settle` is never called, so `onSettled` keeps the callback `startSession` registered, and `startSession`'s `await` throws, rejecting `startSession`'s promise. The caller then hears neither `'session ready'` nor `'offline mode'` nor `'retrying later'`, and the stale callback would be the one picked up by whichever `connect` next settles on that Link. Whether any transport in use rejects cannot be read here; the interface promises a boolean, and the code is written as if it always gets one.

After a successful first attempt `attempts` is left at 1 until the next `connect` resets it; nothing reads it in between.

```

</details>

### Turn 6: write-step (file-2) · W1.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.5 settle hands the outcome to a timer
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: The stored callback is taken, the field cleared, and the callback scheduled with setTimeout 0 instead of being called directly.
- settle: src/link.ts (To) lines 32–38 — reached from connect calls this.settle('connected') (src/link.ts target 23–23)
Brief: Reached from line 23. Make comprehensible three things: the callback is read and `onSettled` cleared, so it fires at most once per registration; nothing happens when no callback was registered; and the callback is not called here but scheduled as a timer with delay 0, so it runs in a later macrotask, after the promise continuations that connect's return triggers. The reader takes to the next step that connect now returns while the notification is still pending.
The step before: W1.4 connect makes its first attempt, and it succeeds — attempts is reset, the loop opens the transport once, and open is true: settle('connected'), then return 'connected'.
The step after: W1.6 startSession resumes with 'connected' — The await resumes as a promise continuation, the gave-up branch is skipped, and startSession completes.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`connect` calls `settle('connected')` synchronously, in the moment it knows the outcome and before it returns. `settle` is the only place that ever reads the `onSettled` slot, and it is where the callback `startSession` registered is finally used. Three things happen, and each one shapes what the caller will experience.

1. **The callback is taken out of the slot, and the slot is cleared, before anything else.** `settle` copies `onSettled` into a local and sets the field to `null`. From this moment the Link has no listener. Whatever is done with the local copy, the registration has been consumed: one `whenSettled` yields at most one notification, and a second `settle` on the same Link, for example from a later `connect`, would find nothing unless someone registers again.
2. **If nothing was registered, nothing happens.** The `null` check means a Link used without `whenSettled` settles silently; `connect` still returns its `Outcome`, so the return value is the channel that always works and the callback the one that works only when asked for.
3. **The callback is not called here. It is handed to `setTimeout` with a delay of 0.** The arrow `() => callback(outcome)` captures the outcome value as it is now, so the callback will be told `'connected'` whatever happens to the Link in the meantime. But it will be told later: a timer callback runs as a separate macrotask, and the host runs every pending promise continuation (microtask) before it starts any timer. The continuation that `connect`'s `return` creates in `startSession` is such a microtask. So the order is fixed by the event loop's rules, not by luck: `connect` returns, `startSession` resumes and runs to the end, and only after that does the timer fire the callback.

What the reader carries to the next step: `connect` is about to return `'connected'` to `startSession` while the `'session ready'` notification is scheduled but not yet delivered.

<!-- dspatch:details -->
Why the deferral is there is not written in the code; what the code shows is its effect. Calling the callback directly would run `report` inside `connect`'s own call stack, where a throw from `report` would reject `connect` and with it `startSession`, and where the callback would observe the Link before `connect` has returned. With the timer, the callback runs on an empty stack: an exception thrown by `report` there becomes an uncaught exception in the host (an `uncaughtException` in Node, a window error in a browser), not a rejection that any `await` can catch. Nothing in `settle` or the timer closure catches it.

A delay of 0 is a lower bound, not a promise of immediacy: Node clamps it to at least 1 ms, and browsers may clamp further. The code relies only on the relative ordering, timer after microtasks, which holds for any clamping. It does not rely on, and cannot give, any particular elapsed time.

The timer's handle is discarded, so once `settle` has scheduled the callback it cannot be cancelled. Replacement through `whenSettled`, as we saw earlier, only affects a callback still in the slot; a callback that `settle` has already taken will fire even if the Link is dropped or re-registered before the timer runs.

Because the slot is cleared synchronously here, a callback that calls `whenSettled` again from inside the timer registers for the next settle, not this one, and its registration survives. In the second walk `settle` is reached from the other call site with `'gave-up'`, and the same deferral is what puts `'retrying later'` ahead of `'offline mode'`.

`setTimeout` is used as a global, with no clock or scheduler passed in, so the deferral is real host time in every environment this module runs in; there are no tests in the repository, and testing this ordering would need the host's timers or fakes of them.

```

</details>

### Turn 7: write-step (file-2) · W1.6

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.6 startSession resumes with 'connected'
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: The await resumes as a promise continuation, the gave-up branch is skipped, and startSession completes.
- startSession after connect returns: src/session.ts (To) lines 5–8 — reached from connect returns 'connected' (src/link.ts target 24–24)
Brief: Reached when connect's promise resolves with 'connected' (line 24); the continuation runs as a microtask, before the timer from step 5. Make comprehensible that on this path the `if` is false, so startSession reports nothing itself and its own promise resolves. The reader takes to the next step that the only report on this path is still to come, from the timer.
The step before: W1.5 settle hands the outcome to a timer — The stored callback is taken, the field cleared, and the callback scheduled with setTimeout 0 instead of being called directly.
The step after: W1.7 The timer fires: 'session ready' — The callback registered in step 1 runs from the timer and reports 'session ready', after startSession has already completed.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`connect`'s promise has resolved with `'connected'`, and `startSession` picks up again at its `await`. That resumption is a promise continuation, a microtask, so it runs before the timer `settle` scheduled in the previous step; the callback is still waiting when these lines execute.

On this path there is little to do. `outcome` is `'connected'`, the `if (outcome === 'gave-up')` is false, and the branch that would call `report('retrying later')` is skipped. `startSession` reaches its end and its own promise resolves, with nothing. **`startSession` itself reports nothing on the success path.** The only text the caller will receive, `'session ready'`, is the callback's, and it has not run yet.

That is the point to hold on to when judging the function's contract: the direct branch after the `await` is only for the failed outcome, while the success text travels solely through the callback registered in the first step and arrives after `startSession` has completed. A caller that awaits `startSession` and then expects to have heard `'session ready'` already would be wrong; the resolution of `startSession`'s promise says only that `connect` returned.

Next, the timer fires and the callback delivers the one report of this walk.

<!-- dspatch:details -->
Whoever awaits `startSession` resumes in a microtask of their own, queued when `startSession`'s promise resolves here. That continuation also runs before the timer, because the host drains the whole microtask queue, including continuations queued by other continuations, before it starts a timer callback. So not only `startSession` but also its caller's code after `await startSession(...)` runs before `'session ready'` is reported. This follows from the event loop's rules, not from anything observed; the repository has no caller and no tests.

The two tests `startSession` makes point in opposite directions: the callback tests for `'connected'` and treats everything else as `'offline mode'`, while this branch tests for `'gave-up'` and treats everything else as success. With `Outcome` having exactly two members the two agree; they would diverge if a third member were ever added.

In the earlier revision the function ended at the `await` and discarded the boolean; the branch here and the texts are all new, and the second walk shows the path on which the branch is taken.

```

</details>

### Turn 8: write-step (file-2) · W1.7

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.7 The timer fires: 'session ready'
Walk W1 (walk): Connecting on the first attempt. How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.
Summary: The callback registered in step 1 runs from the timer and reports 'session ready', after startSession has already completed.
- The settled callback body: src/session.ts (To) lines 4–4 — reached from the timer scheduled by settle calls callback('connected') (src/link.ts target 36–36)
Revisit: Step 1 showed this line as the registration; now it is the callback body executing with outcome 'connected'.
Brief: A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context, not in startSession's. Make comprehensible that this is where `report` is called on the success path, with 'session ready', and that it happens after startSession's promise has resolved. The reader leaves the walk knowing the success path yields exactly one report, delivered asynchronously.
The step before: W1.6 startSession resumes with 'connected' — The await resumes as a promise continuation, the gave-up branch is skipped, and startSession completes.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The walk returns to the line it started on, but now as code that runs rather than code that registers. The timer `settle` scheduled has fired, and the host calls `callback('connected')`; `callback` is the arrow function `startSession` passed to `whenSettled` in the first step. It executes in the timer's context: on an empty call stack, with no `startSession` frame above it, after `startSession`'s promise has resolved and after whoever awaited it has resumed. Nothing about where the arrow was written changes where it runs.

The body is the one mapping: `outcome === 'connected'`, so `report` is called with `'session ready'`. This is the only call to `report` on the success path, and it is the first thing the caller hears about the connection, arriving after `startSession` is already done. `report`'s return value is ignored, and the Link's `onSettled` slot is already empty, so nothing further is pending on this Link.

**The success path yields exactly one report, `'session ready'`, delivered asynchronously after `startSession` has completed.** That is the behaviour the reader should check against what the caller expects: a function that resolves silently and reports a moment later through a callback it was given, not through its return.

<!-- dspatch:details -->
`report` is reachable here only because the arrow function closed over `startSession`'s parameter; the function has returned, but its closure keeps the reference alive until the timer has run. This is ordinary closure behaviour and the reason the Link never needed to be told about `report`.

The callback has no `this` and touches no Link state, so running it late is harmless to the Link. If `report` throws, the exception leaves the timer callback uncaught; `settle` wrapped nothing in a handler, and no promise is involved at this point, so no `await` anywhere can catch it.

The whole walk in one line, in execution order: register the callback, start `connect`, first `transport.open` resolves `true`, `settle` takes and clears the callback and schedules it, `connect` returns `'connected'`, `startSession` resumes and resolves, its caller resumes, then the timer fires and `report('session ready')` runs. The second walk follows the same registration into a `connect` whose every attempt fails.

```

</details>

### Turn 9: write-step (file-2) · W2.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.1 Back at the branch: open is false
Walk W2 (walk): Giving up after every attempt fails. How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Summary: The if at line 22 is not taken; connect pauses attempts times 100 ms before the loop comes round.
- The untaken branch and the pause: src/link.ts (To) lines 22–27
Brief: Starts again at the branch point of the first walk's step 4, with the same entry and registration; this time `transport.open` resolved false. Make comprehensible that the `if` is skipped and `pause(this.attempts * 100)` is awaited: 100 ms after the first failure, 200 after the second, 300 after the third. The pause is awaited after every failed attempt, including the last one, because the loop condition is only checked at the top. The reader takes to the next step what pause does with that number.
The step after: W2.2 pause waits on a real timer — A module-level helper resolving a promise from setTimeout; connect resumes when the timer fires.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This walk begins where the first one branched. Everything before is the same: `startSession` registered its callback, `connect` reset `attempts`, incremented it to 1 and awaited `transport.open`. The difference is the value that came back: `open` is `false`. The `if` is skipped, so neither `settle` nor `return` runs, and `connect` falls through to the line after it.

That line is `await pause(this.attempts * 100)`. The argument is computed now, from the current count: `attempts` is 1 after the first failure, so `connect` waits 100 ms; it will be 200 ms after a second failure and 300 ms after a third. The delay grows in a straight line with the attempt number, the 100 is a literal in the code, and there is no cap and no randomisation. What `pause` does with that number is the next step; for now, `connect` is suspended at this `await` with the Link's state untouched: `attempts` holds the count, and `onSettled` still holds the callback.

The structural point to notice for judging the loop is **where the pause sits: inside the body, after the failed attempt, with the exit condition checked only at the top of the `while`.** So the pause is awaited after every failure, including the last one. After the third failure `connect` still waits its 300 ms before the loop comes round, finds `attempts < maxAttempts` false, and gives up. That final wait precedes nothing; no further attempt follows it. With the default bound the pauses alone add up to 600 ms before a caller can hear `'gave-up'`, on top of whatever time the three `transport.open` calls take.

In the earlier revision a `false` from the transport went straight back to the caller as the return value. Now a failure is absorbed into retrying, and the caller is told nothing about it until the loop has finished.

<!-- dspatch:details -->
Because `Outcome` has no member for "failed, retrying" and `attempts` is private, a caller cannot tell a connection that opened on the third try from one that opened at once; the count is used only for the pause length and the bound, and is never reported.

The multiplication reads `this.attempts` at the moment `pause` is called, so the delay is fixed when the wait starts. The 600 ms is a lower bound rather than a measurement: each `setTimeout` delay is a minimum the host honours, and the repository contains no test or run that observes how long `connect` actually takes.

While `connect` sits at this `await`, the Link is in the same state a caller sees between the registration and the first attempt, so a `whenSettled` call arriving during a pause would replace the stored callback just as described earlier.

```

</details>

### Turn 10: write-step (file-2) · W2.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.2 pause waits on a real timer
Walk W2 (walk): Giving up after every attempt fails. How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Summary: A module-level helper resolving a promise from setTimeout; connect resumes when the timer fires.
- pause: src/link.ts (To) lines 41–43 — reached from connect awaits pause (src/link.ts target 26–26)
Brief: Reached from line 26. Make comprehensible that this is a plain timer with no cancellation and no injected clock, so the wait is real elapsed time, and that connect's continuation resumes in the timer's context when it fires. The reader takes to the next step that after the wait the loop condition is checked again.
The step before: W2.1 Back at the branch: open is false — The if at line 22 is not taken; connect pauses attempts times 100 ms before the loop comes round.
The step after: W2.3 The loop comes round for another attempt — attempts < maxAttempts still holds, so attempts increments and the transport is opened again.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`pause` is the small helper `connect` awaits after a failed attempt. It is a module-level function, not exported and not a method of `Link`, and `connect` is its only caller. It does one thing: it creates a promise and passes that promise's `resolve` function straight to `setTimeout` as the timer callback, with the requested delay. When the timer fires, the host calls `resolve` with no arguments, the promise resolves with `undefined`, and `connect`'s continuation is queued as a microtask and runs in that timer's turn.

Three properties of this code decide what the wait means for the loop:

- **The wait is real elapsed time.** `setTimeout` is the host's global, with no clock or scheduler passed in, so the 100, 200 and 300 ms from the previous step are honoured by the host's timer, not by anything the Link controls.
- **There is no way to cut it short.** The timer handle is discarded and the promise has no reject path, so once `connect` is waiting, nothing in this code can wake it earlier; a caller that no longer wants the connection has no handle to cancel through.
- **The promise cannot fail.** `pause` never rejects, so the `await` in `connect` always resumes normally; a failure of the transport is the only way out of the loop other than exhausting the attempts.

When the timer fires, `connect` resumes on the line after its `await`, which is the end of the loop body, and the `while` condition is checked again; that is the next step.

<!-- dspatch:details -->
Nothing of this existed in the earlier revision, which never waited. `pause` and `settle` both use the global `setTimeout`, but for different reasons: `settle` uses a delay of 0 purely for ordering, letting promise continuations run first, while `pause` uses the delay for its duration. Because `pause` is a private module function and the timer is the global, a test could only shorten these waits by replacing the global timer functions; the repository has no tests, so how, or whether, that is done is not something this code shows.

In Node an active timer keeps the event loop alive, so a process whose only pending work is a `connect` in one of these pauses stays running until the pause ends. `setTimeout` treats its delay as a minimum, so each pause is at least the requested time, and the actual resumption can be later under load.

```

</details>

### Turn 11: write-step (file-2) · W2.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.3 The loop comes round for another attempt
Walk W2 (walk): Giving up after every attempt fails. How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Summary: attempts < maxAttempts still holds, so attempts increments and the transport is opened again.
- The loop condition and the next attempt: src/link.ts (To) lines 19–21
Brief: Make comprehensible that each round increments `attempts` before calling `transport.open`, and that with the default maxAttempts of 3 (first walk, step 2) the body runs at most three times. This walk follows every attempt failing, so each round returns to step 1's pause; after the third failure and its 300 ms pause the condition is false. The reader takes to the next step that the loop exits without having connected.
The step before: W2.2 pause waits on a real timer — A module-level helper resolving a promise from setTimeout; connect resumes when the timer fires.
The step after: W2.4 connect gives up — After the loop, settle('gave-up') schedules the notification and connect returns 'gave-up'.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The pause's timer has fired and `connect` resumes at the end of the loop body, which brings it back to the `while` condition. `attempts` is 1 and `maxAttempts` is 3 by default, so `attempts < maxAttempts` holds, the body starts again, `attempts` becomes 2, and `transport.open(address)` is awaited a second time. The transport receives exactly the same call as before: the same address and nothing else. **The Link does not tell the transport that this is a retry**, and the `Transport` interface has no close or reset, so whether a transport can be asked to open again after answering `false` is entirely the transport's affair.

This walk follows every attempt failing, so each round runs the same sequence: increment, `open` resolves `false`, the `if` is skipped, pause. With the default bound:

| Round | `attempts` during `open` | Result | Pause after |
| --- | --- | --- | --- |
| 1 | 1 | `false` | 100 ms |
| 2 | 2 | `false` | 200 ms |
| 3 | 3 | `false` | 300 ms |

After the third pause the condition reads 3 < 3, which is false, and the loop ends. `transport.open` is called at most `maxAttempts` times, three here, and there are only two ways out of the loop: `open` resolving `true`, which the first walk followed, or the bound being reached. The reader takes to the next step that `connect` leaves the loop without having connected and still has the registered callback in its slot.

<!-- dspatch:details -->
The condition reads the instance field `attempts`, not a local, so the bound is only as reliable as that field. A second `connect` call on the same Link while this one is pausing would reset `attempts` to 0 and begin its own count on the same field; each loop would then see the other's increments and the total number of `transport.open` calls could exceed three. The code allows this; nothing in the repository makes overlapping calls, and nothing guards against them.

A transport that rejects rather than resolving in any round leaves the loop by exception, as noted in the first walk; that path reaches neither the pause nor the gave-up exit.

```

</details>

### Turn 12: write-step (file-2) · W2.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.4 connect gives up
Walk W2 (walk): Giving up after every attempt fails. How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Summary: After the loop, settle('gave-up') schedules the notification and connect returns 'gave-up'.
- The gave-up exit of connect: src/link.ts (To) lines 28–29
Brief: Reached when the while condition fails. Make comprehensible that settle (first walk, step 5) runs with 'gave-up' exactly as with 'connected': it clears onSettled and schedules the callback on a timer with delay 0; then connect returns 'gave-up' and its promise resolves. The reader takes to the next step that two things are now pending: the caller's continuation and the timer.
The step before: W2.3 The loop comes round for another attempt — attempts < maxAttempts still holds, so attempts increments and the transport is opened again.
The step after: W2.5 startSession reports 'retrying later' first — The await resumes as a promise continuation, sees 'gave-up', and calls report before any timer runs.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The third pause has ended, the `while` condition has read 3 < 3 and failed, and `connect` continues after the loop. Two statements remain, and they mirror the success branch exactly: `settle` first, then `return`, with a different literal.

`settle('gave-up')` does what it did in the first walk: it takes the callback out of `onSettled`, empties the slot, and hands `callback('gave-up')` to `setTimeout` with delay 0. The value is captured in the timer's closure now, so the callback will be told `'gave-up'` regardless of what happens next. Then `return 'gave-up'` resolves `connect`'s promise, which queues `startSession`'s continuation as a microtask.

**Giving up is a normal return, not an error.** No exception is thrown and no reason travels with the outcome; the transport said `false` three times and the caller learns only the word `'gave-up'`. The Link itself schedules nothing further: `attempts` is left at 3, the slot is empty, and no retry is pending anywhere in this code. A fresh `connect` on the same Link would start the count again, but would notify nobody unless `whenSettled` is called first.

The reader takes to the next step that two things are now queued at once, the caller's continuation and the timer, and that the host's rules decide which runs first.

<!-- dspatch:details -->
The two exits of `connect` are built the same way on purpose, as far as the code shows: in both, `settle` runs synchronously before the `return`, so the caller never sees an `Outcome` whose notification has not already been scheduled, and in both the deferral through the timer is what separates the return value from the callback. On this path four host timers have been involved by now, three for the pauses and this one for the notification; only the last carries the callback.

In the earlier revision a transport that answered `false` once made `connect` resolve `false` at once and `startSession` ignored it. Now the same transport is asked three times over at least 600 ms before `'gave-up'` is produced, and the result reaches the caller twice, through the return value and through the callback, in the order the next two steps show.

```

</details>

### Turn 13: write-step (file-2) · W2.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.5 startSession reports 'retrying later' first
Walk W2 (walk): Giving up after every attempt fails. How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Summary: The await resumes as a promise continuation, sees 'gave-up', and calls report before any timer runs.
- startSession's gave-up branch: src/session.ts (To) lines 5–8 — reached from connect returns 'gave-up' (src/link.ts target 29–29)
Brief: Reached from line 29. Make comprehensible, from the code, that this continuation is a microtask and runs before the timer settle scheduled, so 'retrying later' is the first text report receives on this path; startSession's promise then resolves. Say this follows from how promise continuations and setTimeout are ordered, not from a test, since the repository has none. The reader takes to the next step that the stored callback has not run yet.
The step before: W2.4 connect gives up — After the loop, settle('gave-up') schedules the notification and connect returns 'gave-up'.
The step after: W2.6 The timer fires: 'offline mode' — The callback from the registration runs from the timer and reports 'offline mode', after startSession has completed.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`connect`'s promise has resolved with `'gave-up'`, and `startSession` resumes at its `await`. As in the first walk, that resumption is a promise continuation, a microtask, and the host runs every queued microtask before it starts any timer. The timer `settle` just scheduled is therefore still waiting when these lines run. **This ordering is what makes `'retrying later'` the first text `report` receives on this path**; it follows from how promise continuations and `setTimeout` are ordered by the language and the host, not from anything observed, since the repository has no tests and no caller.

This time the branch is taken: `outcome === 'gave-up'` is true, and `startSession` calls `report('retrying later')` directly, synchronously, in its own context. Then the function ends and its promise resolves. So on this path the caller hears something before `startSession` completes, which it never does on the success path, and this report is the one `startSession` makes itself rather than through the Link.

Two things about this branch are worth weighing. First, `report` is called on `startSession`'s own stack here, so a `report` that throws rejects `startSession`'s promise; the callback's call to `report`, running from a timer, cannot do that. The two calls to `report` in this function thus fail differently. Second, the words `'retrying later'` describe nothing the code does: neither `startSession` nor the Link schedules any further attempt after `connect` has given up. The text is a message to the caller, and whether anything retries later is outside this change.

The reader takes to the next step that the callback `settle` took from the slot has not yet run, and that a second text is still to come.

<!-- dspatch:details -->
The caller's own continuation, the code after `await startSession(...)`, is queued when `startSession`'s promise resolves here and also runs before the timer, for the same reason: microtasks queued by microtasks are drained in the same pass. So a caller sees, in order, `report('retrying later')`, its own resumption, and only then the timer's report.

The same `'gave-up'` thus produces two texts, `'retrying later'` from this branch and `'offline mode'` from the callback, through two channels with different timing. The code shows that both are sent; it does not show what a `report` implementation is expected to make of receiving both for one outcome, and no caller in the repository answers that.

```

</details>

### Turn 14: write-step (file-2) · W2.6

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.6 The timer fires: 'offline mode'
Walk W2 (walk): Giving up after every attempt fails. How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.
Summary: The callback from the registration runs from the timer and reports 'offline mode', after startSession has completed.
- The settled callback body: src/session.ts (To) lines 4–4 — reached from the timer scheduled by settle calls callback('gave-up') (src/link.ts target 36–36)
Brief: A callback step: started by the setTimeout in settle (line 36) and executed in the timer's context. Make comprehensible that this is the second report on this path, that it arrives after startSession has already returned, and that because settle cleared onSettled, another connect on the same Link would notify nobody unless whenSettled is called again. The reader leaves the walk with the sequence: three attempts, three pauses, 'retrying later', then 'offline mode'.
The step before: W2.5 startSession reports 'retrying later' first — The await resumes as a promise continuation, sees 'gave-up', and calls report before any timer runs.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The timer `settle` scheduled at the gave-up exit fires, and the host calls `callback('gave-up')`. The callback is the same arrow function `startSession` registered at the start of both walks; it runs here in the timer's context, on an empty stack, after `startSession` has resolved and after its caller has resumed. The mapping takes its other branch: `outcome === 'connected'` is false, so `report` is called with `'offline mode'`.

This is the second text the caller receives for one failed connection, and the later one. `'retrying later'` came from `startSession` itself, before it returned; `'offline mode'` comes from the Link's deferred notification, after. A `report` implementation that treats each text as the current state will end on `'offline mode'`; one that acts on the first text it sees will act on `'retrying later'`. The code sends both and fixes their order; it does not say which one is meant to count.

The Link is now spent as a notifier. `settle` emptied `onSettled` before scheduling this timer, so **a further `connect` on the same Link would produce an `Outcome` but notify nobody unless `whenSettled` is called again first.** `startSession` always does call it, so going through `startSession` again is safe in that respect; calling `connect` directly after this point is not.

The whole path, in execution order: three calls to `transport.open`, each answered `false`; three pauses of 100, 200 and 300 ms, the last one before nothing; `settle` takes the callback and schedules it; `connect` returns `'gave-up'`; `startSession` reports `'retrying later'` and resolves; its caller resumes; the timer fires and `report('offline mode')` runs.

<!-- dspatch:details -->
As on the success path, `report` is reachable only through the closure, and an exception it throws here is uncaught in the timer rather than visible to any `await`. The text `'offline mode'`, like `'retrying later'`, names a state the code does not itself enter or maintain: the Link keeps no mode, and after this callback nothing in either file runs again until some caller acts. What a caller does with the two texts, and whether anything retries, lies outside the two files of this change and cannot be read here.

```

</details>

### Turn 15: review-walks (file-3)

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: review-walks

## Your role: walk-reviewer
Judge whether finished code walks let the reader of the chosen profile follow the course and understand what the steps show, checked against the code and docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.0; name concrete shortcomings or accept.

Read the walks as the person will read them, beside the code, and judge whether they do their job for this reader: can the course be followed through calls, returns, branches, workers and callbacks; is every shown place explained, at this reader's level, rather than named or displayed; is what the text claims true of the code; does the text give the help the profile is for; does the deepening continue the first part rather than repeat it.

Check claims against the code with your tools. A confident sentence is not evidence, and neither is a plan or a brief. Read what each step rests on before you judge it.

Report shortcomings that matter to understanding, each concrete: which steps, what falls short, why it matters to this reader, and what in the code shows it, with the section of the reference when it helps. A problem with which walks, steps or places exist is a structural finding for the planner; a problem with a step's text is an explanation finding for the writer.

Accept different good explanations. When nothing significant falls short, accept the walks as written; a matter of style or preference is not a finding and is not a reason to ask for a change. Length, density and the number of identifiers are not measures of quality.

On your second visit, after the one correction round, give the final assessment: what was put right, what still falls short, and the verdict. Ask for nothing more.

You judge the walks, not the change. Your acceptance is an agent's and approves nothing of the code; it changes no decision of the review and resolves no finding of the review. Do not rewrite the texts yourself, and do not raise findings to be seen to have found something.

One JSON object in a fence: your assessment, the verdict, and the findings in the shape the call describes. Empty findings with the verdict accept is a complete answer.

## The reader (Standard)
- The reader knows programming but not this code: make the central mechanism understandable, how the parts work together and why their relationship matters, from a natural entry point into what makes the behaviour understandable rather than the parts in source order. Place a project-specific name the first time it matters, and explain a language detail where the reader needs it to interpret the code; you need not teach every concept, nor add facts to be longer.

## What to judge
- Can the reader follow the course: at each step, how it is reached and what the caller needs, what a return brings back, that an alternative outcome is back at the branch point, what starts a worker or callback and which context is followed, and when the teaching order differs from the execution order?
- Is every code place a step shows explained there, at this reader's level: what it does here, why it matters for the change, and what decides the outcome? Naming a function or showing its lines is not explaining it.
- Is what the text claims true of the code? Read the code behind each step with your tools before you judge; a confident sentence is not evidence.
- Does the text give this reader the help the profile is for: quick orientation at the right level of abstraction, the mechanism made understandable, or the concepts and intermediate reasoning built where they are needed? Length and density are not the measure.
- Is the part after Show more a deepening that continues the first part, not a repetition of it?
- Is an important new implementation walked rather than left behind a function name, and are alternatives presented as alternatives, never as one run?
Report only shortcomings that matter to the reader's understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step's text is "explanation" and goes to the writer. Different good explanations are acceptable: accept without changes when nothing significant falls short, and never ask for a change on a matter of style or preference.

## The walks as the person will read them
### W1 (walk): Connecting on the first attempt
Purpose: How the report callback, the new attempt loop and the deferred settled notification fit together when the connection succeeds at once.

#### W1.1 startSession registers the settled callback
- startSession's new signature and the registration: src/session.ts (To) lines 3–4

`startSession` is the only entry point of this change, and its contract with the caller has changed in one visible way: it now takes a third argument, `report`, a function that receives short status texts. `startSession` still resolves to nothing, so `report` is the caller's only way of learning how the connection went. Before this change the function simply awaited `link.connect` and dropped its boolean result; nobody was told anything.

The line to understand here is the call to `link.whenSettled`. Before the Link is asked to connect, `startSession` hands it a callback. That callback takes an `Outcome` (a two-member string union, `'connected' | 'gave-up'`, defined in the Link module and shown in the next step) and translates it into words for the caller: `'connected'` becomes `'session ready'`, and the only other outcome, `'gave-up'`, becomes `'offline mode'`. The Link never sees `report` itself and knows nothing about these texts; it only holds the wrapper. **The Link decides the outcome; `startSession` decides the words.**

Nothing is reported at this point. `whenSettled` only stores the callback in the Link (shown two steps on), and the callback runs only when the Link's `settle` later picks it up and schedules it. The order of the two statements is what matters: `settle` notifies whichever callback is stored at the moment it runs, and on the path this walk follows `connect` settles before it returns. A registration placed after the `await` would arrive when `settle` had already looked and found nothing. So the callback must be in place first, and it is.

What the reader carries into the next steps: the Link now holds exactly one callback that closes over `report`, and the very next statement asks that Link to connect.

Show more:
`report` is called from two places in this function: inside the callback registered here, and directly in the branch after the `await` (a later step). On the success path only the callback fires; the direct branch is for `'gave-up'`. The callback's `outcome === 'connected'` test with a ternary means every outcome that is not `'connected'` yields `'offline mode'`; with `Outcome` limited to two members that is precisely `'gave-up'`, but a future third member would silently land in `'offline mode'` as well.

The import `import { Link, type Outcome } from './link'` brings `Outcome` in as a type-only import: it exists for the type checker and is erased from the emitted JavaScript. The annotation `(outcome: Outcome)` on the arrow function matches the parameter type `whenSettled` declares, so TypeScript checks that the callback accepts exactly the union the Link will pass.

Two consequences of registering a callback rather than reporting inline are worth having in mind when judging this line. First, the Link runs the callback from a timer, not from within `startSession` (the `settle` step shows this), so a `report` implementation that throws would raise an uncaught exception in that timer rather than rejecting `startSession`'s promise; the function's own promise is unaffected by what `report` does. Second, the registration is unconditional on every call and the Link keeps at most one callback, so what happens when the same Link is started twice depends on `whenSettled`'s replacement behaviour, which the step on `whenSettled` covers.

Nothing else in the repository calls `startSession` or supplies a `report`; the two source files are all there is, and there are no tests. Who provides `report` and what it does with `'session ready'`, `'offline mode'` and `'retrying later'` is outside this change and cannot be read here.

#### W1.2 What a Link now carries
- Outcome, the new fields and the constructor: src/link.ts (To) lines 5–11

This step leaves the execution order for a moment. `startSession` has just handed the Link a callback and is about to ask it to connect; before following that call, it helps to see what a Link now keeps between calls, because the next steps all read or write this state. In the earlier revision a Link held only its `Transport` and passed the transport's boolean straight through; now it is an object with a small life of its own.

Four names matter:

- **`Outcome`** is an exported two-member string union, `'connected' | 'gave-up'`. It replaces the boolean that `connect` used to return: it is `connect`'s return type, the parameter type of `settle`, and the argument type of the callback `whenSettled` accepts, which is why `startSession` imported it in the previous step. There is no third member; "still trying" is not an outcome a caller can ever be handed.
- **`attempts`** is a private instance field starting at 0. Only `connect` writes it (it resets it on entry and increments it once per round) and only `connect` reads it, in the loop condition and in the length of the pause between rounds. Keeping it on the instance rather than as a local inside `connect` changes one thing: there is one counter per Link, shared by every `connect` call on it. The reset at the start of `connect` means a fresh call does not inherit the previous count, but two `connect` calls in flight on the same Link would be counting on the same field; nothing in the code prevents that.
- **`onSettled`** holds either one callback taking an `Outcome`, or `null`, and starts as `null`. It is a single slot, not a list. `whenSettled` writes into it (next step) and `settle` reads it and clears it (a later step). What `startSession` registered in the first step will sit here.
- **`maxAttempts`** is a second constructor parameter with default 3, declared `private readonly`, so it is fixed when the Link is created and bounds how many times `connect` will call `transport.open`. No code in the repository constructs a Link at all, so nothing here overrides the default; whether a caller outside the change does is not something this code can show.

The reader takes these names onward: the next step shows `onSettled` being written, and the `connect` step shows `attempts` and `maxAttempts` in use.

Show more:
The constructor uses TypeScript parameter properties: `constructor(private readonly transport: Transport, private readonly maxAttempts = 3)` both declares the two fields and assigns them from the arguments, so there is no separate field declaration or assignment to look for. `readonly` is enforced by the type checker only, as is `private`; neither is a runtime barrier. Within the two files of this repository nothing besides `Link`'s own methods touches any of the four fields, but that is a statement about this code, not a guarantee the language gives.

The default of 3 is a plain parameter default, so a caller can pass any number. A `maxAttempts` of 0 or less would make the `while` condition in `connect` false before the first round, and `connect` would settle and return `'gave-up'` without ever calling `transport.open`. The code does not validate the value; this is what it allows, not something any caller in the repository does.

Because `onSettled` holds a reference to the closure `startSession` created, and that closure captures `report`, a Link that has been given a callback but never asked to connect keeps that callback, and whatever `report` closes over, reachable for as long as the Link itself lives. The slot is only emptied by `settle`.

#### W1.3 whenSettled stores the callback
- whenSettled: src/link.ts (To) lines 13–15 — reached from startSession calls link.whenSettled (src/session.ts target 4–4)

Back in execution order: `startSession`'s registration line calls into the Link, and this is all that call does. `whenSettled` assigns the callback to the `onSettled` slot seen in the previous step and returns. It is synchronous, returns nothing, and neither calls, wraps nor checks the callback. The callback `startSession` built, the one that turns an `Outcome` into `'session ready'` or `'offline mode'`, now sits in the Link, and nothing will run it until `settle` reads the slot (two steps on).

The one thing to judge here is that this is a plain assignment, not an addition to a list. **A second `whenSettled` call replaces the first callback, and the replaced callback is simply dropped: it is never notified.** The Link can have at most one listener at a time, and there is no way to remove a listener except `settle` clearing the slot, and no handle is returned that would let a caller undo its own registration.

That matters because of how `startSession` uses it: every `startSession` call registers unconditionally. Two `startSession` calls on the same Link, the second arriving before the first has settled, would leave only the second caller's callback in the slot; the first caller would never receive its `'session ready'` or `'offline mode'`. The code allows this; nothing in the repository does it, and there are no tests exercising it.

From here control returns to `startSession`, which next awaits `link.connect`.

Show more:
Nothing like this method existed in the earlier revision; the whole notification channel, the slot and the method that fills it, is new in this change.

Because `settle` reads the slot only at the moment it runs, the assignment here is also effective if it happens while a `connect` is already in flight on the Link: whatever is stored when `settle` runs is what gets notified. So the order `startSession` chose, register then connect, is sufficient for its own callback to be the one found, but it is not protected against a later registration from elsewhere overwriting it during the attempts.

#### W1.4 connect makes its first attempt, and it succeeds
- connect: the attempt loop and the success branch: src/link.ts (To) lines 17–25 — reached from startSession awaits link.connect (src/session.ts target 5–5)

`startSession` now awaits `link.connect`, and this is where the change does its real work. In the earlier revision `connect` was a one-line pass-through, `return this.transport.open(address)`, and the caller got the transport's boolean. Now `connect` owns the retrying and translates the boolean into an `Outcome`. The `Transport` interface itself is unchanged, so a transport written for the old Link still fits; what changed is how often it is asked and what the caller hears back.

The loop's shape, in the order it executes:

1. `attempts` is reset to 0, so each `connect` call starts counting afresh regardless of what an earlier call left behind.
2. The `while` condition `attempts < maxAttempts` is checked; with the default bound of 3 (as we saw in the state step) it is true.
3. `attempts` is incremented **before** `transport.open` is called, so during the first call it already reads 1. The counter means "attempts started", not "attempts failed".
4. `connect` awaits `transport.open(address)`. The transport does the actual opening; the Link only waits. There is no timeout here: a transport that never resolves leaves `connect`, and with it `startSession`, pending indefinitely.

This walk follows `open` resolving `true` on that first call. The `if` is taken, and two things happen in a fixed order: `this.settle('connected')` runs to completion, and only then does `return 'connected'` resolve `connect`'s promise. **The caller cannot see the result before `settle` has done its work**; what that work is, and why it is not the same as calling the callback, is the next step. The `pause` after the `if` is never reached on this path, and the loop does not come round again. The second walk returns to this same branch with `open` false.

One thing the reader should notice for judging the function: `open` is a boolean, and only `false` counts as a failed attempt. A transport that rejects instead of resolving is not caught anywhere in `connect`; that case is covered below.

Show more:
Because `connect` is an `async` function, everything up to its first `await` runs synchronously inside the caller's call: the reset, the condition check, the increment and the call into `transport.open` all happen before `startSession`'s own `await` yields. Only when `transport.open` returns a pending promise does control leave `connect`. The language guarantees this order; nothing in the code depends on it, but it is what the reader would see when stepping through.

Nothing in `connect` handles a rejected promise from `transport.open`. If the transport throws, the rejection propagates out of `connect` unchanged: `settle` is never called, so `onSettled` keeps the callback `startSession` registered, and `startSession`'s `await` throws, rejecting `startSession`'s promise. The caller then hears neither `'session ready'` nor `'offline mode'` nor `'retrying later'`, and the stale callback would be the one picked up by whichever `connect` next settles on that Link. Whether any transport in use rejects cannot be read here; the interface promises a boolean, and the code is written as if it always gets one.

After a successful first attempt `attempts` is left at 1 until the next `connect` resets it; nothing reads it in between.

#### W1.5 settle hands the outcome to a timer
- settle: src/link.ts (To) lines 32–38 — reached from connect calls this.settle('connected') (src/link.ts target 23–23)

`connect` calls `settle('connected')` synchronously, in the moment it knows the outcome and before it returns. `settle` is the only place that ever reads the `onSettled` slot, and it is where the callback `startSession` registered is finally used. Three things happen, and each one shapes what the caller will experience.

1. **The callback is taken out of the slot, and the slot is cleared, before anything else.** `settle` copies `onSettled` into a local and sets the field to `null`. From this moment the Link has no listener. Whatever is done with the local copy, the registration has been consumed: one `whenSettled` yields at most one notification, and a second `settle` on the same Link, for example from a later `connect`, would find nothing unless someone registers again.
2. **If nothing was registered, nothing happens.** The `null` check means a Link used without `whenSettled` settles silently; `connect` still returns its `Outcome`, so the return value is the channel that always works and the callback the one that works only when asked for.
3. **The callback is not called here. It is handed to `setTimeout` with a delay of 0.** The arrow `() => callback(outcome)` captures the outcome value as it is now, so the callback will be told `'connected'` whatever happens to the Link in the meantime. But it will be told later: a timer callback runs as a separate macrotask, and the host runs every pending promise continuation (microtask) before it starts any timer. The continuation that `connect`'s `return` creates in `startSession` is such a microtask. So the order is fixed by the event loop's rules, not by luck: `connect` returns, `startSession` resumes and runs to the end, and only after that does the timer fire the callback.

What the reader carries to the next step: `connect` is about to return `'connected'` to `startSession` while the `'session ready'` notification is scheduled but not yet delivered.

Show more:
Why the deferral is there is not written in the code; what the code shows is its effect. Calling the callback directly would run `report` inside `connect`'s own call stack, where a throw from `report` would reject `connect` and with it `startSession`, and where the callback would observe the Link before `connect` has returned. With the timer, the callback runs on an empty stack: an exception thrown by `report` there becomes an uncaught exception in the host (an `uncaughtException` in Node, a window error in a browser), not a rejection that any `await` can catch. Nothing in `settle` or the timer closure catches it.

A delay of 0 is a lower bound, not a promise of immediacy: Node clamps it to at least 1 ms, and browsers may clamp further. The code relies only on the relative ordering, timer after microtasks, which holds for any clamping. It does not rely on, and cannot give, any particular elapsed time.

The timer's handle is discarded, so once `settle` has scheduled the callback it cannot be cancelled. Replacement through `whenSettled`, as we saw earlier, only affects a callback still in the slot; a callback that `settle` has already taken will fire even if the Link is dropped or re-registered before the timer runs.

Because the slot is cleared synchronously here, a callback that calls `whenSettled` again from inside the timer registers for the next settle, not this one, and its registration survives. In the second walk `settle` is reached from the other call site with `'gave-up'`, and the same deferral is what puts `'retrying later'` ahead of `'offline mode'`.

`setTimeout` is used as a global, with no clock or scheduler passed in, so the deferral is real host time in every environment this module runs in; there are no tests in the repository, and testing this ordering would need the host's timers or fakes of them.

#### W1.6 startSession resumes with 'connected'
- startSession after connect returns: src/session.ts (To) lines 5–8 — reached from connect returns 'connected' (src/link.ts target 24–24)

`connect`'s promise has resolved with `'connected'`, and `startSession` picks up again at its `await`. That resumption is a promise continuation, a microtask, so it runs before the timer `settle` scheduled in the previous step; the callback is still waiting when these lines execute.

On this path there is little to do. `outcome` is `'connected'`, the `if (outcome === 'gave-up')` is false, and the branch that would call `report('retrying later')` is skipped. `startSession` reaches its end and its own promise resolves, with nothing. **`startSession` itself reports nothing on the success path.** The only text the caller will receive, `'session ready'`, is the callback's, and it has not run yet.

That is the point to hold on to when judging the function's contract: the direct branch after the `await` is only for the failed outcome, while the success text travels solely through the callback registered in the first step and arrives after `startSession` has completed. A caller that awaits `startSession` and then expects to have heard `'session ready'` already would be wrong; the resolution of `startSession`'s promise says only that `connect` returned.

Next, the timer fires and the callback delivers the one report of this walk.

Show more:
Whoever awaits `startSession` resumes in a microtask of their own, queued when `startSession`'s promise resolves here. That continuation also runs before the timer, because the host drains the whole microtask queue, including continuations queued by other continuations, before it starts a timer callback. So not only `startSession` but also its caller's code after `await startSession(...)` runs before `'session ready'` is reported. This follows from the event loop's rules, not from anything observed; the repository has no caller and no tests.

The two tests `startSession` makes point in opposite directions: the callback tests for `'connected'` and treats everything else as `'offline mode'`, while this branch tests for `'gave-up'` and treats everything else as success. With `Outcome` having exactly two members the two agree; they would diverge if a third member were ever added.

In the earlier revision the function ended at the `await` and discarded the boolean; the branch here and the texts are all new, and the second walk shows the path on which the branch is taken.

#### W1.7 The timer fires: 'session ready'
- The settled callback body: src/session.ts (To) lines 4–4 — reached from the timer scheduled by settle calls callback('connected') (src/link.ts target 36–36)

The walk returns to the line it started on, but now as code that runs rather than code that registers. The timer `settle` scheduled has fired, and the host calls `callback('connected')`; `callback` is the arrow function `startSession` passed to `whenSettled` in the first step. It executes in the timer's context: on an empty call stack, with no `startSession` frame above it, after `startSession`'s promise has resolved and after whoever awaited it has resumed. Nothing about where the arrow was written changes where it runs.

The body is the one mapping: `outcome === 'connected'`, so `report` is called with `'session ready'`. This is the only call to `report` on the success path, and it is the first thing the caller hears about the connection, arriving after `startSession` is already done. `report`'s return value is ignored, and the Link's `onSettled` slot is already empty, so nothing further is pending on this Link.

**The success path yields exactly one report, `'session ready'`, delivered asynchronously after `startSession` has completed.** That is the behaviour the reader should check against what the caller expects: a function that resolves silently and reports a moment later through a callback it was given, not through its return.

Show more:
`report` is reachable here only because the arrow function closed over `startSession`'s parameter; the function has returned, but its closure keeps the reference alive until the timer has run. This is ordinary closure behaviour and the reason the Link never needed to be told about `report`.

The callback has no `this` and touches no Link state, so running it late is harmless to the Link. If `report` throws, the exception leaves the timer callback uncaught; `settle` wrapped nothing in a handler, and no promise is involved at this point, so no `await` anywhere can catch it.

The whole walk in one line, in execution order: register the callback, start `connect`, first `transport.open` resolves `true`, `settle` takes and clears the callback and schedules it, `connect` returns `'connected'`, `startSession` resumes and resolves, its caller resumes, then the timer fires and `report('session ready')` runs. The second walk follows the same registration into a `connect` whose every attempt fails.

### W2 (walk): Giving up after every attempt fails
Purpose: How the retry loop ends in 'gave-up' and why startSession's 'retrying later' is reported before the deferred 'offline mode'.

#### W2.1 Back at the branch: open is false
- The untaken branch and the pause: src/link.ts (To) lines 22–27

This walk begins where the first one branched. Everything before is the same: `startSession` registered its callback, `connect` reset `attempts`, incremented it to 1 and awaited `transport.open`. The difference is the value that came back: `open` is `false`. The `if` is skipped, so neither `settle` nor `return` runs, and `connect` falls through to the line after it.

That line is `await pause(this.attempts * 100)`. The argument is computed now, from the current count: `attempts` is 1 after the first failure, so `connect` waits 100 ms; it will be 200 ms after a second failure and 300 ms after a third. The delay grows in a straight line with the attempt number, the 100 is a literal in the code, and there is no cap and no randomisation. What `pause` does with that number is the next step; for now, `connect` is suspended at this `await` with the Link's state untouched: `attempts` holds the count, and `onSettled` still holds the callback.

The structural point to notice for judging the loop is **where the pause sits: inside the body, after the failed attempt, with the exit condition checked only at the top of the `while`.** So the pause is awaited after every failure, including the last one. After the third failure `connect` still waits its 300 ms before the loop comes round, finds `attempts < maxAttempts` false, and gives up. That final wait precedes nothing; no further attempt follows it. With the default bound the pauses alone add up to 600 ms before a caller can hear `'gave-up'`, on top of whatever time the three `transport.open` calls take.

In the earlier revision a `false` from the transport went straight back to the caller as the return value. Now a failure is absorbed into retrying, and the caller is told nothing about it until the loop has finished.

Show more:
Because `Outcome` has no member for "failed, retrying" and `attempts` is private, a caller cannot tell a connection that opened on the third try from one that opened at once; the count is used only for the pause length and the bound, and is never reported.

The multiplication reads `this.attempts` at the moment `pause` is called, so the delay is fixed when the wait starts. The 600 ms is a lower bound rather than a measurement: each `setTimeout` delay is a minimum the host honours, and the repository contains no test or run that observes how long `connect` actually takes.

While `connect` sits at this `await`, the Link is in the same state a caller sees between the registration and the first attempt, so a `whenSettled` call arriving during a pause would replace the stored callback just as described earlier.

#### W2.2 pause waits on a real timer
- pause: src/link.ts (To) lines 41–43 — reached from connect awaits pause (src/link.ts target 26–26)

`pause` is the small helper `connect` awaits after a failed attempt. It is a module-level function, not exported and not a method of `Link`, and `connect` is its only caller. It does one thing: it creates a promise and passes that promise's `resolve` function straight to `setTimeout` as the timer callback, with the requested delay. When the timer fires, the host calls `resolve` with no arguments, the promise resolves with `undefined`, and `connect`'s continuation is queued as a microtask and runs in that timer's turn.

Three properties of this code decide what the wait means for the loop:

- **The wait is real elapsed time.** `setTimeout` is the host's global, with no clock or scheduler passed in, so the 100, 200 and 300 ms from the previous step are honoured by the host's timer, not by anything the Link controls.
- **There is no way to cut it short.** The timer handle is discarded and the promise has no reject path, so once `connect` is waiting, nothing in this code can wake it earlier; a caller that no longer wants the connection has no handle to cancel through.
- **The promise cannot fail.** `pause` never rejects, so the `await` in `connect` always resumes normally; a failure of the transport is the only way out of the loop other than exhausting the attempts.

When the timer fires, `connect` resumes on the line after its `await`, which is the end of the loop body, and the `while` condition is checked again; that is the next step.

Show more:
Nothing of this existed in the earlier revision, which never waited. `pause` and `settle` both use the global `setTimeout`, but for different reasons: `settle` uses a delay of 0 purely for ordering, letting promise continuations run first, while `pause` uses the delay for its duration. Because `pause` is a private module function and the timer is the global, a test could only shorten these waits by replacing the global timer functions; the repository has no tests, so how, or whether, that is done is not something this code shows.

In Node an active timer keeps the event loop alive, so a process whose only pending work is a `connect` in one of these pauses stays running until the pause ends. `setTimeout` treats its delay as a minimum, so each pause is at least the requested time, and the actual resumption can be later under load.

#### W2.3 The loop comes round for another attempt
- The loop condition and the next attempt: src/link.ts (To) lines 19–21

The pause's timer has fired and `connect` resumes at the end of the loop body, which brings it back to the `while` condition. `attempts` is 1 and `maxAttempts` is 3 by default, so `attempts < maxAttempts` holds, the body starts again, `attempts` becomes 2, and `transport.open(address)` is awaited a second time. The transport receives exactly the same call as before: the same address and nothing else. **The Link does not tell the transport that this is a retry**, and the `Transport` interface has no close or reset, so whether a transport can be asked to open again after answering `false` is entirely the transport's affair.

This walk follows every attempt failing, so each round runs the same sequence: increment, `open` resolves `false`, the `if` is skipped, pause. With the default bound:

| Round | `attempts` during `open` | Result | Pause after |
| --- | --- | --- | --- |
| 1 | 1 | `false` | 100 ms |
| 2 | 2 | `false` | 200 ms |
| 3 | 3 | `false` | 300 ms |

After the third pause the condition reads 3 < 3, which is false, and the loop ends. `transport.open` is called at most `maxAttempts` times, three here, and there are only two ways out of the loop: `open` resolving `true`, which the first walk followed, or the bound being reached. The reader takes to the next step that `connect` leaves the loop without having connected and still has the registered callback in its slot.

Show more:
The condition reads the instance field `attempts`, not a local, so the bound is only as reliable as that field. A second `connect` call on the same Link while this one is pausing would reset `attempts` to 0 and begin its own count on the same field; each loop would then see the other's increments and the total number of `transport.open` calls could exceed three. The code allows this; nothing in the repository makes overlapping calls, and nothing guards against them.

A transport that rejects rather than resolving in any round leaves the loop by exception, as noted in the first walk; that path reaches neither the pause nor the gave-up exit.

#### W2.4 connect gives up
- The gave-up exit of connect: src/link.ts (To) lines 28–29

The third pause has ended, the `while` condition has read 3 < 3 and failed, and `connect` continues after the loop. Two statements remain, and they mirror the success branch exactly: `settle` first, then `return`, with a different literal.

`settle('gave-up')` does what it did in the first walk: it takes the callback out of `onSettled`, empties the slot, and hands `callback('gave-up')` to `setTimeout` with delay 0. The value is captured in the timer's closure now, so the callback will be told `'gave-up'` regardless of what happens next. Then `return 'gave-up'` resolves `connect`'s promise, which queues `startSession`'s continuation as a microtask.

**Giving up is a normal return, not an error.** No exception is thrown and no reason travels with the outcome; the transport said `false` three times and the caller learns only the word `'gave-up'`. The Link itself schedules nothing further: `attempts` is left at 3, the slot is empty, and no retry is pending anywhere in this code. A fresh `connect` on the same Link would start the count again, but would notify nobody unless `whenSettled` is called first.

The reader takes to the next step that two things are now queued at once, the caller's continuation and the timer, and that the host's rules decide which runs first.

Show more:
The two exits of `connect` are built the same way on purpose, as far as the code shows: in both, `settle` runs synchronously before the `return`, so the caller never sees an `Outcome` whose notification has not already been scheduled, and in both the deferral through the timer is what separates the return value from the callback. On this path four host timers have been involved by now, three for the pauses and this one for the notification; only the last carries the callback.

In the earlier revision a transport that answered `false` once made `connect` resolve `false` at once and `startSession` ignored it. Now the same transport is asked three times over at least 600 ms before `'gave-up'` is produced, and the result reaches the caller twice, through the return value and through the callback, in the order the next two steps show.

#### W2.5 startSession reports 'retrying later' first
- startSession's gave-up branch: src/session.ts (To) lines 5–8 — reached from connect returns 'gave-up' (src/link.ts target 29–29)

`connect`'s promise has resolved with `'gave-up'`, and `startSession` resumes at its `await`. As in the first walk, that resumption is a promise continuation, a microtask, and the host runs every queued microtask before it starts any timer. The timer `settle` just scheduled is therefore still waiting when these lines run. **This ordering is what makes `'retrying later'` the first text `report` receives on this path**; it follows from how promise continuations and `setTimeout` are ordered by the language and the host, not from anything observed, since the repository has no tests and no caller.

This time the branch is taken: `outcome === 'gave-up'` is true, and `startSession` calls `report('retrying later')` directly, synchronously, in its own context. Then the function ends and its promise resolves. So on this path the caller hears something before `startSession` completes, which it never does on the success path, and this report is the one `startSession` makes itself rather than through the Link.

Two things about this branch are worth weighing. First, `report` is called on `startSession`'s own stack here, so a `report` that throws rejects `startSession`'s promise; the callback's call to `report`, running from a timer, cannot do that. The two calls to `report` in this function thus fail differently. Second, the words `'retrying later'` describe nothing the code does: neither `startSession` nor the Link schedules any further attempt after `connect` has given up. The text is a message to the caller, and whether anything retries later is outside this change.

The reader takes to the next step that the callback `settle` took from the slot has not yet run, and that a second text is still to come.

Show more:
The caller's own continuation, the code after `await startSession(...)`, is queued when `startSession`'s promise resolves here and also runs before the timer, for the same reason: microtasks queued by microtasks are drained in the same pass. So a caller sees, in order, `report('retrying later')`, its own resumption, and only then the timer's report.

The same `'gave-up'` thus produces two texts, `'retrying later'` from this branch and `'offline mode'` from the callback, through two channels with different timing. The code shows that both are sent; it does not show what a `report` implementation is expected to make of receiving both for one outcome, and no caller in the repository answers that.

#### W2.6 The timer fires: 'offline mode'
- The settled callback body: src/session.ts (To) lines 4–4 — reached from the timer scheduled by settle calls callback('gave-up') (src/link.ts target 36–36)

The timer `settle` scheduled at the gave-up exit fires, and the host calls `callback('gave-up')`. The callback is the same arrow function `startSession` registered at the start of both walks; it runs here in the timer's context, on an empty stack, after `startSession` has resolved and after its caller has resumed. The mapping takes its other branch: `outcome === 'connected'` is false, so `report` is called with `'offline mode'`.

This is the second text the caller receives for one failed connection, and the later one. `'retrying later'` came from `startSession` itself, before it returned; `'offline mode'` comes from the Link's deferred notification, after. A `report` implementation that treats each text as the current state will end on `'offline mode'`; one that acts on the first text it sees will act on `'retrying later'`. The code sends both and fixes their order; it does not say which one is meant to count.

The Link is now spent as a notifier. `settle` emptied `onSettled` before scheduling this timer, so **a further `connect` on the same Link would produce an `Outcome` but notify nobody unless `whenSettled` is called again first.** `startSession` always does call it, so going through `startSession` again is safe in that respect; calling `connect` directly after this point is not.

The whole path, in execution order: three calls to `transport.open`, each answered `false`; three pauses of 100, 200 and 300 ms, the last one before nothing; `settle` takes the callback and schedules it; `connect` returns `'gave-up'`; `startSession` reports `'retrying later'` and resolves; its caller resumes; the timer fires and `report('offline mode')` runs.

Show more:
As on the success path, `report` is reachable only through the closure, and an exception it throws here is uncaught in the timer rather than visible to any `await`. The text `'offline mode'`, like `'retrying later'`, names a state the code does not itself enter or maintain: the Link keeps no mode, and after this callback nothing in either file runs again until some caller acts. What a caller does with the two texts, and whether anything retries, lies outside the two files of this change and cannot be read here.

## Answer format
When you have checked what you need, answer with one JSON object in a ``​`json fence and nothing else:
``​`json
{
  "assessment": "A short paragraph: whether the reader can follow the course and understand what the walks show, and what decides your verdict.",
  "verdict": "accept | rework",
  "findings": [
    {
      "kind": "structure | explanation",
      "steps": [
        "W1.2"
      ],
      "problem": "What falls short, concretely.",
      "why": "Why it matters to the reader of this profile.",
      "evidence": "What in the code shows it (names and lines).",
      "reference": "Optional: the section of the reference that applies, when it helps."
    }
  ]
}
``​`
"findings" is empty when you accept. Write in English.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit 62ff871b335f1442c3d0f1e94cd43d9ce41775f9
- `target/` is To, commit 189fb0f3633de8828762469c5262faaef5485db0
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.
```

</details>

<details><summary>Answer</summary>

```text
I read both revisions in full and checked every step's range, transition and claim against the code before judging.

``​`json
{
  "assessment": "A Standard reader can follow both courses from startSession's registration (src/session.ts target 4) through whenSettled (src/link.ts target 13-15), the attempt loop (target 17-27), settle's copy-clear-and-schedule (target 32-38) and the two exits (target 22-24, 28-29), and back into startSession's branch (src/session.ts target 5-8) and the deferred callback (target 4). Every shown place is explained with its role in the change, the branch in W2 returns explicitly to the point where W1 took the success path, the departure from execution order in W1.2 is announced, and the teaching-order claims hold: settle runs before each return, the await continuation in startSession is a microtask and so precedes the 0 ms timer, the pause at line 26 is awaited after every failed attempt including the third, and the delays are 100, 200 and 300 ms from this.attempts * 100. The Show more parts deepen (type-only import, parameter properties, overlapping connect calls on the shared attempts field, rejection from transport.open leaving the callback in the slot, uncaught throws from report in the timer) rather than repeat. Two sentences are loosely worded but do not mislead: W1.4's Show more says control leaves connect only when transport.open returns a pending promise, whereas an await yields regardless, and the paragraph itself says nothing depends on it; W2.2's 'a failure of the transport is the only way out of the loop other than exhausting the attempts' omits the success exit the reader has just followed, and W2.3 states the two exits correctly in the next step. Neither changes what the reader understands of the mechanism, so nothing significant falls short and the walks are accepted as written.",
  "verdict": "accept",
  "findings": []
}
``​`

```

</details>
