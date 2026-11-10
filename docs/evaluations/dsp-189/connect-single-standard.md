# connect · one call · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, today's one-call preparation) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:21:39.640Z, ended 2026-11-10T02:26:34.690Z; job done: 3 walk(s) and 0 reading(s), 16 step(s). 8 changed line(s) are in none of them.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | prepare-walks | file-1 | 4 min 53 s | 24238 |

Sum of answer times: 4 min 53 s.

## The walks as written in one call

**Summary:** Link.connect now retries the transport: it calls transport.open up to maxAttempts times (default 3), pauses attempts × 100 ms after each failed call, and returns an Outcome, 'connected' or 'gave-up', instead of the transport's boolean. A caller can register one callback with whenSettled, which Link calls once, on a later timer tick, with the outcome. startSession gains a report callback: it registers a settled callback that reports 'session ready' or 'offline mode', awaits connect, and after 'gave-up' also reports 'retrying later'. The change contains no tests and no caller of startSession.

**Background:** The two source files are the whole material at both revisions. There are no tests and no code that constructs a Link or calls startSession, so the attempt limit in force (3) and how `report` is consumed are known only from the default and the signatures.

Two consequences of the deferred callback are worth having in mind before the walks: `startSession` resolves before the settled report arrives, and on a give-up the caller's `report` is called twice, `'retrying later'` first and `'offline mode'` second. Both follow from `settle` scheduling the callback with `setTimeout` rather than calling it. Nothing in the change schedules a later retry; `'retrying later'` is a text only.

### W1 (walk): A session start that connects on the first attempt

*Purpose:* Shows how startSession, the retry loop and the one-shot settled callback fit together on the plain success path. · *Question:* What happens from startSession to the 'session ready' report when the transport opens at once?

- **W1.1 startSession: register the report, then connect** — startSession now takes a report callback and wires it to the connection outcome before it connects.
  - The new startSession: register, then connect: `src/session.ts` target 3–4
  - The old startSession: connect and discard the result: `src/session.ts` base 3–4
  - together: The old signature beside the new one shows what a caller must now supply (report) and that the outcome is now used instead of discarded.
- **W1.2 The Outcome type** — Outcome names the two ways a series of connection attempts can end.
  - The Outcome union: `src/link.ts` target 5–5 ← from startSession's module imports Outcome as a type (`src/session.ts` 1–1)
- **W1.3 What Link now keeps between calls** — Link gains an attempt counter, a one-slot callback and a configurable attempt limit.
  - Link's fields and constructor: `src/link.ts` target 8–11
- **W1.4 whenSettled stores the callback** — The callback goes into the single onSettled slot; nothing is called yet.
  - whenSettled: `src/link.ts` target 13–15 ← from startSession registers its callback (`src/session.ts` 4–4)
- **W1.5 connect: the retry loop and its first attempt** — connect resets the counter and makes the first transport.open call inside a loop bounded by maxAttempts.
  - The new connect: counter reset and loop head: `src/link.ts` target 17–21 ← from startSession awaits connect (`src/session.ts` 5–5)
  - The old connect: one pass-through of transport.open: `src/link.ts` base 8–10
  - together: The old one-line connect beside the loop shows that retrying, the counter and the Outcome return type are all introduced here.
- **W1.6 First attempt succeeds: settle and return** — On true, connect tells the callback and returns 'connected': two separate routes for the same news.
  - The success branch in connect: `src/link.ts` target 22–25
- **W1.7 settle: take the callback out, call it later** — settle empties the slot and schedules the callback on a timer instead of calling it directly.
  - settle: `src/link.ts` target 32–38 ← from connect calls settle('connected') (`src/link.ts` 23–23)
- **W1.8 Back in startSession: resolved before the report arrives** — startSession sees 'connected', skips the 'retrying later' branch and resolves; 'session ready' is reported on the next timer tick.
  - startSession after connect returns: `src/session.ts` target 5–8

### W2 (walk): Every attempt fails: giving up and what is reported

*Purpose:* Shows the retry timing and the two reports a failed session start produces, in the order they actually arrive. · *Question:* How does connect pause, retry and give up, and what does startSession report then?

- **W2.1 Back at the branch: open returned false** — A false answer skips the success branch and pauses attempts × 100 ms before the loop re-tests the limit.
  - The failure path through the loop body: `src/link.ts` target 22–26
- **W2.2 pause: a real timer** — pause wraps setTimeout in a promise; the loop waits real wall-clock time.
  - pause: `src/link.ts` target 41–43 ← from the loop awaits pause (`src/link.ts` 26–26)
- **W2.3 Third failure: the loop ends and connect gives up** — After the third false and its 300 ms pause, attempts equals maxAttempts; connect settles and returns 'gave-up'.
  - Loop exit and give-up: `src/link.ts` target 27–29
- **W2.4 settle on the gave-up path** — The callback is handed 'gave-up' and scheduled on a timer, as on success.
  - settle: `src/link.ts` target 32–38 ← from connect calls settle('gave-up') (`src/link.ts` 28–28)
