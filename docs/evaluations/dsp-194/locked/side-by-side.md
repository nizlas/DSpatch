# DSP-194 · The locked-plan comparison, texts side by side

Provider Copilot (DSpatch's Copilot adapter, analysis policy), model `copilot-default` (the adapter reports no resolved model id). One locked plan (the planner's answer of the DSP-192 real Standard run), the synthetic connect case, steps W1.1 (the registration in `startSession`) and W1.5 (`settle`). Prompts by the product's own builders; one fresh session per prompt. The first part and Show more are kept apart. Names: `writer` is the loop writer's prompt (written during the walk), `present` the step explanation channel's prompt (an alternative made after the walk, with that run's own Standard text as the walk's text).

## The simple step, W1.1: the registration in startSession

### Standard, writer, version 8

**First part:**

`startSession` now accepts a `report` function and registers a callback with `link.whenSettled` before connecting. When that callback later receives an outcome, it reports **“session ready”** for `'connected'` and **“offline mode”** otherwise; registration itself does not call `report`. Then `startSession` awaits `link.connect(address)`, continuing when that call returns.

*No Show more.*

### Standard, writer, version 9

**First part:**

`startSession` now accepts a `report` function and registers a callback with `Link` before awaiting `connect`. When `Link` later settles, the callback reports “session ready” for `connected` and “offline mode” for the other outcome. The next step follows where `Link` stores it.

*No Show more.*

### Essentials, writer, version 8

**First part:**

`startSession` now accepts a `report` function and registers a callback with `link.whenSettled` before awaiting `link.connect(address)`. The callback reports “session ready” for `connected` and “offline mode” otherwise; registration stores it for later rather than reporting immediately (target `src/link.ts:13–15`). Unlike the base version, `startSession` also reports based on the returned outcome after `connect` completes. The next step follows where the registered callback is stored.

*No Show more.*

### Essentials, writer, version 9

**First part:**

`startSession` accepts a `report` function and registers a callback with `link.whenSettled` before connecting. That callback turns a `connected` outcome into `session ready` and any other outcome into `offline mode`; `startSession` then awaits `link.connect(address)`. The next step shows where `Link` keeps the callback until it settles.

*No Show more.*

### Essentials, present (after Standard), version 8

**First part:**

Here `startSession` installs a report callback before starting `connect`: settlement reports “session ready” for `'connected'` and “offline mode” for `'gave-up'`. It still awaits `connect`, then reports “retrying later” if the connection gave up. Compared with the base revision, this adds outcome reporting; registering the callback does not report immediately.

`Link` schedules that callback only when it settles [W1.2, W1.5]. If `transport.open` rejects before settlement, `startSession` rejects without this callback reporting [W3.1].

*No Show more.*

### Essentials, present (after Standard), version 9

**First part:**

Here `startSession` adds a status notification alongside the connection attempt: it registers a handler before calling `connect`, mapping `connected` to “session ready” and `gave-up` to “offline mode.” The awaited result is separate; on `gave-up`, `startSession` also reports “retrying later.” Unlike the base revision, which only awaited `connect`, this version can report the outcome. The next step shows how `Link` stores the handler.

**Show more:**

The notification only has a settled outcome to report. If `transport.open` rejects, `connect` rejects instead of settling, so this handler does not report an outcome; that path is covered in W3.2.

### Teacher, writer, version 8

**First part:**

`startSession` now accepts a `report` function and registers a callback with `Link` before connecting. When called with an outcome, that callback reports `session ready` for `connected` and `offline mode` otherwise; the `Outcome` type’s other value is `gave-up` ([target: `src/link.ts`, line 5]). Registering the callback does not report anything immediately.

`startSession` then awaits `link.connect(address)`. `Link.whenSettled` stores the callback for later; the next step shows where it is kept ([target: `src/link.ts`, lines 8–15]).

*No Show more.*

### Teacher, writer, version 9

**First part:**

`startSession` now accepts a `report` function and registers a callback with `Link.whenSettled` before calling `connect`. The callback reports “session ready” for `'connected'` and “offline mode” for any other outcome. `startSession` then awaits `connect`; the next step shows where `whenSettled` keeps the callback until the link settles.

*No Show more.*

### Teacher, present (after Standard), version 8

**First part:**

Here, `startSession` gives `Link` a function to call once the connection attempt settles, before it starts `connect`. That function reports **“session ready”** for `'connected'` and **“offline mode”** for `'gave-up'`; registering it does not report anything immediately. In the base revision, `startSession` just awaited `connect` and had no `report` parameter. The next step shows how `whenSettled` stores the callback.

**Show more:**

`Link.settle` schedules the stored callback with a timer, while `startSession` separately awaits the result of `connect`. So if the result is `'gave-up'`, this callback reports **“offline mode”**, and then the `if` here also reports **“retrying later”**. If `transport.open` rejects instead, `connect` does not reach `settle` on that path, so this callback is not invoked by `Link`; the rejection propagates through the `await` (W3.1–W3.2).

