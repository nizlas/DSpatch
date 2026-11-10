# The three profiles through the real provider flow: the texts side by side

Provider **claude**, model **opus**, instruction version 8. The synthetic connect case (base , target ), the same two files at the same two revisions in every run. Three loop runs, one per profile, each with the planner's own plan; then on the Standard walk the reading profile switched to Essentials and to Teacher on the two steps, which made a step explanation through the step explanation channel. Generation path is named at every text.

## The runs

| Profile | Generation path | Started (UTC) | Duration | Walks / steps | Writer turns | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| Standard | the loop (planner, writer, reviewer) | 2026-11-10 14:55:35 | 3.5 min | 3 / 13 | 14 | 1: rework (1 finding(s)); 2: accept |
| Essentials | the loop (planner, writer, reviewer) | 2026-11-10 15:03:20 | 2.5 min | 2 / 11 | 11 | 1: accept |
| Teacher | the loop (planner, writer, reviewer) | 2026-11-10 15:06:32 | 3 min | 3 / 13 | 13 | 1: accept |
| Essentials (alternative of W1.1) | the step explanation channel, after the Standard walk | 2026-11-10 14:59:18 | v8, auto | – | – | – |
| Teacher (alternative of W1.1) | the step explanation channel, after the Standard walk | 2026-11-10 14:59:34 | v8, auto | – | – | – |
| Essentials (alternative of W1.5) | the step explanation channel, after the Standard walk | 2026-11-10 15:00:00 | v8, auto | – | – | – |
| Teacher (alternative of W1.5) | the step explanation channel, after the Standard walk | 2026-11-10 15:00:18 | v8, auto | – | – | – |

## The plans

### Standard run (job-a40a96cc-c07a-4c84-ac4d-71d171580436)

- **W1** Starting a session when the transport opens
  - W1.1 startSession registers the settle callback · src/session.ts 3–5 (target)
  - W1.2 whenSettled stores one callback · src/link.ts 8–15 (target)
  - W1.3 connect makes an attempt · src/link.ts 17–21 (target)
  - W1.4 Success: settle and return 'connected' · src/link.ts 22–25 (target)
  - W1.5 settle defers the callback to a timer · src/link.ts 32–38 (target)
  - W1.6 Back in startSession, then the timer reports 'session ready' · src/session.ts 4–8 (target)
- **W2** When every attempt fails
  - W2.1 Failure: pause before the next attempt · src/link.ts 21–27 (target)
  - W2.2 pause wraps setTimeout in a promise · src/link.ts 41–43 (target)
  - W2.3 The attempt limit · src/link.ts 11–11 (target); src/link.ts 18–20 (target)
  - W2.4 Giving up: settle('gave-up') and return · src/link.ts 28–29 (target)
  - W2.5 Two reports, 'retrying later' before 'offline mode' · src/session.ts 4–8 (target)
- **W3** When transport.open rejects
  - W3.1 A rejection leaves the loop without settling · src/link.ts 17–30 (target)
  - W3.2 startSession rejects with no report · src/session.ts 5–8 (target)

Reviewer, visit 1: **rework**. I checked the walks against target/src/link.ts, target/src/session.ts and the base versions. A Standard reader can follow them. W1 goes through startSession, whenSettled, the connect loop, settle and the deferred callback. W2 covers the backoff, the attempt limit and the order of the two reports. W3 shows how a rejection skips the retries and settle. The explanations are accurate in nearly every detail. The microtask-before-timer ordering, the one-shot capture of the callback in settle, the pause after the last failure (600 ms of waits in total), the fractional and zero values of maxAttempts, the callback left stored after a rejection, and the two different ways report can fail all match the code. The Show more parts take the main text further rather than repeating it. One statement is not true of the code: W1.3's Show more says that overlapping connect calls would each cut the other's attempts short. Because the counter is reset when a call starts, an overlapping call can also give another call more attempts than maxAttempts. Since the reader checks the code through these texts, this one false statement means rework. Nothing else needs changing.
- W1.3: The Show more says that two overlapping connect calls on one Link 'would reset and increment the same counter, and each would cut short the other's attempts.' That is only half right. When one call resets the shared counter to 0, the other call's count drops too, so the other call can make more attempts than maxAttempts. The correct reading is that the shared counter makes the number of attempts per call unreliable: a call can end up with fewer attempts or with more.

Reviewer, visit 2: **accept**. The one finding from the first visit has been put right. W1.3's main text now says the limit of three holds for 'a single connect call running on its own'. Its Show more now explains that overlapping calls make the number of attempts per call unreliable, in either direction. Both of its examples hold up against target src/link.ts lines 18–26. In the 'more' case, a reset during A's final pause gives A a fourth call to open. In the 'fewer' case, B's increments can make A's check `attempts < maxAttempts` false after only two attempts of its own. The rest of the walks were already accurate and are unchanged. The reader can still follow the success path, the backoff and give-up path with the order of its two reports, and the rejection path that leaves the callback stored on the Link, and each step explains the code it shows. Nothing false or significantly missing remains.

### Essentials run (job-0243d6cd-13b8-40a1-a841-78150e190f30)