- **W2.5 startSession after a give-up: 'retrying later', then 'offline mode'** — startSession reports 'retrying later' itself and resolves; the deferred callback then reports 'offline mode'.
  - startSession's gave-up branch: `src/session.ts` target 5–8

### W3 (walk): When the transport throws instead of answering false

*Purpose:* Shows that a rejection bypasses the retry loop, the settled callback and every report. · *Question:* What happens if Transport.open rejects?

- **W3.1 No catch around transport.open** — A rejected open propagates out of connect: no retry, no pause, no settle.
  - The unguarded await of transport.open: `src/link.ts` target 21–21 ← from startSession awaits connect (`src/session.ts` 5–5)
- **W3.2 The callback stays registered** — Because settle never runs, the onSettled slot keeps the callback from this startSession call.
  - The onSettled slot: `src/link.ts` target 9–9
- **W3.3 startSession rejects without reporting** — The await rethrows; report is never called and the rejection reaches startSession's caller.
  - startSession's await and report branch: `src/session.ts` target 5–8

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:26 UTC. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7).

### W1 (walk): A session start that connects on the first attempt

*Purpose:* Shows how startSession, the retry loop and the one-shot settled callback fit together on the plain success path.

#### W1.1 startSession: register the report, then connect

- The new startSession: register, then connect: `src/session.ts` target lines 3–4
- The old startSession: connect and discard the result: `src/session.ts` base lines 3–4

`startSession` is the entry point. Compared with the old version shown beside it, it gains a third parameter, `report`, a function that receives a text for the user or a log, and it no longer discards what `connect` returns.

Two things happen, in this order:
1. It hands `Link.whenSettled` a callback that maps the `Outcome` to a text: `'session ready'` for `'connected'`, `'offline mode'` for anything else (with the current `Outcome` type that is `'gave-up'`).
2. It awaits `link.connect(address)` and keeps the result in `outcome`.

The registration comes first for a reason: `Link` only notifies a callback that is in place when the connection settles; the whenSettled step shows the slot it goes into. Notice that this function does not call `report` itself on success. The `'session ready'` text travels through the callback, on a separate route that the last step of this walk follows.

*Why:* Every caller of startSession must now pass report; no caller is in the material, so that adaptation lies outside what can be read here.

#### W1.2 The Outcome type

- The Outcome union: `src/link.ts` target lines 5–5 ← from startSession's module imports Outcome as a type (`src/session.ts` 1–1)

`Outcome` is a union of two string literals, `'connected'` and `'gave-up'`. `connect` returns it in place of the old `boolean`, and `startSession`'s module imports it as a type only (`type Outcome`), so the import exists for the compiler and leaves no runtime code.

The difference from a boolean matters for reading the rest: the names say that `'gave-up'` is the end of a **series** of attempts, not one failed open. Whether that holds is decided by the loop in `connect`, shown three steps on.

#### W1.3 What Link now keeps between calls

- Link's fields and constructor: `src/link.ts` target lines 8–11

Three pieces of state are new on `Link`:
- `attempts`: how many `transport.open` calls the current `connect` has made.
- `onSettled`: a single slot for the callback from `whenSettled`, `null` when nothing is registered.
- `maxAttempts`: a constructor parameter with the default `3`. Nothing in the material constructs a `Link` with another value, so the default is what is in force unless a caller outside the material passes one.

Only `maxAttempts` is `readonly`. `attempts` and `onSettled` are written by `connect` and `settle`, so what one `connect` call does depends on what earlier calls left behind; the following steps show who writes each of them.

#### W1.4 whenSettled stores the callback

- whenSettled: `src/link.ts` target lines 13–15 ← from startSession registers its callback (`src/session.ts` 4–4)

Reached from the first line of `startSession`. `whenSettled` only writes the callback into `onSettled`. It does not call it and it does not queue: a second `whenSettled` before the connection settles **replaces** the first callback silently.

The slot is emptied again by `settle`, shown later in this walk. That is why `startSession` registers anew on every call: a registration serves exactly one settlement.

**Show more:**

What the code allows for a caller other than startSession:
- Two `connect` calls on one `Link` after a single `whenSettled` notify the callback only for the first: `settle` clears the slot, and the second `connect` finds `null` and notifies nobody.
- A `whenSettled` made after `connect` has already settled registers a callback that nothing calls until the next `connect`.

#### W1.5 connect: the retry loop and its first attempt

- The new connect: counter reset and loop head: `src/link.ts` target lines 17–21 ← from startSession awaits connect (`src/session.ts` 5–5)
- The old connect: one pass-through of transport.open: `src/link.ts` base lines 8–10

Reached from `await link.connect(address)` in `startSession`. The old `connect`, shown beside, passed `transport.open` straight through and returned its boolean. The new one wraps the call in a `while` loop:

1. `attempts` is set to `0`, so every `connect` starts counting afresh.
2. The loop runs while `attempts < maxAttempts`; with the default of 3 that is at most three `transport.open` calls.
3. Each pass increments `attempts` **before** the call, so after the first `await this.transport.open(address)` the counter reads 1.

`open` is the transport's answer: `true` for an open connection, `false` otherwise. In this walk the first answer is `true`, and the next step follows that branch. What the loop does on `false` is the second walk's subject.

