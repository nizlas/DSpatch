# connect · planner, writer and reviewer · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, the walk loop drawing, its roles, the run engine and the run record) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:44:14.163Z, ended 2026-11-10T03:01:05.349Z; job done: 3 walk(s) and 0 reading(s), 16 step(s). 12 changed line(s) are in none of them. The reviewer asked for one correction (2 finding(s)); it accepted the corrected walks.

Loop: status **delivered**, path plan → write → review → write → review → delivered; correction rounds 1 (writer; written again: W1.2, W3.1); 21 provider turns; 16 min 51 s in all; usage not reported (unknown). Graph dspatch-walk-loop graph-8e84007492c1b56f; roles walk-planner, walk-writer, walk-reviewer.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | plan-walks | file-1 | 6 min 1 s | 20186 |
| 2 | write-step | file-2 | 42 s | 2255 |
| 3 | write-step | file-2 | 20 s | 1939 |
| 4 | write-step | file-2 | 24 s | 2452 |
| 5 | write-step | file-2 | 20 s | 1831 |
| 6 | write-step | file-2 | 24 s | 2220 |
| 7 | write-step | file-2 | 20 s | 1963 |
| 8 | write-step | file-2 | 20 s | 1770 |
| 9 | write-step | file-2 | 22 s | 2021 |
| 10 | write-step | file-2 | 20 s | 1898 |
| 11 | write-step | file-2 | 24 s | 2214 |
| 12 | write-step | file-2 | 18 s | 1531 |
| 13 | write-step | file-2 | 20 s | 1963 |
| 14 | write-step | file-2 | 20 s | 2082 |
| 15 | write-step | file-2 | 24 s | 2223 |
| 16 | write-step | file-2 | 24 s | 2421 |
| 17 | write-step | file-2 | 28 s | 2234 |
| 18 | review-walks | file-3 | 3 min 35 s | 4203 |
| 19 | write-step | file-2 | 18 s | 2593 |
| 20 | write-step | file-2 | 14 s | 2524 |
| 21 | review-walks | file-3 | 30 s | 1327 |

Sum of answer times: 16 min 48 s.

## The plan (the planner's first answer)

**Summary:** Link.connect no longer hands back a single transport.open result. It now tries up to maxAttempts times (a new constructor option, default 3), waits attempts × 100 ms after each failed open, and answers with an Outcome, 'connected' or 'gave-up', instead of a boolean. A Link can also hold one settled callback, registered with whenSettled, which it detaches and calls from a zero-delay timer when connect settles. startSession takes a report function, registers that callback to report 'session ready' or 'offline mode', awaits connect, and additionally reports 'retrying later' when the link gave up. Read from the code, the intent is to ride out transient failures before giving up and to give the caller a word to show for the result; the change carries no commit message or test that states it.

**Background:** The repository at both revisions holds only `src/link.ts` and `src/session.ts`: nothing in it constructs a Link, calls startSession or tests either, so the default of three attempts and the three report texts are the whole visible behaviour.

Two consequences read from the code are worth knowing before the walks. The pause follows every failed open, including the last one, so by default a link that never opens spends 100 + 200 + 300 ms waiting before it gives up. And the settled callback is deferred with `setTimeout(…, 0)` while the return value resumes the awaiting caller as a promise continuation, so on failure the caller hears 'retrying later' first and 'offline mode' afterwards, after startSession has already returned; on success 'session ready' likewise arrives after startSession has completed.

Both public signatures changed: connect's return type and startSession's required third parameter. Any caller outside these files must follow.

### W1 (walk): A connection that succeeds: from startSession to 'session ready'

*Purpose:* How the new callback and the new return value both carry a successful connection back to the caller, and in which order. · *Question:* What happens when the transport opens, and when does the caller hear 'session ready'?

- **W1.1 startSession registers the settled callback** — Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.
  - startSession's signature and the whenSettled registration: `src/session.ts` target 3–4
  - brief: Show the new shape of startSession against the From side's bare await: it now receives a report sink and, before anything is attempted, registers a callback that closes over report. Make clear that registering calls nothing yet; the reader takes to the next step that the Link now holds this callback and that connect is called right after.
- **W1.2 Link.whenSettled keeps one callback** — The callback is stored in the Link's single onSettled slot; nothing runs yet.
  - whenSettled stores the callback: `src/link.ts` target 13–15 ← from The registration in startSession (`src/session.ts` 4–4)
  - brief: Reached from startSession's call at line 4. Make comprehensible that this is a plain assignment into the onSettled field declared at line 9 (one slot, so a later call replaces an earlier one) and that the Link, not startSession, decides when it is called. The reader takes along that the slot is full when connect starts.
- **W1.3 connect begins the attempt loop** — connect resets the counter and makes the first attempt by awaiting transport.open.
  - connect's signature, the reset and the first attempt: `src/link.ts` target 17–21 ← from The await in startSession (`src/session.ts` 5–5)
  - brief: Reached from startSession's await at line 5. Explain the loop's frame: attempts is reset per call, the while compares it with maxAttempts (a constructor option, default 3; see the contract item), the counter is raised before each open so that it equals the number of attempts made, and the awaited transport.open is where the outside world answers. The reader takes along that the boolean from open decides the branch at line 22, and that this walk follows the true branch.
- **W1.4 open returned true: settle, then return 'connected'** — On success the Link settles the callback first and only then returns 'connected' to the caller.
  - The success branch of the loop body: `src/link.ts` target 22–25
  - brief: This is the branch we follow; the false branch is the second walk, which starts again at this if. Make the order visible: settle runs before the return, so whatever settle does is arranged before connect's promise resolves. The reader takes to the next step the question of what settle actually does with the callback.
- **W1.5 settle detaches the callback and defers it** — settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.
  - The private settle method: `src/link.ts` target 32–38 ← from The settle call on success (`src/link.ts` 23–23)
  - brief: Reached from line 23. Make two things comprehensible: the slot is cleared before the callback is scheduled, so it fires at most once per registration and a later connect on the same Link finds no callback unless whenSettled is called again; and setTimeout(..., 0) means the callback runs in a later turn of the event loop, not inside connect. The reader takes along that when connect returns, nothing has been reported yet.
- **W1.6 Back in startSession: 'connected' needs no extra report** — The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.
  - The await and the gave-up check in startSession: `src/session.ts` target 5–8 ← from The return that resumes the await (`src/link.ts` 24–24)
  - brief: Reached by the return at line 24 resuming the await at line 5; this continuation runs as a promise microtask, before any timer. Make clear that for 'connected' the if does nothing and startSession's own promise resolves here, still without any report. The reader takes along that the only report on this path is still pending in the timer from the previous step.
- **W1.7 The timer fires: 'session ready'** — Later, from the timer settle scheduled, the callback reports 'session ready'.
  - The callback body, now running from the timer: `src/session.ts` target 4–4 ← from The timer settle scheduled (`src/link.ts` 36–36)
  - revisit: The callback registered in step 1 is now seen running, from the timer, with outcome 'connected'.
  - brief: The context followed now is the timer callback set at line 36, not startSession, which has already returned. Explain, as read from the code and not observed, that a caller awaiting startSession is resumed before this report arrives, because promise continuations run before timers; the text comes from the ternary in the callback. Nothing follows this step.

### W2 (walk): Every attempt fails: pauses, giving up and two reports

*Purpose:* How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'. · *Question:* What happens when the transport never opens: how many attempts, how long between them, and what does the caller hear in which order?

- **W2.1 Back at the branch: open returned false** — A failed open skips the success branch and awaits a pause proportional to the attempt number.
  - The if with its false outcome and the pause: `src/link.ts` target 22–26
  - brief: Start again at the if of the first walk's step 4, now with open false; everything before it holds (callback registered, attempts raised to 1). Make clear that no outcome is decided here: the loop body just waits attempts × 100 ms, so 100 ms after the first failure, before anything else happens. The reader takes to the next step that connect is suspended on that pause.
- **W2.2 pause: a timer wrapped in a promise** — pause resolves when a setTimeout fires; the loop continues from that timer.
  - The pause helper: `src/link.ts` target 41–43 ← from The awaited pause in the loop (`src/link.ts` 26–26)
  - brief: Reached from the await at line 26. Explain that this module-private helper has no cancellation and that the loop's next iteration runs from the timer's resolution, which is what makes the delay. The reader takes along that after the pause control goes back to the while condition.
- **W2.3 The loop condition after each pause** — After each pause the while re-checks attempts against maxAttempts; a further attempt raises the counter and opens again.
  - The while condition and the counter: `src/link.ts` target 19–20
  - brief: Reached when the pause resolves, not by a call. Make the sequence comprehensible with the default of 3: open, pause 100, open, pause 200, open, pause 300, and only then the condition fails, so the pause after the last failed attempt is also spent before giving up. Say that a later attempt that succeeds leaves through the first walk's step 4; the reader takes along the state at exit: attempts equals maxAttempts and no outcome has been settled.
- **W2.4 Giving up: settle('gave-up'), then return** — When the loop exits, the Link settles the callback with 'gave-up' and returns the same word.
  - The exit after the loop: `src/link.ts` target 28–29 ← from The loop condition, now false (`src/link.ts` 19–19)
  - brief: Reached when the condition at line 19 is false. Point at the first walk's step 5 for what settle does (slot cleared, callback deferred to a timer); what matters here is that the same outcome goes out through both channels and that the timer is set before connect's promise resolves. The reader takes to the next step that the caller's await and the timer are now both pending.
- **W2.5 Back in startSession: 'retrying later' is reported first** — The await resumes with 'gave-up' and startSession reports 'retrying later' at once.
  - The gave-up check and its report: `src/session.ts` target 5–8 ← from The return that resumes the await (`src/link.ts` 29–29)
  - brief: Reached by the return at line 29 resuming the await at line 5 as a microtask. Make comprehensible why this report comes before the callback's: promise continuations run before the timer settle set, so report('retrying later') runs and startSession returns while 'offline mode' is still queued. Also make clear that nothing in this code retries later; the text is a message, not an action. The reader takes along that a second report is pending.
- **W2.6 The timer fires: 'offline mode'** — Later, from the timer, the callback reports 'offline mode', the second report for the same failure.
  - The callback body, taking the 'offline mode' branch: `src/session.ts` target 4–4 ← from The timer settle scheduled (`src/link.ts` 36–36)
  - brief: Context followed: the timer callback from line 36, after startSession has returned; this is the callback registered in the first walk's step 1, now with outcome 'gave-up'. Explain, as read from the code and not observed, that the caller therefore receives two reports for one failed connect, 'retrying later' then 'offline mode', and that the callback cannot run a second time for this registration because settle emptied the slot. Nothing follows this step.

### W3 (walk): What code that uses Link and startSession must now provide and expect

*Purpose:* The contract change for callers outside these two files, read by dependency rather than by execution. · *Question:* Which signatures changed, and what applies when nothing in this repository sets the new options?

- **W3.1 Outcome replaces connect's boolean** — connect now answers 'connected' or 'gave-up', a string union, where From returned the transport's boolean.
  - The Outcome type: `src/link.ts` target 5–5 ← from The type import in session.ts (`src/session.ts` 1–1)
  - brief: Route by dependency, not execution: this type is what connect returns (line 17) and what the whenSettled callback receives (lines 9 and 13), and session.ts imports it as a type. Make comprehensible that the two-value union carries the same information as the old boolean but in words, and that both words are non-empty strings, so a caller that still tests connect's result as a boolean would read both as true. The reader takes along that these words are what startSession compares against.
- **W3.2 Link's state and the maxAttempts option** — A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.
  - The fields and the constructor: `src/link.ts` target 8–11
  - brief: A mechanism taken apart on its own. Explain the three fields the loop and the callback share, and that maxAttempts is a constructor parameter with default 3; no code in this repository constructs a Link, so the default is what applies here and any other value comes from outside. Note for the reader that attempts is per Link instance and is reset at each connect, which matters if two connects overlap on one Link.
- **W3.3 startSession requires a report sink** — startSession gains a third, required parameter and imports Outcome as a type.
  - The import and the new signature: `src/session.ts` target 1–3
  - brief: Compare with From: the function used to take link and address only and discard connect's result. Make clear that report is required, so every caller must change, and that no caller or test exists in this repository, so the only use of these messages visible here is the one in session.ts itself. The reader takes along that the words 'session ready', 'offline mode' and 'retrying later' are fixed in this function, not configurable.

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 03:01 UTC, through the planner, writer and reviewer loop. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7). The planner planned the walks, the writer explained each step in its own call, and the reviewer judged them against the code; one correction round went to the writer (2 step(s) written again), and the reviewer's final assessment accepted the walks. The reviewer is an agent: its acceptance approves nothing of the code.

### W1 (walk): A connection that succeeds: from startSession to 'session ready'

*Purpose:* How the new callback and the new return value both carry a successful connection back to the caller, and in which order.

#### W1.1 startSession registers the settled callback

- startSession's signature and the whenSettled registration: `src/session.ts` target lines 3–4

`startSession` now takes three arguments instead of two: the `Link`, the address, and a `report` function that accepts a text message. In the earlier revision the whole body was one `await link.connect(address)` whose boolean result was discarded, so the caller learned nothing about how the connection went. Here, before any connection is attempted, the function calls `link.whenSettled` with an arrow function that closes over `report`: whenever the Link later invokes it with an `Outcome`, the arrow function maps `'connected'` to the message `'session ready'` and anything else to `'offline mode'`, and hands that text to `report`.

**Registering the callback runs nothing.** `whenSettled` only stores the function; `report` is not called on this line and no message exists yet. What this step fixes is the order: the Link holds the callback first, and `connect` is called on the very next line, so when the first attempt begins the Link already knows whom to tell. The next step shows the slot the callback lands in.

For judging the change, two things are worth noticing here. The callback is a second channel beside the value `connect` returns; the rest of this walk follows how both carry the same success back to the caller, and in which order. And the message texts are decided inside this arrow function from `outcome` alone, so nothing a caller passes can change them.

**Show more:**

`report` is typed `(text: string) => void`: `startSession` ignores anything it returns and cannot wait for it, so what the sink does with the text, show it, log it, or drop it, lies entirely outside these two files. No caller of `startSession` exists in this repository, so the only use of these messages visible here is this function itself; a third walk takes up what that requires of code elsewhere.

The arrow function keeps `report` alive through its closure: the Link stores the function, not the sink, and `report` is reached only when the callback eventually runs. Because `Outcome` is a union of exactly two strings, the ternary's else branch means precisely `'gave-up'`; the callback does not inspect anything else about the Link, and the same registration serves both the success path of this walk and the failure path of the next one.

#### W1.2 Link.whenSettled keeps one callback

- whenSettled stores the callback: `src/link.ts` target lines 13–15 ← from The registration in startSession (`src/session.ts` 4–4)

*First draft (turn 3), replaced after the reviewer's findings:*

> `whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.
> 
> **There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it; the Link's private `settle` method, which a later step in this walk takes apart, is the only code that reads the slot.
> 
> What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.
> 
> <!-- dspatch:details -->
> 
> Because the slot is a single field, the code allows a sequence the two files never guard against: if `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first, and only the second caller's `report` would ever receive a message for either connection. No caller in this repository does this, so it is a property of the design to be aware of rather than an observed fault.
> 
> The field is `private`, so within these files only `whenSettled` writes it and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

*Final text (turn 19):*

`whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.

**There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it. The only other code that touches the field is the Link's private `settle` method, which a later step in this walk takes apart: it reads the slot and sets it back to `null` in the same move, which is where the single use of each registration comes from.

What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.

**Show more:**

Because the slot is a single field, the code allows a sequence the two files never guard against. If `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first. The slot carries only the callback channel, so the consequence is confined to it: the callback fires once, for whichever `connect` settles first, and into the second caller's `report`; the other `connect` then settles into an empty slot and sends nothing that way. The direct channel is untouched, because each `startSession` compares its own `connect` result and calls its own `report('retrying later')` on `'gave-up'`, independently of the slot. So an overlapped first caller is cut off from `'session ready'` and `'offline mode'`, not from every message. No caller in this repository does this; it is a property of the design to be aware of rather than an observed fault.

The field is `private`, so within these files only `whenSettled` and `settle` write it, one filling it and the other clearing it, and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

#### W1.3 connect begins the attempt loop

- connect's signature, the reset and the first attempt: `src/link.ts` target lines 17–21 ← from The await in startSession (`src/session.ts` 5–5)

`startSession` is now suspended on `await link.connect(address)`, and the walk follows the call into the Link. In the earlier revision `connect` was a single line that returned the transport's boolean untouched; here it is a retry loop that promises an `Outcome` instead, and this step is the loop's frame before any answer has arrived.

Three things set that frame up:

1. `attempts` is set back to `0` at the start of every call, so each `connect` counts from the beginning no matter what an earlier call on the same Link left behind.
2. The `while` condition compares `attempts` with `maxAttempts`, a constructor parameter that defaults to `3`; the third walk looks at how that value is supplied. The check comes before each attempt, so the loop makes at most `maxAttempts` attempts.
3. Inside the body the counter is raised **before** `open` is called. At the moment of any attempt, `attempts` therefore equals the number of attempts made so far, including this one: 1 on the first pass. The second walk shows the pause length being computed from this same number.

The attempt itself is `await this.transport.open(address)`. `Transport` is an interface with only this method, and `open` is where the outside world answers: `connect` hands the address over and is suspended until the transport's promise resolves to a boolean. Nothing in the Link decides whether a connection succeeds; it only reacts to what `open` says.

That boolean, held in `open`, is what the next step branches on. This walk follows the case where it is `true`.

**Show more:**

The code catches nothing. If the transport's promise rejects rather than resolving, the rejection passes out of `connect` and on through the `await` in `startSession`, and `settle` is never reached, so the callback registered earlier stays in the slot with no message sent through either channel. Whether a transport can reject is not established by these files; the interface's type says only `Promise<boolean>`.

`attempts` is an instance field rather than a local of `connect`. That is why the reset in the first line matters: two `connect` calls overlapping on one Link would both read and write the same counter, which the code permits but never guards against. The reset also means that if `maxAttempts` were `0` or negative, the condition would fail at once and the loop body would never run, so no attempt would be made at all; with the default of `3` that case does not arise.

#### W1.4 open returned true: settle, then return 'connected'

- The success branch of the loop body: `src/link.ts` target lines 22–25

`open` is `true`, so the `if` takes the branch this walk follows; the `false` case, which falls through to a pause, is where the second walk begins. Two statements run here, and their order is the point of the step.

First `this.settle('connected')`. `settle` is a private method of the Link that returns `void`, so it runs to completion, synchronously, before the next line is reached; what it arranges with the stored callback is the subject of the next step. Only then comes `return 'connected'`, which ends `connect`. Because `connect` is an `async` function, that return resolves the promise `startSession` is awaiting, and `startSession`'s continuation is queued to run afterwards.

**So whatever `settle` sets up exists before the caller can see the result.** The same word, `'connected'`, goes out through both channels: into `settle` for the callback, and as the return value for the caller. The reader should hold on to this order; the walk returns to it when the two channels deliver their messages at different times.

**Show more:**

The `return` leaves the `while` loop from inside its body, so a success on any pass exits here, not only the first: with the default of three attempts, the second walk shows the failing passes, and an `open` that answers `true` on the second or third pass comes back through this branch with `attempts` at 2 or 3. The counter is left at that value; it is only reset by the next call to `connect`.

Both occurrences of `'connected'` are string literals that TypeScript checks against the `Outcome` type, so neither `settle` nor the caller can receive a word outside the union from here. There is no third thing done in this branch: no state on the Link records that it is connected, and nothing closes or keeps the transport; a later `connect` would open again from scratch.

#### W1.5 settle detaches the callback and defers it

- The private settle method: `src/link.ts` target lines 32–38 ← from The settle call on success (`src/link.ts` 23–23)

`settle` is reached from the success branch with `'connected'` as its `outcome`, and it does two things in a deliberate order.

First it takes the function out of `onSettled` into a local `callback` and sets the field to `null`, before anything is scheduled. That is what makes the registration single-use: **the slot is already empty when the callback is arranged**, so the same registration can never fire twice, and a later `connect` on this Link reaches `settle` with an empty slot unless `whenSettled` has been called again. When the slot was already empty, the `if` guards against calling `null` and `settle` quietly does nothing; no error marks a connection that nobody asked to hear about.

Second, when there was a callback, it is not called here. `setTimeout(() => callback(outcome), 0)` hands a small closure, carrying both the function and the outcome, to the timer queue. A zero-delay timer does not mean "now": by the event loop's rules it runs in a later turn, after the current synchronous code has finished and after any pending promise continuations. So `settle` returns to `connect` with the report only queued, `connect` then returns `'connected'` as we saw in the previous step, and at that moment nothing has reached `report` yet. The next step picks up `startSession` as it resumes, still ahead of the timer.

**Show more:**

The local `callback` is why clearing the field is safe: the closure captures the local variable and the `outcome` argument, not the field, so nulling `onSettled` cannot pull the function out from under the scheduled timer. The handle `setTimeout` returns is discarded, so the Link has no way to cancel a report once settled.