- **W1** Starting a session when the link connects
  - W1.1 startSession registers a settled callback, then connects · src/session.ts 3–5 (target)
  - W1.2 whenSettled stores a single callback · src/link.ts 8–15 (target)
  - W1.3 connect tries to open, and the transport succeeds · src/link.ts 8–10 (base); src/link.ts 17–25 (target)
  - W1.4 settle takes the callback once and schedules it · src/link.ts 32–38 (target)
  - W1.5 Back in startSession: nothing to report yet · src/session.ts 5–8 (target)
  - W1.6 The timer fires: 'session ready' · src/session.ts 4–4 (target)
- **W2** When every attempt fails
  - W2.1 A failed open leads to a pause · src/link.ts 19–27 (target)
  - W2.2 pause wraps a timer in a promise · src/link.ts 41–43 (target)
  - W2.3 The loop ends: settle 'gave-up' and return it · src/link.ts 28–29 (target)
  - W2.4 startSession reports 'retrying later' first · src/session.ts 5–8 (target)
  - W2.5 Then the timer reports 'offline mode' · src/session.ts 4–4 (target)

Reviewer, visit 1: **accept**. I checked every claim against src/link.ts and src/session.ts on both sides, and they hold. The base Link had only `transport` and a pass-through `connect`. The base startSession ignored the boolean and had no other caller. The target `whenSettled` keeps a single slot. `attempts` is per instance and reset on every `connect`. If `open` rejects, `settle` is skipped and the callback stays registered. `settle` clears the slot and queues the callback with `setTimeout(..., 0)`. The backoff waits 100, 200 and 300 ms, including the pause after the last failure. A `maxAttempts` of 0 or less gives up without trying. The awaited `'gave-up'` path reports 'retrying later' in a microtask, before the timer reports 'offline mode'. The reader can follow the course. The walks say when a callback is only registered and when it runs, say when the teaching order differs from execution order (W1.6 and W2.5 come back to line 4), and handle the return into startSession and the failure branch as alternatives at the `if (open)` branch, not as one run. For Essentials, the walks bring out what matters: two paths reach `report`, the readiness report comes after `startSession` resolves, the message order on failure is fixed, and nothing actually retries. The instance-state and timer-exception points are consequences that bear on review, and most of the extra mechanics come after Show more, where they continue the first part rather than repeat it. Nothing is false and nothing significant is missing, so I accept.

### Teacher run (job-549bd742-2f1c-429a-9df3-9b283db81529)

- **W1** Starting a session when the link connects
  - W1.1 startSession registers a settle callback · src/session.ts 3–5 (target)
  - W1.2 whenSettled stores one callback · src/link.ts 8–15 (target)
  - W1.3 connect tries the transport in a loop · src/link.ts 17–25 (target)
  - W1.4 settle defers the callback to a timer · src/link.ts 32–38 (target)
  - W1.5 startSession resumes and finishes · src/session.ts 5–8 (target)
  - W1.6 The timer runs the registered callback · src/session.ts 4–4 (target)
- **W2** Giving up after every attempt fails
  - W2.1 A failed attempt waits before the next try · src/link.ts 19–27 (target)
  - W2.2 pause wraps setTimeout in a promise · src/link.ts 41–43 (target)
  - W2.3 The loop ends with gave-up · src/link.ts 28–29 (target)
  - W2.4 startSession reports 'retrying later' first · src/session.ts 5–8 (target)
  - W2.5 The timer reports 'offline mode' · src/session.ts 4–4 (target)
- **W3** When the transport rejects
  - W3.1 A rejection leaves the loop without settling · src/link.ts 17–21 (target)
  - W3.2 startSession rejects with no report · src/session.ts 4–8 (target)

Reviewer, visit 1: **accept**. I checked every step against src/link.ts and src/session.ts on both sides. A Teacher reader can follow all three walks. Each walk shows how execution reaches every place. The success, failure and rejection outcomes are presented as alternatives that return to the same branch at target link.ts line 21–22, not as one run. The text says where teaching order differs from execution order: the timer callback in W1.6 and W2.5 is started by the event loop after startSession has resolved. Each step builds the concepts it needs, right where it needs them: callbacks and closures, async/await suspension, microtasks versus timer tasks and why that order is guaranteed, the promise executor in pause, and await on a rejected promise acting as a throw. Later steps refer back to these explanations instead of deriving them again. The claims are true of the code. The single callback slot is replaced on each whenSettled call (line 14). settle empties the slot before it schedules the callback (lines 33–36). The linear waits of 100, 200 and 300 ms include a wait after the final attempt, 600 ms in total (lines 19–27). The order 'retrying later' then 'offline mode' follows from the microtask and timer ordering. A rejection skips settle, leaves the callback registered and makes startSession reject. The comparisons with base are also correct: base connect returned transport.open's boolean, and base startSession took no report. The single-threaded overlap of connect calls is correctly described as interleaving, not a data race. Each Show more part goes deeper than the first part instead of repeating it. Nothing false or significantly missing affects understanding, so I accept the walks.

## The simple step: the registration in startSession

### Standard, written during the walk (the loop's writer; standard run, W1.1 startSession registers the settle callback)

Places: startSession signature and callback registration (src/session.ts 3–5, target)

`startSession` is where a session begins. In the earlier version it only awaited `link.connect(address)` and returned nothing to anyone. Now it also takes a `report` function. Whoever calls `startSession` passes it in to receive short status texts. Nothing in this repository calls `startSession`, so it can't be shown here what a real `report` does with those texts.