**Show more:**

`attempts` is an instance field, not a local of `connect`. Two `connect` calls that overlap in time on the same `Link` share one counter, and each increments and reads it; the code neither prevents nor handles that. With `startSession` as the only caller in the material there is one call per session start, but nothing in `Link` enforces it.

#### W1.6 First attempt succeeds: settle and return

- The success branch in connect: `src/link.ts` target lines 22–25

With `open` true, `connect` does two things with the same outcome:
- `this.settle('connected')` hands it to the registered callback; the next step shows how.
- `return 'connected'` resolves the promise `startSession` is awaiting.

These are **two routes**, and the next two steps show that they do not arrive at the same time. The loop ends here: the pause below the `if` is never reached on this path.

#### W1.7 settle: take the callback out, call it later

- settle: `src/link.ts` target lines 32–38 ← from connect calls settle('connected') (`src/link.ts` 23–23)

Reached from `this.settle('connected')` in the previous step. `settle` copies `onSettled` into a local, sets the slot to `null`, and, if there was a callback, schedules it with `setTimeout(..., 0)`.

Two things to notice:
- Emptying the slot before scheduling makes the callback **one-shot**: it cannot be called a second time for this settlement, and a later `connect` cannot reach it either.
- The call is deferred, not made here. `settle` returns at once, `connect` returns at once, and the callback runs only when the event loop reaches its timers, after every pending promise continuation. The next step shows what that means for `startSession`.

#### W1.8 Back in startSession: resolved before the report arrives

- startSession after connect returns: `src/session.ts` target lines 5–8

The `await` resumes with `outcome === 'connected'`, the `if` is skipped, and `startSession`'s own promise resolves.

The order between this and the callback follows from the event loop's rules: a promise continuation such as this `await` runs as a microtask, and microtasks drain before any timer callback runs. So **`startSession` resolves first**, and `report('session ready')` runs afterwards, from the `setTimeout` scheduled in `settle`.

For a caller that awaits `startSession` and then continues, the `'session ready'` report has not arrived at that point. The code does not wait for it, and nothing here lets a caller wait for it.

*Why:* The outcome report is not part of what awaiting startSession guarantees.

### W2 (walk): Every attempt fails: giving up and what is reported

*Purpose:* Shows the retry timing and the two reports a failed session start produces, in the order they actually arrive.

#### W2.1 Back at the branch: open returned false

- The failure path through the loop body: `src/link.ts` target lines 22–26

This walk returns to the branch point in `connect` from the first walk, now with `open` false. The `if` is skipped and the loop body continues to `await pause(this.attempts * 100)`: 100 ms after the first failure, 200 ms after the second, 300 ms after the third.

After the pause the `while` condition is tested again. `attempts` was incremented before the call, so after the first failure it reads 1, and `1 < 3` lets the loop make a second attempt.

Notice where the pause sits: after **every** failed attempt, including the last one, because nothing checks whether another attempt will follow. The third step shows what that costs.

#### W2.2 pause: a real timer

- pause: `src/link.ts` target lines 41–43 ← from the loop awaits pause (`src/link.ts` 26–26)

`pause` is a module-private helper, reached from the loop. It returns a promise that `setTimeout` resolves after `ms` milliseconds, and the `await` in `connect` suspends for that long. The delay is real time on the host's timer: the transport is not consulted during it, and nothing in the code can cut it short.

#### W2.3 Third failure: the loop ends and connect gives up

- Loop exit and give-up: `src/link.ts` target lines 27–29

After the third `false`, `attempts` is 3 and the 300 ms pause runs. Then `3 < 3` is false, the loop exits, and `connect` runs `this.settle('gave-up')` followed by `return 'gave-up'`: the same two routes as on success, with the other outcome.

The timing adds up from the code: three `transport.open` calls plus pauses of 100 + 200 + 300 ms, so a give-up takes at least 600 ms of waiting on top of the transport's own time, 300 ms of which precede no further attempt.

Also notice what does not happen here: `'gave-up'` is final for this `connect` call. Nothing in `Link` schedules a later retry; the counter is reset only by the next `connect` call.

#### W2.4 settle on the gave-up path

- settle: `src/link.ts` target lines 32–38 ← from connect calls settle('gave-up') (`src/link.ts` 28–28)

Reached from `this.settle('gave-up')`. The mechanics are those of the settle step in the first walk: the slot is emptied and the callback is deferred with `setTimeout(..., 0)`. What matters here is only the deferral: `startSession` gets its `'gave-up'` return value **before** the callback runs, and the next step shows how that orders the two reports.

#### W2.5 startSession after a give-up: 'retrying later', then 'offline mode'

- startSession's gave-up branch: `src/session.ts` target lines 5–8

The `await` resumes with `'gave-up'`, the `if` matches, and `startSession` calls `report('retrying later')` directly, then resolves.

The `'offline mode'` text comes from the callback registered on the first line, which `settle` scheduled on a timer. Promise continuations run before timer callbacks, so for one failed start the caller's `report` is called twice, in this order:
1. `'retrying later'`, from `startSession`, before it resolves;
2. `'offline mode'`, from the callback, after `startSession` has resolved.