### Teacher, present (after Standard), version 9

**First part:**

Here, `report` is a function that sends a text message, and the callback translates `Link`’s `Outcome`—`'connected'` or `'gave-up'`—into the corresponding message. Registering the callback does not report immediately: it gives `Link` work to do if it later settles. `startSession` then waits for `connect`; in the next step, `whenSettled` stores that callback (W1.2).

**Show more:**

The callback report is separate from the result `startSession` receives from `connect`: after a `'gave-up'` result, `startSession` also reports `'retrying later'` (W2.5). In the base revision, `startSession` only awaited `connect`; this revision adds the `report` argument and settlement callback. One boundary to keep in mind: if `transport.open` rejects, the walk shows that `Link` does not settle, so this callback does not report an outcome (W3.1, W3.2).

### The ablation at version 8 (an experiment on the prompt text, not product prompts)

### Essentials, writer, version 8, the planner's briefs taken out

**First part:**

`startSession` registers its outcome-to-message callback before calling `link.connect`, so the callback is in place when `Link` settles. It maps `connected` to `session ready` and `gave-up` to `offline mode`; registration itself does not report anything. The awaited return is handled separately, and the next step shows where `Link` stores this callback.

*No Show more.*

### Essentials, present, version 8, the answer format's content rules taken out

**First part:**

`startSession` now accepts a `report` callback and registers an outcome handler before calling `connect`. When the handler runs, it reports “session ready” for `'connected'` or “offline mode” for `'gave-up'`; registering it does not report immediately. `startSession` then waits for `connect` to return. The next step shows how `whenSettled` stores the handler (W1.2).

**Show more:**

These are separate reporting paths: if `connect` returns `'gave-up'`, `startSession` also reports “retrying later” after the `await` (W2.5); the settle handler is deferred to a timer (W1.5). If `transport.open` rejects instead, `connect` rejects, so this code does not reach either report path (W3.2).

### Essentials, present, version 8, the walk's own text taken out

**First part:**

Target `startSession` adds a `report` callback and registers it before calling `link.connect`, so a settled outcome can produce a status: `connected` maps to `session ready`, and `gave-up` to `offline mode`. Unlike the base version, it can report status as well as await the connection result. A rejected `connect` is not covered: it never settles, so `startSession` rejects before reaching its later `if` ([W3.1–W3.2]).

**Show more:**

The return value is handled separately: after `connect` returns `gave-up`, `startSession` also reports `retrying later`. Because `Link.settle` defers the callback to a timer, `offline mode` can be reported afterward ([W1.5], [W2.5]).

## The step with interacting mechanisms, W1.5: settle

### Standard, writer, version 8

**First part:**

After the successful branch calls `settle('connected')`, `settle` takes the registered callback and clears `onSettled` before scheduling it. That makes the callback one-shot; if none is registered, nothing is scheduled.

**Show more:**

`setTimeout(..., 0)` queues the callback for a later timer task rather than running it inside `connect`. `connect` can return `'connected'`, and `startSession` can resume after its `await`, before that timer task runs. The next step follows that callback when it reports `'session ready'`.

### Standard, writer, version 9

**First part:**

`settle` takes the registered callback out of `onSettled` and clears the field before scheduling it. If there is no callback, it does nothing; otherwise, it passes the outcome captured by this call to `setTimeout` with a zero-millisecond delay. This makes the callback one-shot and keeps it from running inside `connect`.

**Show more:**

Because the successful branch calls `settle` before returning, the timer is scheduled before `connect` returns `'connected'`. The `await` in `startSession` then resumes in a promise microtask; the timer callback runs later as a separate task. The next step follows that callback back to `startSession` to explain the report order.

### Essentials, writer, version 8

**First part:**

`settle` takes the registered callback out of `onSettled` and clears the field before scheduling it. If no callback was registered, it schedules nothing; otherwise, `setTimeout` moves the callback out of `connect`’s execution, so it cannot run as part of the success branch that called `settle`.

**Show more:**

`connect` returns `'connected'` after `settle` schedules the timer. Its promise then resolves, and `startSession`’s `await` continuation runs as a microtask before the timer callback runs as a later task. The next step follows those two paths to their reports.

### Essentials, writer, version 9

**First part:**

After W1.4’s successful path calls `settle('connected')`, `settle` schedules the registered callback instead of running it inside `connect`. This lets `connect` return and `startSession` resume after its `await` before the timer callback runs; W1.6 follows that order through to the reports.

**Show more:**

`settle` clears `onSettled` before scheduling, so the callback is used at most once; if no callback is registered, it schedules nothing. When called, the timer passes the same outcome to the callback.

### Essentials, present (after Standard), version 8

**First part:**