Before it connects, `startSession` gives `link.whenSettled` a callback. The callback turns an `Outcome` into a message:

- `'connected'` → `'session ready'`
- anything else → `'offline mode'`

`Outcome` is defined in the Link module as `'connected' | 'gave-up'`. So "anything else" currently means `'gave-up'`. If a new value is added to `Outcome` later, it would also show up as `'offline mode'`, with no type error to flag it.

**The callback is only handed over at this point; it does not run.** It runs later, when the `Link` "settles" a connection attempt. The steps that follow show how and when.

Next, `startSession` awaits `link.connect(address)`. This is where execution leaves `startSession`. W1.2 first shows where the callback is kept, and W1.3 then follows `connect`.

**Show more:**

This means `report` can be called from two places:

- **The registered callback**, which the `Link` calls whenever it settles.
- **`startSession`'s own code after the await.** When the outcome is `'gave-up'`, that code calls `report('retrying later')` directly.

A failed connection therefore produces two messages: one from each place. W2.5 works out the order they come in. On the success path in this walk, only the callback reports.

Because the callback is registered on the `Link` object, it is not tied to this one call to `startSession`. It stays stored on the `Link` until something uses or replaces it. That matters later in W1.5 and in W3.

### Essentials, written during the walk (the loop's writer; essens run, W1.1 startSession registers a settled callback, then connects)

Places: startSession (src/session.ts 3–5, target)

`startSession` is where the walk starts. It now takes a `report` function, and it gives that function to two different paths:

1. **The settled callback.** `link.whenSettled(...)` only registers a callback here and does not run it. Later, the callback turns the `Outcome` into `'session ready'` or `'offline mode'`. The `Link` decides when it runs.
2. **The awaited result.** `await link.connect(address)` gives back an `Outcome` (`'connected' | 'gave-up'`), and `startSession` checks that value itself on the lines that follow.

In the old version, `startSession` had no `report` parameter. It awaited `connect` and ignored the `boolean` that came back, so nothing was reported.

**What to carry forward: one connection attempt can now reach `report` through both paths, and each path runs on its own timing.** The rest of this walk follows the order in which they fire. The next step shows that `whenSettled` keeps only one callback, so registering a second one replaces the first.

**Show more:**

Each path covers different outcomes. The callback has a message for both `'connected'` and `'gave-up'`. The direct check acts only on `'gave-up'`, where it reports `'retrying later'`. So with `'connected'`, only the callback reports anything. With `'gave-up'`, both paths report.

`report` is a required parameter, so any existing caller written for the old two-argument signature no longer compiles. No other caller of `startSession` exists in either revision.

### Teacher, written during the walk (the loop's writer; pedagog run, W1.1 startSession registers a settle callback)

Places: startSession registers the callback (src/session.ts 3–5, target)

This is where a session begins. In the earlier revision, `startSession` only awaited `link.connect(address)` and reported nothing. Now it takes a third parameter, `report`, which is a function that accepts a piece of text. The session uses it to tell its caller how the connection turned out. `startSession` doesn't decide what happens to that text, whether it's logged or shown to a user. It only calls `report`. No caller of `startSession` exists in this code, so it can't be seen what any real caller passes as `report`.

**First line: a callback is registered.** The argument given to `link.whenSettled` is an arrow function. In TypeScript, `(outcome) => ...` creates a function value without running it. `startSession` hands this function to the `Link` so that the `Link` can call it later, once the connection attempt has *settled*, meaning it has a final outcome. This is what "callback" means here. The function's body maps the outcome to a message:

- `'connected'` becomes `'session ready'`
- anything else becomes `'offline mode'`

`Outcome` is declared in `link.ts` as `'connected' | 'gave-up'`, so "anything else" can only be `'gave-up'`.

**Registering doesn't report anything.** When this line finishes, `report` hasn't been called. The `Link` has only stored the function. The next step shows how `whenSettled` keeps it.

**Second line: `connect` is awaited.** Because `startSession` is an `async` function, `await link.connect(address)` suspends `startSession` until the promise from `connect` resolves. Then the function continues with the result in `outcome`. The walk follows that call into `connect` in a later step.

This means the session has two separate ways to report:

1. the registered callback, which the `Link` decides when to call
2. the direct `report('retrying later')` that comes after the await

To judge this change you need to know in what order these two paths run. This walk and the next one work that out.

### Essentials, made after the walk (the step explanation channel on the Standard walk's W1.1; status done, present)

In the base version, `startSession` only awaited `link.connect(address)` and told no one how it went. Now it takes a `report` callback and passes status texts to it.

Here it does two things, in this order:

1. **It registers a settle callback.** Before connecting, it gives `link.whenSettled` a function that maps the `Outcome` to a text. `'connected'` becomes `'session ready'` and anything else becomes `'offline mode'`. The callback is only stored at this point. It does not run until the `Link` settles the attempt, later in the walk.
2. **It starts connecting.** It awaits `link.connect(address)`. At this point execution leaves `startSession` and goes into `Link`.

To judge this step, two things matter:

- **Order matters.** The callback has to be stored before `connect` runs, because `connect` is what settles and hands the result to the stored callback. If no callback is stored by then, nothing is reported.
- **The `else` branch is a catch-all.** In `link.ts`, `Outcome` is `'connected' | 'gave-up'`, so `'offline mode'` means `'gave-up'` today. If a third value is added to `Outcome` later, it will also be reported as `'offline mode'`, and the compiler won't flag it.

