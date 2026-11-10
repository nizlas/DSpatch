# work-queue · one call · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, today's one-call preparation) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:28:24.704Z, ended 2026-11-10T02:33:38.853Z; job done: 4 walk(s) and 0 reading(s), 13 step(s). 10 changed line(s) are in none of them.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | prepare-walks | file-1 | 5 min 13 s | 24367 |

Sum of answer times: 5 min 13 s.

## The walks as written in one call

**Summary:** The change turns `WorkQueue` from a passive lookup table into a queue with its own worker thread. The read-only `find`, which returned `nullptr` for an unknown key and never added anything, is replaced by `acquire`, which creates a slot for the key on first use, marks it pending and wakes a worker thread that the constructor starts and the destructor stops. `submit` now returns the `Job` handle it gets from `acquire` instead of discarding a lookup. `Job` gains `pending` and `runs`; the worker's 'run' of a job is to clear `pending` and count one in `runs`: there is no job body in this change.

**Background:** The change ships no test, and nothing here was run; every statement below comes from reading the code.

Points a reviewer will want to weigh, each explained in its walk: the worker waits on the condition variable without a predicate, so a request made before the worker first waits is not processed until the next notification; `pending` is a flag, so several submissions of one key before the worker wakes count as one run; the handle `submit` returns exposes `pending` and `runs`, which the worker writes under a mutex the caller cannot take; `slots_` only grows, and every wakeup scans all of it under the lock.

### W1 (walk): What happens when a job is submitted

*Purpose:* Follow a submission from submit into acquire and see how a slot is created, marked pending and handed to both the worker and the caller. · *Question:* What does submit(queue, key) do now, and what does its caller get back?

- **W1.1 submit returns a job handle** — submit asks the queue to acquire the key and returns the Job it receives.
  - submit, the entry point: `src/submit.cpp` target 3–5
- **W1.2 acquire finds or creates the slot** — Under the queue's mutex, the key's slot is looked up and created on first use.
  - acquire: lookup or create: `src/work_queue.cpp` target 15–20 ← from the call in submit (`src/submit.cpp` 4–4)
- **W1.3 What a Job now carries** — Job gains a pending flag and a runs counter, written only under the queue's private mutex.
  - Job with its new fields: `src/work_queue.h` target 9–13
- **W1.4 acquire marks the slot pending and wakes the worker** — Still under the lock, pending is set, the worker is notified and the handle is returned.
  - acquire: mark, notify, return: `src/work_queue.cpp` target 21–23

### W2 (walk): How the worker thread processes pending jobs

*Purpose:* See how the constructor starts the worker, how it waits on the condition variable, and what its scan over slots_ actually does to a job. · *Question:* Who runs a pending job, when does it wake, and what does a run do?

- **W2.1 The queue's new state** — WorkQueue gains a mutex, a condition variable, a stop flag and the thread, declared in an order that matters.
  - The private members of WorkQueue: `src/work_queue.h` target 22–28
- **W2.2 The constructor starts the worker** — Constructing the thread member starts the worker before the constructor returns.
  - WorkQueue constructor: `src/work_queue.cpp` target 3–3
- **W2.3 workerLoop waits for a signal** — The worker holds the mutex except while it sleeps in cv_.wait, which has no predicate.
  - workerLoop: lock and wait: `src/work_queue.cpp` target 27–29 ← from the lambda the thread runs (`src/work_queue.cpp` 3–3)
- **W2.4 The scan: what a run does** — After each wakeup the worker walks every slot and, for each pending job, clears the flag and counts one run.
  - workerLoop: the scan over slots_: `src/work_queue.cpp` target 30–35

### W3 (walk): How destroying the queue stops the worker

*Purpose:* See how the destructor signals the worker and why both a waiting and a not-yet-waiting worker exit, so join returns. · *Question:* What happens in ~WorkQueue, and why does the worker always leave its loop?

- **W3.1 The destructor sets stopping_ and joins** — stopping_ is set under the mutex, the worker is notified, and the destructor waits for the thread to finish.
  - WorkQueue destructor: `src/work_queue.cpp` target 5–12
- **W3.2 How the worker leaves the loop** — A waiting worker wakes, scans once more and exits at the while; a worker not yet waiting never enters the wait.
  - workerLoop: the stop check and the wait: `src/work_queue.cpp` target 28–29 ← from the destructor's notify_all that wakes a waiting worker (`src/work_queue.cpp` 10–10)

### W4 (walk): What the old code did, and what callers of find lose

*Purpose:* Understand the behaviour the change replaces: a lookup that never created anything, whose result submit discarded. · *Question:* What did submit and find do before, and who is affected by removing find?

- **W4.1 The old submit was a no-op** — submit called find and threw the result away.
  - submit before the change: `src/submit.cpp` base 3–5
- **W4.2 find was a read-only lookup** — find returned the stored pointer or nullptr, and nothing ever inserted into slots_.
  - WorkQueue::find before the change: `src/work_queue.cpp` base 3–6 ← from the call in the old submit (`src/submit.cpp` 4–4)
- **W4.3 The public interface before and after** — find is removed outright; acquire, a constructor and a destructor take its place.
  - WorkQueue before: `src/work_queue.h` base 10–16
  - WorkQueue's public interface after: `src/work_queue.h` target 15–19
  - together: Seeing both class declarations side by side shows what a caller loses (find) and gains (acquire, and a lifetime tied to a thread).

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:33 UTC. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7).