What happens inside the timer is outside anything the Link controls. The callback runs in its own turn with no `try`/`catch` and no promise around it; if `report` threw, the exception would surface as an uncaught error in the timer, not in `connect` or `startSession`, which by then have both finished. And although `settle` is `private`, that keyword is TypeScript's compile-time check; within these files it is called from exactly two places in `connect`, the success branch seen here and the giving-up exit the second walk reaches.

#### W1.6 Back in startSession: 'connected' needs no extra report

- The await and the gave-up check in startSession: `src/session.ts` target lines 5–8 ← from The return that resumes the await (`src/link.ts` 24–24)

`connect` has returned `'connected'`, and that return resolves the promise `startSession` was awaiting. The continuation after an `await` runs as a promise microtask: by the event loop's rules it is processed as soon as the current synchronous work is done and before any timer, so **`startSession` resumes here ahead of the callback that `settle` queued in the previous step.**

`outcome` is now `'connected'`. The only thing `startSession` does with the value is compare it with `'gave-up'`, and that comparison is false, so the `if` body is skipped and `report` is not called. The function then reaches its end, and since it is `async` and returns `Promise<void>`, its own promise resolves here with no value: the caller is told that `startSession` finished, not how the connection went.

That is the state to carry forward: `startSession` has completed, `report` has received nothing on this path, and the one message that will say "session ready" is still waiting in the timer. The next step follows that timer when it fires.

**Show more:**

The `if` is written for the failure case only; there is no branch for success, which is why the success path depends entirely on the callback for its message. With `Outcome` limited to two words, "not `'gave-up'`" and "`'connected'`" are the same condition here, so the code could not silently skip a third outcome; but it also means the return value of `connect` is read for one purpose and then dropped, and nothing of it reaches the caller.

The ordering also gives the reader something to notice about callers. Whoever awaits `startSession` is resumed by the same microtask mechanism, so by the rules of promises any code placed directly after `await startSession(...)` runs before `report('session ready')` does. The code allows a caller to act on a finished `startSession` while the session-ready message has not yet been delivered; no caller exists in this repository to show whether that matters.

#### W1.7 The timer fires: 'session ready'

- The callback body, now running from the timer: `src/session.ts` target lines 4–4 ← from The timer settle scheduled (`src/link.ts` 36–36)

The code here is the arrow function from the first step, but the execution context is new: it is no longer `startSession` running, which has completed and resolved its promise as we saw in the previous step, but the timer that `settle` queued. When the event loop reaches that timer it calls the closure, which calls this arrow function with the `outcome` captured at settle time, `'connected'`.

The ternary then selects its first text, and `report('session ready')` is the single call made. This is **the only message the success path produces**, and it arrives from the callback channel, not from `startSession`'s own code, which reported nothing for this outcome.

What the reader can conclude from the code, not from any observed run, is the order the walk has been building towards: by the rules of promises and timers, a caller awaiting `startSession` is resumed first, and `report('session ready')` reaches the sink after that, in a later turn. Nothing in these two files runs after this report; the walk ends here.

**Show more:**

The `report` the callback uses is the one passed to the `startSession` call that registered it, kept alive by the closure; the Link has no reference to the sink itself. The callback reads nothing from the Link or the transport when it runs, so a change in the Link's state between settling and firing, such as another `connect` having started, could not alter the message; only the captured `outcome` decides it.

"Later" is a lower bound rather than a fixed delay: a zero-delay timer runs no earlier than the next timer phase, and anything already queued ahead of it runs first. The same arrow function serves the failure path, where the ternary takes its other branch; the second walk arrives there with `'gave-up'`.

### W2 (walk): Every attempt fails: pauses, giving up and two reports

*Purpose:* How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.

#### W2.1 Back at the branch: open returned false

- The if with its false outcome and the pause: `src/link.ts` target lines 22–26

The walk is back at the `if` where the first walk's fourth step took the success branch, with everything before it unchanged: `startSession` registered its callback, `connect` reset and then raised `attempts` to `1`, and the first `transport.open` has answered. This time the answer is `false`: the transport resolved its promise with that value rather than throwing, so the `if` body with `settle` and `return` is skipped and execution continues below it.

**Nothing is decided here.** The Link does not record a failure, does not call `settle`, and does not return; the callback stays in its slot untouched. The only thing the loop body does after a failed attempt is `await pause(this.attempts * 100)`, which with `attempts` at `1` asks for a 100 ms wait. During that wait `connect` is suspended, and with it `startSession`'s `await` and whoever is awaiting that, so from the caller's side a failed first attempt looks exactly like an attempt still in progress.

The reader takes to the next step that `connect` is parked on this pause and will continue from whatever resolves it. The multiplier is why later pauses grow: the second failed attempt would wait 200 ms, the third 300 ms, and the third step of this walk lays out the full sequence.

**Show more:**

The pause sits unconditionally after the `if`, inside the loop body, not in a branch of its own. That placement means every failed attempt pays a pause before the `while` condition is re-examined, the last one included; the consequence for the total time before giving up is taken up with the loop condition in a later step.

The length comes from `this.attempts`, an instance field, at the moment the pause is requested; the number is fixed when `pause` is called, so a change to the field during the wait would not shorten or lengthen a pause already under way. Only the `false` value reaches this code: a transport whose promise rejects never arrives here, because, as noted with the loop's frame in the first walk, `connect` catches nothing.

#### W2.2 pause: a timer wrapped in a promise

- The pause helper: `src/link.ts` target lines 41–43 ← from The awaited pause in the loop (`src/link.ts` 26–26)

`pause` is the helper the loop awaited in the previous step. It is a plain function at the bottom of the module, not a method of the Link and not exported, so within this repository only `connect` can reach it. It builds one `Promise` and passes the promise's `resolve` function straight to `setTimeout` as the timer callback: when the timer fires after `ms` milliseconds, `resolve` is called with no value and the promise settles as `void`.

That is the whole mechanism of the delay. `connect` is suspended on `await pause(...)`, and **the loop's next iteration is driven by the timer**: nothing else can resolve this promise, so until the timer fires there is no further attempt, no report, and no return. When it does fire, the continuation after the `await` is queued as a microtask and `connect` picks up right after the pause expression, which brings control back to the `while` condition; the next step follows that check.

Worth noticing for the change: the helper offers no cancellation. The timer handle is discarded, the promise has no rejection path, and nothing on the Link can cut a pause short, so a caller that gives up on a connection while a pause is running still has `connect` finish its remaining attempts in the background.

**Show more:**

The requested `ms` is a lower bound by the rules of timers: the callback runs no earlier than that, and later if the event loop is busy. The same rule applies to the zero-delay timer `settle` uses, and the two kinds of timer are independent; a pause does not delay a report already queued.

Because `pause` is module-private and uses the global `setTimeout` directly, the only ways to make the loop faster in a test are to replace the global timer functions or to construct the Link with a smaller `maxAttempts`; no test exists in this repository that does either, and the delays are not configurable from outside this file.

#### W2.3 The loop condition after each pause

- The while condition and the counter: `src/link.ts` target lines 19–20

The pause has resolved and `connect` has reached the end of the loop body, so the walk arrives here by the loop turning over, not by a call: the `while` condition is evaluated again. As long as `attempts` is still below `maxAttempts`, the body runs once more, the counter goes up by one, and `transport.open` is awaited again exactly as in the first walk's loop frame.

With the default `maxAttempts` of `3` and a transport that always answers `false`, the loop therefore runs through this sequence:

1. `attempts` becomes 1, open fails, pause 100 ms
2. condition 1 < 3 holds; `attempts` becomes 2, open fails, pause 200 ms
3. condition 2 < 3 holds; `attempts` becomes 3, open fails, pause 300 ms
4. condition 3 < 3 fails; the loop exits

**The pause after the last failed attempt is spent before giving up.** Nothing in the body distinguishes the final attempt, so the 300 ms wait runs although no further `open` can follow it; at least 600 ms of pauses pass, plus whatever the three opens took, before the Link concludes anything. Had any of the three opens answered `true` instead, the loop would have left through the success branch of the first walk's fourth step, with the counter at that attempt's number.

Carried to the next step is the state at exit: `attempts` equals `maxAttempts`, `settle` has not been called, the callback registered by `startSession` is still in its slot, and `connect` has not returned.

**Show more:**

The strict `<` in the condition, together with the increment at the top of the body, is what keeps the counter from ever passing `maxAttempts`; the exit always happens with the two equal, which is why the number of attempts made is exactly the limit. For a general limit `n` the pauses add up to `100 × n(n+1)/2` ms, so the trailing pause grows with the limit as well; whether that final wait is intended or an oversight cannot be read from these files, which contain no comment or test about it.

Each turn of the loop is a fresh round through the same code, with no memory of why earlier attempts failed: the transport's `false` is not inspected further, and the loop would retry identically after an answer that meant a permanent problem as after a transient one.

#### W2.4 Giving up: settle('gave-up'), then return

- The exit after the loop: `src/link.ts` target lines 28–29 ← from The loop condition, now false (`src/link.ts` 19–19)

The `while` condition is false, so `connect` falls out of the loop onto its last two lines. They mirror the success branch of the first walk, with `'gave-up'` in place of `'connected'`: `settle('gave-up')` first, then `return 'gave-up'`.

`settle` does here what the first walk's fifth step showed: it takes the callback out of the slot, leaves the slot empty, and queues a zero-delay timer that will call the callback with `'gave-up'`. Because `settle` is synchronous and runs before the `return`, **the timer is already queued when `connect`'s promise resolves**, and the same word travels out through both channels: the callback will carry it later, the return value carries it now to `startSession`'s `await`.

From here two things are pending at once, and the next step is about which of them runs first: the continuation of `startSession`, resumed by this return, and the timer holding the callback.

**Show more:**

This exit and the success branch are the only two normal ways out of `connect`, and at both the word passed to `settle` is the literal returned on the next line, so the two channels cannot disagree about an outcome by construction; a rejection from the transport remains the one way out that settles nothing.

`'gave-up'` is final as far as the Link is concerned. No further timer, attempt or state change is scheduled after this point, and `attempts` stays at `maxAttempts` until a caller invokes `connect` again. What the caller then says about retrying is its own wording; the Link has stopped.

#### W2.5 Back in startSession: 'retrying later' is reported first

- The gave-up check and its report: `src/session.ts` target lines 5–8 ← from The return that resumes the await (`src/link.ts` 29–29)

`connect` has returned `'gave-up'`, and that resolves the promise `startSession` was waiting on. As in the first walk's sixth step, the continuation after the `await` runs as a promise microtask, which by the event loop's rules comes before any timer, so `startSession` resumes while the callback `settle` just queued is still waiting its turn.

This time `outcome === 'gave-up'` is true, the `if` body runs, and `report('retrying later')` is called directly, in this same microtask. `startSession` then reaches its end and its promise resolves. **The direct report wins the race by construction**: `'retrying later'` has reached the sink, and `startSession` has finished, before `'offline mode'` can be delivered from the timer.

The wording deserves a plain reading beside the code. Nothing here, and nothing left running in the Link, retries anything: the loop has ended, no timer other than the report's is pending, and the next `open` happens only if some caller invokes `connect` again. `'retrying later'` is a message sent to whoever `report` is, not an action the code takes.

The reader takes along that a second report for this same failed connection is still queued; the next step follows the timer that delivers it.

**Show more:**

The order between the direct report and the completion of `startSession` is also fixed: `report` is called synchronously in the continuation, so a caller resumed by `await startSession(...)` resumes after the sink has already received `'retrying later'`, and, by the same promise-before-timer rule, before it receives `'offline mode'`. What the caller does in that window is outside these files, and no caller exists in the repository to show it.

Compared with the earlier revision, this is the only place `startSession` reads the result of `connect` at all; the two-word union means this branch is exactly the complement of the success path, with no outcome that would skip both the `if` and the callback.

#### W2.6 The timer fires: 'offline mode'

- The callback body, taking the 'offline mode' branch: `src/session.ts` target lines 4–4 ← from The timer settle scheduled (`src/link.ts` 36–36)

The timer `settle` queued at the loop's exit now fires, and the context is the same as at the end of the first walk: not `startSession`, which has returned, but the timer's own turn calling the arrow function registered in the first walk's first step. This time the captured `outcome` is `'gave-up'`, the ternary takes its second branch, and `report('offline mode')` is called.

Read from the code rather than observed, the consequence for the caller is this: **one failed `connect` produces two reports through the same sink**, `'retrying later'` from `startSession` itself in the previous step and `'offline mode'` from this callback afterwards, in that order by the promise-before-timer rule. The success path, by contrast, produced a single message. Both texts are fixed inside `startSession`, and `report` receives only the string, so the sink has nothing to tell it that the two messages describe the same connection attempt.

This callback cannot run again for this registration: `settle` emptied the slot before queuing the timer, so a later `connect` on the same Link settles into nothing unless `whenSettled` is called first. Nothing in these two files runs after this report, and the walk ends here.

**Show more:**

The two messages say different things about the same state. `'retrying later'` was sent by code that does not retry, as the previous step noted; `'offline mode'` is sent by a callback that has no view of what the caller did in the meantime. If a caller reacted to `startSession` finishing by calling `connect` again, that second attempt could already be under way when `'offline mode'` arrives, which the code allows but nothing here coordinates.

The callback reads only its captured `outcome` and the closed-over `report`; the Link's current state at the time the timer fires, including `attempts` sitting at `maxAttempts`, plays no part in the message. Whether sending both texts is intended, or whether one of them should carry the whole failure, is not something these files decide; there is no comment, test or caller to show the intent.

### W3 (walk): What code that uses Link and startSession must now provide and expect

*Purpose:* The contract change for callers outside these two files, read by dependency rather than by execution.

#### W3.1 Outcome replaces connect's boolean

- The Outcome type: `src/link.ts` target lines 5–5 ← from The type import in session.ts (`src/session.ts` 1–1)

*First draft (turn 15), replaced after the reviewer's findings:*

> This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Three places in the two files rest on it. `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; the callback that `whenSettled` accepts, and the `onSettled` field that stores it, take an `Outcome` as their only argument; and `startSession` imports the name with `import { type Outcome }`, which makes it a compile-time-only import that leaves nothing in the emitted JavaScript.
> 
> The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.
> 
> **Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.
> 
> <!-- dspatch:details -->
> 
> The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.
> 
> Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

*Final text (turn 20):*

This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Everything that passes the verdict around names it. In the Link, `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; `settle` takes an `Outcome` as its parameter, which is the way the word gets from `connect` to the callback; and the callback itself is typed to receive one, both where `whenSettled` accepts it and in the `onSettled` field that stores it. In the session file, `startSession` imports the name with `import { type Outcome }`, a compile-time-only import that leaves nothing in the emitted JavaScript, and uses it for exactly one thing: annotating the parameter of the arrow function it registers, so that the ternary inside is checked against the same two words.

The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.

**Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.

**Show more:**

The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.

Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

#### W3.2 Link's state and the maxAttempts option

- The fields and the constructor: `src/link.ts` target lines 8–11

In the earlier revision a `Link` held one thing, the `transport`. It now carries three more pieces of state, all `private`, that the loop and the callback mechanism of the first two walks share:

- `attempts`, a mutable counter starting at `0`, which `connect` resets and raises and which also sets the pause lengths;
- `onSettled`, the single callback slot, `null` until `whenSettled` fills it and `null` again once `settle` has taken the callback out;
- `maxAttempts`, a `readonly` limit set once at construction and compared against `attempts` by the loop condition.

`maxAttempts` arrives as a second constructor parameter with a default of `3`, written as a TypeScript parameter property, so `new Link(transport)` still compiles and behaves as before apart from the retrying, while `new Link(transport, 5)` would allow five attempts. **No code in this repository constructs a `Link`**, so the default is the only value these files can be read with; any other limit comes from a caller outside them, and nothing here validates what that caller passes.

For a reader judging the design, the important property is that `attempts` belongs to the instance, not to a call. Each `connect` starts by resetting it, which is correct for one connection at a time, but it means that two `connect` calls overlapping on the same Link write the same counter, and the slot is shared in the same way. The code permits that overlap and does nothing to prevent or detect it.

**Show more:**

If two connects did overlap, the second's reset would pull the first's count back to zero in the middle of its loop, so the first could make more attempts than the limit and compute shorter pauses than its own attempt number implies; and whichever call reaches `settle` first empties the shared slot, leaving the other to settle into nothing. These are consequences read from the code, not observed; the repository holds no caller or test that exercises them.

Because all three fields are `private`, a caller has no way to ask how many attempts have been made or whether a callback is pending. The limit is the only knob exposed, and only at construction: there is no setter, and `connect` takes no per-call override. A limit of `0` or below makes the loop exit before any attempt, as the first walk's loop frame noted; a non-integer such as `2.5` is accepted by the type and, with the strict `<` comparison, allows three attempts.

#### W3.3 startSession requires a report sink

- The import and the new signature: `src/session.ts` target lines 1–3

`startSession` is the one exported function of its file, and its signature is the change a caller meets first. In the earlier revision it took a `Link` and an address, awaited `connect`, and threw the boolean away; a caller got a `Promise<void>` and no word about the connection. It now takes a third parameter, `report`, typed `(text: string) => void`, and the import line brings in `Outcome` as a type alongside `Link` so that the callback it registers can be typed.

**`report` is required.** It has no default and is not optional, so every existing call with two arguments stops compiling, and every caller must decide what to do with text messages before it can use this function again. The return type is still `Promise<void>`: the outcome does not come back through the promise, so `report` is the only way a caller of `startSession` learns whether the session is ready. Within this repository there is no caller and no test of `startSession` or `Link`, so the only use of the new parameter visible here is the function body itself.

The three texts a sink can receive, `'session ready'`, `'offline mode'` and `'retrying later'`, are literals inside this function. They cannot be configured, translated or replaced by a caller; the first two walks showed which of them arrive, in which order and from which context, for a success and for a failure.

**Show more:**

The parameter is a bare function type rather than an interface, so anything that accepts a string fits, including a logger; but the messages are plain text with no accompanying `Outcome` or identifier, so a sink that needs to act differently on success and failure has to recognise the words themselves, and a sink shared by several sessions cannot tell which `startSession` a message came from.

Each call of `startSession` registers a fresh callback on the Link it is given, and the Link keeps only one, as the first walk's second step showed; a caller that starts two sessions on one `Link` instance therefore changes which `report` hears the first connection's outcome. `Link` is imported as a value although this file uses it only as a type; whether that import survives compilation depends on compiler settings that are not part of these files.

## The reviewer

### First verdict (turn 18)

**Verdict:** rework

**Assessment:** The reader can follow the course. W1 and W2 enter at startSession, follow connect into the loop, return to the if as a shared branch point, take settle apart once and reuse it, and make the one non-obvious ordering, the await continuation resuming before the zero-delay timer, understandable from the rules of promises and timers rather than from assertion; every shown place is explained for what it does here and why it matters to the change, and the 'reached from' labels and line ranges all match the target code. W3 says it reads by dependency and does so. The Show more parts add depth (rejection, overlapping connects, non-integer limits, the truthiness trap) rather than repeating the first part. The mechanism, timing and message claims I checked are true of the code, so the verdict rests only on two small statements in Show more texts that are not true as written and that the person would find contradicted when checking the code: W1.2's account of the overlapping-registration case and of who writes the slot, and W3.1's count of what rests on Outcome. Nothing structural falls short.

- **W1.2** (explanation): Two statements in the Show more are not true of the code. First: 'if startSession were called twice on the same Link while the first connect is still running ... only the second caller's report would ever receive a message for either connection.' The slot carries only the callback channel; the direct channel is per call. Each startSession still calls its own report('retrying later') when its own connect returns 'gave-up', so the first caller's report is cut off from 'session ready' and 'offline mode', not from every message. The correct reading: the callback fires once, for whichever connect settles first, into the second caller's report; the other connect settles into an empty slot; but a first connect that gives up still reports 'retrying later' to the first caller. Second: 'within these files only whenSettled writes it and only settle reads it.' settle also writes the field, setting it to null at the moment it takes the callback out; that write is what the step's own point about single use rests on. *Why:* A Standard reader judging the shared-slot design would conclude that an overlapped first caller hears nothing at all, which overstates the consequence and contradicts W2.5, where the direct report is shown to be independent of the slot. The 'only whenSettled writes it' sentence is contradicted on the next step's lines, and the person checks the code through these texts. *Evidence:* src/session.ts target 6–7: report('retrying later') is called from the awaiting startSession itself, with that call's own report, regardless of the slot. src/link.ts target 14: whenSettled writes onSettled; target 33–34: settle reads it into a local and then writes null to it. *Reference:* Section 3, Distinguish evidence from conclusions.
- **W3.1** (explanation): 'Three places in the two files rest on it' is not an accurate count, and the list that follows leaves out two uses: settle's parameter is typed Outcome, and the arrow function startSession registers annotates its parameter with Outcome, which is the reason the type is imported at all. The correct reading: in link.ts the field (line 9), whenSettled's parameter (13), connect's return type (17) and settle's parameter (32) all name Outcome; in session.ts the import (1) and the callback's parameter (4) do. *Why:* The step teaches the change by dependency, so the inventory of what depends on the type is its content; a reader who checks the code finds more uses than the text says, and the omitted settle parameter is the one through which the word reaches the callback. *Evidence:* src/link.ts target 9, 13, 17, 32; src/session.ts target 1, 4. *Reference:* Section 3, Add understanding beyond reading the code aloud.