Nothing in the repository calls `startSession`, so the code can't show what a real `report` does with these texts.

<!-- dspatch:details -->
`whenSettled` keeps a single callback slot, and registering again replaces the earlier callback (shown in the next step, W1.2). So when one `Link` is passed to `startSession` twice, only the newest callback is still stored when that `Link` next settles.

This is also not the only place that calls `report`. After `connect` returns `'gave-up'`, `startSession` calls `report('retrying later')` directly. W2.5 covers how that message and the deferred `'offline mode'` are ordered.

### Teacher, made after the walk (the step explanation channel on the Standard walk's W1.1; status done, present)

This step is where a session starts. It is also where the change adds a way for the session to tell its caller how the connection went.

**What changed.** In the base revision, `startSession(link, address)` only awaited `link.connect(address)`, and no one was told the result. In the target revision it takes a third parameter, `report: (text: string) => void`. That is a function the caller supplies, and `startSession` calls it with short status texts. No code in the repository calls `startSession`, so the code can't show what a real `report` does with those texts (for example, logging them or showing them in a UI).

**Registering a callback is not calling it.** A *callback* is a function you hand to someone else so they can call it later. The `whenSettled(...)` line builds a small arrow function and gives it to the `Link`. It works like leaving a phone number: "call me when it's settled." At this point nothing is reported. The `Link` keeps the function and calls it once a connection attempt has a final result (`Link` calls this "settling"). The function translates that result into text:

- `'connected'` → `'session ready'`
- anything else → `'offline mode'`

**Why it is registered first.** The settling happens inside `link.connect` itself, at the end of its loop. So the callback has to be stored before `connect` starts, or there is nothing for the `Link` to call. Here the order is guaranteed: the `whenSettled` line runs to completion before the next line calls `connect`.