Reading `startSession` top to bottom suggests the opposite order, since the callback is written first; the actual order comes from the deferral in `settle`, not from the source order.

The text `'retrying later'` describes an intention, not an action in this code: as the earlier steps showed, neither `Link` nor `startSession` schedules another attempt. Whatever retries must be a caller outside the material.

*Why:* A caller receives two texts for one failure, and the one that sounds final ('offline mode') arrives last.

### W3 (walk): When the transport throws instead of answering false

*Purpose:* Shows that a rejection bypasses the retry loop, the settled callback and every report.

#### W3.1 No catch around transport.open

- The unguarded await of transport.open: `src/link.ts` target lines 21–21 ← from startSession awaits connect (`src/session.ts` 5–5)

`Transport.open` returns a promise, and the interface says nothing about rejection, so a transport that rejects is possible. The `await` here has no `try`/`catch` around it: a rejection ends `connect` at this line with the same rejection. The loop does not reach the `if`, the pause or another iteration; `attempts` keeps its value; and `settle` is never called.

The retry loop therefore reacts only to a `false` **return**. A transport that signals failure by throwing gets one attempt, not three.

#### W3.2 The callback stays registered

- The onSettled slot: `src/link.ts` target lines 9–9

`onSettled` is emptied only by `settle`, which the previous step showed is not reached. The callback that `startSession` registered therefore remains in the slot after the rejection.

What the code allows from there: a later `connect` on the same `Link` that settles normally calls this old callback with its outcome, reporting `'session ready'` or `'offline mode'` through the `report` function of the earlier, failed `startSession`. A later `startSession` on the same `Link` avoids this only because its own `whenSettled` overwrites the slot first.

#### W3.3 startSession rejects without reporting

- startSession's await and report branch: `src/session.ts` target lines 5–8

In `startSession`, `await link.connect(address)` rethrows the rejection. `outcome` is never assigned, the `'retrying later'` branch is not reached, and the callback registered on the first line has nothing to fire it. The caller receives a rejected promise and no text at all through `report`.

So the three texts `'session ready'`, `'offline mode'` and `'retrying later'` cover only the outcomes `connect` returns. A transport error reaches the caller through the promise alone, and only if the caller handles rejections.

## Every prompt the product sent, whole

### Turn 1: prepare-walks (file-1)

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: prepare-walks

You prepare code walks and readings that help a person understand and review a change. You examine the code yourself with your reading tools, then answer.

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

## About the change
- "summary": a short paragraph a person reads first: what the change does and why.
- "background": only when there is more worth knowing (context, history, consequences), in short Markdown paragraphs. Leave it empty rather than repeating the summary.

## How to write (language: English)
- Write so that a developer who did not write this change understands it.
- Each step says what happens, why it happens or is needed, and what is worth noticing in the code. Give the needed context before the details.
- Use concrete language and say who does what: the user, DSpatch, the provider, or a named component.
- Explain cause and effect. Do not write that something "appears" or "happens" without saying why.
- Keep the relevant class names, methods and established terms such as inheritance and subclass. Explain them when needed instead of replacing them with vague simplifications.
- Use short paragraphs. Use bullets for alternative cases and numbering for an actual order.
- Emphasise sparingly with **bold**: only the central connection or consequence.
- Prefer plain words to advanced ones, but keep the real names of classes, methods, files and objects.
- Keep apart what the code is meant to do, your own conclusions, and test results that were actually observed. You have observed no test run here: you can read code, not run it.
- No fixed length and no template of mandatory headings: be as short as understanding allows.
- Do not narrate your investigation ("I read…", "Then I searched…"). Give the explanation, and point at the code it rests on.

## How to explain the steps (Standard)
The person reads the walks in the Standard profile. Write each step's "summary", "body", "why" and "details" for that reader. This section decides how the steps are explained, nothing else: which walks, readings, steps and places you produce, their titles, questions and purposes, and the change's own summary and background follow the sections above and stay concise, whatever the profile.
Instruction version: 7

Every explanation:
- Explain this code to a person reviewing the change, who reads your text beside the code itself. Say what the code does here and why it matters for the change, how it connects to what the reader has seen and will see, and what the reader must understand to judge it: a condition that decides the outcome, a risk, work that is only requested or reused rather than done.
- Read the code you rest on before you write: callers, types, the other code that reads or writes the same state, and what waits for or carries out what this code asks. Do not infer the architecture from names, and do not present what you have not read. The code decides, also where the prepared explanation or an earlier answer says more than the code supports; then say plainly what the code does.
- Add understanding beyond what the lines and their comments already say: do not retell statements in prose, and keep what the code shows apart from an interpretation of why it is written so. Be exact about guarantees: a lock protects only the accesses under it, a notification is not a completed hand-over, a private method is not proof that nothing else calls it. When a part cannot be read, explain the general concept and say what cannot be established about this implementation.
- Let the scope follow the code and the reader: a simple step is said in a few words in every profile, and a step where several mechanisms interact takes the room understanding needs. There is no length to hit and no required form; use a paragraph, a list or a small code excerpt where it helps, and let every sentence add understanding. Point at the code you rest on with references, so the person can open it.