### W1 (walk): What happens when a job is submitted

*Purpose:* Follow a submission from submit into acquire and see how a slot is created, marked pending and handed to both the worker and the caller.

#### W1.1 submit returns a job handle

- submit, the entry point: `src/submit.cpp` target lines 3–5

`submit` is the entry point a caller uses. It now calls `WorkQueue::acquire` and returns the `std::shared_ptr<Job>` it receives, so the caller keeps a handle to the queue's own `Job` object.

Before this change `submit` returned `void` and discarded the result of a lookup, so a call had no observable effect. Existing callers that ignored the (absent) result still compile; a caller that starts using the returned handle takes on the question of a later step in this walk: which of the handle's fields it may read, and when.

*Why:* The returned pointer is shared with the queue's worker thread, which is what makes the handle's fields a synchronisation question rather than plain data.

#### W1.2 acquire finds or creates the slot

- acquire: lookup or create: `src/work_queue.cpp` target lines 15–20 ← from the call in submit (`src/submit.cpp` 4–4)

`acquire` runs on the caller's thread and takes `mutex_` with a `std::lock_guard` for its whole body, so everything in this and the step after next happens while the worker thread cannot touch `slots_`.

`slots_[key]` is `std::map::operator[]`: for a key that is not in the map it **inserts a default entry first**, here a null `std::shared_ptr<Job>`, and returns a reference to it. `slot` is therefore a reference into the map, and `if (!slot)` is the test for 'this key is new'. Only then is a `Job` allocated with `std::make_shared` and its `key` set; a known key keeps its existing `Job`, with whatever `runs` count it has accumulated.

This is the behavioural change against the old `WorkQueue::find`: `find` only looked the key up and returned `nullptr` when it was absent, and nothing ever added a slot. After this change the first `acquire` for a key creates the slot, and no code removes slots, so `slots_` grows with the number of distinct keys ever submitted.

**Show more:**

The insertion happens before the allocation. If `std::make_shared<Job>()` throws (allocation failure), `acquire` leaves with the null entry still in `slots_`, because `operator[]` has already inserted it. The worker's scan in the next walk dereferences every entry with `job->pending` and does not check for null, so after such a failure the next wakeup reads through a null pointer. A rare path, but the code has no guard for it.

A `std::lock_guard` cannot be released early; the lock is held until `acquire` returns, including across the `notify_all` two steps on.

*Why:* A key's Job is created once and then reused for every later submission of the same key.

#### W1.3 What a Job now carries

- Job with its new fields: `src/work_queue.h` target lines 9–13

The `Job` created in the previous step has two new fields that only the queue and its worker write:

- `pending` is a **flag, not a count**: it records that at least one run has been requested since the worker last looked, so several submissions of the same key before the worker wakes collapse into one run.
- `runs` counts how many times the worker has processed the job.

`key` is written once, when the slot is created, before the pointer is ever handed out, so a holder of the handle can read it freely. `pending` and `runs` are different: the worker writes them while holding `mutex_`, and `mutex_` is a private member of `WorkQueue`, so code that holds only the `std::shared_ptr<Job>` has no way to take the same lock before reading them. Reading them from the handle while the worker may be writing is a data race in C++, not a stale read.

*Why:* Whether a caller may safely read pending or runs from the returned handle is decided outside this change, by how the caller uses it; the Job itself offers no synchronisation.

#### W1.4 acquire marks the slot pending and wakes the worker

- acquire: mark, notify, return: `src/work_queue.cpp` target lines 21–23

Still holding `mutex_`, `acquire` sets `pending` and calls `cv_.notify_all()` on the condition variable the worker waits on. Then `return slot` copies the `shared_ptr` out of the map, and the `lock_guard` releases `mutex_` as the function returns.

Two things decide what the worker sees:

- The flag is set **before** the notification and under the same mutex the worker holds when it reads `pending`, so a worker woken by this notification finds the flag set.
- A notification is not stored: `notify_all` only wakes threads that are waiting at that moment. In the next walk the worker holds `mutex_` whenever it is not waiting, so in the steady state `acquire` can only get the lock while the worker is inside its wait, and the notification reaches it. The exception is the moment before the worker has taken the lock for the first time, treated in the next walk.

Because `pending` is only ever set to `true` here, a key that is already pending is not queued twice; it stays one request.

**Show more:**

The worker leaves `cv_.wait` only after it can re-take `mutex_`, which `acquire` still holds during `notify_all` and releases on return. So the order a caller can count on is: flag set, worker signalled, lock released, worker runs. A second `acquire` for the same key that wins the mutex before the worker re-takes it only sets the flag again, which is why the worker then counts one run for two requests. Which of the two reaches the mutex first depends on scheduling, not on this code.

*Why:* The call returns as soon as the request is recorded and the worker is signalled; the run itself happens later, on the worker thread.

### W2 (walk): How the worker thread processes pending jobs

*Purpose:* See how the constructor starts the worker, how it waits on the condition variable, and what its scan over slots_ actually does to a job.

#### W2.1 The queue's new state