After `connect` succeeds (W1.4), `settle` takes the callback registered earlier (W1.2) and schedules it instead of invoking it inline. `connect` returns `'connected'` separately, so the notification does not delay its result; `startSession` reports `'session ready'` when the timer runs in the next step (W1.6). Clearing `onSettled` consumes that callback, and if none is registered, no timer is scheduled.

*No Show more.*

### Essentials, present (after Standard), version 9

**First part:**

On the successful path, `settle` schedules the registered notification for a later timer turn rather than running it inline. `connect` can return `'connected'` first; then `startSession` resumes after its `await`, and the callback reports `'session ready'` in the next step (W1.6).

**Show more:**

`settle` clears the registration before scheduling, so that callback is used at most once. The timer closes over this call’s `outcome`; if no callback is registered, no timer is scheduled.

### Teacher, writer, version 8

**First part:**

After the successful branch in `connect` calls `settle('connected')`, `settle` takes the registered callback out of `onSettled` and clears the field before scheduling it. If no callback was registered, it schedules nothing. Otherwise, `setTimeout` queues the callback to run later, so it does not run inside `connect`; this is what lets `connect` return `'connected'` before the callback reports the result.

**Show more:**

The callback is one-shot because any later call to `settle` finds `onSettled` cleared, even if the first callback has not run yet. A zero-millisecond timer does not run immediately: it queues a timer task. Once `connect` returns, `startSession` can resume from its `await` as a microtask before that timer task runs; the next step follows that order to show when the reports occur.

### Teacher, writer, version 9

**First part:**

`settle` takes the registered callback out of `onSettled` before scheduling it, so this settlement can invoke that callback at most once; if none is registered, it schedules nothing. The callback runs in a later timer task, not inside `connect`.

**Show more:**

As established in W1.2, `onSettled` holds one callback. Copying it to a local variable lets `settle` clear the field while still scheduling that callback with the outcome. On the success path, `connect` then returns `'connected'`; its promise continuation resumes `startSession` before the timer task runs. W1.6 follows that order through to the report.

### Teacher, present (after Standard), version 8

**First part:**

When `connect` succeeds, it calls `settle('connected')` before returning (W1.4). Here, `settle` consumes the registered callback by clearing `onSettled`, then schedules that callback with the outcome rather than calling it immediately. This makes that registration one-shot and lets `connect` return without waiting for the notification.

**Show more:**

A zero-delay timer means “run later when the runtime can,” not “run exactly now.” The scheduled function retains the callback and outcome even though `onSettled` has been cleared. In the next step, `startSession` resumes after `connect` returns, and the timer callback reports `session ready` (W1.6).

### Teacher, present (after Standard), version 9

**First part:**

`settle` is reached after `connect` gets an outcome from an attempt, as in W1.4. It takes the registered callback and clears the registration before scheduling the callback, so that settlement consumes that registration rather than leaving it for another call. `setTimeout(..., 0)` asks JavaScript to run the callback in a later timer task; it does not call it immediately or guarantee it runs exactly zero milliseconds later. In the base revision, `connect` had no settlement callback.

**Show more:**

The callback closes over this call’s `outcome`, so it will report `'connected'` or `'gave-up'` even though `connect` has already returned that outcome to its caller. The timer does not wait for the callback to finish: `startSession` resumes after awaiting `connect` and handles the returned outcome, while the callback reports through `report` in the later step (W1.6). On the failure path, that means `startSession` can report `'retrying later'` before the timer reports `'offline mode'`.

### The ablation at version 8 (an experiment on the prompt text, not product prompts)

### Essentials, writer, version 8, the planner's briefs taken out

**First part:**

`settle` takes the registered callback out of `Link` and clears the field before scheduling it with `setTimeout(..., 0)`. That defers the report instead of running it inside `connect`’s success branch, so `startSession` can resume from its `await` first; the timer callback reports afterward (W1.6).

*No Show more.*

### Essentials, present, version 8, the answer format's content rules taken out

**First part:**

When `connect` reaches this point after a successful open, `settle` takes the registered callback and queues it on a zero-delay timer instead of calling it inline. The callback receives `'connected'`; clearing it first means this registration cannot be used for a later settlement. In the next step, `startSession` handles the returned outcome and the timer callback reports the session status.

*No Show more.*

### Essentials, present, version 8, the walk's own text taken out

**First part:**

When `connect` reaches `settle`, it takes the callback registered earlier and schedules it with a zero-delay timer instead of calling it inline. Clearing the callback slot first means that registration can report only once; if no callback is registered, nothing is scheduled. This separates `connect` returning its outcome from the later report in the next step ([W1.6]). Unlike the base revision, `Link` now has this callback-based settlement path.

**Show more:**

Because the timer is queued before `connect` returns, JavaScript can resume `startSession` from its `await` before the timer callback runs. On a gave-up outcome, that lets `startSession` report “retrying later” before the deferred callback reports “offline mode.”