Standard:
- The reader knows programming but not this code: make the central mechanism understandable, how the parts work together and why their relationship matters, from a natural entry point into what makes the behaviour understandable rather than the parts in source order. Place a project-specific name the first time it matters, and explain a language detail where the reader needs it to interpret the code; you need not teach every concept, nor add facts to be longer.

Every step is read beside its code, in the walk's order:
- The walk shows the code of each step beside its explanation: in the prose, name functions, types, variables and settings rather than file names, paths or line numbers; the references block, when one is asked for, still names files and lines.
- Write relative to the walk: "here" for this step's code, and "in the next step", "in a later step" or "as we saw earlier" only where the walk's order makes it true. A short orientation about what a later step shows is often needed, normally one sentence with a reference to that step; do not repeat that step's explanation here. What an earlier step established is recalled in a line with a reference to that step, not derived again: this step adds what is new here.
- Make a transition comprehensible where it would otherwise be unclear: what this step is reached from and what the caller needs from it; on a return, where the caller continues and what is now known; for an alternative outcome, that the walk is back at the branch point and which condition applies now; for a worker or a callback, what starts or triggers it and which execution context is being followed. When the teaching order differs from the execution order, say so. What follows from the language's or the library's rules, such as a specified order or a type, is stated as a fact; what depends on timing, scheduling or callers outside the change is stated as what the code allows, never as something observed to run.
- Write only from what the reader can see: do not refer to the prepared explanation, the instructions or other text given to you but not shown (no "the prepared summary says"); where the code contradicts it, simply say what the code does.