### Final assessment (turn 21)

**Verdict:** accept

**Assessment:** Both findings were put right. W1.2 now says that settle both reads and clears the slot, and its Show more confines the overlapping-registration consequence to the callback channel: one callback for whichever connect settles first, into the second caller's report, while each startSession's own report('retrying later') is unaffected, which is what src/session.ts target 6–7 and src/link.ts target 33–34 show. W3.1 now inventories every use of Outcome, including settle's parameter at link.ts target 32 and the arrow's annotation at session.ts target 4 as the import's one use, and says how the word travels from connect to the callback. The rest of the walks is unchanged and was already checked: the course can be followed through startSession, the loop, the shared branch point, settle and the timer, with the microtask-before-timer ordering explained from the rules rather than asserted; every shown place is explained at the Standard level; the Show more parts deepen rather than repeat; and W3 reads the contract by dependency and says so. Nothing false and nothing significant remains, so the walks now serve this reader.


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
- `base/` is From, commit a9377d8d0e17771a5bfdac383b773fda287e0c83
- `target/` is To, commit 0d0c00df3bd0aa0c923c96527bf1d3c9bd3717f4
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: connect
From: a9377d8d0e17771a5bfdac383b773fda287e0c83 (base commit)
To: 0d0c00df3bd0aa0c923c96527bf1d3c9bd3717f4 (target commit)
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
  "summary": "Link.connect no longer hands back a single transport.open result. It now tries up to maxAttempts times (a new constructor option, default 3), waits attempts × 100 ms after each failed open, and answers with an Outcome, 'connected' or 'gave-up', instead of a boolean. A Link can also hold one settled callback, registered with whenSettled, which it detaches and calls from a zero-delay timer when connect settles. startSession takes a report function, registers that callback to report 'session ready' or 'offline mode', awaits connect, and additionally reports 'retrying later' when the link gave up. Read from the code, the intent is to ride out transient failures before giving up and to give the caller a word to show for the result; the change carries no commit message or test that states it.",
  "background": "The repository at both revisions holds only `src/link.ts` and `src/session.ts`: nothing in it constructs a Link, calls startSession or tests either, so the default of three attempts and the three report texts are the whole visible behaviour.\n\nTwo consequences read from the code are worth knowing before the walks. The pause follows every failed open, including the last one, so by default a link that never opens spends 100 + 200 + 300 ms waiting before it gives up. And the settled callback is deferred with `setTimeout(…, 0)` while the return value resumes the awaiting caller as a promise continuation, so on failure the caller hears 'retrying later' first and 'offline mode' afterwards, after startSession has already returned; on success 'session ready' likewise arrives after startSession has completed.\n\nBoth public signatures changed: connect's return type and startSession's required third parameter. Any caller outside these files must follow.",
  "walks": [
    {
      "kind": "walk",
      "title": "A connection that succeeds: from startSession to 'session ready'",
      "question": "What happens when the transport opens, and when does the caller hear 'session ready'?",
      "purpose": "How the new callback and the new return value both carry a successful connection back to the caller, and in which order.",
      "steps": [
        {
          "title": "startSession registers the settled callback",
          "summary": "Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.",
          "brief": "Show the new shape of startSession against the From side's bare await: it now receives a report sink and, before anything is attempted, registers a callback that closes over report. Make clear that registering calls nothing yet; the reader takes to the next step that the Link now holds this callback and that connect is called right after.",
          "places": [
            {
              "label": "startSession's signature and the whenSettled registration",
              "path": "src/session.ts",
              "side": "target",
              "start": 3,
              "end": 4,
              "anchor": "link.whenSettled("
            }
          ]
        },
        {
          "title": "Link.whenSettled keeps one callback",
          "summary": "The callback is stored in the Link's single onSettled slot; nothing runs yet.",
          "brief": "Reached from startSession's call at line 4. Make comprehensible that this is a plain assignment into the onSettled field declared at line 9 (one slot, so a later call replaces an earlier one) and that the Link, not startSession, decides when it is called. The reader takes along that the slot is full when connect starts.",
          "places": [
            {
              "label": "whenSettled stores the callback",
              "path": "src/link.ts",
              "side": "target",
              "start": 13,
              "end": 15,
              "anchor": "this.onSettled = callback;",
              "from": {
                "label": "The registration in startSession",
                "path": "src/session.ts",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "connect begins the attempt loop",
          "summary": "connect resets the counter and makes the first attempt by awaiting transport.open.",
          "brief": "Reached from startSession's await at line 5. Explain the loop's frame: attempts is reset per call, the while compares it with maxAttempts (a constructor option, default 3; see the contract item), the counter is raised before each open so that it equals the number of attempts made, and the awaited transport.open is where the outside world answers. The reader takes along that the boolean from open decides the branch at line 22, and that this walk follows the true branch.",
          "places": [
            {
              "label": "connect's signature, the reset and the first attempt",
              "path": "src/link.ts",
              "side": "target",
              "start": 17,
              "end": 21,
              "anchor": "while (this.attempts < this.maxAttempts)",
              "from": {
                "label": "The await in startSession",
                "path": "src/session.ts",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "open returned true: settle, then return 'connected'",
          "summary": "On success the Link settles the callback first and only then returns 'connected' to the caller.",
          "brief": "This is the branch we follow; the false branch is the second walk, which starts again at this if. Make the order visible: settle runs before the return, so whatever settle does is arranged before connect's promise resolves. The reader takes to the next step the question of what settle actually does with the callback.",
          "places": [
            {
              "label": "The success branch of the loop body",
              "path": "src/link.ts",
              "side": "target",
              "start": 22,
              "end": 25,
              "anchor": "this.settle('connected');"
            }
          ]
        },
        {
          "title": "settle detaches the callback and defers it",
          "summary": "settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.",
          "brief": "Reached from line 23. Make two things comprehensible: the slot is cleared before the callback is scheduled, so it fires at most once per registration and a later connect on the same Link finds no callback unless whenSettled is called again; and setTimeout(..., 0) means the callback runs in a later turn of the event loop, not inside connect. The reader takes along that when connect returns, nothing has been reported yet.",
          "places": [
            {
              "label": "The private settle method",
              "path": "src/link.ts",
              "side": "target",
              "start": 32,
              "end": 38,
              "anchor": "setTimeout(() => callback(outcome), 0);",
              "from": {
                "label": "The settle call on success",
                "path": "src/link.ts",
                "side": "target",
                "start": 23,
                "end": 23
              }
            }
          ]
        },
        {
          "title": "Back in startSession: 'connected' needs no extra report",
          "summary": "The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.",
          "brief": "Reached by the return at line 24 resuming the await at line 5; this continuation runs as a promise microtask, before any timer. Make clear that for 'connected' the if does nothing and startSession's own promise resolves here, still without any report. The reader takes along that the only report on this path is still pending in the timer from the previous step.",
          "places": [
            {
              "label": "The await and the gave-up check in startSession",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "if (outcome === 'gave-up')",
              "from": {
                "label": "The return that resumes the await",
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
          "summary": "Later, from the timer settle scheduled, the callback reports 'session ready'.",
          "brief": "The context followed now is the timer callback set at line 36, not startSession, which has already returned. Explain, as read from the code and not observed, that a caller awaiting startSession is resumed before this report arrives, because promise continuations run before timers; the text comes from the ternary in the callback. Nothing follows this step.",
          "places": [
            {
              "label": "The callback body, now running from the timer",
              "path": "src/session.ts",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "'session ready' : 'offline mode'",
              "from": {
                "label": "The timer settle scheduled",
                "path": "src/link.ts",
                "side": "target",
                "start": 36,
                "end": 36
              }
            }
          ],
          "revisit": "The callback registered in step 1 is now seen running, from the timer, with outcome 'connected'."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "Every attempt fails: pauses, giving up and two reports",
      "question": "What happens when the transport never opens: how many attempts, how long between them, and what does the caller hear in which order?",
      "purpose": "How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.",
      "steps": [
        {
          "title": "Back at the branch: open returned false",
          "summary": "A failed open skips the success branch and awaits a pause proportional to the attempt number.",
          "brief": "Start again at the if of the first walk's step 4, now with open false; everything before it holds (callback registered, attempts raised to 1). Make clear that no outcome is decided here: the loop body just waits attempts × 100 ms, so 100 ms after the first failure, before anything else happens. The reader takes to the next step that connect is suspended on that pause.",
          "places": [
            {
              "label": "The if with its false outcome and the pause",
              "path": "src/link.ts",
              "side": "target",
              "start": 22,
              "end": 26,
              "anchor": "await pause(this.attempts * 100);"
            }
          ]
        },
        {
          "title": "pause: a timer wrapped in a promise",
          "summary": "pause resolves when a setTimeout fires; the loop continues from that timer.",
          "brief": "Reached from the await at line 26. Explain that this module-private helper has no cancellation and that the loop's next iteration runs from the timer's resolution, which is what makes the delay. The reader takes along that after the pause control goes back to the while condition.",
          "places": [
            {
              "label": "The pause helper",
              "path": "src/link.ts",
              "side": "target",
              "start": 41,
              "end": 43,
              "anchor": "new Promise((resolve) => setTimeout(resolve, ms))",
              "from": {
                "label": "The awaited pause in the loop",
                "path": "src/link.ts",
                "side": "target",
                "start": 26,
                "end": 26
              }
            }
          ]
        },
        {
          "title": "The loop condition after each pause",
          "summary": "After each pause the while re-checks attempts against maxAttempts; a further attempt raises the counter and opens again.",
          "brief": "Reached when the pause resolves, not by a call. Make the sequence comprehensible with the default of 3: open, pause 100, open, pause 200, open, pause 300, and only then the condition fails, so the pause after the last failed attempt is also spent before giving up. Say that a later attempt that succeeds leaves through the first walk's step 4; the reader takes along the state at exit: attempts equals maxAttempts and no outcome has been settled.",
          "places": [
            {
              "label": "The while condition and the counter",
              "path": "src/link.ts",
              "side": "target",
              "start": 19,
              "end": 20,
              "anchor": "this.attempts += 1;"
            }
          ]
        },
        {
          "title": "Giving up: settle('gave-up'), then return",
          "summary": "When the loop exits, the Link settles the callback with 'gave-up' and returns the same word.",
          "brief": "Reached when the condition at line 19 is false. Point at the first walk's step 5 for what settle does (slot cleared, callback deferred to a timer); what matters here is that the same outcome goes out through both channels and that the timer is set before connect's promise resolves. The reader takes to the next step that the caller's await and the timer are now both pending.",
          "places": [
            {
              "label": "The exit after the loop",
              "path": "src/link.ts",
              "side": "target",
              "start": 28,
              "end": 29,
              "anchor": "this.settle('gave-up');",
              "from": {
                "label": "The loop condition, now false",
                "path": "src/link.ts",
                "side": "target",
                "start": 19,
                "end": 19
              }
            }
          ]
        },
        {
          "title": "Back in startSession: 'retrying later' is reported first",
          "summary": "The await resumes with 'gave-up' and startSession reports 'retrying later' at once.",
          "brief": "Reached by the return at line 29 resuming the await at line 5 as a microtask. Make comprehensible why this report comes before the callback's: promise continuations run before the timer settle set, so report('retrying later') runs and startSession returns while 'offline mode' is still queued. Also make clear that nothing in this code retries later; the text is a message, not an action. The reader takes along that a second report is pending.",
          "places": [
            {
              "label": "The gave-up check and its report",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "report('retrying later');",
              "from": {
                "label": "The return that resumes the await",
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
          "summary": "Later, from the timer, the callback reports 'offline mode', the second report for the same failure.",
          "brief": "Context followed: the timer callback from line 36, after startSession has returned; this is the callback registered in the first walk's step 1, now with outcome 'gave-up'. Explain, as read from the code and not observed, that the caller therefore receives two reports for one failed connect, 'retrying later' then 'offline mode', and that the callback cannot run a second time for this registration because settle emptied the slot. Nothing follows this step.",
          "places": [
            {
              "label": "The callback body, taking the 'offline mode' branch",
              "path": "src/session.ts",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "'session ready' : 'offline mode'",
              "from": {
                "label": "The timer settle scheduled",
                "path": "src/link.ts",
                "side": "target",
                "start": 36,
                "end": 36
              }
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What code that uses Link and startSession must now provide and expect",
      "question": "Which signatures changed, and what applies when nothing in this repository sets the new options?",
      "purpose": "The contract change for callers outside these two files, read by dependency rather than by execution.",
      "steps": [
        {
          "title": "Outcome replaces connect's boolean",
          "summary": "connect now answers 'connected' or 'gave-up', a string union, where From returned the transport's boolean.",
          "brief": "Route by dependency, not execution: this type is what connect returns (line 17) and what the whenSettled callback receives (lines 9 and 13), and session.ts imports it as a type. Make comprehensible that the two-value union carries the same information as the old boolean but in words, and that both words are non-empty strings, so a caller that still tests connect's result as a boolean would read both as true. The reader takes along that these words are what startSession compares against.",
          "places": [
            {
              "label": "The Outcome type",
              "path": "src/link.ts",
              "side": "target",
              "start": 5,
              "end": 5,
              "anchor": "export type Outcome = 'connected' | 'gave-up';",
              "from": {
                "label": "The type import in session.ts",
                "path": "src/session.ts",
                "side": "target",
                "start": 1,
                "end": 1
              }
            }
          ]
        },
        {
          "title": "Link's state and the maxAttempts option",
          "summary": "A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.",
          "brief": "A mechanism taken apart on its own. Explain the three fields the loop and the callback share, and that maxAttempts is a constructor parameter with default 3; no code in this repository constructs a Link, so the default is what applies here and any other value comes from outside. Note for the reader that attempts is per Link instance and is reset at each connect, which matters if two connects overlap on one Link.",
          "places": [
            {
              "label": "The fields and the constructor",
              "path": "src/link.ts",
              "side": "target",
              "start": 8,
              "end": 11,
              "anchor": "private readonly maxAttempts = 3"
            }
          ]
        },
        {
          "title": "startSession requires a report sink",
          "summary": "startSession gains a third, required parameter and imports Outcome as a type.",
          "brief": "Compare with From: the function used to take link and address only and discard connect's result. Make clear that report is required, so every caller must change, and that no caller or test exists in this repository, so the only use of these messages visible here is the one in session.ts itself. The reader takes along that the words 'session ready', 'offline mode' and 'retrying later' are fixed in this function, not configurable.",
          "places": [
            {
              "label": "The import and the new signature",
              "path": "src/session.ts",
              "side": "target",
              "start": 1,
              "end": 3,
              "anchor": "report: (text: string) => void"
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

### W1 (walk): A connection that succeeds: from startSession to 'session ready'
Purpose: How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Question: What happens when the transport opens, and when does the caller hear 'session ready'?
- W1.1 startSession registers the settled callback — Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.
  - startSession's signature and the whenSettled registration: src/session.ts (To) lines 3–4
  - Brief: Show the new shape of startSession against the From side's bare await: it now receives a report sink and, before anything is attempted, registers a callback that closes over report. Make clear that registering calls nothing yet; the reader takes to the next step that the Link now holds this callback and that connect is called right after.
- W1.2 Link.whenSettled keeps one callback — The callback is stored in the Link's single onSettled slot; nothing runs yet.
  - whenSettled stores the callback: src/link.ts (To) lines 13–15 — reached from The registration in startSession (src/session.ts target 4–4)
  - Brief: Reached from startSession's call at line 4. Make comprehensible that this is a plain assignment into the onSettled field declared at line 9 (one slot, so a later call replaces an earlier one) and that the Link, not startSession, decides when it is called. The reader takes along that the slot is full when connect starts.
- W1.3 connect begins the attempt loop — connect resets the counter and makes the first attempt by awaiting transport.open.
  - connect's signature, the reset and the first attempt: src/link.ts (To) lines 17–21 — reached from The await in startSession (src/session.ts target 5–5)
  - Brief: Reached from startSession's await at line 5. Explain the loop's frame: attempts is reset per call, the while compares it with maxAttempts (a constructor option, default 3; see the contract item), the counter is raised before each open so that it equals the number of attempts made, and the awaited transport.open is where the outside world answers. The reader takes along that the boolean from open decides the branch at line 22, and that this walk follows the true branch.
- W1.4 open returned true: settle, then return 'connected' — On success the Link settles the callback first and only then returns 'connected' to the caller.
  - The success branch of the loop body: src/link.ts (To) lines 22–25
  - Brief: This is the branch we follow; the false branch is the second walk, which starts again at this if. Make the order visible: settle runs before the return, so whatever settle does is arranged before connect's promise resolves. The reader takes to the next step the question of what settle actually does with the callback.
- W1.5 settle detaches the callback and defers it — settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.
  - The private settle method: src/link.ts (To) lines 32–38 — reached from The settle call on success (src/link.ts target 23–23)
  - Brief: Reached from line 23. Make two things comprehensible: the slot is cleared before the callback is scheduled, so it fires at most once per registration and a later connect on the same Link finds no callback unless whenSettled is called again; and setTimeout(..., 0) means the callback runs in a later turn of the event loop, not inside connect. The reader takes along that when connect returns, nothing has been reported yet.
- W1.6 Back in startSession: 'connected' needs no extra report — The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.
  - The await and the gave-up check in startSession: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 24–24)
  - Brief: Reached by the return at line 24 resuming the await at line 5; this continuation runs as a promise microtask, before any timer. Make clear that for 'connected' the if does nothing and startSession's own promise resolves here, still without any report. The reader takes along that the only report on this path is still pending in the timer from the previous step.
- W1.7 The timer fires: 'session ready' — Later, from the timer settle scheduled, the callback reports 'session ready'.
  - The callback body, now running from the timer: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)
  - Revisit: The callback registered in step 1 is now seen running, from the timer, with outcome 'connected'.
  - Brief: The context followed now is the timer callback set at line 36, not startSession, which has already returned. Explain, as read from the code and not observed, that a caller awaiting startSession is resumed before this report arrives, because promise continuations run before timers; the text comes from the ternary in the callback. Nothing follows this step.

### W2 (walk): Every attempt fails: pauses, giving up and two reports
Purpose: How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Question: What happens when the transport never opens: how many attempts, how long between them, and what does the caller hear in which order?
- W2.1 Back at the branch: open returned false — A failed open skips the success branch and awaits a pause proportional to the attempt number.
  - The if with its false outcome and the pause: src/link.ts (To) lines 22–26
  - Brief: Start again at the if of the first walk's step 4, now with open false; everything before it holds (callback registered, attempts raised to 1). Make clear that no outcome is decided here: the loop body just waits attempts × 100 ms, so 100 ms after the first failure, before anything else happens. The reader takes to the next step that connect is suspended on that pause.
- W2.2 pause: a timer wrapped in a promise — pause resolves when a setTimeout fires; the loop continues from that timer.
  - The pause helper: src/link.ts (To) lines 41–43 — reached from The awaited pause in the loop (src/link.ts target 26–26)
  - Brief: Reached from the await at line 26. Explain that this module-private helper has no cancellation and that the loop's next iteration runs from the timer's resolution, which is what makes the delay. The reader takes along that after the pause control goes back to the while condition.
- W2.3 The loop condition after each pause — After each pause the while re-checks attempts against maxAttempts; a further attempt raises the counter and opens again.
  - The while condition and the counter: src/link.ts (To) lines 19–20
  - Brief: Reached when the pause resolves, not by a call. Make the sequence comprehensible with the default of 3: open, pause 100, open, pause 200, open, pause 300, and only then the condition fails, so the pause after the last failed attempt is also spent before giving up. Say that a later attempt that succeeds leaves through the first walk's step 4; the reader takes along the state at exit: attempts equals maxAttempts and no outcome has been settled.
- W2.4 Giving up: settle('gave-up'), then return — When the loop exits, the Link settles the callback with 'gave-up' and returns the same word.
  - The exit after the loop: src/link.ts (To) lines 28–29 — reached from The loop condition, now false (src/link.ts target 19–19)
  - Brief: Reached when the condition at line 19 is false. Point at the first walk's step 5 for what settle does (slot cleared, callback deferred to a timer); what matters here is that the same outcome goes out through both channels and that the timer is set before connect's promise resolves. The reader takes to the next step that the caller's await and the timer are now both pending.
- W2.5 Back in startSession: 'retrying later' is reported first — The await resumes with 'gave-up' and startSession reports 'retrying later' at once.
  - The gave-up check and its report: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 29–29)
  - Brief: Reached by the return at line 29 resuming the await at line 5 as a microtask. Make comprehensible why this report comes before the callback's: promise continuations run before the timer settle set, so report('retrying later') runs and startSession returns while 'offline mode' is still queued. Also make clear that nothing in this code retries later; the text is a message, not an action. The reader takes along that a second report is pending.
- W2.6 The timer fires: 'offline mode' — Later, from the timer, the callback reports 'offline mode', the second report for the same failure.
  - The callback body, taking the 'offline mode' branch: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)
  - Brief: Context followed: the timer callback from line 36, after startSession has returned; this is the callback registered in the first walk's step 1, now with outcome 'gave-up'. Explain, as read from the code and not observed, that the caller therefore receives two reports for one failed connect, 'retrying later' then 'offline mode', and that the callback cannot run a second time for this registration because settle emptied the slot. Nothing follows this step.

### W3 (walk): What code that uses Link and startSession must now provide and expect
Purpose: The contract change for callers outside these two files, read by dependency rather than by execution.
Question: Which signatures changed, and what applies when nothing in this repository sets the new options?
- W3.1 Outcome replaces connect's boolean — connect now answers 'connected' or 'gave-up', a string union, where From returned the transport's boolean.
  - The Outcome type: src/link.ts (To) lines 5–5 — reached from The type import in session.ts (src/session.ts target 1–1)
  - Brief: Route by dependency, not execution: this type is what connect returns (line 17) and what the whenSettled callback receives (lines 9 and 13), and session.ts imports it as a type. Make comprehensible that the two-value union carries the same information as the old boolean but in words, and that both words are non-empty strings, so a caller that still tests connect's result as a boolean would read both as true. The reader takes along that these words are what startSession compares against.
- W3.2 Link's state and the maxAttempts option — A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.
  - The fields and the constructor: src/link.ts (To) lines 8–11
  - Brief: A mechanism taken apart on its own. Explain the three fields the loop and the callback share, and that maxAttempts is a constructor parameter with default 3; no code in this repository constructs a Link, so the default is what applies here and any other value comes from outside. Note for the reader that attempts is per Link instance and is reset at each connect, which matters if two connects overlap on one Link.
- W3.3 startSession requires a report sink — startSession gains a third, required parameter and imports Outcome as a type.
  - The import and the new signature: src/session.ts (To) lines 1–3
  - Brief: Compare with From: the function used to take link and address only and discard connect's result. Make clear that report is required, so every caller must change, and that no caller or test exists in this repository, so the only use of these messages visible here is the one in session.ts itself. The reader takes along that the words 'session ready', 'offline mode' and 'retrying later' are fixed in this function, not configurable.

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
- `base/` is From, commit a9377d8d0e17771a5bfdac383b773fda287e0c83
- `target/` is To, commit 0d0c00df3bd0aa0c923c96527bf1d3c9bd3717f4
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## This step: W1.1 startSession registers the settled callback
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.
- startSession's signature and the whenSettled registration: src/session.ts (To) lines 3–4
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Show the new shape of startSession against the From side's bare await: it now receives a report sink and, before anything is attempted, registers a callback that closes over report. Make clear that registering calls nothing yet; the reader takes to the next step that the Link now holds this callback and that connect is called right after.
The step after: W1.2 Link.whenSettled keeps one callback — The callback is stored in the Link's single onSettled slot; nothing runs yet.
```

</details>

<details><summary>Answer</summary>

```text
`startSession` now takes three arguments instead of two: the `Link`, the address, and a `report` function that accepts a text message. In the earlier revision the whole body was one `await link.connect(address)` whose boolean result was discarded, so the caller learned nothing about how the connection went. Here, before any connection is attempted, the function calls `link.whenSettled` with an arrow function that closes over `report`: whenever the Link later invokes it with an `Outcome`, the arrow function maps `'connected'` to the message `'session ready'` and anything else to `'offline mode'`, and hands that text to `report`.

**Registering the callback runs nothing.** `whenSettled` only stores the function; `report` is not called on this line and no message exists yet. What this step fixes is the order: the Link holds the callback first, and `connect` is called on the very next line, so when the first attempt begins the Link already knows whom to tell. The next step shows the slot the callback lands in.

For judging the change, two things are worth noticing here. The callback is a second channel beside the value `connect` returns; the rest of this walk follows how both carry the same success back to the caller, and in which order. And the message texts are decided inside this arrow function from `outcome` alone, so nothing a caller passes can change them.

<!-- dspatch:details -->

`report` is typed `(text: string) => void`: `startSession` ignores anything it returns and cannot wait for it, so what the sink does with the text, show it, log it, or drop it, lies entirely outside these two files. No caller of `startSession` exists in this repository, so the only use of these messages visible here is this function itself; a third walk takes up what that requires of code elsewhere.

The arrow function keeps `report` alive through its closure: the Link stores the function, not the sink, and `report` is reached only when the callback eventually runs. Because `Outcome` is a union of exactly two strings, the ternary's else branch means precisely `'gave-up'`; the callback does not inspect anything else about the Link, and the same registration serves both the success path of this walk and the failure path of the next one.

```

</details>

### Turn 3: write-step (file-2) · W1.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.2 Link.whenSettled keeps one callback
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: The callback is stored in the Link's single onSettled slot; nothing runs yet.
- whenSettled stores the callback: src/link.ts (To) lines 13–15 — reached from The registration in startSession (src/session.ts target 4–4)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached from startSession's call at line 4. Make comprehensible that this is a plain assignment into the onSettled field declared at line 9 (one slot, so a later call replaces an earlier one) and that the Link, not startSession, decides when it is called. The reader takes along that the slot is full when connect starts.
The step before: W1.1 startSession registers the settled callback — Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.
The step after: W1.3 connect begins the attempt loop — connect resets the counter and makes the first attempt by awaiting transport.open.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.

**There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it; the Link's private `settle` method, which a later step in this walk takes apart, is the only code that reads the slot.

What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.

<!-- dspatch:details -->

Because the slot is a single field, the code allows a sequence the two files never guard against: if `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first, and only the second caller's `report` would ever receive a message for either connection. No caller in this repository does this, so it is a property of the design to be aware of rather than an observed fault.

The field is `private`, so within these files only `whenSettled` writes it and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

```

</details>

### Turn 4: write-step (file-2) · W1.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.3 connect begins the attempt loop
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: connect resets the counter and makes the first attempt by awaiting transport.open.
- connect's signature, the reset and the first attempt: src/link.ts (To) lines 17–21 — reached from The await in startSession (src/session.ts target 5–5)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached from startSession's await at line 5. Explain the loop's frame: attempts is reset per call, the while compares it with maxAttempts (a constructor option, default 3; see the contract item), the counter is raised before each open so that it equals the number of attempts made, and the awaited transport.open is where the outside world answers. The reader takes along that the boolean from open decides the branch at line 22, and that this walk follows the true branch.
The step before: W1.2 Link.whenSettled keeps one callback — The callback is stored in the Link's single onSettled slot; nothing runs yet.
The step after: W1.4 open returned true: settle, then return 'connected' — On success the Link settles the callback first and only then returns 'connected' to the caller.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`startSession` is now suspended on `await link.connect(address)`, and the walk follows the call into the Link. In the earlier revision `connect` was a single line that returned the transport's boolean untouched; here it is a retry loop that promises an `Outcome` instead, and this step is the loop's frame before any answer has arrived.

Three things set that frame up:

1. `attempts` is set back to `0` at the start of every call, so each `connect` counts from the beginning no matter what an earlier call on the same Link left behind.
2. The `while` condition compares `attempts` with `maxAttempts`, a constructor parameter that defaults to `3`; the third walk looks at how that value is supplied. The check comes before each attempt, so the loop makes at most `maxAttempts` attempts.
3. Inside the body the counter is raised **before** `open` is called. At the moment of any attempt, `attempts` therefore equals the number of attempts made so far, including this one: 1 on the first pass. The second walk shows the pause length being computed from this same number.

The attempt itself is `await this.transport.open(address)`. `Transport` is an interface with only this method, and `open` is where the outside world answers: `connect` hands the address over and is suspended until the transport's promise resolves to a boolean. Nothing in the Link decides whether a connection succeeds; it only reacts to what `open` says.

That boolean, held in `open`, is what the next step branches on. This walk follows the case where it is `true`.

<!-- dspatch:details -->

The code catches nothing. If the transport's promise rejects rather than resolving, the rejection passes out of `connect` and on through the `await` in `startSession`, and `settle` is never reached, so the callback registered earlier stays in the slot with no message sent through either channel. Whether a transport can reject is not established by these files; the interface's type says only `Promise<boolean>`.

`attempts` is an instance field rather than a local of `connect`. That is why the reset in the first line matters: two `connect` calls overlapping on one Link would both read and write the same counter, which the code permits but never guards against. The reset also means that if `maxAttempts` were `0` or negative, the condition would fail at once and the loop body would never run, so no attempt would be made at all; with the default of `3` that case does not arise.

```

</details>

### Turn 5: write-step (file-2) · W1.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.4 open returned true: settle, then return 'connected'
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: On success the Link settles the callback first and only then returns 'connected' to the caller.
- The success branch of the loop body: src/link.ts (To) lines 22–25
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: This is the branch we follow; the false branch is the second walk, which starts again at this if. Make the order visible: settle runs before the return, so whatever settle does is arranged before connect's promise resolves. The reader takes to the next step the question of what settle actually does with the callback.
The step before: W1.3 connect begins the attempt loop — connect resets the counter and makes the first attempt by awaiting transport.open.
The step after: W1.5 settle detaches the callback and defers it — settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`open` is `true`, so the `if` takes the branch this walk follows; the `false` case, which falls through to a pause, is where the second walk begins. Two statements run here, and their order is the point of the step.

First `this.settle('connected')`. `settle` is a private method of the Link that returns `void`, so it runs to completion, synchronously, before the next line is reached; what it arranges with the stored callback is the subject of the next step. Only then comes `return 'connected'`, which ends `connect`. Because `connect` is an `async` function, that return resolves the promise `startSession` is awaiting, and `startSession`'s continuation is queued to run afterwards.

**So whatever `settle` sets up exists before the caller can see the result.** The same word, `'connected'`, goes out through both channels: into `settle` for the callback, and as the return value for the caller. The reader should hold on to this order; the walk returns to it when the two channels deliver their messages at different times.

<!-- dspatch:details -->

The `return` leaves the `while` loop from inside its body, so a success on any pass exits here, not only the first: with the default of three attempts, the second walk shows the failing passes, and an `open` that answers `true` on the second or third pass comes back through this branch with `attempts` at 2 or 3. The counter is left at that value; it is only reset by the next call to `connect`.

Both occurrences of `'connected'` are string literals that TypeScript checks against the `Outcome` type, so neither `settle` nor the caller can receive a word outside the union from here. There is no third thing done in this branch: no state on the Link records that it is connected, and nothing closes or keeps the transport; a later `connect` would open again from scratch.

```

</details>

### Turn 6: write-step (file-2) · W1.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.5 settle detaches the callback and defers it
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.
- The private settle method: src/link.ts (To) lines 32–38 — reached from The settle call on success (src/link.ts target 23–23)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached from line 23. Make two things comprehensible: the slot is cleared before the callback is scheduled, so it fires at most once per registration and a later connect on the same Link finds no callback unless whenSettled is called again; and setTimeout(..., 0) means the callback runs in a later turn of the event loop, not inside connect. The reader takes along that when connect returns, nothing has been reported yet.
The step before: W1.4 open returned true: settle, then return 'connected' — On success the Link settles the callback first and only then returns 'connected' to the caller.
The step after: W1.6 Back in startSession: 'connected' needs no extra report — The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`settle` is reached from the success branch with `'connected'` as its `outcome`, and it does two things in a deliberate order.

First it takes the function out of `onSettled` into a local `callback` and sets the field to `null`, before anything is scheduled. That is what makes the registration single-use: **the slot is already empty when the callback is arranged**, so the same registration can never fire twice, and a later `connect` on this Link reaches `settle` with an empty slot unless `whenSettled` has been called again. When the slot was already empty, the `if` guards against calling `null` and `settle` quietly does nothing; no error marks a connection that nobody asked to hear about.

Second, when there was a callback, it is not called here. `setTimeout(() => callback(outcome), 0)` hands a small closure, carrying both the function and the outcome, to the timer queue. A zero-delay timer does not mean "now": by the event loop's rules it runs in a later turn, after the current synchronous code has finished and after any pending promise continuations. So `settle` returns to `connect` with the report only queued, `connect` then returns `'connected'` as we saw in the previous step, and at that moment nothing has reached `report` yet. The next step picks up `startSession` as it resumes, still ahead of the timer.

<!-- dspatch:details -->

The local `callback` is why clearing the field is safe: the closure captures the local variable and the `outcome` argument, not the field, so nulling `onSettled` cannot pull the function out from under the scheduled timer. The handle `setTimeout` returns is discarded, so the Link has no way to cancel a report once settled.

What happens inside the timer is outside anything the Link controls. The callback runs in its own turn with no `try`/`catch` and no promise around it; if `report` threw, the exception would surface as an uncaught error in the timer, not in `connect` or `startSession`, which by then have both finished. And although `settle` is `private`, that keyword is TypeScript's compile-time check; within these files it is called from exactly two places in `connect`, the success branch seen here and the giving-up exit the second walk reaches.

```

</details>

### Turn 7: write-step (file-2) · W1.6

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.6 Back in startSession: 'connected' needs no extra report
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.
- The await and the gave-up check in startSession: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 24–24)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached by the return at line 24 resuming the await at line 5; this continuation runs as a promise microtask, before any timer. Make clear that for 'connected' the if does nothing and startSession's own promise resolves here, still without any report. The reader takes along that the only report on this path is still pending in the timer from the previous step.
The step before: W1.5 settle detaches the callback and defers it — settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.
The step after: W1.7 The timer fires: 'session ready' — Later, from the timer settle scheduled, the callback reports 'session ready'.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`connect` has returned `'connected'`, and that return resolves the promise `startSession` was awaiting. The continuation after an `await` runs as a promise microtask: by the event loop's rules it is processed as soon as the current synchronous work is done and before any timer, so **`startSession` resumes here ahead of the callback that `settle` queued in the previous step.**

`outcome` is now `'connected'`. The only thing `startSession` does with the value is compare it with `'gave-up'`, and that comparison is false, so the `if` body is skipped and `report` is not called. The function then reaches its end, and since it is `async` and returns `Promise<void>`, its own promise resolves here with no value: the caller is told that `startSession` finished, not how the connection went.

That is the state to carry forward: `startSession` has completed, `report` has received nothing on this path, and the one message that will say "session ready" is still waiting in the timer. The next step follows that timer when it fires.

<!-- dspatch:details -->

The `if` is written for the failure case only; there is no branch for success, which is why the success path depends entirely on the callback for its message. With `Outcome` limited to two words, "not `'gave-up'`" and "`'connected'`" are the same condition here, so the code could not silently skip a third outcome; but it also means the return value of `connect` is read for one purpose and then dropped, and nothing of it reaches the caller.

The ordering also gives the reader something to notice about callers. Whoever awaits `startSession` is resumed by the same microtask mechanism, so by the rules of promises any code placed directly after `await startSession(...)` runs before `report('session ready')` does. The code allows a caller to act on a finished `startSession` while the session-ready message has not yet been delivered; no caller exists in this repository to show whether that matters.

```

</details>

### Turn 8: write-step (file-2) · W1.7

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.7 The timer fires: 'session ready'
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: Later, from the timer settle scheduled, the callback reports 'session ready'.
- The callback body, now running from the timer: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Revisit: The callback registered in step 1 is now seen running, from the timer, with outcome 'connected'.
Brief: The context followed now is the timer callback set at line 36, not startSession, which has already returned. Explain, as read from the code and not observed, that a caller awaiting startSession is resumed before this report arrives, because promise continuations run before timers; the text comes from the ternary in the callback. Nothing follows this step.
The step before: W1.6 Back in startSession: 'connected' needs no extra report — The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The code here is the arrow function from the first step, but the execution context is new: it is no longer `startSession` running, which has completed and resolved its promise as we saw in the previous step, but the timer that `settle` queued. When the event loop reaches that timer it calls the closure, which calls this arrow function with the `outcome` captured at settle time, `'connected'`.

The ternary then selects its first text, and `report('session ready')` is the single call made. This is **the only message the success path produces**, and it arrives from the callback channel, not from `startSession`'s own code, which reported nothing for this outcome.

What the reader can conclude from the code, not from any observed run, is the order the walk has been building towards: by the rules of promises and timers, a caller awaiting `startSession` is resumed first, and `report('session ready')` reaches the sink after that, in a later turn. Nothing in these two files runs after this report; the walk ends here.

<!-- dspatch:details -->

The `report` the callback uses is the one passed to the `startSession` call that registered it, kept alive by the closure; the Link has no reference to the sink itself. The callback reads nothing from the Link or the transport when it runs, so a change in the Link's state between settling and firing, such as another `connect` having started, could not alter the message; only the captured `outcome` decides it.

"Later" is a lower bound rather than a fixed delay: a zero-delay timer runs no earlier than the next timer phase, and anything already queued ahead of it runs first. The same arrow function serves the failure path, where the ternary takes its other branch; the second walk arrives there with `'gave-up'`.

```

</details>

### Turn 9: write-step (file-2) · W2.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.1 Back at the branch: open returned false
Walk W2 (walk): Every attempt fails: pauses, giving up and two reports. How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Summary: A failed open skips the success branch and awaits a pause proportional to the attempt number.
- The if with its false outcome and the pause: src/link.ts (To) lines 22–26
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Start again at the if of the first walk's step 4, now with open false; everything before it holds (callback registered, attempts raised to 1). Make clear that no outcome is decided here: the loop body just waits attempts × 100 ms, so 100 ms after the first failure, before anything else happens. The reader takes to the next step that connect is suspended on that pause.
The step after: W2.2 pause: a timer wrapped in a promise — pause resolves when a setTimeout fires; the loop continues from that timer.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The walk is back at the `if` where the first walk's fourth step took the success branch, with everything before it unchanged: `startSession` registered its callback, `connect` reset and then raised `attempts` to `1`, and the first `transport.open` has answered. This time the answer is `false`: the transport resolved its promise with that value rather than throwing, so the `if` body with `settle` and `return` is skipped and execution continues below it.

**Nothing is decided here.** The Link does not record a failure, does not call `settle`, and does not return; the callback stays in its slot untouched. The only thing the loop body does after a failed attempt is `await pause(this.attempts * 100)`, which with `attempts` at `1` asks for a 100 ms wait. During that wait `connect` is suspended, and with it `startSession`'s `await` and whoever is awaiting that, so from the caller's side a failed first attempt looks exactly like an attempt still in progress.

The reader takes to the next step that `connect` is parked on this pause and will continue from whatever resolves it. The multiplier is why later pauses grow: the second failed attempt would wait 200 ms, the third 300 ms, and the third step of this walk lays out the full sequence.

<!-- dspatch:details -->

The pause sits unconditionally after the `if`, inside the loop body, not in a branch of its own. That placement means every failed attempt pays a pause before the `while` condition is re-examined, the last one included; the consequence for the total time before giving up is taken up with the loop condition in a later step.

The length comes from `this.attempts`, an instance field, at the moment the pause is requested; the number is fixed when `pause` is called, so a change to the field during the wait would not shorten or lengthen a pause already under way. Only the `false` value reaches this code: a transport whose promise rejects never arrives here, because, as noted with the loop's frame in the first walk, `connect` catches nothing.

```

</details>

### Turn 10: write-step (file-2) · W2.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.2 pause: a timer wrapped in a promise
Walk W2 (walk): Every attempt fails: pauses, giving up and two reports. How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Summary: pause resolves when a setTimeout fires; the loop continues from that timer.
- The pause helper: src/link.ts (To) lines 41–43 — reached from The awaited pause in the loop (src/link.ts target 26–26)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached from the await at line 26. Explain that this module-private helper has no cancellation and that the loop's next iteration runs from the timer's resolution, which is what makes the delay. The reader takes along that after the pause control goes back to the while condition.
The step before: W2.1 Back at the branch: open returned false — A failed open skips the success branch and awaits a pause proportional to the attempt number.
The step after: W2.3 The loop condition after each pause — After each pause the while re-checks attempts against maxAttempts; a further attempt raises the counter and opens again.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`pause` is the helper the loop awaited in the previous step. It is a plain function at the bottom of the module, not a method of the Link and not exported, so within this repository only `connect` can reach it. It builds one `Promise` and passes the promise's `resolve` function straight to `setTimeout` as the timer callback: when the timer fires after `ms` milliseconds, `resolve` is called with no value and the promise settles as `void`.

That is the whole mechanism of the delay. `connect` is suspended on `await pause(...)`, and **the loop's next iteration is driven by the timer**: nothing else can resolve this promise, so until the timer fires there is no further attempt, no report, and no return. When it does fire, the continuation after the `await` is queued as a microtask and `connect` picks up right after the pause expression, which brings control back to the `while` condition; the next step follows that check.

Worth noticing for the change: the helper offers no cancellation. The timer handle is discarded, the promise has no rejection path, and nothing on the Link can cut a pause short, so a caller that gives up on a connection while a pause is running still has `connect` finish its remaining attempts in the background.

<!-- dspatch:details -->

The requested `ms` is a lower bound by the rules of timers: the callback runs no earlier than that, and later if the event loop is busy. The same rule applies to the zero-delay timer `settle` uses, and the two kinds of timer are independent; a pause does not delay a report already queued.

Because `pause` is module-private and uses the global `setTimeout` directly, the only ways to make the loop faster in a test are to replace the global timer functions or to construct the Link with a smaller `maxAttempts`; no test exists in this repository that does either, and the delays are not configurable from outside this file.

```

</details>

### Turn 11: write-step (file-2) · W2.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.3 The loop condition after each pause
Walk W2 (walk): Every attempt fails: pauses, giving up and two reports. How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Summary: After each pause the while re-checks attempts against maxAttempts; a further attempt raises the counter and opens again.
- The while condition and the counter: src/link.ts (To) lines 19–20
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached when the pause resolves, not by a call. Make the sequence comprehensible with the default of 3: open, pause 100, open, pause 200, open, pause 300, and only then the condition fails, so the pause after the last failed attempt is also spent before giving up. Say that a later attempt that succeeds leaves through the first walk's step 4; the reader takes along the state at exit: attempts equals maxAttempts and no outcome has been settled.
The step before: W2.2 pause: a timer wrapped in a promise — pause resolves when a setTimeout fires; the loop continues from that timer.
The step after: W2.4 Giving up: settle('gave-up'), then return — When the loop exits, the Link settles the callback with 'gave-up' and returns the same word.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The pause has resolved and `connect` has reached the end of the loop body, so the walk arrives here by the loop turning over, not by a call: the `while` condition is evaluated again. As long as `attempts` is still below `maxAttempts`, the body runs once more, the counter goes up by one, and `transport.open` is awaited again exactly as in the first walk's loop frame.

With the default `maxAttempts` of `3` and a transport that always answers `false`, the loop therefore runs through this sequence:

1. `attempts` becomes 1, open fails, pause 100 ms
2. condition 1 < 3 holds; `attempts` becomes 2, open fails, pause 200 ms
3. condition 2 < 3 holds; `attempts` becomes 3, open fails, pause 300 ms
4. condition 3 < 3 fails; the loop exits

**The pause after the last failed attempt is spent before giving up.** Nothing in the body distinguishes the final attempt, so the 300 ms wait runs although no further `open` can follow it; at least 600 ms of pauses pass, plus whatever the three opens took, before the Link concludes anything. Had any of the three opens answered `true` instead, the loop would have left through the success branch of the first walk's fourth step, with the counter at that attempt's number.

Carried to the next step is the state at exit: `attempts` equals `maxAttempts`, `settle` has not been called, the callback registered by `startSession` is still in its slot, and `connect` has not returned.

<!-- dspatch:details -->

The strict `<` in the condition, together with the increment at the top of the body, is what keeps the counter from ever passing `maxAttempts`; the exit always happens with the two equal, which is why the number of attempts made is exactly the limit. For a general limit `n` the pauses add up to `100 × n(n+1)/2` ms, so the trailing pause grows with the limit as well; whether that final wait is intended or an oversight cannot be read from these files, which contain no comment or test about it.

Each turn of the loop is a fresh round through the same code, with no memory of why earlier attempts failed: the transport's `false` is not inspected further, and the loop would retry identically after an answer that meant a permanent problem as after a transient one.

```

</details>

### Turn 12: write-step (file-2) · W2.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.4 Giving up: settle('gave-up'), then return
Walk W2 (walk): Every attempt fails: pauses, giving up and two reports. How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Summary: When the loop exits, the Link settles the callback with 'gave-up' and returns the same word.
- The exit after the loop: src/link.ts (To) lines 28–29 — reached from The loop condition, now false (src/link.ts target 19–19)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached when the condition at line 19 is false. Point at the first walk's step 5 for what settle does (slot cleared, callback deferred to a timer); what matters here is that the same outcome goes out through both channels and that the timer is set before connect's promise resolves. The reader takes to the next step that the caller's await and the timer are now both pending.
The step before: W2.3 The loop condition after each pause — After each pause the while re-checks attempts against maxAttempts; a further attempt raises the counter and opens again.
The step after: W2.5 Back in startSession: 'retrying later' is reported first — The await resumes with 'gave-up' and startSession reports 'retrying later' at once.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The `while` condition is false, so `connect` falls out of the loop onto its last two lines. They mirror the success branch of the first walk, with `'gave-up'` in place of `'connected'`: `settle('gave-up')` first, then `return 'gave-up'`.

`settle` does here what the first walk's fifth step showed: it takes the callback out of the slot, leaves the slot empty, and queues a zero-delay timer that will call the callback with `'gave-up'`. Because `settle` is synchronous and runs before the `return`, **the timer is already queued when `connect`'s promise resolves**, and the same word travels out through both channels: the callback will carry it later, the return value carries it now to `startSession`'s `await`.

From here two things are pending at once, and the next step is about which of them runs first: the continuation of `startSession`, resumed by this return, and the timer holding the callback.

<!-- dspatch:details -->

This exit and the success branch are the only two normal ways out of `connect`, and at both the word passed to `settle` is the literal returned on the next line, so the two channels cannot disagree about an outcome by construction; a rejection from the transport remains the one way out that settles nothing.

`'gave-up'` is final as far as the Link is concerned. No further timer, attempt or state change is scheduled after this point, and `attempts` stays at `maxAttempts` until a caller invokes `connect` again. What the caller then says about retrying is its own wording; the Link has stopped.

```

</details>

### Turn 13: write-step (file-2) · W2.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.5 Back in startSession: 'retrying later' is reported first
Walk W2 (walk): Every attempt fails: pauses, giving up and two reports. How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Summary: The await resumes with 'gave-up' and startSession reports 'retrying later' at once.
- The gave-up check and its report: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 29–29)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached by the return at line 29 resuming the await at line 5 as a microtask. Make comprehensible why this report comes before the callback's: promise continuations run before the timer settle set, so report('retrying later') runs and startSession returns while 'offline mode' is still queued. Also make clear that nothing in this code retries later; the text is a message, not an action. The reader takes along that a second report is pending.
The step before: W2.4 Giving up: settle('gave-up'), then return — When the loop exits, the Link settles the callback with 'gave-up' and returns the same word.
The step after: W2.6 The timer fires: 'offline mode' — Later, from the timer, the callback reports 'offline mode', the second report for the same failure.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`connect` has returned `'gave-up'`, and that resolves the promise `startSession` was waiting on. As in the first walk's sixth step, the continuation after the `await` runs as a promise microtask, which by the event loop's rules comes before any timer, so `startSession` resumes while the callback `settle` just queued is still waiting its turn.

This time `outcome === 'gave-up'` is true, the `if` body runs, and `report('retrying later')` is called directly, in this same microtask. `startSession` then reaches its end and its promise resolves. **The direct report wins the race by construction**: `'retrying later'` has reached the sink, and `startSession` has finished, before `'offline mode'` can be delivered from the timer.

The wording deserves a plain reading beside the code. Nothing here, and nothing left running in the Link, retries anything: the loop has ended, no timer other than the report's is pending, and the next `open` happens only if some caller invokes `connect` again. `'retrying later'` is a message sent to whoever `report` is, not an action the code takes.

The reader takes along that a second report for this same failed connection is still queued; the next step follows the timer that delivers it.

<!-- dspatch:details -->

The order between the direct report and the completion of `startSession` is also fixed: `report` is called synchronously in the continuation, so a caller resumed by `await startSession(...)` resumes after the sink has already received `'retrying later'`, and, by the same promise-before-timer rule, before it receives `'offline mode'`. What the caller does in that window is outside these files, and no caller exists in the repository to show it.

Compared with the earlier revision, this is the only place `startSession` reads the result of `connect` at all; the two-word union means this branch is exactly the complement of the success path, with no outcome that would skip both the `if` and the callback.

```

</details>

### Turn 14: write-step (file-2) · W2.6

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.6 The timer fires: 'offline mode'
Walk W2 (walk): Every attempt fails: pauses, giving up and two reports. How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.
Summary: Later, from the timer, the callback reports 'offline mode', the second report for the same failure.
- The callback body, taking the 'offline mode' branch: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Context followed: the timer callback from line 36, after startSession has returned; this is the callback registered in the first walk's step 1, now with outcome 'gave-up'. Explain, as read from the code and not observed, that the caller therefore receives two reports for one failed connect, 'retrying later' then 'offline mode', and that the callback cannot run a second time for this registration because settle emptied the slot. Nothing follows this step.
The step before: W2.5 Back in startSession: 'retrying later' is reported first — The await resumes with 'gave-up' and startSession reports 'retrying later' at once.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The timer `settle` queued at the loop's exit now fires, and the context is the same as at the end of the first walk: not `startSession`, which has returned, but the timer's own turn calling the arrow function registered in the first walk's first step. This time the captured `outcome` is `'gave-up'`, the ternary takes its second branch, and `report('offline mode')` is called.

Read from the code rather than observed, the consequence for the caller is this: **one failed `connect` produces two reports through the same sink**, `'retrying later'` from `startSession` itself in the previous step and `'offline mode'` from this callback afterwards, in that order by the promise-before-timer rule. The success path, by contrast, produced a single message. Both texts are fixed inside `startSession`, and `report` receives only the string, so the sink has nothing to tell it that the two messages describe the same connection attempt.

This callback cannot run again for this registration: `settle` emptied the slot before queuing the timer, so a later `connect` on the same Link settles into nothing unless `whenSettled` is called first. Nothing in these two files runs after this report, and the walk ends here.

<!-- dspatch:details -->

The two messages say different things about the same state. `'retrying later'` was sent by code that does not retry, as the previous step noted; `'offline mode'` is sent by a callback that has no view of what the caller did in the meantime. If a caller reacted to `startSession` finishing by calling `connect` again, that second attempt could already be under way when `'offline mode'` arrives, which the code allows but nothing here coordinates.

The callback reads only its captured `outcome` and the closed-over `report`; the Link's current state at the time the timer fires, including `attempts` sitting at `maxAttempts`, plays no part in the message. Whether sending both texts is intended, or whether one of them should carry the whole failure, is not something these files decide; there is no comment, test or caller to show the intent.

```

</details>

### Turn 15: write-step (file-2) · W3.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W3.1 Outcome replaces connect's boolean
Walk W3 (walk): What code that uses Link and startSession must now provide and expect. The contract change for callers outside these two files, read by dependency rather than by execution.
Summary: connect now answers 'connected' or 'gave-up', a string union, where From returned the transport's boolean.
- The Outcome type: src/link.ts (To) lines 5–5 — reached from The type import in session.ts (src/session.ts target 1–1)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Route by dependency, not execution: this type is what connect returns (line 17) and what the whenSettled callback receives (lines 9 and 13), and session.ts imports it as a type. Make comprehensible that the two-value union carries the same information as the old boolean but in words, and that both words are non-empty strings, so a caller that still tests connect's result as a boolean would read both as true. The reader takes along that these words are what startSession compares against.
The step after: W3.2 Link's state and the maxAttempts option — A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Three places in the two files rest on it. `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; the callback that `whenSettled` accepts, and the `onSettled` field that stores it, take an `Outcome` as their only argument; and `startSession` imports the name with `import { type Outcome }`, which makes it a compile-time-only import that leaves nothing in the emitted JavaScript.

The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.

**Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.

<!-- dspatch:details -->

The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.

Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

```

</details>

### Turn 16: write-step (file-2) · W3.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W3.2 Link's state and the maxAttempts option
Walk W3 (walk): What code that uses Link and startSession must now provide and expect. The contract change for callers outside these two files, read by dependency rather than by execution.
Summary: A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.
- The fields and the constructor: src/link.ts (To) lines 8–11
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: A mechanism taken apart on its own. Explain the three fields the loop and the callback share, and that maxAttempts is a constructor parameter with default 3; no code in this repository constructs a Link, so the default is what applies here and any other value comes from outside. Note for the reader that attempts is per Link instance and is reset at each connect, which matters if two connects overlap on one Link.
The step before: W3.1 Outcome replaces connect's boolean — connect now answers 'connected' or 'gave-up', a string union, where From returned the transport's boolean.
The step after: W3.3 startSession requires a report sink — startSession gains a third, required parameter and imports Outcome as a type.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
In the earlier revision a `Link` held one thing, the `transport`. It now carries three more pieces of state, all `private`, that the loop and the callback mechanism of the first two walks share:

- `attempts`, a mutable counter starting at `0`, which `connect` resets and raises and which also sets the pause lengths;
- `onSettled`, the single callback slot, `null` until `whenSettled` fills it and `null` again once `settle` has taken the callback out;
- `maxAttempts`, a `readonly` limit set once at construction and compared against `attempts` by the loop condition.

`maxAttempts` arrives as a second constructor parameter with a default of `3`, written as a TypeScript parameter property, so `new Link(transport)` still compiles and behaves as before apart from the retrying, while `new Link(transport, 5)` would allow five attempts. **No code in this repository constructs a `Link`**, so the default is the only value these files can be read with; any other limit comes from a caller outside them, and nothing here validates what that caller passes.

For a reader judging the design, the important property is that `attempts` belongs to the instance, not to a call. Each `connect` starts by resetting it, which is correct for one connection at a time, but it means that two `connect` calls overlapping on the same Link write the same counter, and the slot is shared in the same way. The code permits that overlap and does nothing to prevent or detect it.

<!-- dspatch:details -->

If two connects did overlap, the second's reset would pull the first's count back to zero in the middle of its loop, so the first could make more attempts than the limit and compute shorter pauses than its own attempt number implies; and whichever call reaches `settle` first empties the shared slot, leaving the other to settle into nothing. These are consequences read from the code, not observed; the repository holds no caller or test that exercises them.

Because all three fields are `private`, a caller has no way to ask how many attempts have been made or whether a callback is pending. The limit is the only knob exposed, and only at construction: there is no setter, and `connect` takes no per-call override. A limit of `0` or below makes the loop exit before any attempt, as the first walk's loop frame noted; a non-integer such as `2.5` is accepted by the type and, with the strict `<` comparison, allows three attempts.

```

</details>

### Turn 17: write-step (file-2) · W3.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W3.3 startSession requires a report sink
Walk W3 (walk): What code that uses Link and startSession must now provide and expect. The contract change for callers outside these two files, read by dependency rather than by execution.
Summary: startSession gains a third, required parameter and imports Outcome as a type.
- The import and the new signature: src/session.ts (To) lines 1–3
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Compare with From: the function used to take link and address only and discard connect's result. Make clear that report is required, so every caller must change, and that no caller or test exists in this repository, so the only use of these messages visible here is the one in session.ts itself. The reader takes along that the words 'session ready', 'offline mode' and 'retrying later' are fixed in this function, not configurable.
The step before: W3.2 Link's state and the maxAttempts option — A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`startSession` is the one exported function of its file, and its signature is the change a caller meets first. In the earlier revision it took a `Link` and an address, awaited `connect`, and threw the boolean away; a caller got a `Promise<void>` and no word about the connection. It now takes a third parameter, `report`, typed `(text: string) => void`, and the import line brings in `Outcome` as a type alongside `Link` so that the callback it registers can be typed.

**`report` is required.** It has no default and is not optional, so every existing call with two arguments stops compiling, and every caller must decide what to do with text messages before it can use this function again. The return type is still `Promise<void>`: the outcome does not come back through the promise, so `report` is the only way a caller of `startSession` learns whether the session is ready. Within this repository there is no caller and no test of `startSession` or `Link`, so the only use of the new parameter visible here is the function body itself.

The three texts a sink can receive, `'session ready'`, `'offline mode'` and `'retrying later'`, are literals inside this function. They cannot be configured, translated or replaced by a caller; the first two walks showed which of them arrive, in which order and from which context, for a success and for a failure.

<!-- dspatch:details -->

The parameter is a bare function type rather than an interface, so anything that accepts a string fits, including a logger; but the messages are plain text with no accompanying `Outcome` or identifier, so a sink that needs to act differently on success and failure has to recognise the words themselves, and a sink shared by several sessions cannot tell which `startSession` a message came from.

Each call of `startSession` registers a fresh callback on the Link it is given, and the Link keeps only one, as the first walk's second step showed; a caller that starts two sessions on one `Link` instance therefore changes which `report` hears the first connection's outcome. `Link` is imported as a value although this file uses it only as a type; whether that import survives compilation depends on compiler settings that are not part of these files.

```

</details>

### Turn 18: review-walks (file-3)

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: review-walks

## Your role: walk-reviewer
Judge whether finished code walks let the reader of the chosen profile follow the course and understand what the steps show, checked against the code and docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.0; name concrete shortcomings or accept.

Read the walks as the person will read them, beside the code, and judge whether they do their job for this reader: can the course be followed through calls, returns, branches, workers and callbacks; is every shown place explained, at this reader's level, rather than named or displayed; is what the text claims true of the code; does the text give the help the profile is for; does the deepening continue the first part rather than repeat it.

Check claims against the code with your tools. A confident sentence is not evidence, and neither is a plan or a brief. Read what each step rests on before you judge it.

Report shortcomings that matter to understanding, each concrete: which steps, what falls short, why it matters to this reader, and what in the code shows it, with the section of the reference when it helps. A problem with which walks, steps or places exist is a structural finding for the planner; a problem with a step's text is an explanation finding for the writer. A statement about the code that is not true is a shortcoming whatever its size, because the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right.

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
Report only shortcomings that matter to the reader's understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step's text is "explanation" and goes to the writer. A statement about the code that is not true is a shortcoming whatever its size, since the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right. Different good explanations are acceptable: accept without changes when nothing false and nothing significant falls short, and never ask for a change on a matter of style or preference.

## The walks as the person will read them
### W1 (walk): A connection that succeeds: from startSession to 'session ready'
Purpose: How the new callback and the new return value both carry a successful connection back to the caller, and in which order.

#### W1.1 startSession registers the settled callback
- startSession's signature and the whenSettled registration: src/session.ts (To) lines 3–4

`startSession` now takes three arguments instead of two: the `Link`, the address, and a `report` function that accepts a text message. In the earlier revision the whole body was one `await link.connect(address)` whose boolean result was discarded, so the caller learned nothing about how the connection went. Here, before any connection is attempted, the function calls `link.whenSettled` with an arrow function that closes over `report`: whenever the Link later invokes it with an `Outcome`, the arrow function maps `'connected'` to the message `'session ready'` and anything else to `'offline mode'`, and hands that text to `report`.

**Registering the callback runs nothing.** `whenSettled` only stores the function; `report` is not called on this line and no message exists yet. What this step fixes is the order: the Link holds the callback first, and `connect` is called on the very next line, so when the first attempt begins the Link already knows whom to tell. The next step shows the slot the callback lands in.

For judging the change, two things are worth noticing here. The callback is a second channel beside the value `connect` returns; the rest of this walk follows how both carry the same success back to the caller, and in which order. And the message texts are decided inside this arrow function from `outcome` alone, so nothing a caller passes can change them.

Show more:
`report` is typed `(text: string) => void`: `startSession` ignores anything it returns and cannot wait for it, so what the sink does with the text, show it, log it, or drop it, lies entirely outside these two files. No caller of `startSession` exists in this repository, so the only use of these messages visible here is this function itself; a third walk takes up what that requires of code elsewhere.

The arrow function keeps `report` alive through its closure: the Link stores the function, not the sink, and `report` is reached only when the callback eventually runs. Because `Outcome` is a union of exactly two strings, the ternary's else branch means precisely `'gave-up'`; the callback does not inspect anything else about the Link, and the same registration serves both the success path of this walk and the failure path of the next one.

#### W1.2 Link.whenSettled keeps one callback
- whenSettled stores the callback: src/link.ts (To) lines 13–15 — reached from The registration in startSession (src/session.ts target 4–4)

`whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.

**There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it; the Link's private `settle` method, which a later step in this walk takes apart, is the only code that reads the slot.

What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.

Show more:
Because the slot is a single field, the code allows a sequence the two files never guard against: if `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first, and only the second caller's `report` would ever receive a message for either connection. No caller in this repository does this, so it is a property of the design to be aware of rather than an observed fault.

The field is `private`, so within these files only `whenSettled` writes it and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

#### W1.3 connect begins the attempt loop
- connect's signature, the reset and the first attempt: src/link.ts (To) lines 17–21 — reached from The await in startSession (src/session.ts target 5–5)

`startSession` is now suspended on `await link.connect(address)`, and the walk follows the call into the Link. In the earlier revision `connect` was a single line that returned the transport's boolean untouched; here it is a retry loop that promises an `Outcome` instead, and this step is the loop's frame before any answer has arrived.

Three things set that frame up:

1. `attempts` is set back to `0` at the start of every call, so each `connect` counts from the beginning no matter what an earlier call on the same Link left behind.
2. The `while` condition compares `attempts` with `maxAttempts`, a constructor parameter that defaults to `3`; the third walk looks at how that value is supplied. The check comes before each attempt, so the loop makes at most `maxAttempts` attempts.
3. Inside the body the counter is raised **before** `open` is called. At the moment of any attempt, `attempts` therefore equals the number of attempts made so far, including this one: 1 on the first pass. The second walk shows the pause length being computed from this same number.

The attempt itself is `await this.transport.open(address)`. `Transport` is an interface with only this method, and `open` is where the outside world answers: `connect` hands the address over and is suspended until the transport's promise resolves to a boolean. Nothing in the Link decides whether a connection succeeds; it only reacts to what `open` says.

That boolean, held in `open`, is what the next step branches on. This walk follows the case where it is `true`.

Show more:
The code catches nothing. If the transport's promise rejects rather than resolving, the rejection passes out of `connect` and on through the `await` in `startSession`, and `settle` is never reached, so the callback registered earlier stays in the slot with no message sent through either channel. Whether a transport can reject is not established by these files; the interface's type says only `Promise<boolean>`.

`attempts` is an instance field rather than a local of `connect`. That is why the reset in the first line matters: two `connect` calls overlapping on one Link would both read and write the same counter, which the code permits but never guards against. The reset also means that if `maxAttempts` were `0` or negative, the condition would fail at once and the loop body would never run, so no attempt would be made at all; with the default of `3` that case does not arise.

#### W1.4 open returned true: settle, then return 'connected'
- The success branch of the loop body: src/link.ts (To) lines 22–25

`open` is `true`, so the `if` takes the branch this walk follows; the `false` case, which falls through to a pause, is where the second walk begins. Two statements run here, and their order is the point of the step.

First `this.settle('connected')`. `settle` is a private method of the Link that returns `void`, so it runs to completion, synchronously, before the next line is reached; what it arranges with the stored callback is the subject of the next step. Only then comes `return 'connected'`, which ends `connect`. Because `connect` is an `async` function, that return resolves the promise `startSession` is awaiting, and `startSession`'s continuation is queued to run afterwards.

**So whatever `settle` sets up exists before the caller can see the result.** The same word, `'connected'`, goes out through both channels: into `settle` for the callback, and as the return value for the caller. The reader should hold on to this order; the walk returns to it when the two channels deliver their messages at different times.

Show more:
The `return` leaves the `while` loop from inside its body, so a success on any pass exits here, not only the first: with the default of three attempts, the second walk shows the failing passes, and an `open` that answers `true` on the second or third pass comes back through this branch with `attempts` at 2 or 3. The counter is left at that value; it is only reset by the next call to `connect`.

Both occurrences of `'connected'` are string literals that TypeScript checks against the `Outcome` type, so neither `settle` nor the caller can receive a word outside the union from here. There is no third thing done in this branch: no state on the Link records that it is connected, and nothing closes or keeps the transport; a later `connect` would open again from scratch.

#### W1.5 settle detaches the callback and defers it
- The private settle method: src/link.ts (To) lines 32–38 — reached from The settle call on success (src/link.ts target 23–23)

`settle` is reached from the success branch with `'connected'` as its `outcome`, and it does two things in a deliberate order.

First it takes the function out of `onSettled` into a local `callback` and sets the field to `null`, before anything is scheduled. That is what makes the registration single-use: **the slot is already empty when the callback is arranged**, so the same registration can never fire twice, and a later `connect` on this Link reaches `settle` with an empty slot unless `whenSettled` has been called again. When the slot was already empty, the `if` guards against calling `null` and `settle` quietly does nothing; no error marks a connection that nobody asked to hear about.

Second, when there was a callback, it is not called here. `setTimeout(() => callback(outcome), 0)` hands a small closure, carrying both the function and the outcome, to the timer queue. A zero-delay timer does not mean "now": by the event loop's rules it runs in a later turn, after the current synchronous code has finished and after any pending promise continuations. So `settle` returns to `connect` with the report only queued, `connect` then returns `'connected'` as we saw in the previous step, and at that moment nothing has reached `report` yet. The next step picks up `startSession` as it resumes, still ahead of the timer.

Show more:
The local `callback` is why clearing the field is safe: the closure captures the local variable and the `outcome` argument, not the field, so nulling `onSettled` cannot pull the function out from under the scheduled timer. The handle `setTimeout` returns is discarded, so the Link has no way to cancel a report once settled.

What happens inside the timer is outside anything the Link controls. The callback runs in its own turn with no `try`/`catch` and no promise around it; if `report` threw, the exception would surface as an uncaught error in the timer, not in `connect` or `startSession`, which by then have both finished. And although `settle` is `private`, that keyword is TypeScript's compile-time check; within these files it is called from exactly two places in `connect`, the success branch seen here and the giving-up exit the second walk reaches.

#### W1.6 Back in startSession: 'connected' needs no extra report
- The await and the gave-up check in startSession: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 24–24)

`connect` has returned `'connected'`, and that return resolves the promise `startSession` was awaiting. The continuation after an `await` runs as a promise microtask: by the event loop's rules it is processed as soon as the current synchronous work is done and before any timer, so **`startSession` resumes here ahead of the callback that `settle` queued in the previous step.**

`outcome` is now `'connected'`. The only thing `startSession` does with the value is compare it with `'gave-up'`, and that comparison is false, so the `if` body is skipped and `report` is not called. The function then reaches its end, and since it is `async` and returns `Promise<void>`, its own promise resolves here with no value: the caller is told that `startSession` finished, not how the connection went.

That is the state to carry forward: `startSession` has completed, `report` has received nothing on this path, and the one message that will say "session ready" is still waiting in the timer. The next step follows that timer when it fires.

Show more:
The `if` is written for the failure case only; there is no branch for success, which is why the success path depends entirely on the callback for its message. With `Outcome` limited to two words, "not `'gave-up'`" and "`'connected'`" are the same condition here, so the code could not silently skip a third outcome; but it also means the return value of `connect` is read for one purpose and then dropped, and nothing of it reaches the caller.

The ordering also gives the reader something to notice about callers. Whoever awaits `startSession` is resumed by the same microtask mechanism, so by the rules of promises any code placed directly after `await startSession(...)` runs before `report('session ready')` does. The code allows a caller to act on a finished `startSession` while the session-ready message has not yet been delivered; no caller exists in this repository to show whether that matters.

#### W1.7 The timer fires: 'session ready'
- The callback body, now running from the timer: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)

The code here is the arrow function from the first step, but the execution context is new: it is no longer `startSession` running, which has completed and resolved its promise as we saw in the previous step, but the timer that `settle` queued. When the event loop reaches that timer it calls the closure, which calls this arrow function with the `outcome` captured at settle time, `'connected'`.

The ternary then selects its first text, and `report('session ready')` is the single call made. This is **the only message the success path produces**, and it arrives from the callback channel, not from `startSession`'s own code, which reported nothing for this outcome.

What the reader can conclude from the code, not from any observed run, is the order the walk has been building towards: by the rules of promises and timers, a caller awaiting `startSession` is resumed first, and `report('session ready')` reaches the sink after that, in a later turn. Nothing in these two files runs after this report; the walk ends here.

Show more:
The `report` the callback uses is the one passed to the `startSession` call that registered it, kept alive by the closure; the Link has no reference to the sink itself. The callback reads nothing from the Link or the transport when it runs, so a change in the Link's state between settling and firing, such as another `connect` having started, could not alter the message; only the captured `outcome` decides it.

"Later" is a lower bound rather than a fixed delay: a zero-delay timer runs no earlier than the next timer phase, and anything already queued ahead of it runs first. The same arrow function serves the failure path, where the ternary takes its other branch; the second walk arrives there with `'gave-up'`.

### W2 (walk): Every attempt fails: pauses, giving up and two reports
Purpose: How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.

#### W2.1 Back at the branch: open returned false
- The if with its false outcome and the pause: src/link.ts (To) lines 22–26

The walk is back at the `if` where the first walk's fourth step took the success branch, with everything before it unchanged: `startSession` registered its callback, `connect` reset and then raised `attempts` to `1`, and the first `transport.open` has answered. This time the answer is `false`: the transport resolved its promise with that value rather than throwing, so the `if` body with `settle` and `return` is skipped and execution continues below it.

**Nothing is decided here.** The Link does not record a failure, does not call `settle`, and does not return; the callback stays in its slot untouched. The only thing the loop body does after a failed attempt is `await pause(this.attempts * 100)`, which with `attempts` at `1` asks for a 100 ms wait. During that wait `connect` is suspended, and with it `startSession`'s `await` and whoever is awaiting that, so from the caller's side a failed first attempt looks exactly like an attempt still in progress.

The reader takes to the next step that `connect` is parked on this pause and will continue from whatever resolves it. The multiplier is why later pauses grow: the second failed attempt would wait 200 ms, the third 300 ms, and the third step of this walk lays out the full sequence.

Show more:
The pause sits unconditionally after the `if`, inside the loop body, not in a branch of its own. That placement means every failed attempt pays a pause before the `while` condition is re-examined, the last one included; the consequence for the total time before giving up is taken up with the loop condition in a later step.

The length comes from `this.attempts`, an instance field, at the moment the pause is requested; the number is fixed when `pause` is called, so a change to the field during the wait would not shorten or lengthen a pause already under way. Only the `false` value reaches this code: a transport whose promise rejects never arrives here, because, as noted with the loop's frame in the first walk, `connect` catches nothing.

#### W2.2 pause: a timer wrapped in a promise
- The pause helper: src/link.ts (To) lines 41–43 — reached from The awaited pause in the loop (src/link.ts target 26–26)

`pause` is the helper the loop awaited in the previous step. It is a plain function at the bottom of the module, not a method of the Link and not exported, so within this repository only `connect` can reach it. It builds one `Promise` and passes the promise's `resolve` function straight to `setTimeout` as the timer callback: when the timer fires after `ms` milliseconds, `resolve` is called with no value and the promise settles as `void`.

That is the whole mechanism of the delay. `connect` is suspended on `await pause(...)`, and **the loop's next iteration is driven by the timer**: nothing else can resolve this promise, so until the timer fires there is no further attempt, no report, and no return. When it does fire, the continuation after the `await` is queued as a microtask and `connect` picks up right after the pause expression, which brings control back to the `while` condition; the next step follows that check.

Worth noticing for the change: the helper offers no cancellation. The timer handle is discarded, the promise has no rejection path, and nothing on the Link can cut a pause short, so a caller that gives up on a connection while a pause is running still has `connect` finish its remaining attempts in the background.

Show more:
The requested `ms` is a lower bound by the rules of timers: the callback runs no earlier than that, and later if the event loop is busy. The same rule applies to the zero-delay timer `settle` uses, and the two kinds of timer are independent; a pause does not delay a report already queued.

Because `pause` is module-private and uses the global `setTimeout` directly, the only ways to make the loop faster in a test are to replace the global timer functions or to construct the Link with a smaller `maxAttempts`; no test exists in this repository that does either, and the delays are not configurable from outside this file.

#### W2.3 The loop condition after each pause
- The while condition and the counter: src/link.ts (To) lines 19–20

The pause has resolved and `connect` has reached the end of the loop body, so the walk arrives here by the loop turning over, not by a call: the `while` condition is evaluated again. As long as `attempts` is still below `maxAttempts`, the body runs once more, the counter goes up by one, and `transport.open` is awaited again exactly as in the first walk's loop frame.

With the default `maxAttempts` of `3` and a transport that always answers `false`, the loop therefore runs through this sequence:

1. `attempts` becomes 1, open fails, pause 100 ms
2. condition 1 < 3 holds; `attempts` becomes 2, open fails, pause 200 ms
3. condition 2 < 3 holds; `attempts` becomes 3, open fails, pause 300 ms
4. condition 3 < 3 fails; the loop exits

**The pause after the last failed attempt is spent before giving up.** Nothing in the body distinguishes the final attempt, so the 300 ms wait runs although no further `open` can follow it; at least 600 ms of pauses pass, plus whatever the three opens took, before the Link concludes anything. Had any of the three opens answered `true` instead, the loop would have left through the success branch of the first walk's fourth step, with the counter at that attempt's number.

Carried to the next step is the state at exit: `attempts` equals `maxAttempts`, `settle` has not been called, the callback registered by `startSession` is still in its slot, and `connect` has not returned.

Show more:
The strict `<` in the condition, together with the increment at the top of the body, is what keeps the counter from ever passing `maxAttempts`; the exit always happens with the two equal, which is why the number of attempts made is exactly the limit. For a general limit `n` the pauses add up to `100 × n(n+1)/2` ms, so the trailing pause grows with the limit as well; whether that final wait is intended or an oversight cannot be read from these files, which contain no comment or test about it.

Each turn of the loop is a fresh round through the same code, with no memory of why earlier attempts failed: the transport's `false` is not inspected further, and the loop would retry identically after an answer that meant a permanent problem as after a transient one.

#### W2.4 Giving up: settle('gave-up'), then return
- The exit after the loop: src/link.ts (To) lines 28–29 — reached from The loop condition, now false (src/link.ts target 19–19)

The `while` condition is false, so `connect` falls out of the loop onto its last two lines. They mirror the success branch of the first walk, with `'gave-up'` in place of `'connected'`: `settle('gave-up')` first, then `return 'gave-up'`.

`settle` does here what the first walk's fifth step showed: it takes the callback out of the slot, leaves the slot empty, and queues a zero-delay timer that will call the callback with `'gave-up'`. Because `settle` is synchronous and runs before the `return`, **the timer is already queued when `connect`'s promise resolves**, and the same word travels out through both channels: the callback will carry it later, the return value carries it now to `startSession`'s `await`.

From here two things are pending at once, and the next step is about which of them runs first: the continuation of `startSession`, resumed by this return, and the timer holding the callback.

Show more:
This exit and the success branch are the only two normal ways out of `connect`, and at both the word passed to `settle` is the literal returned on the next line, so the two channels cannot disagree about an outcome by construction; a rejection from the transport remains the one way out that settles nothing.

`'gave-up'` is final as far as the Link is concerned. No further timer, attempt or state change is scheduled after this point, and `attempts` stays at `maxAttempts` until a caller invokes `connect` again. What the caller then says about retrying is its own wording; the Link has stopped.

#### W2.5 Back in startSession: 'retrying later' is reported first
- The gave-up check and its report: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 29–29)

`connect` has returned `'gave-up'`, and that resolves the promise `startSession` was waiting on. As in the first walk's sixth step, the continuation after the `await` runs as a promise microtask, which by the event loop's rules comes before any timer, so `startSession` resumes while the callback `settle` just queued is still waiting its turn.

This time `outcome === 'gave-up'` is true, the `if` body runs, and `report('retrying later')` is called directly, in this same microtask. `startSession` then reaches its end and its promise resolves. **The direct report wins the race by construction**: `'retrying later'` has reached the sink, and `startSession` has finished, before `'offline mode'` can be delivered from the timer.

The wording deserves a plain reading beside the code. Nothing here, and nothing left running in the Link, retries anything: the loop has ended, no timer other than the report's is pending, and the next `open` happens only if some caller invokes `connect` again. `'retrying later'` is a message sent to whoever `report` is, not an action the code takes.

The reader takes along that a second report for this same failed connection is still queued; the next step follows the timer that delivers it.

Show more:
The order between the direct report and the completion of `startSession` is also fixed: `report` is called synchronously in the continuation, so a caller resumed by `await startSession(...)` resumes after the sink has already received `'retrying later'`, and, by the same promise-before-timer rule, before it receives `'offline mode'`. What the caller does in that window is outside these files, and no caller exists in the repository to show it.

Compared with the earlier revision, this is the only place `startSession` reads the result of `connect` at all; the two-word union means this branch is exactly the complement of the success path, with no outcome that would skip both the `if` and the callback.

#### W2.6 The timer fires: 'offline mode'
- The callback body, taking the 'offline mode' branch: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)

The timer `settle` queued at the loop's exit now fires, and the context is the same as at the end of the first walk: not `startSession`, which has returned, but the timer's own turn calling the arrow function registered in the first walk's first step. This time the captured `outcome` is `'gave-up'`, the ternary takes its second branch, and `report('offline mode')` is called.

Read from the code rather than observed, the consequence for the caller is this: **one failed `connect` produces two reports through the same sink**, `'retrying later'` from `startSession` itself in the previous step and `'offline mode'` from this callback afterwards, in that order by the promise-before-timer rule. The success path, by contrast, produced a single message. Both texts are fixed inside `startSession`, and `report` receives only the string, so the sink has nothing to tell it that the two messages describe the same connection attempt.

This callback cannot run again for this registration: `settle` emptied the slot before queuing the timer, so a later `connect` on the same Link settles into nothing unless `whenSettled` is called first. Nothing in these two files runs after this report, and the walk ends here.

Show more:
The two messages say different things about the same state. `'retrying later'` was sent by code that does not retry, as the previous step noted; `'offline mode'` is sent by a callback that has no view of what the caller did in the meantime. If a caller reacted to `startSession` finishing by calling `connect` again, that second attempt could already be under way when `'offline mode'` arrives, which the code allows but nothing here coordinates.

The callback reads only its captured `outcome` and the closed-over `report`; the Link's current state at the time the timer fires, including `attempts` sitting at `maxAttempts`, plays no part in the message. Whether sending both texts is intended, or whether one of them should carry the whole failure, is not something these files decide; there is no comment, test or caller to show the intent.

### W3 (walk): What code that uses Link and startSession must now provide and expect
Purpose: The contract change for callers outside these two files, read by dependency rather than by execution.

#### W3.1 Outcome replaces connect's boolean
- The Outcome type: src/link.ts (To) lines 5–5 — reached from The type import in session.ts (src/session.ts target 1–1)

This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Three places in the two files rest on it. `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; the callback that `whenSettled` accepts, and the `onSettled` field that stores it, take an `Outcome` as their only argument; and `startSession` imports the name with `import { type Outcome }`, which makes it a compile-time-only import that leaves nothing in the emitted JavaScript.

The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.

**Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.

Show more:
The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.

Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

#### W3.2 Link's state and the maxAttempts option
- The fields and the constructor: src/link.ts (To) lines 8–11

In the earlier revision a `Link` held one thing, the `transport`. It now carries three more pieces of state, all `private`, that the loop and the callback mechanism of the first two walks share:

- `attempts`, a mutable counter starting at `0`, which `connect` resets and raises and which also sets the pause lengths;
- `onSettled`, the single callback slot, `null` until `whenSettled` fills it and `null` again once `settle` has taken the callback out;
- `maxAttempts`, a `readonly` limit set once at construction and compared against `attempts` by the loop condition.

`maxAttempts` arrives as a second constructor parameter with a default of `3`, written as a TypeScript parameter property, so `new Link(transport)` still compiles and behaves as before apart from the retrying, while `new Link(transport, 5)` would allow five attempts. **No code in this repository constructs a `Link`**, so the default is the only value these files can be read with; any other limit comes from a caller outside them, and nothing here validates what that caller passes.

For a reader judging the design, the important property is that `attempts` belongs to the instance, not to a call. Each `connect` starts by resetting it, which is correct for one connection at a time, but it means that two `connect` calls overlapping on the same Link write the same counter, and the slot is shared in the same way. The code permits that overlap and does nothing to prevent or detect it.

Show more:
If two connects did overlap, the second's reset would pull the first's count back to zero in the middle of its loop, so the first could make more attempts than the limit and compute shorter pauses than its own attempt number implies; and whichever call reaches `settle` first empties the shared slot, leaving the other to settle into nothing. These are consequences read from the code, not observed; the repository holds no caller or test that exercises them.

Because all three fields are `private`, a caller has no way to ask how many attempts have been made or whether a callback is pending. The limit is the only knob exposed, and only at construction: there is no setter, and `connect` takes no per-call override. A limit of `0` or below makes the loop exit before any attempt, as the first walk's loop frame noted; a non-integer such as `2.5` is accepted by the type and, with the strict `<` comparison, allows three attempts.

#### W3.3 startSession requires a report sink
- The import and the new signature: src/session.ts (To) lines 1–3

`startSession` is the one exported function of its file, and its signature is the change a caller meets first. In the earlier revision it took a `Link` and an address, awaited `connect`, and threw the boolean away; a caller got a `Promise<void>` and no word about the connection. It now takes a third parameter, `report`, typed `(text: string) => void`, and the import line brings in `Outcome` as a type alongside `Link` so that the callback it registers can be typed.

**`report` is required.** It has no default and is not optional, so every existing call with two arguments stops compiling, and every caller must decide what to do with text messages before it can use this function again. The return type is still `Promise<void>`: the outcome does not come back through the promise, so `report` is the only way a caller of `startSession` learns whether the session is ready. Within this repository there is no caller and no test of `startSession` or `Link`, so the only use of the new parameter visible here is the function body itself.

The three texts a sink can receive, `'session ready'`, `'offline mode'` and `'retrying later'`, are literals inside this function. They cannot be configured, translated or replaced by a caller; the first two walks showed which of them arrive, in which order and from which context, for a success and for a failure.

Show more:
The parameter is a bare function type rather than an interface, so anything that accepts a string fits, including a logger; but the messages are plain text with no accompanying `Outcome` or identifier, so a sink that needs to act differently on success and failure has to recognise the words themselves, and a sink shared by several sessions cannot tell which `startSession` a message came from.

Each call of `startSession` registers a fresh callback on the Link it is given, and the Link keeps only one, as the first walk's second step showed; a caller that starts two sessions on one `Link` instance therefore changes which `report` hears the first connection's outcome. `Link` is imported as a value although this file uses it only as a type; whether that import survives compilation depends on compiler settings that are not part of these files.

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
- `base/` is From, commit a9377d8d0e17771a5bfdac383b773fda287e0c83
- `target/` is To, commit 0d0c00df3bd0aa0c923c96527bf1d3c9bd3717f4
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.
```

</details>

<details><summary>Answer</summary>

```text
I read both revisions in full and checked each step's lines, transitions and claims against them.

``​`json
{
  "assessment": "The reader can follow the course. W1 and W2 enter at startSession, follow connect into the loop, return to the if as a shared branch point, take settle apart once and reuse it, and make the one non-obvious ordering, the await continuation resuming before the zero-delay timer, understandable from the rules of promises and timers rather than from assertion; every shown place is explained for what it does here and why it matters to the change, and the 'reached from' labels and line ranges all match the target code. W3 says it reads by dependency and does so. The Show more parts add depth (rejection, overlapping connects, non-integer limits, the truthiness trap) rather than repeating the first part. The mechanism, timing and message claims I checked are true of the code, so the verdict rests only on two small statements in Show more texts that are not true as written and that the person would find contradicted when checking the code: W1.2's account of the overlapping-registration case and of who writes the slot, and W3.1's count of what rests on Outcome. Nothing structural falls short.",
  "verdict": "rework",
  "findings": [
    {
      "kind": "explanation",
      "steps": [
        "W1.2"
      ],
      "problem": "Two statements in the Show more are not true of the code. First: 'if startSession were called twice on the same Link while the first connect is still running ... only the second caller's report would ever receive a message for either connection.' The slot carries only the callback channel; the direct channel is per call. Each startSession still calls its own report('retrying later') when its own connect returns 'gave-up', so the first caller's report is cut off from 'session ready' and 'offline mode', not from every message. The correct reading: the callback fires once, for whichever connect settles first, into the second caller's report; the other connect settles into an empty slot; but a first connect that gives up still reports 'retrying later' to the first caller. Second: 'within these files only whenSettled writes it and only settle reads it.' settle also writes the field, setting it to null at the moment it takes the callback out; that write is what the step's own point about single use rests on.",
      "why": "A Standard reader judging the shared-slot design would conclude that an overlapped first caller hears nothing at all, which overstates the consequence and contradicts W2.5, where the direct report is shown to be independent of the slot. The 'only whenSettled writes it' sentence is contradicted on the next step's lines, and the person checks the code through these texts.",
      "evidence": "src/session.ts target 6–7: report('retrying later') is called from the awaiting startSession itself, with that call's own report, regardless of the slot. src/link.ts target 14: whenSettled writes onSettled; target 33–34: settle reads it into a local and then writes null to it.",
      "reference": "Section 3, Distinguish evidence from conclusions."
    },
    {
      "kind": "explanation",
      "steps": [
        "W3.1"
      ],
      "problem": "'Three places in the two files rest on it' is not an accurate count, and the list that follows leaves out two uses: settle's parameter is typed Outcome, and the arrow function startSession registers annotates its parameter with Outcome, which is the reason the type is imported at all. The correct reading: in link.ts the field (line 9), whenSettled's parameter (13), connect's return type (17) and settle's parameter (32) all name Outcome; in session.ts the import (1) and the callback's parameter (4) do.",
      "why": "The step teaches the change by dependency, so the inventory of what depends on the type is its content; a reader who checks the code finds more uses than the text says, and the omitted settle parameter is the one through which the word reaches the callback.",
      "evidence": "src/link.ts target 9, 13, 17, 32; src/session.ts target 1, 4.",
      "reference": "Section 3, Add understanding beyond reading the code aloud."
    }
  ]
}
``​`

```

</details>

### Turn 19: write-step (file-2) · W1.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.2 Link.whenSettled keeps one callback
Walk W1 (walk): A connection that succeeds: from startSession to 'session ready'. How the new callback and the new return value both carry a successful connection back to the caller, and in which order.
Summary: The callback is stored in the Link's single onSettled slot; nothing runs yet.
- whenSettled stores the callback: src/link.ts (To) lines 13–15 — reached from The registration in startSession (src/session.ts target 4–4)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Reached from startSession's call at line 4. Make comprehensible that this is a plain assignment into the onSettled field declared at line 9 (one slot, so a later call replaces an earlier one) and that the Link, not startSession, decides when it is called. The reader takes along that the slot is full when connect starts.
The step before: W1.1 startSession registers the settled callback — Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.
The step after: W1.3 connect begins the attempt loop — connect resets the counter and makes the first attempt by awaiting transport.open.

## The reviewer's findings about this step
Write this step again, acting on each finding; keep what was right. The reviewer read the code: check each claim against it yourself.
- Two statements in the Show more are not true of the code. First: 'if startSession were called twice on the same Link while the first connect is still running ... only the second caller's report would ever receive a message for either connection.' The slot carries only the callback channel; the direct channel is per call. Each startSession still calls its own report('retrying later') when its own connect returns 'gave-up', so the first caller's report is cut off from 'session ready' and 'offline mode', not from every message. The correct reading: the callback fires once, for whichever connect settles first, into the second caller's report; the other connect settles into an empty slot; but a first connect that gives up still reports 'retrying later' to the first caller. Second: 'within these files only whenSettled writes it and only settle reads it.' settle also writes the field, setting it to null at the moment it takes the callback out; that write is what the step's own point about single use rests on. (A Standard reader judging the shared-slot design would conclude that an overlapped first caller hears nothing at all, which overstates the consequence and contradicts W2.5, where the direct report is shown to be independent of the slot. The 'only whenSettled writes it' sentence is contradicted on the next step's lines, and the person checks the code through these texts.) Evidence: src/session.ts target 6–7: report('retrying later') is called from the awaiting startSession itself, with that call's own report, regardless of the slot. src/link.ts target 14: whenSettled writes onSettled; target 33–34: settle reads it into a local and then writes null to it.

## Your earlier text
`whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.

**There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it; the Link's private `settle` method, which a later step in this walk takes apart, is the only code that reads the slot.

What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.

Because the slot is a single field, the code allows a sequence the two files never guard against: if `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first, and only the second caller's `report` would ever receive a message for either connection. No caller in this repository does this, so it is a property of the design to be aware of rather than an observed fault.

The field is `private`, so within these files only `whenSettled` writes it and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
`whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.

**There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it. The only other code that touches the field is the Link's private `settle` method, which a later step in this walk takes apart: it reads the slot and sets it back to `null` in the same move, which is where the single use of each registration comes from.

What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.

<!-- dspatch:details -->

Because the slot is a single field, the code allows a sequence the two files never guard against. If `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first. The slot carries only the callback channel, so the consequence is confined to it: the callback fires once, for whichever `connect` settles first, and into the second caller's `report`; the other `connect` then settles into an empty slot and sends nothing that way. The direct channel is untouched, because each `startSession` compares its own `connect` result and calls its own `report('retrying later')` on `'gave-up'`, independently of the slot. So an overlapped first caller is cut off from `'session ready'` and `'offline mode'`, not from every message. No caller in this repository does this; it is a property of the design to be aware of rather than an observed fault.

The field is `private`, so within these files only `whenSettled` and `settle` write it, one filling it and the other clearing it, and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

```

</details>

### Turn 20: write-step (file-2) · W3.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W3.1 Outcome replaces connect's boolean
Walk W3 (walk): What code that uses Link and startSession must now provide and expect. The contract change for callers outside these two files, read by dependency rather than by execution.
Summary: connect now answers 'connected' or 'gave-up', a string union, where From returned the transport's boolean.
- The Outcome type: src/link.ts (To) lines 5–5 — reached from The type import in session.ts (src/session.ts target 1–1)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
Brief: Route by dependency, not execution: this type is what connect returns (line 17) and what the whenSettled callback receives (lines 9 and 13), and session.ts imports it as a type. Make comprehensible that the two-value union carries the same information as the old boolean but in words, and that both words are non-empty strings, so a caller that still tests connect's result as a boolean would read both as true. The reader takes along that these words are what startSession compares against.
The step after: W3.2 Link's state and the maxAttempts option — A Link now carries an attempt counter, one callback slot and a retry limit that defaults to 3.

## The reviewer's findings about this step
Write this step again, acting on each finding; keep what was right. The reviewer read the code: check each claim against it yourself.
- 'Three places in the two files rest on it' is not an accurate count, and the list that follows leaves out two uses: settle's parameter is typed Outcome, and the arrow function startSession registers annotates its parameter with Outcome, which is the reason the type is imported at all. The correct reading: in link.ts the field (line 9), whenSettled's parameter (13), connect's return type (17) and settle's parameter (32) all name Outcome; in session.ts the import (1) and the callback's parameter (4) do. (The step teaches the change by dependency, so the inventory of what depends on the type is its content; a reader who checks the code finds more uses than the text says, and the omitted settle parameter is the one through which the word reaches the callback.) Evidence: src/link.ts target 9, 13, 17, 32; src/session.ts target 1, 4.

## Your earlier text
This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Three places in the two files rest on it. `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; the callback that `whenSettled` accepts, and the `onSettled` field that stores it, take an `Outcome` as their only argument; and `startSession` imports the name with `import { type Outcome }`, which makes it a compile-time-only import that leaves nothing in the emitted JavaScript.

The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.

**Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.

The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.

Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Everything that passes the verdict around names it. In the Link, `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; `settle` takes an `Outcome` as its parameter, which is the way the word gets from `connect` to the callback; and the callback itself is typed to receive one, both where `whenSettled` accepts it and in the `onSettled` field that stores it. In the session file, `startSession` imports the name with `import { type Outcome }`, a compile-time-only import that leaves nothing in the emitted JavaScript, and uses it for exactly one thing: annotating the parameter of the arrow function it registers, so that the ternary inside is checked against the same two words.

The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.

**Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.

<!-- dspatch:details -->

The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.

Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

```

</details>

### Turn 21: review-walks (file-3)

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: review-walks

## The reader (Standard)
- The reader knows programming but not this code: make the central mechanism understandable, how the parts work together and why their relationship matters, from a natural entry point into what makes the behaviour understandable rather than the parts in source order. Place a project-specific name the first time it matters, and explain a language detail where the reader needs it to interpret the code; you need not teach every concept, nor add facts to be longer.

## What to judge
- Can the reader follow the course: at each step, how it is reached and what the caller needs, what a return brings back, that an alternative outcome is back at the branch point, what starts a worker or callback and which context is followed, and when the teaching order differs from the execution order?
- Is every code place a step shows explained there, at this reader's level: what it does here, why it matters for the change, and what decides the outcome? Naming a function or showing its lines is not explaining it.
- Is what the text claims true of the code? Read the code behind each step with your tools before you judge; a confident sentence is not evidence.
- Does the text give this reader the help the profile is for: quick orientation at the right level of abstraction, the mechanism made understandable, or the concepts and intermediate reasoning built where they are needed? Length and density are not the measure.
- Is the part after Show more a deepening that continues the first part, not a repetition of it?
- Is an important new implementation walked rather than left behind a function name, and are alternatives presented as alternatives, never as one run?
Report only shortcomings that matter to the reader's understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step's text is "explanation" and goes to the writer. A statement about the code that is not true is a shortcoming whatever its size, since the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right. Different good explanations are acceptable: accept without changes when nothing false and nothing significant falls short, and never ask for a change on a matter of style or preference.

## The final assessment
This is the assessment after the one correction round: no further correction follows. Judge the walks as they are now, say what was put right and what still falls short, and give the verdict "accept" when the walks now serve the reader or "objections" when something significant still does, with the remaining shortcomings as findings.

What you found the first time:
- W1.2: Two statements in the Show more are not true of the code. First: 'if startSession were called twice on the same Link while the first connect is still running ... only the second caller's report would ever receive a message for either connection.' The slot carries only the callback channel; the direct channel is per call. Each startSession still calls its own report('retrying later') when its own connect returns 'gave-up', so the first caller's report is cut off from 'session ready' and 'offline mode', not from every message. The correct reading: the callback fires once, for whichever connect settles first, into the second caller's report; the other connect settles into an empty slot; but a first connect that gives up still reports 'retrying later' to the first caller. Second: 'within these files only whenSettled writes it and only settle reads it.' settle also writes the field, setting it to null at the moment it takes the callback out; that write is what the step's own point about single use rests on.
- W3.1: 'Three places in the two files rest on it' is not an accurate count, and the list that follows leaves out two uses: settle's parameter is typed Outcome, and the arrow function startSession registers annotates its parameter with Outcome, which is the reason the type is imported at all. The correct reading: in link.ts the field (line 9), whenSettled's parameter (13), connect's return type (17) and settle's parameter (32) all name Outcome; in session.ts the import (1) and the callback's parameter (4) do.

## The walks as the person will read them
### W1 (walk): A connection that succeeds: from startSession to 'session ready'
Purpose: How the new callback and the new return value both carry a successful connection back to the caller, and in which order.

#### W1.1 startSession registers the settled callback
- startSession's signature and the whenSettled registration: src/session.ts (To) lines 3–4

`startSession` now takes three arguments instead of two: the `Link`, the address, and a `report` function that accepts a text message. In the earlier revision the whole body was one `await link.connect(address)` whose boolean result was discarded, so the caller learned nothing about how the connection went. Here, before any connection is attempted, the function calls `link.whenSettled` with an arrow function that closes over `report`: whenever the Link later invokes it with an `Outcome`, the arrow function maps `'connected'` to the message `'session ready'` and anything else to `'offline mode'`, and hands that text to `report`.

**Registering the callback runs nothing.** `whenSettled` only stores the function; `report` is not called on this line and no message exists yet. What this step fixes is the order: the Link holds the callback first, and `connect` is called on the very next line, so when the first attempt begins the Link already knows whom to tell. The next step shows the slot the callback lands in.

For judging the change, two things are worth noticing here. The callback is a second channel beside the value `connect` returns; the rest of this walk follows how both carry the same success back to the caller, and in which order. And the message texts are decided inside this arrow function from `outcome` alone, so nothing a caller passes can change them.

Show more:
`report` is typed `(text: string) => void`: `startSession` ignores anything it returns and cannot wait for it, so what the sink does with the text, show it, log it, or drop it, lies entirely outside these two files. No caller of `startSession` exists in this repository, so the only use of these messages visible here is this function itself; a third walk takes up what that requires of code elsewhere.

The arrow function keeps `report` alive through its closure: the Link stores the function, not the sink, and `report` is reached only when the callback eventually runs. Because `Outcome` is a union of exactly two strings, the ternary's else branch means precisely `'gave-up'`; the callback does not inspect anything else about the Link, and the same registration serves both the success path of this walk and the failure path of the next one.

#### W1.2 Link.whenSettled keeps one callback
- whenSettled stores the callback: src/link.ts (To) lines 13–15 — reached from The registration in startSession (src/session.ts target 4–4)

`whenSettled` is what `startSession` called in the previous step, and all it does is store the function it is given in the Link's private `onSettled` field. That field is declared as either a callback taking an `Outcome` or `null`, and starts as `null`; this assignment fills it. Nothing is invoked, nothing is scheduled, and `whenSettled` returns `void`, so `startSession` continues straight on to `connect`.

**There is one slot, not a list.** A second call to `whenSettled` on the same Link overwrites whatever was stored before, without any check that the earlier callback was ever used. And the Link, not `startSession`, decides when the stored function runs: `startSession` has handed over a function and lost control of it. The only other code that touches the field is the Link's private `settle` method, which a later step in this walk takes apart: it reads the slot and sets it back to `null` in the same move, which is where the single use of each registration comes from.

What the reader carries into the next step is the state: when `connect` starts, `onSettled` holds the arrow function from `startSession`, ready to be called with whatever outcome the attempt loop produces.

Show more:
Because the slot is a single field, the code allows a sequence the two files never guard against. If `startSession` were called twice on the same Link while the first `connect` is still running, the second registration would replace the first. The slot carries only the callback channel, so the consequence is confined to it: the callback fires once, for whichever `connect` settles first, and into the second caller's `report`; the other `connect` then settles into an empty slot and sends nothing that way. The direct channel is untouched, because each `startSession` compares its own `connect` result and calls its own `report('retrying later')` on `'gave-up'`, independently of the slot. So an overlapped first caller is cut off from `'session ready'` and `'offline mode'`, not from every message. No caller in this repository does this; it is a property of the design to be aware of rather than an observed fault.

The field is `private`, so within these files only `whenSettled` and `settle` write it, one filling it and the other clearing it, and only `settle` reads it; a caller cannot inspect whether a callback is pending, and there is no way to withdraw a registration other than registering a different function. The parameter type `(outcome: Outcome) => void` also tells the reader that the Link will not await the callback and will not see anything it returns.

#### W1.3 connect begins the attempt loop
- connect's signature, the reset and the first attempt: src/link.ts (To) lines 17–21 — reached from The await in startSession (src/session.ts target 5–5)

`startSession` is now suspended on `await link.connect(address)`, and the walk follows the call into the Link. In the earlier revision `connect` was a single line that returned the transport's boolean untouched; here it is a retry loop that promises an `Outcome` instead, and this step is the loop's frame before any answer has arrived.

Three things set that frame up:

1. `attempts` is set back to `0` at the start of every call, so each `connect` counts from the beginning no matter what an earlier call on the same Link left behind.
2. The `while` condition compares `attempts` with `maxAttempts`, a constructor parameter that defaults to `3`; the third walk looks at how that value is supplied. The check comes before each attempt, so the loop makes at most `maxAttempts` attempts.
3. Inside the body the counter is raised **before** `open` is called. At the moment of any attempt, `attempts` therefore equals the number of attempts made so far, including this one: 1 on the first pass. The second walk shows the pause length being computed from this same number.

The attempt itself is `await this.transport.open(address)`. `Transport` is an interface with only this method, and `open` is where the outside world answers: `connect` hands the address over and is suspended until the transport's promise resolves to a boolean. Nothing in the Link decides whether a connection succeeds; it only reacts to what `open` says.

That boolean, held in `open`, is what the next step branches on. This walk follows the case where it is `true`.

Show more:
The code catches nothing. If the transport's promise rejects rather than resolving, the rejection passes out of `connect` and on through the `await` in `startSession`, and `settle` is never reached, so the callback registered earlier stays in the slot with no message sent through either channel. Whether a transport can reject is not established by these files; the interface's type says only `Promise<boolean>`.

`attempts` is an instance field rather than a local of `connect`. That is why the reset in the first line matters: two `connect` calls overlapping on one Link would both read and write the same counter, which the code permits but never guards against. The reset also means that if `maxAttempts` were `0` or negative, the condition would fail at once and the loop body would never run, so no attempt would be made at all; with the default of `3` that case does not arise.

#### W1.4 open returned true: settle, then return 'connected'
- The success branch of the loop body: src/link.ts (To) lines 22–25

`open` is `true`, so the `if` takes the branch this walk follows; the `false` case, which falls through to a pause, is where the second walk begins. Two statements run here, and their order is the point of the step.

First `this.settle('connected')`. `settle` is a private method of the Link that returns `void`, so it runs to completion, synchronously, before the next line is reached; what it arranges with the stored callback is the subject of the next step. Only then comes `return 'connected'`, which ends `connect`. Because `connect` is an `async` function, that return resolves the promise `startSession` is awaiting, and `startSession`'s continuation is queued to run afterwards.

**So whatever `settle` sets up exists before the caller can see the result.** The same word, `'connected'`, goes out through both channels: into `settle` for the callback, and as the return value for the caller. The reader should hold on to this order; the walk returns to it when the two channels deliver their messages at different times.

Show more:
The `return` leaves the `while` loop from inside its body, so a success on any pass exits here, not only the first: with the default of three attempts, the second walk shows the failing passes, and an `open` that answers `true` on the second or third pass comes back through this branch with `attempts` at 2 or 3. The counter is left at that value; it is only reset by the next call to `connect`.

Both occurrences of `'connected'` are string literals that TypeScript checks against the `Outcome` type, so neither `settle` nor the caller can receive a word outside the union from here. There is no third thing done in this branch: no state on the Link records that it is connected, and nothing closes or keeps the transport; a later `connect` would open again from scratch.

#### W1.5 settle detaches the callback and defers it
- The private settle method: src/link.ts (To) lines 32–38 — reached from The settle call on success (src/link.ts target 23–23)

`settle` is reached from the success branch with `'connected'` as its `outcome`, and it does two things in a deliberate order.

First it takes the function out of `onSettled` into a local `callback` and sets the field to `null`, before anything is scheduled. That is what makes the registration single-use: **the slot is already empty when the callback is arranged**, so the same registration can never fire twice, and a later `connect` on this Link reaches `settle` with an empty slot unless `whenSettled` has been called again. When the slot was already empty, the `if` guards against calling `null` and `settle` quietly does nothing; no error marks a connection that nobody asked to hear about.

Second, when there was a callback, it is not called here. `setTimeout(() => callback(outcome), 0)` hands a small closure, carrying both the function and the outcome, to the timer queue. A zero-delay timer does not mean "now": by the event loop's rules it runs in a later turn, after the current synchronous code has finished and after any pending promise continuations. So `settle` returns to `connect` with the report only queued, `connect` then returns `'connected'` as we saw in the previous step, and at that moment nothing has reached `report` yet. The next step picks up `startSession` as it resumes, still ahead of the timer.

Show more:
The local `callback` is why clearing the field is safe: the closure captures the local variable and the `outcome` argument, not the field, so nulling `onSettled` cannot pull the function out from under the scheduled timer. The handle `setTimeout` returns is discarded, so the Link has no way to cancel a report once settled.

What happens inside the timer is outside anything the Link controls. The callback runs in its own turn with no `try`/`catch` and no promise around it; if `report` threw, the exception would surface as an uncaught error in the timer, not in `connect` or `startSession`, which by then have both finished. And although `settle` is `private`, that keyword is TypeScript's compile-time check; within these files it is called from exactly two places in `connect`, the success branch seen here and the giving-up exit the second walk reaches.

#### W1.6 Back in startSession: 'connected' needs no extra report
- The await and the gave-up check in startSession: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 24–24)

`connect` has returned `'connected'`, and that return resolves the promise `startSession` was awaiting. The continuation after an `await` runs as a promise microtask: by the event loop's rules it is processed as soon as the current synchronous work is done and before any timer, so **`startSession` resumes here ahead of the callback that `settle` queued in the previous step.**

`outcome` is now `'connected'`. The only thing `startSession` does with the value is compare it with `'gave-up'`, and that comparison is false, so the `if` body is skipped and `report` is not called. The function then reaches its end, and since it is `async` and returns `Promise<void>`, its own promise resolves here with no value: the caller is told that `startSession` finished, not how the connection went.

That is the state to carry forward: `startSession` has completed, `report` has received nothing on this path, and the one message that will say "session ready" is still waiting in the timer. The next step follows that timer when it fires.

Show more:
The `if` is written for the failure case only; there is no branch for success, which is why the success path depends entirely on the callback for its message. With `Outcome` limited to two words, "not `'gave-up'`" and "`'connected'`" are the same condition here, so the code could not silently skip a third outcome; but it also means the return value of `connect` is read for one purpose and then dropped, and nothing of it reaches the caller.

The ordering also gives the reader something to notice about callers. Whoever awaits `startSession` is resumed by the same microtask mechanism, so by the rules of promises any code placed directly after `await startSession(...)` runs before `report('session ready')` does. The code allows a caller to act on a finished `startSession` while the session-ready message has not yet been delivered; no caller exists in this repository to show whether that matters.

#### W1.7 The timer fires: 'session ready'
- The callback body, now running from the timer: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)

The code here is the arrow function from the first step, but the execution context is new: it is no longer `startSession` running, which has completed and resolved its promise as we saw in the previous step, but the timer that `settle` queued. When the event loop reaches that timer it calls the closure, which calls this arrow function with the `outcome` captured at settle time, `'connected'`.

The ternary then selects its first text, and `report('session ready')` is the single call made. This is **the only message the success path produces**, and it arrives from the callback channel, not from `startSession`'s own code, which reported nothing for this outcome.

What the reader can conclude from the code, not from any observed run, is the order the walk has been building towards: by the rules of promises and timers, a caller awaiting `startSession` is resumed first, and `report('session ready')` reaches the sink after that, in a later turn. Nothing in these two files runs after this report; the walk ends here.

Show more:
The `report` the callback uses is the one passed to the `startSession` call that registered it, kept alive by the closure; the Link has no reference to the sink itself. The callback reads nothing from the Link or the transport when it runs, so a change in the Link's state between settling and firing, such as another `connect` having started, could not alter the message; only the captured `outcome` decides it.

"Later" is a lower bound rather than a fixed delay: a zero-delay timer runs no earlier than the next timer phase, and anything already queued ahead of it runs first. The same arrow function serves the failure path, where the ternary takes its other branch; the second walk arrives there with `'gave-up'`.

### W2 (walk): Every attempt fails: pauses, giving up and two reports
Purpose: How the retry loop runs out, and why the caller gets 'retrying later' before 'offline mode'.

#### W2.1 Back at the branch: open returned false
- The if with its false outcome and the pause: src/link.ts (To) lines 22–26

The walk is back at the `if` where the first walk's fourth step took the success branch, with everything before it unchanged: `startSession` registered its callback, `connect` reset and then raised `attempts` to `1`, and the first `transport.open` has answered. This time the answer is `false`: the transport resolved its promise with that value rather than throwing, so the `if` body with `settle` and `return` is skipped and execution continues below it.

**Nothing is decided here.** The Link does not record a failure, does not call `settle`, and does not return; the callback stays in its slot untouched. The only thing the loop body does after a failed attempt is `await pause(this.attempts * 100)`, which with `attempts` at `1` asks for a 100 ms wait. During that wait `connect` is suspended, and with it `startSession`'s `await` and whoever is awaiting that, so from the caller's side a failed first attempt looks exactly like an attempt still in progress.

The reader takes to the next step that `connect` is parked on this pause and will continue from whatever resolves it. The multiplier is why later pauses grow: the second failed attempt would wait 200 ms, the third 300 ms, and the third step of this walk lays out the full sequence.

Show more:
The pause sits unconditionally after the `if`, inside the loop body, not in a branch of its own. That placement means every failed attempt pays a pause before the `while` condition is re-examined, the last one included; the consequence for the total time before giving up is taken up with the loop condition in a later step.

The length comes from `this.attempts`, an instance field, at the moment the pause is requested; the number is fixed when `pause` is called, so a change to the field during the wait would not shorten or lengthen a pause already under way. Only the `false` value reaches this code: a transport whose promise rejects never arrives here, because, as noted with the loop's frame in the first walk, `connect` catches nothing.

#### W2.2 pause: a timer wrapped in a promise
- The pause helper: src/link.ts (To) lines 41–43 — reached from The awaited pause in the loop (src/link.ts target 26–26)

`pause` is the helper the loop awaited in the previous step. It is a plain function at the bottom of the module, not a method of the Link and not exported, so within this repository only `connect` can reach it. It builds one `Promise` and passes the promise's `resolve` function straight to `setTimeout` as the timer callback: when the timer fires after `ms` milliseconds, `resolve` is called with no value and the promise settles as `void`.

That is the whole mechanism of the delay. `connect` is suspended on `await pause(...)`, and **the loop's next iteration is driven by the timer**: nothing else can resolve this promise, so until the timer fires there is no further attempt, no report, and no return. When it does fire, the continuation after the `await` is queued as a microtask and `connect` picks up right after the pause expression, which brings control back to the `while` condition; the next step follows that check.

Worth noticing for the change: the helper offers no cancellation. The timer handle is discarded, the promise has no rejection path, and nothing on the Link can cut a pause short, so a caller that gives up on a connection while a pause is running still has `connect` finish its remaining attempts in the background.

Show more:
The requested `ms` is a lower bound by the rules of timers: the callback runs no earlier than that, and later if the event loop is busy. The same rule applies to the zero-delay timer `settle` uses, and the two kinds of timer are independent; a pause does not delay a report already queued.

Because `pause` is module-private and uses the global `setTimeout` directly, the only ways to make the loop faster in a test are to replace the global timer functions or to construct the Link with a smaller `maxAttempts`; no test exists in this repository that does either, and the delays are not configurable from outside this file.

#### W2.3 The loop condition after each pause
- The while condition and the counter: src/link.ts (To) lines 19–20

The pause has resolved and `connect` has reached the end of the loop body, so the walk arrives here by the loop turning over, not by a call: the `while` condition is evaluated again. As long as `attempts` is still below `maxAttempts`, the body runs once more, the counter goes up by one, and `transport.open` is awaited again exactly as in the first walk's loop frame.

With the default `maxAttempts` of `3` and a transport that always answers `false`, the loop therefore runs through this sequence:

1. `attempts` becomes 1, open fails, pause 100 ms
2. condition 1 < 3 holds; `attempts` becomes 2, open fails, pause 200 ms
3. condition 2 < 3 holds; `attempts` becomes 3, open fails, pause 300 ms
4. condition 3 < 3 fails; the loop exits

**The pause after the last failed attempt is spent before giving up.** Nothing in the body distinguishes the final attempt, so the 300 ms wait runs although no further `open` can follow it; at least 600 ms of pauses pass, plus whatever the three opens took, before the Link concludes anything. Had any of the three opens answered `true` instead, the loop would have left through the success branch of the first walk's fourth step, with the counter at that attempt's number.

Carried to the next step is the state at exit: `attempts` equals `maxAttempts`, `settle` has not been called, the callback registered by `startSession` is still in its slot, and `connect` has not returned.

Show more:
The strict `<` in the condition, together with the increment at the top of the body, is what keeps the counter from ever passing `maxAttempts`; the exit always happens with the two equal, which is why the number of attempts made is exactly the limit. For a general limit `n` the pauses add up to `100 × n(n+1)/2` ms, so the trailing pause grows with the limit as well; whether that final wait is intended or an oversight cannot be read from these files, which contain no comment or test about it.

Each turn of the loop is a fresh round through the same code, with no memory of why earlier attempts failed: the transport's `false` is not inspected further, and the loop would retry identically after an answer that meant a permanent problem as after a transient one.

#### W2.4 Giving up: settle('gave-up'), then return
- The exit after the loop: src/link.ts (To) lines 28–29 — reached from The loop condition, now false (src/link.ts target 19–19)

The `while` condition is false, so `connect` falls out of the loop onto its last two lines. They mirror the success branch of the first walk, with `'gave-up'` in place of `'connected'`: `settle('gave-up')` first, then `return 'gave-up'`.

`settle` does here what the first walk's fifth step showed: it takes the callback out of the slot, leaves the slot empty, and queues a zero-delay timer that will call the callback with `'gave-up'`. Because `settle` is synchronous and runs before the `return`, **the timer is already queued when `connect`'s promise resolves**, and the same word travels out through both channels: the callback will carry it later, the return value carries it now to `startSession`'s `await`.

From here two things are pending at once, and the next step is about which of them runs first: the continuation of `startSession`, resumed by this return, and the timer holding the callback.

Show more:
This exit and the success branch are the only two normal ways out of `connect`, and at both the word passed to `settle` is the literal returned on the next line, so the two channels cannot disagree about an outcome by construction; a rejection from the transport remains the one way out that settles nothing.

`'gave-up'` is final as far as the Link is concerned. No further timer, attempt or state change is scheduled after this point, and `attempts` stays at `maxAttempts` until a caller invokes `connect` again. What the caller then says about retrying is its own wording; the Link has stopped.

#### W2.5 Back in startSession: 'retrying later' is reported first
- The gave-up check and its report: src/session.ts (To) lines 5–8 — reached from The return that resumes the await (src/link.ts target 29–29)

`connect` has returned `'gave-up'`, and that resolves the promise `startSession` was waiting on. As in the first walk's sixth step, the continuation after the `await` runs as a promise microtask, which by the event loop's rules comes before any timer, so `startSession` resumes while the callback `settle` just queued is still waiting its turn.

This time `outcome === 'gave-up'` is true, the `if` body runs, and `report('retrying later')` is called directly, in this same microtask. `startSession` then reaches its end and its promise resolves. **The direct report wins the race by construction**: `'retrying later'` has reached the sink, and `startSession` has finished, before `'offline mode'` can be delivered from the timer.

The wording deserves a plain reading beside the code. Nothing here, and nothing left running in the Link, retries anything: the loop has ended, no timer other than the report's is pending, and the next `open` happens only if some caller invokes `connect` again. `'retrying later'` is a message sent to whoever `report` is, not an action the code takes.

The reader takes along that a second report for this same failed connection is still queued; the next step follows the timer that delivers it.

Show more:
The order between the direct report and the completion of `startSession` is also fixed: `report` is called synchronously in the continuation, so a caller resumed by `await startSession(...)` resumes after the sink has already received `'retrying later'`, and, by the same promise-before-timer rule, before it receives `'offline mode'`. What the caller does in that window is outside these files, and no caller exists in the repository to show it.

Compared with the earlier revision, this is the only place `startSession` reads the result of `connect` at all; the two-word union means this branch is exactly the complement of the success path, with no outcome that would skip both the `if` and the callback.

#### W2.6 The timer fires: 'offline mode'
- The callback body, taking the 'offline mode' branch: src/session.ts (To) lines 4–4 — reached from The timer settle scheduled (src/link.ts target 36–36)

The timer `settle` queued at the loop's exit now fires, and the context is the same as at the end of the first walk: not `startSession`, which has returned, but the timer's own turn calling the arrow function registered in the first walk's first step. This time the captured `outcome` is `'gave-up'`, the ternary takes its second branch, and `report('offline mode')` is called.

Read from the code rather than observed, the consequence for the caller is this: **one failed `connect` produces two reports through the same sink**, `'retrying later'` from `startSession` itself in the previous step and `'offline mode'` from this callback afterwards, in that order by the promise-before-timer rule. The success path, by contrast, produced a single message. Both texts are fixed inside `startSession`, and `report` receives only the string, so the sink has nothing to tell it that the two messages describe the same connection attempt.

This callback cannot run again for this registration: `settle` emptied the slot before queuing the timer, so a later `connect` on the same Link settles into nothing unless `whenSettled` is called first. Nothing in these two files runs after this report, and the walk ends here.

Show more:
The two messages say different things about the same state. `'retrying later'` was sent by code that does not retry, as the previous step noted; `'offline mode'` is sent by a callback that has no view of what the caller did in the meantime. If a caller reacted to `startSession` finishing by calling `connect` again, that second attempt could already be under way when `'offline mode'` arrives, which the code allows but nothing here coordinates.

The callback reads only its captured `outcome` and the closed-over `report`; the Link's current state at the time the timer fires, including `attempts` sitting at `maxAttempts`, plays no part in the message. Whether sending both texts is intended, or whether one of them should carry the whole failure, is not something these files decide; there is no comment, test or caller to show the intent.

### W3 (walk): What code that uses Link and startSession must now provide and expect
Purpose: The contract change for callers outside these two files, read by dependency rather than by execution.

#### W3.1 Outcome replaces connect's boolean
- The Outcome type: src/link.ts (To) lines 5–5 — reached from The type import in session.ts (src/session.ts target 1–1)

This walk reads the change by what depends on what, not by what runs. `Outcome` is a new exported type: a union of exactly two string literals, `'connected'` and `'gave-up'`. Everything that passes the verdict around names it. In the Link, `connect` now promises an `Outcome` where the earlier revision promised the transport's raw boolean; `settle` takes an `Outcome` as its parameter, which is the way the word gets from `connect` to the callback; and the callback itself is typed to receive one, both where `whenSettled` accepts it and in the `onSettled` field that stores it. In the session file, `startSession` imports the name with `import { type Outcome }`, a compile-time-only import that leaves nothing in the emitted JavaScript, and uses it for exactly one thing: annotating the parameter of the arrow function it registers, so that the ternary inside is checked against the same two words.

The union carries the same one bit of information as the old boolean, but as words, and that is what gives both channels of the previous walks something to agree on: the same word is settled and returned, and `startSession` compares against these exact spellings. TypeScript checks every literal written against the type, so a misspelt outcome inside these files would fail to compile.

**Both words are non-empty strings, and every non-empty string is truthy.** A caller written for the earlier revision that still tests `connect`'s result as a condition, `if (await link.connect(address))`, would take the true path for `'gave-up'` as well as for `'connected'`, and TypeScript does not object to a string in a boolean position. No such caller exists in this repository, but any that exists elsewhere must be read with this in mind.

Show more:
The `Transport` interface is unchanged between the revisions: `open` still answers a boolean, and that boolean now stops at the `if` inside `connect`, where it is translated into a word or into a further attempt. The transport's answer is therefore no longer part of what a caller of `Link` sees; only the Link's own verdict is.

Because the type is exported, code outside these files can name it, for example to declare its own callback for `whenSettled`; because it is a closed union, adding a third outcome later would be a change to this line that TypeScript would then flag at the ternary in `startSession` only if that code were written as an exhaustive check, which it is not: the ternary treats everything that is not `'connected'` as the offline case.

#### W3.2 Link's state and the maxAttempts option
- The fields and the constructor: src/link.ts (To) lines 8–11

In the earlier revision a `Link` held one thing, the `transport`. It now carries three more pieces of state, all `private`, that the loop and the callback mechanism of the first two walks share:

- `attempts`, a mutable counter starting at `0`, which `connect` resets and raises and which also sets the pause lengths;
- `onSettled`, the single callback slot, `null` until `whenSettled` fills it and `null` again once `settle` has taken the callback out;
- `maxAttempts`, a `readonly` limit set once at construction and compared against `attempts` by the loop condition.

`maxAttempts` arrives as a second constructor parameter with a default of `3`, written as a TypeScript parameter property, so `new Link(transport)` still compiles and behaves as before apart from the retrying, while `new Link(transport, 5)` would allow five attempts. **No code in this repository constructs a `Link`**, so the default is the only value these files can be read with; any other limit comes from a caller outside them, and nothing here validates what that caller passes.

For a reader judging the design, the important property is that `attempts` belongs to the instance, not to a call. Each `connect` starts by resetting it, which is correct for one connection at a time, but it means that two `connect` calls overlapping on the same Link write the same counter, and the slot is shared in the same way. The code permits that overlap and does nothing to prevent or detect it.

Show more:
If two connects did overlap, the second's reset would pull the first's count back to zero in the middle of its loop, so the first could make more attempts than the limit and compute shorter pauses than its own attempt number implies; and whichever call reaches `settle` first empties the shared slot, leaving the other to settle into nothing. These are consequences read from the code, not observed; the repository holds no caller or test that exercises them.

Because all three fields are `private`, a caller has no way to ask how many attempts have been made or whether a callback is pending. The limit is the only knob exposed, and only at construction: there is no setter, and `connect` takes no per-call override. A limit of `0` or below makes the loop exit before any attempt, as the first walk's loop frame noted; a non-integer such as `2.5` is accepted by the type and, with the strict `<` comparison, allows three attempts.

#### W3.3 startSession requires a report sink
- The import and the new signature: src/session.ts (To) lines 1–3

`startSession` is the one exported function of its file, and its signature is the change a caller meets first. In the earlier revision it took a `Link` and an address, awaited `connect`, and threw the boolean away; a caller got a `Promise<void>` and no word about the connection. It now takes a third parameter, `report`, typed `(text: string) => void`, and the import line brings in `Outcome` as a type alongside `Link` so that the callback it registers can be typed.

**`report` is required.** It has no default and is not optional, so every existing call with two arguments stops compiling, and every caller must decide what to do with text messages before it can use this function again. The return type is still `Promise<void>`: the outcome does not come back through the promise, so `report` is the only way a caller of `startSession` learns whether the session is ready. Within this repository there is no caller and no test of `startSession` or `Link`, so the only use of the new parameter visible here is the function body itself.

The three texts a sink can receive, `'session ready'`, `'offline mode'` and `'retrying later'`, are literals inside this function. They cannot be configured, translated or replaced by a caller; the first two walks showed which of them arrive, in which order and from which context, for a success and for a failure.

Show more:
The parameter is a bare function type rather than an interface, so anything that accepts a string fits, including a logger; but the messages are plain text with no accompanying `Outcome` or identifier, so a sink that needs to act differently on success and failure has to recognise the words themselves, and a sink shared by several sessions cannot tell which `startSession` a message came from.

Each call of `startSession` registers a fresh callback on the Link it is given, and the Link keeps only one, as the first walk's second step showed; a caller that starts two sessions on one `Link` instance therefore changes which `report` hears the first connection's outcome. `Link` is imported as a value although this file uses it only as a type; whether that import survives compilation depends on compiler settings that are not part of these files.

## Answer format
When you have checked what you need, answer with one JSON object in a ``​`json fence and nothing else:
``​`json
{
  "assessment": "A short paragraph: whether the reader can follow the course and understand what the walks show, and what decides your verdict.",
  "verdict": "accept | objections",
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
```

</details>

<details><summary>Answer</summary>

```text
I re-read the corrected steps against the code and confirmed that nothing else in the walks changed since the first visit.

``​`json
{
  "assessment": "Both findings were put right. W1.2 now says that settle both reads and clears the slot, and its Show more confines the overlapping-registration consequence to the callback channel: one callback for whichever connect settles first, into the second caller's report, while each startSession's own report('retrying later') is unaffected, which is what src/session.ts target 6–7 and src/link.ts target 33–34 show. W3.1 now inventories every use of Outcome, including settle's parameter at link.ts target 32 and the arrow's annotation at session.ts target 4 as the import's one use, and says how the word travels from connect to the callback. The rest of the walks is unchanged and was already checked: the course can be followed through startSession, the loop, the shared branch point, settle and the timer, with the microtask-before-timer ordering explained from the rules rather than asserted; every shown place is explained at the Standard level; the Show more parts deepen rather than repeat; and W3 reads the contract by dependency and says so. Nothing false and nothing significant remains, so the walks now serve this reader.",
  "verdict": "accept",
  "findings": []
}
``​`

```

</details>