**What `await` does here.** `startSession` is an `async` function, so calling it returns a `Promise` (an object that stands for a result that isn't ready yet). At `await link.connect(address)`, `startSession` pauses and gives control back to its caller. It continues only when `connect`'s promise resolves. This is the point where the walk leaves `startSession`. The next step (W1.2) shows where the callback is stored, and W1.3 follows `connect`.

**A risk to judge.** In the target revision, `Outcome` is a *union of string literal types*: `'connected' | 'gave-up'`. A variable of this type can only hold one of those two exact strings. The ternary here checks only for `'connected'` and sends everything else to `'offline mode'`. Today that means `'gave-up'`. If someone later adds a third value to `Outcome`, it will also be reported as `'offline mode'`, and the compiler won't warn about it.

<!-- dspatch:details -->
**`Outcome` and `whenSettled` are new in this change.** In the base revision, `Link.connect` returned `Promise<boolean>` and simply passed on `transport.open`. There was no `Outcome` type and no `whenSettled`. Both come from the target `link.ts`, and `session.ts` imports `Outcome` with `import { Link, type Outcome }`. The `type` keyword marks it as used only for type checking, so the import disappears from the compiled JavaScript.

**Why the compiler stays quiet.** TypeScript warns about an unhandled union member only when the code is written to require every case. A common way is a `switch` whose `default` assigns the value to a variable of type `never`: if a case is missing, that assignment is a type error. A two-way ternary like this one has no such check, so the `else` branch silently takes any new value.

**One slot, not a list.** `whenSettled` stores a single callback, and calling it again replaces the earlier one (shown in W1.2). So the phone-number picture means one number per `Link`. If the same `Link` were passed to `startSession` twice before it settles, only the newest callback would still be stored and called. No code in the repository shows whether callers ever share a `Link` like this.

**`report` has a second caller.** The callback is not the only place that calls `report`. After `connect` returns `'gave-up'`, `startSession` itself calls `report('retrying later')`. W2.5 explains why that text arrives before the callback's `'offline mode'`. And if `transport.open` rejects (fails with an error), the attempt never settles, so this callback never runs (W3.1, W3.2).

## The complex step: settle: the slot emptied and the callback deferred

### Standard, written during the walk (the loop's writer; standard run, W1.5 settle defers the callback to a timer)

Places: settle (src/link.ts 32–38, target)

This step is reached from the `settle('connected')` call in W1.4. `settle` does three things, and each one makes a difference.

1. **It copies `onSettled` into a local variable `callback` and then sets the field to `null`.** This makes the registration one-shot: after one settle, the `Link` has no callback left. A later `connect` on the same `Link` will report nothing through this channel unless someone calls `whenSettled` again.
2. **It does nothing if no callback is registered.** If `onSettled` was still `null`, the field's initial value (W1.2), the `if` simply skips the scheduling. A `Link` that nobody subscribed to still connects normally.
3. **It doesn't call the callback; it schedules it with `setTimeout(..., 0)`.** The call becomes a timer task that the JavaScript event loop runs later. That happens only after the current code, including the rest of `connect`, has finished.

**Point 3 decides the order of everything that follows.** `settle` returns at once, and then `connect` reaches `return 'connected'`. Returning from an `async` function resolves the promise that `startSession` is awaiting. The code after that `await` is queued as a *microtask*. The JavaScript runtime runs all queued microtasks before it takes the next timer task. As a result, `startSession` resumes before this callback runs, even with a delay of 0. W1.6 follows those two pieces of work in that order.

**Show more:**

A few consequences of how this is written:

- **The timer keeps the callback it captured.** The function given to `setTimeout` closes over the local `callback`, not over the field. If someone calls `whenSettled` again before the timer fires, the new callback is stored for a later settle, and the already scheduled one still runs with this outcome.
- **Errors thrown by the callback have nowhere to go.** The callback runs in its own timer task, outside `connect` and outside `startSession`'s promise. If `report` throws, `startSession` can't catch it and its promise doesn't reject. The error becomes an uncaught exception in whatever runtime hosts this code. How that runtime handles it can't be read from this repository.
- **"0 ms" means "as a later task", not "immediately".** Runtimes may hold back a zero-delay timer a little, and other timers that are already due can run first. The guarantee that matters here is ordering, not timing: queued microtasks always run before this timer task.

### Essentials, written during the walk (the loop's writer; essens run, W1.4 settle takes the callback once and schedules it)

Places: settle (src/link.ts 32–38, target)

This step comes from `this.settle('connected')` in the success branch of `connect`. `settle` takes the callback out of `onSettled` and clears the field in the same synchronous step, so a registered callback is scheduled at most once. If `onSettled` is already `null`, for example because no callback was registered or an earlier settle used it, nothing happens.

**`settle` doesn't call the callback; it only queues it with `setTimeout(..., 0)`.** The timer callback runs in a later event-loop task, after the current call stack and all pending promise continuations have finished. `settle` returns right away, and `connect` returns `'connected'` before `'session ready'` has been reported. The callback then runs on its own, outside `connect` and `startSession`. Step W1.6 follows it there.

**Show more:**

Because the callback runs from a timer, an exception it throws (one thrown by `report`, for example) does not reach `connect` or `startSession`. Whatever awaits `startSession` can't catch it, and it surfaces as an uncaught error in the timer's context.

Clearing `onSettled` only covers the callback that was registered at the moment `settle` ran. If `whenSettled` runs again before the timer fires, the new callback is stored for a later settle. The already-queued call still runs with the old callback, because it captured that callback in its local `callback` variable.

### Teacher, written during the walk (the loop's writer; pedagog run, W1.4 settle defers the callback to a timer)

Places: settle (src/link.ts 32–38, target)

`connect` calls this method on its success branch, just before it returns `'connected'` (W1.3). `settle` is a normal synchronous method. It finishes before `connect` moves on to its `return`. It does two things:

1. **It empties the slot first.** It copies the stored callback into the local variable `callback` and then sets `onSettled` to `null`. Each registered callback can therefore be scheduled at most once. A later `settle`, for example from another `connect` call, finds `null` and does nothing, unless `whenSettled` has registered a new callback in the meantime (W1.2). If nothing was registered at all, `settle` schedules nothing.
2. **It schedules the callback instead of calling it.** `setTimeout(() => callback(outcome), 0)` puts a timer task on JavaScript's event loop, and `settle` returns straight away. The callback hasn't run when `settle` returns.

The delay of `0` doesn't mean "now". The JavaScript runtime finishes the code it is currently running, plus all **microtasks** queued during that run, before it starts any timer task. A microtask is short follow-up work queued by promises. The continuation after an `await` is one. The language and the event-loop rules guarantee this order. It doesn't depend on how fast the machine is.

What follows for this walk: after `settle` returns, `connect` returns `'connected'`. That resolves the promise `startSession` is awaiting, so the continuation of `startSession` is queued as a microtask. **That microtask runs before the timer that `settle` just created**. So `startSession` resumes and finishes (W1.5) before the callback reports `'session ready'` (W1.6).

**Show more:**

The arrow function given to `setTimeout` is a closure. It captures the local `callback` and `outcome`, not the field `onSettled`. A `whenSettled` call made after `settle` but before the timer fires therefore doesn't change or cancel the callback already queued. It only fills the now-empty slot for a later `settle`. Nothing in `Link` keeps the timer's handle, so a queued callback can't be cancelled.

The same ordering also covers code that awaits `startSession`. Those continuations are microtasks too, so they run before the timer as long as they only wait on promises that are already resolved. If such a caller awaits something that needs a new timer or I/O, the code allows the callback to run first. That depends on the caller, and no caller exists in this code.

### Essentials, made after the walk (the step explanation channel on the Standard walk's W1.5; status done, present)

`settle` is reached from `settle('connected')` in the previous step (W1.4). It delivers the outcome to whoever registered with `whenSettled`, and it does that in two ways that matter:

- **The callback is used once.** It removes the callback from the `Link` before scheduling it. The registration therefore covers one settle only. If `connect` is called again on the same `Link`, nothing is reported through this channel unless someone calls `whenSettled` again first. If no callback was registered, `settle` does nothing, and connecting still works.
- **The callback is scheduled, not called.** `setTimeout(..., 0)` queues the call as a timer task. `settle` returns at once, `connect` reaches `return 'connected'`, and `startSession` resumes after its `await` before the callback runs. That follows from JavaScript's rules, not from timing: when the promise `startSession` awaits resolves, the rest of `startSession` is queued as a microtask, and all queued microtasks run before the next timer task.

In this walk, the order has no visible effect, because `startSession` reports nothing directly after `'connected'`. It matters on the failure path. There, `startSession` reports `'retrying later'` first, and then the timer reports `'offline mode'` (W2.5). The next step (W1.6) follows the two pieces of work in order.

<!-- dspatch:details -->
**Errors in the callback reach no caller.** The callback runs inside a timer task, and by then `connect` and `startSession` have already finished. If `report` throws, the exception does not reach `connect` or `startSession`, and no promise in this code rejects. It becomes an uncaught exception at the top level of the runtime, and how that is handled depends on the host environment. The code here doesn't show which environment that is.

**Clearing before scheduling has a side benefit.** When the timer runs the callback, `onSettled` is already `null`. So a callback that calls `whenSettled` again sets up a fresh registration and is not overwritten afterwards.

**`settle` is not reached on every path.** In the target revision, `settle` is called only from `connect`: at the success return and after the loop gives up. If `transport.open` rejects, `connect` leaves before either call, so the registered callback stays stored and is never scheduled (W3.1).

### Teacher, made after the walk (the step explanation channel on the Standard walk's W1.5; status done, present)

The previous step ended with `connect` calling `settle('connected')` (W1.4). `settle` is where the callback registered in `whenSettled` gets the result. It doesn't call that callback directly: it asks the JavaScript runtime to call it a little later. To see what "later" means, you need two rules of JavaScript.

**Rule 1: code runs one piece at a time, to the end.** JavaScript runs your code on a single thread. A piece of work, such as a function and everything it calls synchronously, runs to completion before the runtime starts anything else. Work for later waits in queues, and the *event loop* takes it from them one item at a time.

**Rule 2: there are two queues, and one has priority.**

- `setTimeout(fn, 0)` puts `fn` in the **timer (task) queue**. The 0 means "no extra delay". It does not mean "now".
- When a promise settles, whatever was waiting on it goes into the **microtask queue**. That includes the code after an `await`. After each task, the runtime runs every queued microtask before it takes the next timer task.

**What the code does here.**

1. **It takes the callback and clears the field.** `settle` copies `onSettled` into the local `callback` and sets the field to `null`. The callback is now owned by this one settle, so the next settle finds nothing. A second `connect` on the same `Link` reports nothing through this channel unless `whenSettled` is called again. If nothing was ever registered, the `if` skips the rest, and connecting works the same.
2. **It schedules the call.** The arrow function `() => callback(outcome)` is a *closure*: it remembers `callback` and `outcome` from this call of `settle`. That is why the local copy matters. The field is already `null`, but the closure still holds the function.

**The resulting order on the success path:**

1. `settle` queues the timer task and returns.
2. `connect` reaches `return 'connected'`, which resolves the promise that `startSession` is awaiting. The rest of `startSession` goes into the microtask queue.
3. Microtasks run first, so `startSession` resumes and finishes.
4. Only then does the timer task run, and `report('session ready')` is called.

This order follows from the language rules, not from timing luck, and the next step (W1.6) follows it from `startSession`'s side. On this success path the order has no visible effect, because `startSession` reports nothing directly after `'connected'`. On the failure path it decides that `'retrying later'` comes before `'offline mode'` (W2.5).

<!-- dspatch:details -->
**An analogy for the two queues.** Think of a clerk with two trays. Promise follow-ups go in an "urgent" tray, which must be emptied completely before the clerk takes even one item from the "timers" tray. `setTimeout(..., 0)` drops a note in the timers tray. When `connect` returns, it drops `startSession`'s continuation in the urgent tray, so that continuation always runs first, even though the timer note was written earlier.

**The 0 delay is a minimum, not a promise.** Timers can fire later than asked, for example when the thread is busy or the host limits short timers. That affects only *how late* the callback runs, never whether it can overtake the microtasks. Neither revision has a configuration or package file that names the host runtime (for example Node.js or a browser). Both follow the priority rule described above.

**Errors thrown later reach no caller.** By the time the timer runs, `connect` and `startSession` have both finished, and their promises are already resolved. If `report` throws inside the callback, the error can't reach those promises or any `try/catch` around `await startSession(...)`. It becomes an *uncaught exception* at the runtime's top level, and the host decides what happens next. In Node.js, by default, that ends the process. This code doesn't show which host it runs in.

**Clearing first also allows re-registration.** The field is `null` before the callback runs. So a callback that itself calls `whenSettled` sets up a new registration that stays in place, because `settle` doesn't touch the field again afterwards.

**When `settle` never runs.** `settle` is `private`, and in the target revision it is called only from `connect`, at the success return and after the attempt loop. If `transport.open` *rejects* (its promise fails), `connect` exits by throwing before reaching either call. The callback stays registered and is never scheduled (W3.1).

## The loop runs' own summaries

### Standard

```json
{
  "runId": "walk-fc3826b5-77d8-49a5-9fae-a97c0ec09227",
  "graphId": "dspatch-walk-loop",
  "graphVersionId": "graph-8e84007492c1b56f",
  "roles": [
    {
      "id": "walk-planner",
      "sourcePath": "docs/loop/roles/review/walk-planner.role.md"
    },
    {
      "id": "walk-writer",
      "sourcePath": "docs/loop/roles/review/walk-writer.role.md"
    },
    {
      "id": "walk-reviewer",
      "sourcePath": "docs/loop/roles/review/walk-reviewer.role.md"
    }
  ],
  "recordPath": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-YIpuu9\\reviews\\generated\\r-ce710726fc90476faf1c3b02\\job-a40a96cc-c07a-4c84-ac4d-71d171580436.walk-loop\\record.jsonl",
  "resultsDir": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-YIpuu9\\reviews\\generated\\r-ce710726fc90476faf1c3b02\\job-a40a96cc-c07a-4c84-ac4d-71d171580436.walk-loop\\results",
  "status": "delivered",
  "path": [
    "plan",
    "write",
    "review",
    "write",
    "review",
    "delivered"
  ],
  "first": {
    "assessment": "I checked the walks against target/src/link.ts, target/src/session.ts and the base versions. A Standard reader can follow them. W1 goes through startSession, whenSettled, the connect loop, settle and the deferred callback. W2 covers the backoff, the attempt limit and the order of the two reports. W3 shows how a rejection skips the retries and settle. The explanations are accurate in nearly every detail. The microtask-before-timer ordering, the one-shot capture of the callback in settle, the pause after the last failure (600 ms of waits in total), the fractional and zero values of maxAttempts, the callback left stored after a rejection, and the two different ways report can fail all match the code. The Show more parts take the main text further rather than repeating it. One statement is not true of the code: W1.3's Show more says that overlapping connect calls would each cut the other's attempts short. Because the counter is reset when a call starts, an overlapping call can also give another call more attempts than maxAttempts. Since the reader checks the code through these texts, this one false statement means rework. Nothing else needs changing.",
    "verdict": "rework",
    "findings": [
      {
        "kind": "explanation",
        "steps": [
          "W1.3"
        ],
        "problem": "The Show more says that two overlapping connect calls on one Link 'would reset and increment the same counter, and each would cut short the other's attempts.' That is only half right. When one call resets the shared counter to 0, the other call's count drops too, so the other call can make more attempts than maxAttempts. The correct reading is that the shared counter makes the number of attempts per call unreliable: a call can end up with fewer attempts or with more.",
        "why": "The step is there to warn about the shared counter. If the reader is told the only risk is fewer attempts, they will not expect a connect call to make extra transport.open calls, and they could reason wrongly about how many times open runs or how long it takes before 'gave-up'.",
        "evidence": "target src/link.ts 18–20 and 26: `this.attempts = 0` at the start of every connect, the check `while (this.attempts < this.maxAttempts)`, then `this.attempts += 1`, and `await pause(...)` gives way to other code. Example: call A has failed its third attempt and is in its 300 ms pause, with attempts = 3. Call B starts and resets attempts to 0, then raises it to 1. When A resumes, it checks 1 < 3 and makes a fourth attempt.",
        "reference": ""
      }
    ]
  },
  "final": {
    "assessment": "The one finding from the first visit has been put right. W1.3's main text now says the limit of three holds for 'a single connect call running on its own'. Its Show more now explains that overlapping calls make the number of attempts per call unreliable, in either direction. Both of its examples hold up against target src/link.ts lines 18–26. In the 'more' c
```

### Essentials

```json
{
  "runId": "walk-d87cf2b7-2244-4403-bcac-f30d2abf4f46",
  "graphId": "dspatch-walk-loop",
  "graphVersionId": "graph-8e84007492c1b56f",
  "roles": [
    {
      "id": "walk-planner",
      "sourcePath": "docs/loop/roles/review/walk-planner.role.md"
    },
    {
      "id": "walk-writer",
      "sourcePath": "docs/loop/roles/review/walk-writer.role.md"
    },
    {
      "id": "walk-reviewer",
      "sourcePath": "docs/loop/roles/review/walk-reviewer.role.md"
    }
  ],
  "recordPath": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-YIpuu9\\reviews\\generated\\r-0a400da038ece46b3f38743f\\job-0243d6cd-13b8-40a1-a841-78150e190f30.walk-loop\\record.jsonl",
  "resultsDir": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-YIpuu9\\reviews\\generated\\r-0a400da038ece46b3f38743f\\job-0243d6cd-13b8-40a1-a841-78150e190f30.walk-loop\\results",
  "status": "delivered",
  "path": [
    "plan",
    "write",
    "review",
    "delivered"
  ],
  "first": {
    "assessment": "I checked every claim against src/link.ts and src/session.ts on both sides, and they hold. The base Link had only `transport` and a pass-through `connect`. The base startSession ignored the boolean and had no other caller. The target `whenSettled` keeps a single slot. `attempts` is per instance and reset on every `connect`. If `open` rejects, `settle` is skipped and the callback stays registered. `settle` clears the slot and queues the callback with `setTimeout(..., 0)`. The backoff waits 100, 200 and 300 ms, including the pause after the last failure. A `maxAttempts` of 0 or less gives up without trying. The awaited `'gave-up'` path reports 'retrying later' in a microtask, before the timer reports 'offline mode'. The reader can follow the course. The walks say when a callback is only registered and when it runs, say when the teaching order differs from execution order (W1.6 and W2.5 come back to line 4), and handle the return into startSession and the failure branch as alternatives at the `if (open)` branch, not as one run. For Essentials, the walks bring out what matters: two paths reach `report`, the readiness report comes after `startSession` resolves, the message order on failure is fixed, and nothing actually retries. The instance-state and timer-exception points are consequences that bear on review, and most of the extra mechanics come after Show more, where they continue the first part rather than repeat it. Nothing is false and nothing significant is missing, so I accept.",
    "verdict": "accept",
    "findings": []
  },
  "final": null,
  "rounds": 0,
  "replanned": false,
  "rewritten": [],
  "turns": [
    {
      "node": "plan",
      "occurrence": 1,
      "startedAt": "2026-11-10T15:03:20.652Z",
      "endedAt": "2026-11-10T15:04:13.587Z",
      "durationMs": 52935
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.1",
      "startedAt": "2026-11-10T15:04:14.123Z",
      "endedAt": "2026-11-10T15:04:26.208Z",
      "durationMs": 12085
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.2",
      "startedAt": "2026-11-10T15:04:26.222Z",
      "endedAt": "2026-11-10T15:04:39.012Z",
      "durationMs": 12790
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.3",
      "startedAt": "2026-11-10T15:04:39.025Z",
      "endedAt": "2026-11-10T15:04:46.706Z",
      "durationMs": 7681
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.4",
      "startedAt": "2026-11-10T15:04:46.719Z",
      "endedAt": "2026-11-10T15:04:53.844Z",
      "durationMs": 7125
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.5",
      "startedAt": "2026-11-10T15:04:53.858Z",
      "endedAt": "2026-11-10T15:04:57.796Z",
      "durationMs": 3938
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.6",
      "startedAt": "2026-11-10T15:04:57.808Z",
      "endedAt": "2026-11-10T15:05:04.373Z",
      "du
```

### Teacher

```json
{
  "runId": "walk-4a9534c2-507a-4592-b4e0-ce6e804900a8",
  "graphId": "dspatch-walk-loop",
  "graphVersionId": "graph-8e84007492c1b56f",
  "roles": [
    {
      "id": "walk-planner",
      "sourcePath": "docs/loop/roles/review/walk-planner.role.md"
    },
    {
      "id": "walk-writer",
      "sourcePath": "docs/loop/roles/review/walk-writer.role.md"
    },
    {
      "id": "walk-reviewer",
      "sourcePath": "docs/loop/roles/review/walk-reviewer.role.md"
    }
  ],
  "recordPath": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-YIpuu9\\reviews\\generated\\r-7fb4aa2a48a4b41942c91ed6\\job-549bd742-2f1c-429a-9df3-9b283db81529.walk-loop\\record.jsonl",
  "resultsDir": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-YIpuu9\\reviews\\generated\\r-7fb4aa2a48a4b41942c91ed6\\job-549bd742-2f1c-429a-9df3-9b283db81529.walk-loop\\results",
  "status": "delivered",
  "path": [
    "plan",
    "write",
    "review",
    "delivered"
  ],
  "first": {
    "assessment": "I checked every step against src/link.ts and src/session.ts on both sides. A Teacher reader can follow all three walks. Each walk shows how execution reaches every place. The success, failure and rejection outcomes are presented as alternatives that return to the same branch at target link.ts line 21–22, not as one run. The text says where teaching order differs from execution order: the timer callback in W1.6 and W2.5 is started by the event loop after startSession has resolved. Each step builds the concepts it needs, right where it needs them: callbacks and closures, async/await suspension, microtasks versus timer tasks and why that order is guaranteed, the promise executor in pause, and await on a rejected promise acting as a throw. Later steps refer back to these explanations instead of deriving them again. The claims are true of the code. The single callback slot is replaced on each whenSettled call (line 14). settle empties the slot before it schedules the callback (lines 33–36). The linear waits of 100, 200 and 300 ms include a wait after the final attempt, 600 ms in total (lines 19–27). The order 'retrying later' then 'offline mode' follows from the microtask and timer ordering. A rejection skips settle, leaves the callback registered and makes startSession reject. The comparisons with base are also correct: base connect returned transport.open's boolean, and base startSession took no report. The single-threaded overlap of connect calls is correctly described as interleaving, not a data race. Each Show more part goes deeper than the first part instead of repeating it. Nothing false or significantly missing affects understanding, so I accept the walks.",
    "verdict": "accept",
    "findings": []
  },
  "final": null,
  "rounds": 0,
  "replanned": false,
  "rewritten": [],
  "turns": [
    {
      "node": "plan",
      "occurrence": 1,
      "startedAt": "2026-11-10T15:06:32.301Z",
      "endedAt": "2026-11-10T15:07:22.363Z",
      "durationMs": 50062
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.1",
      "startedAt": "2026-11-10T15:07:22.985Z",
      "endedAt": "2026-11-10T15:07:37.770Z",
      "durationMs": 14785
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.2",
      "startedAt": "2026-11-10T15:07:37.780Z",
      "endedAt": "2026-11-10T15:07:48.565Z",
      "durationMs": 10785
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.3",
      "startedAt": "2026-11-10T15:07:48.576Z",
      "endedAt": "2026-11-10T15:07:58.490Z",
      "durationMs": 9914
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.4",
      "startedAt": "2026-11-10T15:07:58.501Z",
      "endedAt": "2026-11-10T15:08:11.855Z",
      "durationMs": 13354
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.5",
      "startedAt": "2026-11-10T15:08:11.866Z",
      "endedAt": "2026-11-10T15:08:16.776Z",
      "durationMs": 4910
 
```