- "details" is the deepening the person opens with Show more, for a step with real depth to add: complementary mechanics, special cases, longer evidence, more code references, in the same manner as the explanation. Leave it empty when there is nothing to add, and do not repeat the explanation in it.

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
          "body": "The explanation in Markdown: what happens, why, what to notice in the code. Short paragraphs, bullets where they help.",
          "why": "Optional: the consequence, if it needs saying apart from the body.",
          "details": "Optional: the deepening the person opens with Show more, in Markdown. Empty when there is nothing to add.",
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
Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side; so does "from" when given. "anchor", when given, is text that occurs on those lines. DSpatch checks every place against the commit.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit 4cecb19a0d5076f6ead1dd1901c2cb9b1680e7fb
- `target/` is To, commit b80190bb07b9c62b5d72df80a5b0c035bbdd40b7
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: connect
From: 4cecb19a0d5076f6ead1dd1901c2cb9b1680e7fb (base commit)
To: b80190bb07b9c62b5d72df80a5b0c035bbdd40b7 (target commit)
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
  "summary": "Link.connect now retries the transport: it calls transport.open up to maxAttempts times (default 3), pauses attempts × 100 ms after each failed call, and returns an Outcome, 'connected' or 'gave-up', instead of the transport's boolean. A caller can register one callback with whenSettled, which Link calls once, on a later timer tick, with the outcome. startSession gains a report callback: it registers a settled callback that reports 'session ready' or 'offline mode', awaits connect, and after 'gave-up' also reports 'retrying later'. The change contains no tests and no caller of startSession.",
  "background": "The two source files are the whole material at both revisions. There are no tests and no code that constructs a Link or calls startSession, so the attempt limit in force (3) and how `report` is consumed are known only from the default and the signatures.\n\nTwo consequences of the deferred callback are worth having in mind before the walks: `startSession` resolves before the settled report arrives, and on a give-up the caller's `report` is called twice, `'retrying later'` first and `'offline mode'` second. Both follow from `settle` scheduling the callback with `setTimeout` rather than calling it. Nothing in the change schedules a later retry; `'retrying later'` is a text only.",
  "walks": [
    {
      "kind": "walk",
      "title": "A session start that connects on the first attempt",
      "question": "What happens from startSession to the 'session ready' report when the transport opens at once?",
      "purpose": "Shows how startSession, the retry loop and the one-shot settled callback fit together on the plain success path.",
      "steps": [
        {
          "title": "startSession: register the report, then connect",
          "summary": "startSession now takes a report callback and wires it to the connection outcome before it connects.",
          "body": "`startSession` is the entry point. Compared with the old version shown beside it, it gains a third parameter, `report`, a function that receives a text for the user or a log, and it no longer discards what `connect` returns.\n\nTwo things happen, in this order:\n1. It hands `Link.whenSettled` a callback that maps the `Outcome` to a text: `'session ready'` for `'connected'`, `'offline mode'` for anything else (with the current `Outcome` type that is `'gave-up'`).\n2. It awaits `link.connect(address)` and keeps the result in `outcome`.\n\nThe registration comes first for a reason: `Link` only notifies a callback that is in place when the connection settles; the whenSettled step shows the slot it goes into. Notice that this function does not call `report` itself on success. The `'session ready'` text travels through the callback, on a separate route that the last step of this walk follows.",
          "why": "Every caller of startSession must now pass report; no caller is in the material, so that adaptation lies outside what can be read here.",
          "details": "",
          "places": [
            {
              "label": "The new startSession: register, then connect",
              "path": "src/session.ts",
              "side": "target",
              "start": 3,
              "end": 4,
              "anchor": "link.whenSettled("
            },
            {
              "label": "The old startSession: connect and discard the result",
              "path": "src/session.ts",
              "side": "base",
              "start": 3,
              "end": 4,
              "anchor": "await link.connect(address);"
            }
          ],
          "together": "The old signature beside the new one shows what a caller must now supply (report) and that the outcome is now used instead of discarded."
        },
        {
          "title": "The Outcome type",
          "summary": "Outcome names the two ways a series of connection attempts can end.",
          "body": "`Outcome` is a union of two string literals, `'connected'` and `'gave-up'`. `connect` returns it in place of the old `boolean`, and `startSession`'s module imports it as a type only (`type Outcome`), so the import exists for the compiler and leaves no runtime code.\n\nThe difference from a boolean matters for reading the rest: the names say that `'gave-up'` is the end of a **series** of attempts, not one failed open. Whether that holds is decided by the loop in `connect`, shown three steps on.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The Outcome union",
              "path": "src/link.ts",
              "side": "target",
              "start": 5,
              "end": 5,
              "anchor": "export type Outcome",
              "from": {
                "label": "startSession's module imports Outcome as a type",
                "path": "src/session.ts",
                "side": "target",
                "start": 1,
                "end": 1
              }
            }
          ]
        },
        {
          "title": "What Link now keeps between calls",
          "summary": "Link gains an attempt counter, a one-slot callback and a configurable attempt limit.",
          "body": "Three pieces of state are new on `Link`:\n- `attempts`: how many `transport.open` calls the current `connect` has made.\n- `onSettled`: a single slot for the callback from `whenSettled`, `null` when nothing is registered.\n- `maxAttempts`: a constructor parameter with the default `3`. Nothing in the material constructs a `Link` with another value, so the default is what is in force unless a caller outside the material passes one.\n\nOnly `maxAttempts` is `readonly`. `attempts` and `onSettled` are written by `connect` and `settle`, so what one `connect` call does depends on what earlier calls left behind; the following steps show who writes each of them.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Link's fields and constructor",
              "path": "src/link.ts",
              "side": "target",
              "start": 8,
              "end": 11,
              "anchor": "private readonly maxAttempts = 3"
            }
          ]
        },
        {
          "title": "whenSettled stores the callback",
          "summary": "The callback goes into the single onSettled slot; nothing is called yet.",
          "body": "Reached from the first line of `startSession`. `whenSettled` only writes the callback into `onSettled`. It does not call it and it does not queue: a second `whenSettled` before the connection settles **replaces** the first callback silently.\n\nThe slot is emptied again by `settle`, shown later in this walk. That is why `startSession` registers anew on every call: a registration serves exactly one settlement.",
          "why": "",
          "details": "What the code allows for a caller other than startSession:\n- Two `connect` calls on one `Link` after a single `whenSettled` notify the callback only for the first: `settle` clears the slot, and the second `connect` finds `null` and notifies nobody.\n- A `whenSettled` made after `connect` has already settled registers a callback that nothing calls until the next `connect`.",
          "places": [
            {
              "label": "whenSettled",
              "path": "src/link.ts",
              "side": "target",
              "start": 13,
              "end": 15,
              "anchor": "this.onSettled = callback;",
              "from": {
                "label": "startSession registers its callback",
                "path": "src/session.ts",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "connect: the retry loop and its first attempt",
          "summary": "connect resets the counter and makes the first transport.open call inside a loop bounded by maxAttempts.",
          "body": "Reached from `await link.connect(address)` in `startSession`. The old `connect`, shown beside, passed `transport.open` straight through and returned its boolean. The new one wraps the call in a `while` loop:\n\n1. `attempts` is set to `0`, so every `connect` starts counting afresh.\n2. The loop runs while `attempts < maxAttempts`; with the default of 3 that is at most three `transport.open` calls.\n3. Each pass increments `attempts` **before** the call, so after the first `await this.transport.open(address)` the counter reads 1.\n\n`open` is the transport's answer: `true` for an open connection, `false` otherwise. In this walk the first answer is `true`, and the next step follows that branch. What the loop does on `false` is the second walk's subject.",
          "why": "",
          "details": "`attempts` is an instance field, not a local of `connect`. Two `connect` calls that overlap in time on the same `Link` share one counter, and each increments and reads it; the code neither prevents nor handles that. With `startSession` as the only caller in the material there is one call per session start, but nothing in `Link` enforces it.",
          "places": [
            {
              "label": "The new connect: counter reset and loop head",
              "path": "src/link.ts",
              "side": "target",
              "start": 17,
              "end": 21,
              "anchor": "while (this.attempts < this.maxAttempts)",
              "from": {
                "label": "startSession awaits connect",
                "path": "src/session.ts",
                "side": "target",
                "start": 5,
                "end": 5
              }
            },
            {
              "label": "The old connect: one pass-through of transport.open",
              "path": "src/link.ts",
              "side": "base",
              "start": 8,
              "end": 10,
              "anchor": "return this.transport.open(address);"
            }
          ],
          "together": "The old one-line connect beside the loop shows that retrying, the counter and the Outcome return type are all introduced here."
        },
        {
          "title": "First attempt succeeds: settle and return",
          "summary": "On true, connect tells the callback and returns 'connected': two separate routes for the same news.",
          "body": "With `open` true, `connect` does two things with the same outcome:\n- `this.settle('connected')` hands it to the registered callback; the next step shows how.\n- `return 'connected'` resolves the promise `startSession` is awaiting.\n\nThese are **two routes**, and the next two steps show that they do not arrive at the same time. The loop ends here: the pause below the `if` is never reached on this path.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The success branch in connect",
              "path": "src/link.ts",
              "side": "target",
              "start": 22,
              "end": 25,
              "anchor": "this.settle('connected');"
            }
          ]
        },
        {
          "title": "settle: take the callback out, call it later",
          "summary": "settle empties the slot and schedules the callback on a timer instead of calling it directly.",
          "body": "Reached from `this.settle('connected')` in the previous step. `settle` copies `onSettled` into a local, sets the slot to `null`, and, if there was a callback, schedules it with `setTimeout(..., 0)`.\n\nTwo things to notice:\n- Emptying the slot before scheduling makes the callback **one-shot**: it cannot be called a second time for this settlement, and a later `connect` cannot reach it either.\n- The call is deferred, not made here. `settle` returns at once, `connect` returns at once, and the callback runs only when the event loop reaches its timers, after every pending promise continuation. The next step shows what that means for `startSession`.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "settle",
              "path": "src/link.ts",
              "side": "target",
              "start": 32,
              "end": 38,
              "anchor": "setTimeout(() => callback(outcome), 0);",
              "from": {
                "label": "connect calls settle('connected')",
                "path": "src/link.ts",
                "side": "target",
                "start": 23,
                "end": 23
              }
            }
          ]
        },
        {
          "title": "Back in startSession: resolved before the report arrives",
          "summary": "startSession sees 'connected', skips the 'retrying later' branch and resolves; 'session ready' is reported on the next timer tick.",
          "body": "The `await` resumes with `outcome === 'connected'`, the `if` is skipped, and `startSession`'s own promise resolves.\n\nThe order between this and the callback follows from the event loop's rules: a promise continuation such as this `await` runs as a microtask, and microtasks drain before any timer callback runs. So **`startSession` resolves first**, and `report('session ready')` runs afterwards, from the `setTimeout` scheduled in `settle`.\n\nFor a caller that awaits `startSession` and then continues, the `'session ready'` report has not arrived at that point. The code does not wait for it, and nothing here lets a caller wait for it.",
          "why": "The outcome report is not part of what awaiting startSession guarantees.",
          "details": "",
          "places": [
            {
              "label": "startSession after connect returns",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "const outcome = await link.connect(address);"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "Every attempt fails: giving up and what is reported",
      "question": "How does connect pause, retry and give up, and what does startSession report then?",
      "purpose": "Shows the retry timing and the two reports a failed session start produces, in the order they actually arrive.",
      "steps": [
        {
          "title": "Back at the branch: open returned false",
          "summary": "A false answer skips the success branch and pauses attempts × 100 ms before the loop re-tests the limit.",
          "body": "This walk returns to the branch point in `connect` from the first walk, now with `open` false. The `if` is skipped and the loop body continues to `await pause(this.attempts * 100)`: 100 ms after the first failure, 200 ms after the second, 300 ms after the third.\n\nAfter the pause the `while` condition is tested again. `attempts` was incremented before the call, so after the first failure it reads 1, and `1 < 3` lets the loop make a second attempt.\n\nNotice where the pause sits: after **every** failed attempt, including the last one, because nothing checks whether another attempt will follow. The third step shows what that costs.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The failure path through the loop body",
              "path": "src/link.ts",
              "side": "target",
              "start": 22,
              "end": 26,
              "anchor": "await pause(this.attempts * 100);"
            }
          ]
        },
        {
          "title": "pause: a real timer",
          "summary": "pause wraps setTimeout in a promise; the loop waits real wall-clock time.",
          "body": "`pause` is a module-private helper, reached from the loop. It returns a promise that `setTimeout` resolves after `ms` milliseconds, and the `await` in `connect` suspends for that long. The delay is real time on the host's timer: the transport is not consulted during it, and nothing in the code can cut it short.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "pause",
              "path": "src/link.ts",
              "side": "target",
              "start": 41,
              "end": 43,
              "anchor": "function pause(ms: number)",
              "from": {
                "label": "the loop awaits pause",
                "path": "src/link.ts",
                "side": "target",
                "start": 26,
                "end": 26
              }
            }
          ]
        },
        {
          "title": "Third failure: the loop ends and connect gives up",
          "summary": "After the third false and its 300 ms pause, attempts equals maxAttempts; connect settles and returns 'gave-up'.",
          "body": "After the third `false`, `attempts` is 3 and the 300 ms pause runs. Then `3 < 3` is false, the loop exits, and `connect` runs `this.settle('gave-up')` followed by `return 'gave-up'`: the same two routes as on success, with the other outcome.\n\nThe timing adds up from the code: three `transport.open` calls plus pauses of 100 + 200 + 300 ms, so a give-up takes at least 600 ms of waiting on top of the transport's own time, 300 ms of which precede no further attempt.\n\nAlso notice what does not happen here: `'gave-up'` is final for this `connect` call. Nothing in `Link` schedules a later retry; the counter is reset only by the next `connect` call.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Loop exit and give-up",
              "path": "src/link.ts",
              "side": "target",
              "start": 27,
              "end": 29,
              "anchor": "this.settle('gave-up');"
            }
          ]
        },
        {
          "title": "settle on the gave-up path",
          "summary": "The callback is handed 'gave-up' and scheduled on a timer, as on success.",
          "body": "Reached from `this.settle('gave-up')`. The mechanics are those of the settle step in the first walk: the slot is emptied and the callback is deferred with `setTimeout(..., 0)`. What matters here is only the deferral: `startSession` gets its `'gave-up'` return value **before** the callback runs, and the next step shows how that orders the two reports.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "settle",
              "path": "src/link.ts",
              "side": "target",
              "start": 32,
              "end": 38,
              "anchor": "this.onSettled = null;",
              "from": {
                "label": "connect calls settle('gave-up')",
                "path": "src/link.ts",
                "side": "target",
                "start": 28,
                "end": 28
              }
            }
          ]
        },
        {
          "title": "startSession after a give-up: 'retrying later', then 'offline mode'",
          "summary": "startSession reports 'retrying later' itself and resolves; the deferred callback then reports 'offline mode'.",
          "body": "The `await` resumes with `'gave-up'`, the `if` matches, and `startSession` calls `report('retrying later')` directly, then resolves.\n\nThe `'offline mode'` text comes from the callback registered on the first line, which `settle` scheduled on a timer. Promise continuations run before timer callbacks, so for one failed start the caller's `report` is called twice, in this order:\n1. `'retrying later'`, from `startSession`, before it resolves;\n2. `'offline mode'`, from the callback, after `startSession` has resolved.\n\nReading `startSession` top to bottom suggests the opposite order, since the callback is written first; the actual order comes from the deferral in `settle`, not from the source order.\n\nThe text `'retrying later'` describes an intention, not an action in this code: as the earlier steps showed, neither `Link` nor `startSession` schedules another attempt. Whatever retries must be a caller outside the material.",
          "why": "A caller receives two texts for one failure, and the one that sounds final ('offline mode') arrives last.",
          "details": "",
          "places": [
            {
              "label": "startSession's gave-up branch",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "report('retrying later');"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "When the transport throws instead of answering false",
      "question": "What happens if Transport.open rejects?",
      "purpose": "Shows that a rejection bypasses the retry loop, the settled callback and every report.",
      "steps": [
        {
          "title": "No catch around transport.open",
          "summary": "A rejected open propagates out of connect: no retry, no pause, no settle.",
          "body": "`Transport.open` returns a promise, and the interface says nothing about rejection, so a transport that rejects is possible. The `await` here has no `try`/`catch` around it: a rejection ends `connect` at this line with the same rejection. The loop does not reach the `if`, the pause or another iteration; `attempts` keeps its value; and `settle` is never called.\n\nThe retry loop therefore reacts only to a `false` **return**. A transport that signals failure by throwing gets one attempt, not three.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The unguarded await of transport.open",
              "path": "src/link.ts",
              "side": "target",
              "start": 21,
              "end": 21,
              "anchor": "await this.transport.open(address)",
              "from": {
                "label": "startSession awaits connect",
                "path": "src/session.ts",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "The callback stays registered",
          "summary": "Because settle never runs, the onSettled slot keeps the callback from this startSession call.",
          "body": "`onSettled` is emptied only by `settle`, which the previous step showed is not reached. The callback that `startSession` registered therefore remains in the slot after the rejection.\n\nWhat the code allows from there: a later `connect` on the same `Link` that settles normally calls this old callback with its outcome, reporting `'session ready'` or `'offline mode'` through the `report` function of the earlier, failed `startSession`. A later `startSession` on the same `Link` avoids this only because its own `whenSettled` overwrites the slot first.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The onSettled slot",
              "path": "src/link.ts",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "private onSettled"
            }
          ]
        },
        {
          "title": "startSession rejects without reporting",
          "summary": "The await rethrows; report is never called and the rejection reaches startSession's caller.",
          "body": "In `startSession`, `await link.connect(address)` rethrows the rejection. `outcome` is never assigned, the `'retrying later'` branch is not reached, and the callback registered on the first line has nothing to fire it. The caller receives a rejected promise and no text at all through `report`.\n\nSo the three texts `'session ready'`, `'offline mode'` and `'retrying later'` cover only the outcomes `connect` returns. A transport error reaches the caller through the promise alone, and only if the caller handles rejections.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "startSession's await and report branch",
              "path": "src/session.ts",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "if (outcome === 'gave-up')"
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