- The private members of WorkQueue: `src/work_queue.h` target lines 22–28

`WorkQueue` gains the parts of a one-thread worker: a private `workerLoop` the thread runs, `mutex_` guarding `slots_` and the flags, `cv_` for the worker to sleep on, `stopping_` for shutdown, and the `std::thread` itself.

The **order of these declarations matters**. C++ initialises members in declaration order, and `worker_` is last, so by the time the thread is created in the next step, `mutex_`, `cv_`, `stopping_` and `slots_` are already constructed and the thread may use them. Moving `worker_` above any of them would start the thread on members that do not exist yet.

**Show more:**

`std::mutex` and `std::condition_variable` can be neither copied nor moved, so `WorkQueue` is now implicitly non-copyable and non-movable; code that passed or stored a `WorkQueue` by value would stop compiling. `submit` takes it by reference and is unaffected.

*Why:* The declaration order is the only thing that makes starting the thread inside the constructor's initialiser list safe.

#### W2.2 The constructor starts the worker

- WorkQueue constructor: `src/work_queue.cpp` target lines 3–3

The constructor's only work is in its initialiser list: `worker_` is constructed with a lambda that captures `this` and calls `workerLoop`. Constructing a `std::thread` starts it, so the worker is running, or about to run, before the empty constructor body executes and before the constructor returns to whoever created the queue.

From this point there are two execution contexts in play. The rest of this walk follows the **worker thread** inside `workerLoop`; `acquire` from the previous walk runs on whichever thread calls `submit`.

*Why:* A WorkQueue has a live thread for its whole lifetime; the destructor in the next walk is what ends it.

#### W2.3 workerLoop waits for a signal

- workerLoop: lock and wait: `src/work_queue.cpp` target lines 27–29 ← from the lambda the thread runs (`src/work_queue.cpp` 3–3)

On the worker thread, `workerLoop` takes `mutex_` with a `std::unique_lock` and keeps it for the whole loop; `unique_lock` rather than `lock_guard` because `cv_.wait` needs to release and re-take it. `cv_.wait(lock)` releases the mutex and starts waiting as one atomic step; when another thread calls `notify_all`, the worker wakes and re-acquires the mutex before `wait` returns. **The worker holds the mutex at every moment it is not inside `wait`**, which is why, in steady state, `acquire` from the previous walk can only run while the worker is waiting, and its notification is not missed.

The wait has no predicate: nothing checks `pending` or `stopping_` before sleeping. Two consequences to weigh:

- A spurious wakeup, which the standard permits, only costs an extra scan that finds nothing; harmless.
- A notification sent before the worker first reaches `cv_.wait` is not remembered. The constructor returns while the thread may still be on its way to the lock, so an `acquire` made right after construction can set `pending` and notify an empty wait set. The worker then enters `wait` with a job already pending and does not process it until the next notification: a later `acquire`, or the destructor's `notify_all`, which triggers one more scan before the loop ends (next walk).

`while (!stopping_)` is read under the mutex before each wait; the next walk shows how shutdown relies on that.

**Show more:**

The usual form for this loop is `cv_.wait(lock, [&] { return stopping_ || <some job is pending>; })`, which re-checks the condition under the mutex before sleeping and closes the startup window above. The current code would need a way to know whether any slot is pending without scanning the map, or accept a scan on every check.

*Why:* Without a predicate, the loop's correctness rests on the lock discipline and on something eventually notifying again; the code gives no bound on how soon a job is processed.

#### W2.4 The scan: what a run does

- workerLoop: the scan over slots_: `src/work_queue.cpp` target lines 30–35

After each wakeup, still holding `mutex_`, the worker walks **every** entry in `slots_`, pending or not, and for each pending job clears `pending` and increments `runs`. That increment is the entire run: `Job` has no callable and nothing else is executed. In this change the worker is a counter of requested runs, processed in batches.

Because all pending jobs are handled in one pass under the lock, a batch is atomic with respect to `acquire`: no submission can interleave with the scan, and every job that was pending when the worker woke is counted before any new request is accepted. The cost is that the lock is held for the whole scan, and the scan is proportional to the number of distinct keys ever submitted, since slots are never removed.

After the loop the worker returns to `while (!stopping_)` and, unless stopping, waits again.

*Why:* A reviewer should decide whether a run is meant to stay a counter, and whether holding the lock across a full scan is acceptable as slots_ grows.

### W3 (walk): How destroying the queue stops the worker

*Purpose:* See how the destructor signals the worker and why both a waiting and a not-yet-waiting worker exit, so join returns.

#### W3.1 The destructor sets stopping_ and joins

- WorkQueue destructor: `src/work_queue.cpp` target lines 5–12

The destructor takes `mutex_` in an inner block just long enough to set `stopping_`, releases it, calls `cv_.notify_all()` and then `join`s the worker, so the destroying thread blocks until `workerLoop` has returned. Only after that are the members destroyed, in reverse declaration order, so the thread is gone before `cv_` and `mutex_` go away.

Setting the flag **under the mutex** is what makes the signal reliable: the worker only reads `stopping_` while it holds the same mutex, so it either sees the flag before it waits, or it is already inside `wait` and the notification wakes it. There is no gap where the worker reads `false`, then sleeps through the notification, because `cv_.wait` releases the mutex atomically with starting to wait.

Releasing the lock before `notify_all` is not needed for correctness; it lets the woken worker re-take the mutex without first waiting for the destructor to release it.

**Show more:**

If the worker is mid-scan when the destructor runs, it holds `mutex_`, so the destructor's `lock_guard` waits until the worker has finished that batch and entered `wait`; then the flag is set and the worker wakes.

The destructor assumes no other thread calls `acquire` during or after destruction; the code has nothing to defend against that, which is the normal rule for a C++ object.

*Why:* If the destructor could not guarantee that the worker exits, join would block forever and the object would never finish destroying.

#### W3.2 How the worker leaves the loop

- workerLoop: the stop check and the wait: `src/work_queue.cpp` target lines 28–29 ← from the destructor's notify_all that wakes a waiting worker (`src/work_queue.cpp` 10–10)

This is the loop head from the worker walk, read now for the stop path. The worker can be in one of two states when `stopping_` becomes true:

- **Waiting in `cv_.wait`**: the destructor's `notify_all` wakes it. It re-takes the mutex, runs one more scan over `slots_`, so jobs still pending are counted, and returns to `while (!stopping_)`, which is now false; `workerLoop` returns and the `unique_lock` releases the mutex on the way out.
- **Not yet at its first lock**, when a queue is destroyed right after construction: the notification reaches no one, but when the worker does lock the mutex it reads `stopping_ == true` at the `while` and never calls `wait`.

Checking the flag before the wait, not only after it, is what covers the second case. The predicate-less wait discussed in the worker walk does not matter here, because `stopping_` is read under the mutex on every iteration.

*Why:* Both paths end with join returning in the destructor, which is the guarantee the previous step relies on.

### W4 (walk): What the old code did, and what callers of find lose

*Purpose:* Understand the behaviour the change replaces: a lookup that never created anything, whose result submit discarded.

#### W4.1 The old submit was a no-op

- submit before the change: `src/submit.cpp` base lines 3–5

In the From revision `submit` returned nothing and called `find` only for its effects, of which there were none: the lookup result was discarded. A call to `submit` therefore had no observable effect on the queue. The To revision's `submit`, in the first step of the submission walk, is what gives the call an effect and a result.

#### W4.2 find was a read-only lookup

- WorkQueue::find before the change: `src/work_queue.cpp` base lines 3–6 ← from the call in the old submit (`src/submit.cpp` 4–4)

`find` was a read-only lookup: `slots_.find(key)` and either the stored pointer or `nullptr`. Nothing in the From revision inserted into `slots_`, so for the code shown here every call returned `nullptr`. There was no mutex because there was no second thread.

`acquire` keeps the signature's shape, a `std::shared_ptr<Job>` for a `const std::string&`, but inverts the contract: it never returns `nullptr`, and a call changes the queue.

#### W4.3 The public interface before and after

- WorkQueue before: `src/work_queue.h` base lines 10–16
- WorkQueue's public interface after: `src/work_queue.h` target lines 15–19

`find` is removed from the public interface, not deprecated, so any caller outside these files that used it will fail to compile, which makes the removal visible rather than silent. In its place come `acquire` and an explicit constructor and destructor: constructing a `WorkQueue` now starts a thread and destroying it joins one, so where a `WorkQueue` lives and for how long has become part of its behaviour, which the From revision's plain class never had.

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
- `base/` is From, commit d67bc78c5069f836803be2439e0a1d21071c0fac
- `target/` is To, commit c83ada18449297f1dcdf731b078e947f208716ae
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: work-queue
From: d67bc78c5069f836803be2439e0a1d21071c0fac (base commit)
To: c83ada18449297f1dcdf731b078e947f208716ae (target commit)
Line numbers are 1-based; "base" is From and "target" is To.

## Changed lines (machine-readable)
``​`json
[{"path":"src/submit.cpp","side":"base","start":3,"end":4},{"path":"src/work_queue.cpp","side":"base","start":3,"end":5},{"path":"src/work_queue.h","side":"base","start":12,"end":12},{"path":"src/submit.cpp","side":"target","start":3,"end":5},{"path":"src/work_queue.cpp","side":"target","start":3,"end":36},{"path":"src/work_queue.h","side":"target","start":2,"end":2},{"path":"src/work_queue.h","side":"target","start":5,"end":5},{"path":"src/work_queue.h","side":"target","start":7,"end":7},{"path":"src/work_queue.h","side":"target","start":11,"end":12},{"path":"src/work_queue.h","side":"target","start":17,"end":19},{"path":"src/work_queue.h","side":"target","start":22,"end":26},{"path":"src/work_queue.h","side":"target","start":28,"end":28}]
``​`

## Changed files
- modified src/submit.cpp
- modified src/work_queue.cpp
- modified src/work_queue.h

## Diff (orientation)
``​`diff
diff --git a/src/submit.cpp b/src/submit.cpp
index 5a1f9ea..faa9963 100644
--- a/src/submit.cpp
+++ b/src/submit.cpp
@@ -1,5 +1,6 @@
 #include "work_queue.h"
 
-void submit(WorkQueue& queue, const std::string& key) {
-  queue.find(key);
+std::shared_ptr<Job> submit(WorkQueue& queue, const std::string& key) {
+  auto job = queue.acquire(key);
+  return job;
 }
diff --git a/src/work_queue.cpp b/src/work_queue.cpp
index 71ef5b1..98b1393 100644
--- a/src/work_queue.cpp
+++ b/src/work_queue.cpp
@@ -1,6 +1,37 @@
 #include "work_queue.h"
 
-std::shared_ptr<Job> WorkQueue::find(const std::string& key) {
-  auto it = slots_.find(key);
-  return it == slots_.end() ? nullptr : it->second;
+WorkQueue::WorkQueue() : worker_([this] { workerLoop(); }) {}
+
+WorkQueue::~WorkQueue() {
+  {
+    std::lock_guard<std::mutex> lock(mutex_);
+    stopping_ = true;
+  }
+  cv_.notify_all();
+  worker_.join();
+}
+
+std::shared_ptr<Job> WorkQueue::acquire(const std::string& key) {
+  std::lock_guard<std::mutex> lock(mutex_);
+  auto& slot = slots_[key];
+  if (!slot) {
+    slot = std::make_shared<Job>();
+    slot->key = key;
+  }
+  slot->pending = true;
+  cv_.notify_all();
+  return slot;
+}
+
+void WorkQueue::workerLoop() {
+  std::unique_lock<std::mutex> lock(mutex_);
+  while (!stopping_) {
+    cv_.wait(lock);
+    for (auto& [key, job] : slots_) {
+      if (job->pending) {
+        job->pending = false;
+        job->runs += 1;
+      }
+    }
+  }
 }
diff --git a/src/work_queue.h b/src/work_queue.h
index ac1ee3a..e217e72 100644
--- a/src/work_queue.h
+++ b/src/work_queue.h
@@ -1,16 +1,29 @@
 #pragma once
+#include <condition_variable>
 #include <map>
 #include <memory>
+#include <mutex>
 #include <string>
+#include <thread>
 
 struct Job {
   std::string key;
+  bool pending = false;
+  int runs = 0;
 };
 
 class WorkQueue {
  public:
-  std::shared_ptr<Job> find(const std::string& key);
+  WorkQueue();
+  ~WorkQueue();
+  std::shared_ptr<Job> acquire(const std::string& key);
 
  private:
+  void workerLoop();
+
+  std::mutex mutex_;
+  std::condition_variable cv_;
+  bool stopping_ = false;
   std::map<std::string, std::shared_ptr<Job>> slots_;
+  std::thread worker_;
 };
``​`
```

</details>

<details><summary>Answer</summary>

```text
``​`json
{
  "summary": "The change turns `WorkQueue` from a passive lookup table into a queue with its own worker thread. The read-only `find`, which returned `nullptr` for an unknown key and never added anything, is replaced by `acquire`, which creates a slot for the key on first use, marks it pending and wakes a worker thread that the constructor starts and the destructor stops. `submit` now returns the `Job` handle it gets from `acquire` instead of discarding a lookup. `Job` gains `pending` and `runs`; the worker's 'run' of a job is to clear `pending` and count one in `runs`: there is no job body in this change.",
  "background": "The change ships no test, and nothing here was run; every statement below comes from reading the code.\n\nPoints a reviewer will want to weigh, each explained in its walk: the worker waits on the condition variable without a predicate, so a request made before the worker first waits is not processed until the next notification; `pending` is a flag, so several submissions of one key before the worker wakes count as one run; the handle `submit` returns exposes `pending` and `runs`, which the worker writes under a mutex the caller cannot take; `slots_` only grows, and every wakeup scans all of it under the lock.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when a job is submitted",
      "question": "What does submit(queue, key) do now, and what does its caller get back?",
      "purpose": "Follow a submission from submit into acquire and see how a slot is created, marked pending and handed to both the worker and the caller.",
      "steps": [
        {
          "title": "submit returns a job handle",
          "summary": "submit asks the queue to acquire the key and returns the Job it receives.",
          "body": "`submit` is the entry point a caller uses. It now calls `WorkQueue::acquire` and returns the `std::shared_ptr<Job>` it receives, so the caller keeps a handle to the queue's own `Job` object.\n\nBefore this change `submit` returned `void` and discarded the result of a lookup, so a call had no observable effect. Existing callers that ignored the (absent) result still compile; a caller that starts using the returned handle takes on the question of a later step in this walk: which of the handle's fields it may read, and when.",
          "why": "The returned pointer is shared with the queue's worker thread, which is what makes the handle's fields a synchronisation question rather than plain data.",
          "details": "",
          "places": [
            {
              "label": "submit, the entry point",
              "path": "src/submit.cpp",
              "side": "target",
              "start": 3,
              "end": 5,
              "anchor": "auto job = queue.acquire(key);"
            }
          ]
        },
        {
          "title": "acquire finds or creates the slot",
          "summary": "Under the queue's mutex, the key's slot is looked up and created on first use.",
          "body": "`acquire` runs on the caller's thread and takes `mutex_` with a `std::lock_guard` for its whole body, so everything in this and the step after next happens while the worker thread cannot touch `slots_`.\n\n`slots_[key]` is `std::map::operator[]`: for a key that is not in the map it **inserts a default entry first**, here a null `std::shared_ptr<Job>`, and returns a reference to it. `slot` is therefore a reference into the map, and `if (!slot)` is the test for 'this key is new'. Only then is a `Job` allocated with `std::make_shared` and its `key` set; a known key keeps its existing `Job`, with whatever `runs` count it has accumulated.\n\nThis is the behavioural change against the old `WorkQueue::find`: `find` only looked the key up and returned `nullptr` when it was absent, and nothing ever added a slot. After this change the first `acquire` for a key creates the slot, and no code removes slots, so `slots_` grows with the number of distinct keys ever submitted.",
          "why": "A key's Job is created once and then reused for every later submission of the same key.",
          "details": "The insertion happens before the allocation. If `std::make_shared<Job>()` throws (allocation failure), `acquire` leaves with the null entry still in `slots_`, because `operator[]` has already inserted it. The worker's scan in the next walk dereferences every entry with `job->pending` and does not check for null, so after such a failure the next wakeup reads through a null pointer. A rare path, but the code has no guard for it.\n\nA `std::lock_guard` cannot be released early; the lock is held until `acquire` returns, including across the `notify_all` two steps on.",
          "places": [
            {
              "label": "acquire: lookup or create",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 15,
              "end": 20,
              "anchor": "auto& slot = slots_[key];",
              "from": {
                "label": "the call in submit",
                "path": "src/submit.cpp",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "What a Job now carries",
          "summary": "Job gains a pending flag and a runs counter, written only under the queue's private mutex.",
          "body": "The `Job` created in the previous step has two new fields that only the queue and its worker write:\n\n- `pending` is a **flag, not a count**: it records that at least one run has been requested since the worker last looked, so several submissions of the same key before the worker wakes collapse into one run.\n- `runs` counts how many times the worker has processed the job.\n\n`key` is written once, when the slot is created, before the pointer is ever handed out, so a holder of the handle can read it freely. `pending` and `runs` are different: the worker writes them while holding `mutex_`, and `mutex_` is a private member of `WorkQueue`, so code that holds only the `std::shared_ptr<Job>` has no way to take the same lock before reading them. Reading them from the handle while the worker may be writing is a data race in C++, not a stale read.",
          "why": "Whether a caller may safely read pending or runs from the returned handle is decided outside this change, by how the caller uses it; the Job itself offers no synchronisation.",
          "details": "",
          "places": [
            {
              "label": "Job with its new fields",
              "path": "src/work_queue.h",
              "side": "target",
              "start": 9,
              "end": 13,
              "anchor": "bool pending = false;"
            }
          ]
        },
        {
          "title": "acquire marks the slot pending and wakes the worker",
          "summary": "Still under the lock, pending is set, the worker is notified and the handle is returned.",
          "body": "Still holding `mutex_`, `acquire` sets `pending` and calls `cv_.notify_all()` on the condition variable the worker waits on. Then `return slot` copies the `shared_ptr` out of the map, and the `lock_guard` releases `mutex_` as the function returns.\n\nTwo things decide what the worker sees:\n\n- The flag is set **before** the notification and under the same mutex the worker holds when it reads `pending`, so a worker woken by this notification finds the flag set.\n- A notification is not stored: `notify_all` only wakes threads that are waiting at that moment. In the next walk the worker holds `mutex_` whenever it is not waiting, so in the steady state `acquire` can only get the lock while the worker is inside its wait, and the notification reaches it. The exception is the moment before the worker has taken the lock for the first time, treated in the next walk.\n\nBecause `pending` is only ever set to `true` here, a key that is already pending is not queued twice; it stays one request.",
          "why": "The call returns as soon as the request is recorded and the worker is signalled; the run itself happens later, on the worker thread.",
          "details": "The worker leaves `cv_.wait` only after it can re-take `mutex_`, which `acquire` still holds during `notify_all` and releases on return. So the order a caller can count on is: flag set, worker signalled, lock released, worker runs. A second `acquire` for the same key that wins the mutex before the worker re-takes it only sets the flag again, which is why the worker then counts one run for two requests. Which of the two reaches the mutex first depends on scheduling, not on this code.",
          "places": [
            {
              "label": "acquire: mark, notify, return",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 21,
              "end": 23,
              "anchor": "slot->pending = true;"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How the worker thread processes pending jobs",
      "question": "Who runs a pending job, when does it wake, and what does a run do?",
      "purpose": "See how the constructor starts the worker, how it waits on the condition variable, and what its scan over slots_ actually does to a job.",
      "steps": [
        {
          "title": "The queue's new state",
          "summary": "WorkQueue gains a mutex, a condition variable, a stop flag and the thread, declared in an order that matters.",
          "body": "`WorkQueue` gains the parts of a one-thread worker: a private `workerLoop` the thread runs, `mutex_` guarding `slots_` and the flags, `cv_` for the worker to sleep on, `stopping_` for shutdown, and the `std::thread` itself.\n\nThe **order of these declarations matters**. C++ initialises members in declaration order, and `worker_` is last, so by the time the thread is created in the next step, `mutex_`, `cv_`, `stopping_` and `slots_` are already constructed and the thread may use them. Moving `worker_` above any of them would start the thread on members that do not exist yet.",
          "why": "The declaration order is the only thing that makes starting the thread inside the constructor's initialiser list safe.",
          "details": "`std::mutex` and `std::condition_variable` can be neither copied nor moved, so `WorkQueue` is now implicitly non-copyable and non-movable; code that passed or stored a `WorkQueue` by value would stop compiling. `submit` takes it by reference and is unaffected.",
          "places": [
            {
              "label": "The private members of WorkQueue",
              "path": "src/work_queue.h",
              "side": "target",
              "start": 22,
              "end": 28,
              "anchor": "std::thread worker_;"
            }
          ]
        },
        {
          "title": "The constructor starts the worker",
          "summary": "Constructing the thread member starts the worker before the constructor returns.",
          "body": "The constructor's only work is in its initialiser list: `worker_` is constructed with a lambda that captures `this` and calls `workerLoop`. Constructing a `std::thread` starts it, so the worker is running, or about to run, before the empty constructor body executes and before the constructor returns to whoever created the queue.\n\nFrom this point there are two execution contexts in play. The rest of this walk follows the **worker thread** inside `workerLoop`; `acquire` from the previous walk runs on whichever thread calls `submit`.",
          "why": "A WorkQueue has a live thread for its whole lifetime; the destructor in the next walk is what ends it.",
          "details": "",
          "places": [
            {
              "label": "WorkQueue constructor",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 3,
              "end": 3,
              "anchor": "worker_([this] { workerLoop(); })"
            }
          ]
        },
        {
          "title": "workerLoop waits for a signal",
          "summary": "The worker holds the mutex except while it sleeps in cv_.wait, which has no predicate.",
          "body": "On the worker thread, `workerLoop` takes `mutex_` with a `std::unique_lock` and keeps it for the whole loop; `unique_lock` rather than `lock_guard` because `cv_.wait` needs to release and re-take it. `cv_.wait(lock)` releases the mutex and starts waiting as one atomic step; when another thread calls `notify_all`, the worker wakes and re-acquires the mutex before `wait` returns. **The worker holds the mutex at every moment it is not inside `wait`**, which is why, in steady state, `acquire` from the previous walk can only run while the worker is waiting, and its notification is not missed.\n\nThe wait has no predicate: nothing checks `pending` or `stopping_` before sleeping. Two consequences to weigh:\n\n- A spurious wakeup, which the standard permits, only costs an extra scan that finds nothing; harmless.\n- A notification sent before the worker first reaches `cv_.wait` is not remembered. The constructor returns while the thread may still be on its way to the lock, so an `acquire` made right after construction can set `pending` and notify an empty wait set. The worker then enters `wait` with a job already pending and does not process it until the next notification: a later `acquire`, or the destructor's `notify_all`, which triggers one more scan before the loop ends (next walk).\n\n`while (!stopping_)` is read under the mutex before each wait; the next walk shows how shutdown relies on that.",
          "why": "Without a predicate, the loop's correctness rests on the lock discipline and on something eventually notifying again; the code gives no bound on how soon a job is processed.",
          "details": "The usual form for this loop is `cv_.wait(lock, [&] { return stopping_ || <some job is pending>; })`, which re-checks the condition under the mutex before sleeping and closes the startup window above. The current code would need a way to know whether any slot is pending without scanning the map, or accept a scan on every check.",
          "places": [
            {
              "label": "workerLoop: lock and wait",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 27,
              "end": 29,
              "anchor": "cv_.wait(lock);",
              "from": {
                "label": "the lambda the thread runs",
                "path": "src/work_queue.cpp",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The scan: what a run does",
          "summary": "After each wakeup the worker walks every slot and, for each pending job, clears the flag and counts one run.",
          "body": "After each wakeup, still holding `mutex_`, the worker walks **every** entry in `slots_`, pending or not, and for each pending job clears `pending` and increments `runs`. That increment is the entire run: `Job` has no callable and nothing else is executed. In this change the worker is a counter of requested runs, processed in batches.\n\nBecause all pending jobs are handled in one pass under the lock, a batch is atomic with respect to `acquire`: no submission can interleave with the scan, and every job that was pending when the worker woke is counted before any new request is accepted. The cost is that the lock is held for the whole scan, and the scan is proportional to the number of distinct keys ever submitted, since slots are never removed.\n\nAfter the loop the worker returns to `while (!stopping_)` and, unless stopping, waits again.",
          "why": "A reviewer should decide whether a run is meant to stay a counter, and whether holding the lock across a full scan is acceptable as slots_ grows.",
          "details": "",
          "places": [
            {
              "label": "workerLoop: the scan over slots_",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 30,
              "end": 35,
              "anchor": "job->runs += 1;"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How destroying the queue stops the worker",
      "question": "What happens in ~WorkQueue, and why does the worker always leave its loop?",
      "purpose": "See how the destructor signals the worker and why both a waiting and a not-yet-waiting worker exit, so join returns.",
      "steps": [
        {
          "title": "The destructor sets stopping_ and joins",
          "summary": "stopping_ is set under the mutex, the worker is notified, and the destructor waits for the thread to finish.",
          "body": "The destructor takes `mutex_` in an inner block just long enough to set `stopping_`, releases it, calls `cv_.notify_all()` and then `join`s the worker, so the destroying thread blocks until `workerLoop` has returned. Only after that are the members destroyed, in reverse declaration order, so the thread is gone before `cv_` and `mutex_` go away.\n\nSetting the flag **under the mutex** is what makes the signal reliable: the worker only reads `stopping_` while it holds the same mutex, so it either sees the flag before it waits, or it is already inside `wait` and the notification wakes it. There is no gap where the worker reads `false`, then sleeps through the notification, because `cv_.wait` releases the mutex atomically with starting to wait.\n\nReleasing the lock before `notify_all` is not needed for correctness; it lets the woken worker re-take the mutex without first waiting for the destructor to release it.",
          "why": "If the destructor could not guarantee that the worker exits, join would block forever and the object would never finish destroying.",
          "details": "If the worker is mid-scan when the destructor runs, it holds `mutex_`, so the destructor's `lock_guard` waits until the worker has finished that batch and entered `wait`; then the flag is set and the worker wakes.\n\nThe destructor assumes no other thread calls `acquire` during or after destruction; the code has nothing to defend against that, which is the normal rule for a C++ object.",
          "places": [
            {
              "label": "WorkQueue destructor",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 5,
              "end": 12,
              "anchor": "worker_.join();"
            }
          ]
        },
        {
          "title": "How the worker leaves the loop",
          "summary": "A waiting worker wakes, scans once more and exits at the while; a worker not yet waiting never enters the wait.",
          "body": "This is the loop head from the worker walk, read now for the stop path. The worker can be in one of two states when `stopping_` becomes true:\n\n- **Waiting in `cv_.wait`**: the destructor's `notify_all` wakes it. It re-takes the mutex, runs one more scan over `slots_`, so jobs still pending are counted, and returns to `while (!stopping_)`, which is now false; `workerLoop` returns and the `unique_lock` releases the mutex on the way out.\n- **Not yet at its first lock**, when a queue is destroyed right after construction: the notification reaches no one, but when the worker does lock the mutex it reads `stopping_ == true` at the `while` and never calls `wait`.\n\nChecking the flag before the wait, not only after it, is what covers the second case. The predicate-less wait discussed in the worker walk does not matter here, because `stopping_` is read under the mutex on every iteration.",
          "why": "Both paths end with join returning in the destructor, which is the guarantee the previous step relies on.",
          "details": "",
          "places": [
            {
              "label": "workerLoop: the stop check and the wait",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 28,
              "end": 29,
              "anchor": "while (!stopping_)",
              "from": {
                "label": "the destructor's notify_all that wakes a waiting worker",
                "path": "src/work_queue.cpp",
                "side": "target",
                "start": 10,
                "end": 10
              }
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What the old code did, and what callers of find lose",
      "question": "What did submit and find do before, and who is affected by removing find?",
      "purpose": "Understand the behaviour the change replaces: a lookup that never created anything, whose result submit discarded.",
      "steps": [
        {
          "title": "The old submit was a no-op",
          "summary": "submit called find and threw the result away.",
          "body": "In the From revision `submit` returned nothing and called `find` only for its effects, of which there were none: the lookup result was discarded. A call to `submit` therefore had no observable effect on the queue. The To revision's `submit`, in the first step of the submission walk, is what gives the call an effect and a result.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "submit before the change",
              "path": "src/submit.cpp",
              "side": "base",
              "start": 3,
              "end": 5,
              "anchor": "queue.find(key);"
            }
          ]
        },
        {
          "title": "find was a read-only lookup",
          "summary": "find returned the stored pointer or nullptr, and nothing ever inserted into slots_.",
          "body": "`find` was a read-only lookup: `slots_.find(key)` and either the stored pointer or `nullptr`. Nothing in the From revision inserted into `slots_`, so for the code shown here every call returned `nullptr`. There was no mutex because there was no second thread.\n\n`acquire` keeps the signature's shape, a `std::shared_ptr<Job>` for a `const std::string&`, but inverts the contract: it never returns `nullptr`, and a call changes the queue.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "WorkQueue::find before the change",
              "path": "src/work_queue.cpp",
              "side": "base",
              "start": 3,
              "end": 6,
              "anchor": "return it == slots_.end() ? nullptr : it->second;",
              "from": {
                "label": "the call in the old submit",
                "path": "src/submit.cpp",
                "side": "base",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "The public interface before and after",
          "summary": "find is removed outright; acquire, a constructor and a destructor take its place.",
          "body": "`find` is removed from the public interface, not deprecated, so any caller outside these files that used it will fail to compile, which makes the removal visible rather than silent. In its place come `acquire` and an explicit constructor and destructor: constructing a `WorkQueue` now starts a thread and destroying it joins one, so where a `WorkQueue` lives and for how long has become part of its behaviour, which the From revision's plain class never had.",
          "why": "",
          "details": "",
          "together": "Seeing both class declarations side by side shows what a caller loses (find) and gains (acquire, and a lifetime tied to a thread).",
          "places": [
            {
              "label": "WorkQueue before",
              "path": "src/work_queue.h",
              "side": "base",
              "start": 10,
              "end": 16,
              "anchor": "std::shared_ptr<Job> find(const std::string& key);"
            },
            {
              "label": "WorkQueue's public interface after",
              "path": "src/work_queue.h",
              "side": "target",
              "start": 15,
              "end": 19,
              "anchor": "std::shared_ptr<Job> acquire(const std::string& key);"
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
