# work-queue · planner, writer and reviewer · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, the walk loop drawing, its roles, the run engine and the run record) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:26:11.782Z, ended 2026-11-10T02:43:19.037Z; job done: 3 walk(s) and 0 reading(s), 15 step(s). 8 changed line(s) are in none of them. The reviewer accepted the walks at once.

Loop: status **delivered**, path plan → write → review → delivered; correction rounds 0; 17 provider turns; 17 min 7 s in all; usage not reported (unknown). Graph dspatch-walk-loop graph-8e84007492c1b56f; roles walk-planner, walk-writer, walk-reviewer.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | plan-walks | file-1 | 4 min 9 s | 18183 |
| 2 | write-step | file-2 | 46 s | 2450 |
| 3 | write-step | file-2 | 40 s | 3445 |
| 4 | write-step | file-2 | 38 s | 3202 |
| 5 | write-step | file-2 | 38 s | 3239 |
| 6 | write-step | file-2 | 36 s | 3344 |
| 7 | write-step | file-2 | 44 s | 3878 |
| 8 | write-step | file-2 | 36 s | 3017 |
| 9 | write-step | file-2 | 46 s | 3508 |
| 10 | write-step | file-2 | 36 s | 2908 |
| 11 | write-step | file-2 | 38 s | 3528 |
| 12 | write-step | file-2 | 36 s | 3304 |
| 13 | write-step | file-2 | 42 s | 3449 |
| 14 | write-step | file-2 | 36 s | 3454 |
| 15 | write-step | file-2 | 34 s | 2175 |
| 16 | write-step | file-2 | 32 s | 2713 |
| 17 | review-walks | file-3 | 3 min 17 s | 2610 |

Sum of answer times: 17 min 4 s.

## The plan (the planner's first answer)

**Summary:** The change turns WorkQueue from a passive lookup table into a queue with a background worker. Before, submit called find, which returned the existing Job for a key or nullptr and never created one, and submit threw the result away. Now WorkQueue starts a worker thread in its constructor; acquire creates a Job for an unknown key or reuses the existing one, marks it pending, notifies the worker through a condition variable and returns the shared handle, which submit now passes back to its caller. The worker loop sleeps on the condition variable under the queue's mutex and, on every wake-up, scans all slots, clears each pending flag and counts a run; the destructor sets a stop flag, wakes the worker and joins it. Job gains the pending flag and runs counter that the submitting thread and the worker use to hand work over.

**Background:** Both revisions hold only these three files: there are no tests, build files, documentation or other callers of WorkQueue, so the walks follow submit as the only entry point and the constructor and destructor as the worker's lifecycle.

In this revision the worker's whole effect on a pending job is to clear the flag and increment runs; nothing else is executed for a job. The queue's mutex is a private member, and Job itself carries no synchronisation, so the handle submit returns is shared with the worker thread without a lock the caller could take.

### W1 (walk): What happens when a caller submits a key

*Purpose:* Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding. · *Question:* How does a submitted key become a pending job, who processes it, and what does the caller get back?

- **W1.1 submit returns the job it acquires** — submit asks the queue to acquire the key and returns the Job handle to its caller.
  - submit in the new revision: `src/submit.cpp` target 3–6
  - brief: Entry point of the walk, on the caller's thread. Make clear that submit no longer discards the result: it returns the shared_ptr<Job> that acquire produces, so the caller keeps a handle on the slot. The reader takes to the next step that everything of interest happens inside acquire.
- **W1.2 acquire locks the queue and finds or creates the slot** — Under mutex_, slots_[key] yields the existing slot or a fresh empty one, which is then filled with a new Job.
  - acquire: lock, lookup and creation: `src/work_queue.cpp` target 14–20 ← from the call in submit (`src/submit.cpp` 4–4)
  - brief: Reached by the call in submit. Make comprehensible that the lock_guard holds mutex_ for the whole function, that std::map::operator[] inserts a null shared_ptr when the key is new, and that the if (!slot) branch is where a Job is created and given its key. Follow the new-key outcome first; the existing-slot outcome is a path of its own later in this walk. The reader takes the slot reference to the Job type next.
- **W1.3 What a Job carries between submitter and worker** — Job gains a pending flag and a runs counter beside its key.
  - the Job struct: `src/work_queue.h` target 9–13
  - brief: A type dependency, not a call: the reader needs the two new fields before seeing them set. Make clear that pending is the request the submitter raises and the worker clears, that runs is the count the worker increments, and that Job itself holds no lock; the queue's mutex_ is what protects these fields while the queue touches them. The reader takes this to the step where acquire sets pending.
- **W1.4 The job is marked pending, the worker notified, the handle returned** — acquire sets pending, calls cv_.notify_all while still holding the lock, and returns the shared slot.
  - acquire: mark, notify, return: `src/work_queue.cpp` target 21–23
  - brief: Back in acquire once the slot holds a Job. Make comprehensible that pending = true is the handover, that notify_all is issued while mutex_ is still held and the lock is released only when the lock_guard is destroyed at the return, and that the returned shared_ptr is the very object the worker will mutate. The reader takes to the next step that this notification is what wakes the worker thread.
- **W1.5 The worker wakes and processes every pending job** — On the worker thread, cv_.wait returns, the loop scans all slots and turns each pending flag into a counted run.
  - workerLoop: wake-up and scan: `src/work_queue.cpp` target 29–35
  - brief: A change of context: this code runs on the worker thread started in the constructor (see the walk 'How the worker thread starts, waits and stops'), which has been blocked in cv_.wait with mutex_ released. The notification from the previous step wakes it once acquire has released the lock, and wait reacquires mutex_ before returning. Make clear that the scan visits every slot, not only the submitted key, that the worker's whole effect on a job is pending = false and runs += 1, and that nothing else runs for a job in this revision. The reader takes to the next step that the caller meanwhile holds the same Job.
- **W1.6 Back on the caller's thread: what the returned handle shares** — The caller holds the same Job the worker writes to, and the only lock guarding its fields is private to the queue.
  - the handle leaving submit: `src/submit.cpp` target 4–5
  - the queue's private lock: `src/work_queue.h` target 21–24
  - together: Seeing the handle leave the queue beside the private mutex that guards its fields shows at once that a caller cannot take that lock.
  - revisit: Step 1 showed submit as the entry point; now the point is the handle the caller keeps, which the worker thread writes to concurrently.
  - brief: Return to the caller's thread after submit has returned. The point now is the handle the caller is left with: the worker writes pending and runs under mutex_, mutex_ is a private member of WorkQueue, and Job carries no synchronisation of its own. This is where the reader judges what a caller may read from the handle and when; state what the code offers and leave the verdict to the reader.
- **W1.7 Back at the branch: the key already has a slot** — When slots_[key] returns a non-null slot, acquire skips creation and marks the existing Job pending again.
  - acquire: the existing-slot outcome: `src/work_queue.cpp` target 16–21
  - revisit: Shown in step 2 for the new-key outcome; now the existing-slot outcome, where the branch is skipped and pending is raised on a Job that already exists.
  - brief: An alternative outcome, starting again at the if (!slot) test of step 2: this time the key was acquired before, so operator[] returns the existing shared_ptr and the branch is not taken. Make clear that the same Job object is reused and pending is set again; if the worker has not scanned since the earlier submission, pending is already true and the two submissions become one run, and if it has, the job is counted a second time. The reader takes to the next path that timing against the worker decides what a submission counts for.
- **W1.8 Back at the handover: the worker is not yet waiting** — If acquire notifies before the worker thread has reached cv_.wait, nobody is waiting and the job stays pending until the next notification.
  - workerLoop: entering the wait: `src/work_queue.cpp` target 27–29
  - revisit: Step 5 showed the wait returning; now the entry into the wait, and what a notification sent before it means.
  - brief: A second alternative, in timing rather than data, starting again at the notify of step 4. The worker thread must first take mutex_ at line 27, check stopping_ and enter cv_.wait at line 29; if acquire holds the lock before the worker gets there, notify_all finds no waiter, and the wait has no predicate that would look at pending afterwards. Make clear from the code what then wakes the worker: a later acquire, or the destructor's notify, after which the loop scans once more before it exits (see the lifecycle walk). Say what the code does, not whether it is intended.

### W2 (walk): How the worker thread starts, waits and stops

*Purpose:* Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe. · *Question:* When does the worker thread run, what does it wait on, and how does a WorkQueue shut it down?

- **W2.1 The constructor starts the worker thread** — WorkQueue's constructor launches worker_ with a lambda that calls workerLoop on this.
  - the constructor: `src/work_queue.cpp` target 3–3
  - brief: Entry: constructing a WorkQueue. Make comprehensible that the thread starts inside the member initializer list, that the lambda captures this and runs workerLoop on the new thread, and that from this moment the queue is used from two threads. The reader takes to the next step the question of what already exists when that thread starts.
- **W2.2 Member order decides what the worker may use** — worker_ is declared last, after mutex_, cv_, stopping_ and slots_, so they are constructed before the thread runs.
  - the WorkQueue class: `src/work_queue.h` target 15–29
  - brief: A declaration the previous step depends on: members are constructed in declaration order, so the position of worker_ at the end of the class is what lets the lambda touch the other members safely. Also show the shape of the class: the public surface is the constructor, destructor and acquire; workerLoop and every data member are private. The reader takes this to the loop itself.
- **W2.3 The worker loop takes the lock and waits** — On the worker thread, workerLoop locks mutex_ and, while stopping_ is false, blocks in cv_.wait, which releases the lock while waiting.
  - workerLoop: lock and wait: `src/work_queue.cpp` target 26–29
  - brief: Context: the worker thread, running the lambda from step 1. Make comprehensible that the unique_lock is held for the whole loop except inside wait, that wait has no predicate so the loop relies on being notified, that a spurious or unrelated wake-up only leads to a scan, and that the scan after each wake-up is what step 5 of the submit walk showed. The reader takes to the next step that only stopping_ ends the loop.
- **W2.4 The destructor asks the worker to stop and joins it** — ~WorkQueue sets stopping_ under the lock, notifies the condition variable, and joins the thread before the members are destroyed.
  - the destructor: `src/work_queue.cpp` target 5–12
  - brief: Entry of the shutdown path, on the thread that destroys the queue. Make clear why stopping_ is set inside its own block so the lock is released before notify_all and join, that join blocks until workerLoop returns, and that the data members are destroyed only after that. The reader takes to the next step how the worker observes the flag.
- **W2.5 Back in the worker: the stop is seen after one more scan** — The notified worker wakes, scans the slots once more, then finds stopping_ true and leaves the loop, ending the thread.
  - workerLoop: the exit: `src/work_queue.cpp` target 28–37
  - revisit: Step 3 showed the loop entering the wait; now the exit: the last scan and the loop condition that fails.
  - brief: Context: the worker thread again, woken by the destructor's notify. Make comprehensible that wait returns with the lock held, that the scan still runs so pending jobs are counted one last time, that the while condition then fails and workerLoop returns, ending the lambda so join in the destructor returns. Also show the other ordering the code allows: if the worker had not yet reached wait when stopping_ was set, it finds the flag true at its first check and never waits.

### W3 (walk): What the old submit did, and what is gone

*Purpose:* Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before. · *Question:* What did submit and find do before the change, and which behaviour was removed?

- **W3.1 The old submit discarded the lookup** — In the base revision, submit called queue.find(key) and returned nothing.
  - submit in the base revision: `src/submit.cpp` base 3–5
  - brief: Entry of the old path, read on the From side. Make clear that submit returned void and dropped the result of find, so a caller learned nothing from submitting. Its replacement is step 1 of the walk 'What happens when a caller submits a key'. The reader takes to the next step what find did.
- **W3.2 find looked up without creating** — find returned the existing Job for a key, or nullptr, and never inserted a slot or involved a thread.
  - find in the base revision: `src/work_queue.cpp` base 3–6 ← from the call in the old submit (`src/submit.cpp` 4–4)
  - brief: Reached from the call in the old submit. Make comprehensible that std::map::find does not insert, that an unknown key yielded nullptr, and that there was no mutex, no worker and no pending state in this revision. Its replacement, acquire, is explained in the submit walk; contrast it briefly rather than re-explaining it here.

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:43 UTC, through the planner, writer and reviewer loop. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7). The planner planned the walks, the writer explained each step in its own call, and the reviewer judged them against the code and accepted them without a correction round. The reviewer is an agent: its acceptance approves nothing of the code.

### W1 (walk): What happens when a caller submits a key

*Purpose:* Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.

#### W1.1 submit returns the job it acquires

- submit in the new revision: `src/submit.cpp` target lines 3–6

`submit` is where a caller hands a key to the queue, and in this revision it is a pure forwarding function: it calls `WorkQueue::acquire` with the key and returns what `acquire` returns, a `std::shared_ptr<Job>`. Nothing else happens on the caller's thread here. No lock is taken, nothing is checked, and the local `job` is only a name for the value on its way out, so the correctness of `submit` is the correctness of `acquire`.

What matters for the change is the return value. Before the change `submit` returned `void` and dropped the result of a lookup, so a caller learnt nothing from submitting. Now **the caller keeps a handle to the queue's own `Job` object**: the same object the queue stores in its slot and that the worker thread later writes to. Whether that `Job` is created fresh or reused from an earlier submission, and how the worker is told about it, is decided inside `acquire`, which the next step opens.

Two things are worth holding on to for the rest of the walk. `std::shared_ptr` means shared ownership, not a copy: the caller and the queue refer to one `Job`. And `submit` gives the caller no rule about when the fields of that `Job` may be read; that question is taken up in a later step (W1.6), once the worker's side has been seen.

References: `submit` at src/submit.cpp (target) lines 3–6; the call it forwards to, `WorkQueue::acquire`, declared at src/work_queue.h (target) line 19.

**Show more:**

The handle's lifetime follows from how `acquire` stores it: the queue keeps its own `std::shared_ptr` in `slots_` (src/work_queue.cpp (target) lines 16–23) and returns a copy, so the `Job` lives as long as either the slot or any caller's copy exists. Nothing in this revision erases a slot, so in practice the queue's copy keeps every `Job` alive for the queue's whole life; a caller's handle therefore never dangles, but it also never becomes the only owner while the queue exists.

Who calls `submit` is not visible in these files. No header declares it in either revision (src/work_queue.h (target) declares only `WorkQueue` and `Job`), and no file here calls it, so a caller in another translation unit would need its own declaration, and whether such a caller uses the returned handle or discards it cannot be read from this change. The signature allows both: a caller that ignores the return gets the old fire-and-forget shape of `submit`, but now with a slot created and a worker notified behind it.

#### W1.2 acquire locks the queue and finds or creates the slot

- acquire: lock, lookup and creation: `src/work_queue.cpp` target lines 14–20 ← from the call in submit (`src/submit.cpp` 4–4)

We are inside `WorkQueue::acquire`, still on the caller's thread, reached by the call that `submit` forwards (step W1.1). The first line takes the queue's lock: `std::lock_guard` locks `mutex_` when it is constructed and unlocks it only when it goes out of scope, which here is the end of the function. So **everything `acquire` does, including the marking and notification of a later step (W1.4), runs with `mutex_` held**, and the worker thread, which takes the same `mutex_` when it scans, can never be in the middle of a scan while this code runs.

The lookup and the creation are folded into one expression. `slots_[key]` is `std::map::operator[]`, and that operator does two things: it finds the entry for `key`, and if there is none it inserts one, default-constructed, and returns it. The mapped type is `std::shared_ptr<Job>`, whose default is a null pointer. `auto& slot` binds a reference to that entry inside the map, not a copy, so whatever is assigned to `slot` is what the map holds afterwards.

That is what the `if (!slot)` test is for. Following the new-key outcome first: the key has not been seen, `operator[]` has just inserted a null entry, the test is true, and the branch creates the `Job` with `std::make_shared<Job>()` and stores it through the reference into the slot, then writes the key into the `Job` itself. After the branch the slot holds a live `Job` whose `key` matches the map's key; the other fields take the defaults given in the `Job` type, which the next step shows. The other outcome, where the entry already held a `Job` and the branch is skipped, is a path of its own later in this walk (W1.7).

Worth noticing for the review: there is no lookup-without-insert here. Every distinct key passed to `acquire` leaves an entry in `slots_`, and nothing in this revision removes one, so the map only grows.

References: `acquire` at src/work_queue.cpp (target) lines 14–20; `mutex_` and `slots_` declared at src/work_queue.h (target) lines 24 and 27.

**Show more:**

The lock matters for the map as a container, not only for the `Job` fields. The worker loop iterates `slots_` with a range-for (src/work_queue.cpp (target) lines 30–35) while it holds `mutex_`, and `operator[]` here may insert a node while `acquire` holds it; because both sides take the same lock, an insertion can never happen during an iteration. A `std::map` is node-based, so inserting other keys does not invalidate the `slot` reference either, but inside this function that question does not arise: the reference is used only under the lock that excludes every other writer.

One case the code allows but does not handle, an observation from reading: `std::make_shared<Job>()` allocates, and if that allocation throws, the entry that `operator[]` already inserted stays in `slots_` as a null pointer, since the exception leaves the function before the assignment. The worker's scan dereferences every entry with `job->pending` without a null check, so a null slot left behind this way would be read as a `Job` on the next wake-up. Whether this is reachable in practice depends on the allocator and the caller's environment, which cannot be read from these files.

The key is stored twice, as the map's key and as `Job::key`, and `acquire` is the only place that writes the second copy. Nothing in this revision reads `Job::key` back, so the copy exists for whoever holds the returned handle rather than for the queue itself.

#### W1.3 What a Job carries between submitter and worker

- the Job struct: `src/work_queue.h` target lines 9–13

A short pause in the execution order: before `acquire` goes on to mark the `Job` it just created (step W1.2), here is the type it created. `Job` is a plain struct with public fields and no methods, no constructor and no lock. In the earlier revision it held only `key`; the change adds two fields, and they are the whole of what passes between the submitting thread and the worker.

- `pending` is a request flag. `acquire` sets it to `true` on the caller's thread (next step), and the worker sets it back to `false` when it processes the job (W1.5). It is a flag, not a counter: it says "there is a request outstanding", and setting it when it is already set changes nothing, which is what a repeated submission comes down to in a later step (W1.7).
- `runs` is a tally that only the worker touches: it is incremented by one each time the worker finds `pending` set. Nothing in this revision resets it, and nothing in these files reads it.

Both have default initialisers, `false` and `0`, so the `std::make_shared<Job>()` in `acquire` yields a job that is not yet pending and has never run; `acquire` then writes `key` and, in the next step, `pending`.

What the reader must hold on to is what this type does not provide. **`Job` carries no synchronisation of its own**: `pending` and `runs` are an ordinary `bool` and `int`. Every write to them in this revision happens while the queue holds its `mutex_`, in `acquire` and in `workerLoop`, and that lock is what makes those accesses safe against each other. The lock belongs to the queue, not to the `Job`, which is the point a later step returns to when it asks what a holder of the returned handle may read (W1.6).

References: `Job` at src/work_queue.h (target) lines 9–13; the writers of its fields are `acquire` at src/work_queue.cpp (target) lines 19–21 and `workerLoop` at lines 31–33.

**Show more:**

The consequence of plain fields is a rule of the language, not a matter of style: under the C++ memory model, one thread writing a non-atomic `bool` or `int` while another thread reads or writes it, with no lock or atomic ordering between them, is a data race and undefined behaviour. Inside the queue that race does not exist, because `acquire` and the worker's scan both run under `mutex_`. The type itself establishes nothing: an access from any code that holds the `std::shared_ptr<Job>` but not the lock is unordered against the worker's writes, and `Job` offers no way to take that lock or to read the fields atomically.

The fields are also public and mutable from anywhere a handle reaches. The queue is the only writer in these files, but the type does not reserve the writes to it; a holder of the handle can set `pending` or change `runs` without the queue noticing, and the worker would act on whatever it finds under the lock.

One limit of the two fields together, an observation from reading: they record whether a request is outstanding and how many times the worker has counted the job, but not how many times it was submitted. A job submitted twice before the worker scanned and a job submitted once both end as `pending == false`, `runs == 1`; the history of submissions is not kept anywhere in this revision.

#### W1.4 The job is marked pending, the worker notified, the handle returned

- acquire: mark, notify, return: `src/work_queue.cpp` target lines 21–23

Back in `acquire`, with `mutex_` still held from its first line and `slot` now holding a `Job` (step W1.2), three lines complete the caller's side of the hand-over.

`slot->pending = true` is the hand-over itself. It is the only thing the submitting thread records about its request: no queue entry, no task object, just the flag from the previous step raised on the `Job`. It is written under the lock, so when the worker later reads it under the same lock, it sees this write.

`cv_.notify_all()` tells whoever is blocked in `cv_.wait` on the queue's condition variable to wake. Two things about it decide what the reader can expect. First, it is issued **while `mutex_` is still held**: `lock_guard` releases the mutex only when `acquire` returns, and a thread woken from `cv_.wait` must reacquire that mutex before `wait` returns, so the worker cannot start its scan until this function has finished. Second, a notification is a signal, not a delivery: it reaches only a thread that is waiting at that moment and is otherwise simply dropped. The flag stays set either way, but the worker's `wait` has no condition that would look at it later; what then wakes the worker is the subject of a later step (W1.8).

`return slot` copies the `std::shared_ptr` out of the map entry; the language constructs the return value before the local `lock_guard` is destroyed, so the copy is made under the lock and the mutex is released only after it. What leaves is a second owner of **the very `Job` object the worker is about to write to**. From the instant the lock is released, the worker may wake, take the lock and turn this `pending` into a counted run, so by the time `submit` hands the pointer to its caller the job may already be in either state.

References: src/work_queue.cpp (target) lines 21–23; the waiting side, `cv_.wait` in `workerLoop`, at line 29.

**Show more:**

Ordering of the two threads from here, as the code allows it when the worker is already waiting: the worker's `wait` is woken by the notify but blocks inside `wait` on `mutex_`; `acquire` constructs its return value, destroys the `lock_guard`, and releases the mutex; the worker's `wait` returns with the mutex held and the scan of the next step begins. The write of `pending` and the worker's read of it are therefore ordered by the mutex, which is what makes a plain `bool` adequate here. Notifying under the lock costs a possible wake-then-block on the worker side; it does not change what the worker observes. The destructor takes the other choice, releasing the lock before it notifies (walk W2, step 4), and the two orders are both correct uses of a condition variable.

`notify_all` rather than `notify_one` makes no difference in this revision: `worker_` is the only thread that ever waits on `cv_`, and nothing in these files creates another. The choice would matter only if more waiters were added.

The copy made by `return slot` means the reference count of the `Job` rises to at least two, the map's and the caller's, under the lock; the caller's copy is then handed on by `submit` unchanged. No field of the `Job` other than `pending` is written on this path, so for a reused slot (W1.7) `runs` keeps whatever count the worker had reached.

#### W1.5 The worker wakes and processes every pending job

- workerLoop: wake-up and scan: `src/work_queue.cpp` target lines 29–35

A change of thread. This code runs on the worker thread that the `WorkQueue` constructor starts (walk W2 explains its lifetime); until now that thread has been blocked inside `cv_.wait(lock)`, with `mutex_` released for the duration of the wait. The `notify_all` of the previous step wakes it, and `wait` does not return until it has reacquired `mutex_`, which is only possible once `acquire` has returned and released it. So when the scan begins, the worker holds the lock, the submitting thread is out of the queue, and `pending` has been set.

The scan is a range-for over `slots_`, with a structured binding `[key, job]` for each map entry; `key` is unused and `job` is a reference to the `std::shared_ptr<Job>` the map holds. For every job whose `pending` is set, the worker clears the flag and adds one to `runs`. **That is the whole of what the worker does for a job in this revision**: there is no work function, no callback and no use of the key; "running" a job is this bookkeeping. If the reader expected the submitted key to trigger something, the code does not support it.

Two properties of the scan matter for judging the change. It visits **every slot, not the submitted key**: one wake-up consumes every outstanding request, whichever keys raised them, and a job not pending costs only its check. And it runs entirely under `mutex_`, so no `acquire` can interleave with it; a submission that arrives during the scan blocks on the lock until the worker has finished and gone back to waiting.

After the scan the loop returns to its condition and, unless stopping was requested, to `cv_.wait`; the exit is shown in walk W2. The next step returns to the caller's thread, which has meanwhile been holding a handle to the same `Job` this code just wrote to.

References: src/work_queue.cpp (target) lines 29–35; the lock the worker holds is the `unique_lock` of line 27, and the submitting side's write of `pending` is line 21.

**Show more:**

The order of lock ownership makes the hand-over work without any state besides the flag: `acquire` writes `pending` under the mutex, releases it, and the worker reads `pending` under the same mutex, so the read is ordered after the write. A submission that blocks on the lock during a scan proceeds only after `wait` has released the mutex again, sets its flag, and notifies; if the worker has by then re-entered `wait` the notification wakes it, and if it has not, the case of a later step applies (W1.8).

`cv_.wait` is called without a predicate, so it may also return without any notify, which condition variables permit. Such a wake-up only runs the scan, which finds nothing pending and changes nothing, so the loop tolerates it; the cost is the scan, not a wrong result.

Because `slots_` never shrinks (W1.2), each scan touches every key the queue has ever seen, and the cost of a wake-up grows with that number rather than with the number of pending jobs. Each entry is dereferenced with `job->pending` as it is visited, with no check that the pointer is set.

What a caller holding the handle can see of this scan is not ordered by anything: the worker's two writes happen under a lock the caller cannot take, so a caller that reads `pending` or `runs` while this code runs reads them concurrently with the writes. The next step takes that up from the caller's side.

#### W1.6 Back on the caller's thread: what the returned handle shares

- the handle leaving submit: `src/submit.cpp` target lines 4–5
- the queue's private lock: `src/work_queue.h` target lines 21–24

Back on the caller's thread, where step W1.1 left it: `submit` has returned, and the caller holds the `std::shared_ptr<Job>` that `acquire` copied out of the slot. The point now is not how the handle was produced but what it is. It refers to the queue's own `Job`, whose `pending` and `runs` the worker thread writes every time it scans (W1.5), and the worker may do so at any moment from the instant `acquire` released the lock; the first scan may already be over, or may not have started.

Beside the handle stands the only thing that orders those writes: `mutex_`, declared under `private:` in `WorkQueue`, next to `workerLoop`. The public surface of the class is the constructor, the destructor and `acquire`, nothing else. **No public operation takes `mutex_` on a caller's behalf, reads a job's fields under it, or waits for a job to be run.** The `Job` itself adds no lock or atomic (W1.3). So a caller that reads `pending` or `runs` through the handle does so with no ordering against the worker's writes, and under the language's rules a plain read that is concurrent with a plain write is a data race, whatever value it happens to produce. The code offers the caller no ordered way to learn whether, or how many times, its job has run while the queue is alive.

What the code does offer the caller is narrower. The handle is safe to hold, copy and destroy from any thread, because `std::shared_ptr` manages its count atomically, and the `Job` stays alive as long as the queue's slot or any copy of the handle exists. `key` is written once, in `acquire` on the caller's own thread before the handle leaves, and the worker never touches it, so reading `key` is safe. And once the `WorkQueue` has been destroyed, its destructor has joined the worker (walk W2), so a handle that outlives the queue refers to a `Job` nothing writes to any more; that is the one point in this revision where `pending` and `runs` can be read without a concurrent writer.

What a caller may read from the handle, and when, is for the reader to judge from this; the code states the facts above and nothing more.

References: the handle leaving `submit`, src/submit.cpp (target) lines 4–5; `private:`, `workerLoop` and `mutex_`, src/work_queue.h (target) lines 21–24; the worker's writes, src/work_queue.cpp (target) lines 32–33.

**Show more:**

The data-race rule applies per access, which is why the three fields fare differently. `key` has one writer, the submitting thread inside `acquire`, and that write is sequenced before `acquire` returns on the same thread; a later read on that thread, or on any thread that received the handle from it, sees the written value, and the worker's scan reads only `pending`. `pending` and `runs` have the worker as a writer, under `mutex_`, and the caller as a possible reader without it; the two are unordered. The same holds in the other direction: the fields are public, so a caller may also write them, and such a write is unordered against the worker's read of `pending` and write of `runs`.

The handle's own safety comes from the library, not from the queue. Copying or dropping a `std::shared_ptr` from several threads is defined behaviour; it is the pointee's fields that carry no such guarantee. Holding the handle does not keep the worker from writing, and dropping it does not remove the slot, since `slots_` keeps its own copy and nothing erases entries.

The window after destruction is a consequence of two things read elsewhere in the walks: the destructor joins `worker_` before the members are destroyed (src/work_queue.cpp (target) line 11), and destroying `slots_` only drops the map's references to the jobs. A caller that kept its handle across the queue's lifetime therefore ends with a `Job` whose `runs` is final. Whether any caller is written to do that cannot be read from these files, where `submit` has no caller.

#### W1.7 Back at the branch: the key already has a slot

- acquire: the existing-slot outcome: `src/work_queue.cpp` target lines 16–21

The walk is back at the branch point of step W1.2, inside `acquire` with `mutex_` held, but this time the key has been acquired before. `slots_[key]` finds the existing entry and returns a reference to the `std::shared_ptr<Job>` it already holds, so `if (!slot)` is false and the creation branch is skipped: no new `Job`, no write to `key`. The lines that follow run exactly as in step W1.4, now on the old object: `pending` is set, the condition variable is notified, and a copy of the same handle is returned. **A key names one `Job` for the life of the queue**; every submission of that key, from any caller, marks and receives the same object, and `runs` on it is a count for the key, not for this submission.

What this submission counts for is then decided by where the worker is, which the code leaves to scheduling:

- If the worker has not scanned since the earlier submission, `pending` is still `true`, and setting it again changes nothing. The next scan clears it once and adds one to `runs`: the two submissions become one run.
- If the worker has already scanned, `pending` is `false` and `runs` already counts the earlier run. Setting `pending` here is a fresh request, and the next scan adds a second run.

Nothing in `acquire` distinguishes the two cases, and nothing records that a second submission happened; the only trace is whatever `runs` later shows. The notify is issued in both cases, so a submission that finds the flag already raised still costs the worker a wake-up. The next step takes the same hand-over from the other side: what the code does when the notify is sent before the worker is waiting at all.

References: src/work_queue.cpp (target) lines 16–21; the worker's clearing of the flag, lines 31–33.

**Show more:**

The two cases are the only two, because the scan and `acquire` exclude each other through `mutex_`. A second submission cannot arrive in the middle of a scan: it blocks in `lock_guard` while the worker holds the lock from the return of `wait` through the scan and the loop condition, and proceeds only once the worker has released the lock inside the next `wait`. In that ordering the earlier run is complete, `pending` is clear, and the submission's notify finds the worker waiting, so the second run follows. The coalescing case needs the opposite ordering, where the second submission takes the lock before the worker has woken for the first.

The reuse also fixes what the handle from step W1.6 means across submissions: two callers that submitted the same key hold pointers to one object and share its `pending` and `runs`, with the same absence of ordering between their reads and the worker's writes. A submitter has no way to lower `pending` through `acquire`; the only path that clears it is the worker's scan.

Should the creation branch ever have left a null entry behind (the allocation case noted in W1.2), this outcome would not repair it: `if (!slot)` would be true again on the next submission and the creation would simply be retried.

#### W1.8 Back at the handover: the worker is not yet waiting

- workerLoop: entering the wait: `src/work_queue.cpp` target lines 27–29

The walk returns once more to the `notify_all` of step W1.4, this time to ask what it reaches. Step W1.5 followed the worker from the moment `wait` returned; here is how it gets into that wait. The worker thread, started by the constructor, first takes `mutex_` with a `unique_lock`, checks `stopping_`, and only then calls `cv_.wait(lock)`, which releases the mutex and blocks until notified. Nothing in this sequence looks at `pending`.

That opens a timing window the data cannot close. **If `acquire` runs before the worker has reached `wait`**, because the queue was constructed and a key submitted before the new thread got as far as line 27, or because the worker is blocked on `mutex_` while `acquire` holds it, then `notify_all` is issued while no thread is waiting, and a notification with no waiter is simply dropped. `pending` is set all the same. The worker then takes the lock, finds `stopping_` false, and enters `wait` with a job already pending and no predicate that would make `wait` return at once. It blocks.

What wakes it next is, from the code, one of two things:

- a later `acquire`, for any key, whose notify finds the worker waiting; the scan that follows visits every slot (W1.5), so the job left pending here is counted together with the new one;
- the destructor's `notify_all` when the queue is destroyed, after which the worker scans once more before the loop condition ends it (walk W2, step 5), so the job is counted at shutdown.

Until one of those happens the job stays pending and uncounted, for as long as the queue lives if no further submission arrives. A spurious return from `wait`, which condition variables permit, would also run the scan, but the code does not arrange for one.

References: `workerLoop` entering the wait, src/work_queue.cpp (target) lines 27–29; the notify that may find no waiter, line 22; the destructor's notify, line 10.

**Show more:**

The window is narrower than it may look, and the code's own locking is what narrows it. `cv_.wait(lock)` releases the mutex and begins waiting as one atomic step with respect to a notify, so a notify cannot fall between "released the lock" and "waiting" once the loop is running. After a scan the worker keeps the lock through the loop condition and into the next `wait`, so no `acquire` can run in between either (W1.7). The only moment the worker neither holds the lock nor waits on the condition variable is therefore before its first `lock(mutex_)` at line 27: from the thread's launch in the constructor until it first acquires the mutex. A submission that takes the lock first in that interval is the case above; one that comes after the worker's first `wait` finds a waiter.

With a worker blocked on the mutex at line 27, the sequence is: `acquire` holds the lock, sets `pending`, notifies into the void, releases; the worker acquires, reads `stopping_` as false, and waits. The flag and the wait are both in place, but the flag was set before the wait was entered, and `wait` without a predicate has no memory of it.

The same start-up ordering has a harder edge at shutdown. If the destructor runs before the worker has reached line 27 at all, the worker's first check of `stopping_` is already true: it never waits, never scans, and a job marked pending in that interval is never counted at all. That is the other ordering the lifecycle walk shows; here it matters because the destructor's notify is the last chance named above, and in that one ordering it does not lead to a scan.

### W2 (walk): How the worker thread starts, waits and stops

*Purpose:* Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.

#### W2.1 The constructor starts the worker thread

- the constructor: `src/work_queue.cpp` target lines 3–3

This walk starts where a `WorkQueue` comes into being. The earlier revision had no constructor of its own and no thread; here the constructor's whole content is in its member initializer list, and its body `{}` is empty. `worker_` is a `std::thread`, and constructing a `std::thread` with a callable starts a new thread that runs it at once. So **the worker thread begins running before the constructor has returned**, as a side effect of initialising a member.

The callable is a lambda that captures `this` and calls `workerLoop()`, a private member function. "Private" governs who may name it, not which thread may run it: the lambda is inside the class, so it may call `workerLoop`, and the new thread runs it on the very object that is still being constructed. `workerLoop` immediately uses `mutex_`, `stopping_`, `cv_` and `slots_` (walk W1, step 5 showed its scan; step 3 of this walk shows its start), all members of the same object.

From this line on the queue is therefore in use from two threads: the one that is constructing it and will go on to call `acquire`, and the worker, which is already on its way to the lock. What the reader must settle before trusting this is whether those members exist when the worker reaches them, which is a question about the order in which members are constructed; the next step answers it from the class declaration.

References: the constructor, src/work_queue.cpp (target) line 3; `worker_` declared at src/work_queue.h (target) line 28; `workerLoop` at src/work_queue.cpp (target) lines 26–37.

**Show more:**

Capturing `this` in a thread that outlives the constructor is safe only if the object stays at that address, and here the types settle it: `WorkQueue` holds a `std::mutex` and a `std::condition_variable`, which can be neither copied nor moved, so the class's copy and move operations are implicitly deleted and a `WorkQueue` can never be relocated after construction. The pointer the lambda holds therefore refers to the live object until the destructor runs, and the destructor joins the thread before the members go (step 4 of this walk).

If starting the thread fails, `std::thread`'s constructor throws `std::system_error`. The members initialised before `worker_` are then destroyed in reverse order, the constructor does not complete, and the destructor never runs for this object; since no thread was started, there is nothing to join. The order in which that unwinding and the normal start both rely on the declaration order is the subject of the next step.

The thread is not detached, and nothing else owns it: it ends only when `workerLoop` returns, which only `stopping_` causes. A `WorkQueue` that is never destroyed keeps its worker blocked in `wait` indefinitely, and a thread that is still joinable when its `std::thread` is destroyed terminates the program, which is why the destructor's join (step 4) is not optional.

#### W2.2 Member order decides what the worker may use

- the WorkQueue class: `src/work_queue.h` target lines 15–29

The previous step left a question: when the worker thread starts inside the constructor, do the members it is about to use exist yet? The answer is in this declaration and in a rule of the language. **Non-static data members are constructed in the order they are declared in the class**, whatever order a constructor's initializer list names them in. Here `mutex_`, `cv_`, `stopping_` and `slots_` come first, and `worker_` is last. So when the constructor reaches `worker_` and the `std::thread` starts, the mutex and the condition variable are already constructed, `stopping_` already holds its default `false`, and `slots_` is an empty map. The first things `workerLoop` does, lock `mutex_` and read `stopping_` (next step), are therefore operating on live objects.

Nothing but the position of `worker_` provides that guarantee. The constructor's initializer list only names `worker_`; the other four take their default constructors or, for `stopping_`, the default member initialiser, and they do so in declaration order because that is where they are declared. The same rule, reversed, governs the end of life: members are destroyed in reverse declaration order, so `worker_` goes first and `mutex_` last, after the destructor's body has joined the thread (step 4 of this walk).

The declaration also shows the whole surface of the class. Public are the constructor, the destructor and `acquire`; private are `workerLoop` and every data member. Compared with the earlier revision, which had only `slots_` and a `find` method, all of the synchronisation and the thread are new, and none of it is reachable from outside: a user of the class can construct it, submit keys through `acquire`, and destroy it, and that is all. That the lock is unreachable from a caller is what gave the handle question its shape in walk W1 (step 6).

References: the class, src/work_queue.h (target) lines 15–29; the initializer list that relies on this order, src/work_queue.cpp (target) line 3.

**Show more:**

The dependency on declaration order is real but silent. Moving `worker_` above `mutex_` in the class would compile unchanged and let the new thread call `lock` on a mutex whose constructor has not run, which is undefined behaviour; moving it above `stopping_` would let the loop condition read a `bool` before its initialiser ran. No comment, static assertion or test in these files marks the order as load-bearing, so a reader judging the change has only the declaration itself to go on. This is an observation from the code, not a report of anything observed to go wrong.

Two members pair by use rather than by type. `cv_` is not bound to `mutex_` by its declaration; it is the `unique_lock<std::mutex>` passed to `cv_.wait` in `workerLoop` that ties them, and both `acquire` and the destructor rely on using that same `mutex_` around `stopping_` and the jobs. `stopping_` is a plain `bool` protected by the same convention: every access to it in these files is under `mutex_`, which is what makes the loop condition and the destructor's write ordered.

The reverse destruction order matters for the thread in particular. A `std::thread` that is still joinable when destroyed calls `std::terminate`, so `worker_`, destroyed first among the members, must already have been joined; the destructor body does that before any member destructor runs. And because `mutex_` and `cv_` are destroyed last, and only after the thread has ended, no thread can be blocked in `wait` on a condition variable that is being destroyed.

#### W2.3 The worker loop takes the lock and waits

- workerLoop: lock and wait: `src/work_queue.cpp` target lines 26–29

We are on the worker thread, at the top of `workerLoop`, the function the constructor's lambda calls (step 1). Its first act is to take `mutex_`, and the choice of `std::unique_lock` rather than `lock_guard` is not cosmetic: a condition variable's `wait` needs a lock it can release and reacquire, and `unique_lock` is the type that allows that. From here **the worker holds `mutex_` for the whole of its life except while it is blocked inside `cv_.wait`**. The loop condition, the scan and every line between them run under the lock; the only moments another thread can take `mutex_` are while the worker waits, before this line, and after the function returns.

The loop condition is `!stopping_`, read under the lock, and it is checked before the first wait. Only this flag ends the loop; there is no other exit, no count of work and no timeout. Then `cv_.wait(lock)` releases the mutex, blocks the thread, and when it returns has reacquired the mutex, so the code after it runs with the lock held again.

`wait` is called without a predicate, and that decides the loop's character. The worker is not waiting for some condition to become true; it is waiting to be poked. Any `notify_all` on `cv_`, from `acquire` or from the destructor, and any spurious return that the library allows, wakes it the same way, and what follows is always the scan of the slots that walk W1 showed (step 5): a wake-up with nothing pending costs a scan and changes nothing. The flip side was shown in the same walk (step 8): a notification sent while the worker is not inside `wait` is not remembered, because nothing here looks at `pending` before waiting.

After each scan the thread comes back to the condition. Only when `stopping_` has been set, which is the destructor's job in the next step, does the loop end.

References: src/work_queue.cpp (target) lines 26–29; the scan that follows every wake-up, lines 30–35; `stopping_` declared at src/work_queue.h (target) line 26.

**Show more:**

The lock ownership timeline, as the code fixes it: the thread acquires `mutex_` at line 27 and from then on releases it only inside `wait`. Each `wait` call unlocks and begins waiting atomically with respect to notifiers, blocks, and relocks before returning; the scan and the next check of `stopping_` then happen without any release in between. `acquire` and the destructor, which both lock `mutex_` with a `lock_guard`, can therefore run only while the worker is waiting or has not yet reached line 27, which is the basis of the two timing cases walk W1 drew (steps 7 and 8).

`stopping_` is a plain `bool`, and its read here is made safe by the same lock that the destructor takes to write it: the write and this read are both under `mutex_`, so the worker sees the write on its next check after the destructor's critical section. No atomic is involved, and the loop would not be correct if the read were moved outside the lock.

The wait has no deadline, so a worker with nothing to do blocks until the next notify. Nothing in this revision wakes it periodically, and the function has no way to end other than observing `stopping_`; if an exception escaped from `wait` or from the scan, there is no handler in the thread's callable, and an exception leaving a `std::thread`'s function terminates the program.

#### W2.4 The destructor asks the worker to stop and joins it

- the destructor: `src/work_queue.cpp` target lines 5–12

The shutdown path starts here, on whichever thread destroys the `WorkQueue`; the earlier revision, having no thread, needed no destructor. The body does three things in a fixed order, and the order is the point.

First, `stopping_` is set to `true` under `mutex_`, inside a block of its own. The write must be under the lock because the worker reads the flag under the same lock in its loop condition (previous step); that is what makes the read see the write. The block is there so that **the lock is released before the notify and before the join**. Releasing before `join` is not optional: `join` blocks this thread until `workerLoop` returns, and `workerLoop` can return only after `wait` has reacquired `mutex_`, scanned, and read the flag. Joining while still holding the mutex would wait for a worker that is itself waiting for the mutex. Releasing before `notify_all` is a choice rather than a necessity, and the opposite of what `acquire` does (walk W1, step 4); here the woken worker finds the mutex free and goes straight on.

Second, `cv_.notify_all()` wakes the worker if it is blocked in `wait`. If it is not, because it has not yet reached its first lock, the notify is dropped, and that is harmless for this flag in a way it was not for `pending` (walk W1, step 8): the worker checks `stopping_` before every wait, so it finds the flag set at its first check and never waits at all.

Third, `worker_.join()` blocks until the worker thread has ended. Only when `join` returns does the destructor body finish, and only then are the members destroyed, in reverse order (step 2): `worker_` first, by then no longer joinable, and `mutex_` and `cv_` last, with no thread left to use them. How the worker gets from the notify to the end of `workerLoop`, and what it does with any job still pending on the way, is the next step.

References: the destructor, src/work_queue.cpp (target) lines 5–12; the worker's read of `stopping_`, line 28; the notify-under-lock it contrasts with, line 22.

**Show more:**

What the destructor does not guard is use of the queue by other threads while it runs. Nothing stops a thread from calling `acquire` after `stopping_` is set: `acquire` takes the lock, marks a job pending and notifies, and whether the worker still scans depends on whether it has already left the loop. A call that reaches the object after `join`, during or after the destruction of the members, is a use of a destroyed object. The code places the responsibility for not submitting to a queue being destroyed on the owner, and states nothing about it.

Jobs survive the queue. `slots_` holds one `std::shared_ptr` per job and is destroyed with the other members, which only drops the map's references; a caller still holding a handle from `submit` keeps its `Job` alive, now with no thread that writes to it (walk W1, step 6). The map itself, and with it the queue's memory of which keys were ever seen, ends here.

`join` is the only thing that keeps the member destructors safe. If `workerLoop` never returned, the destructor would block forever at `join` rather than destroy a `std::thread` that is still joinable, which would terminate the program; the loop's only exit being `stopping_`, and the flag being set here, is what makes `join` return. The destructor must not run on the worker thread itself, since a thread cannot join itself, but nothing in this revision runs any user code on the worker that could do so.

#### W2.5 Back in the worker: the stop is seen after one more scan

- workerLoop: the exit: `src/work_queue.cpp` target lines 28–37

Back on the worker thread, blocked in `cv_.wait` as step 3 left it, and now woken by the destructor's `notify_all` from the previous step. `wait` reacquires `mutex_` before it returns; the destructor released the lock before notifying, so the worker takes it without contention and continues with the lock held.

What follows the wait is the scan, unconditionally. The loop body does not look at `stopping_` before scanning, and the worker has no way to tell a shutdown wake-up from a submission wake-up, so **every job still pending gets counted one last time**: `pending` cleared, `runs` incremented, exactly as in a normal round (walk W1, step 5). Only after the scan does control reach the `while` condition again, and this time `!stopping_` is false. The loop ends, `workerLoop` returns, the `unique_lock` is destroyed on the way out and releases `mutex_`, the lambda from the constructor returns, and the thread is finished. That is the event `join` in the destructor has been waiting for; the destroying thread now continues to the member destructors.

The code allows a second ordering, and it is worth holding beside the first. If the destructor runs before the worker has reached its first lock, the worker takes `mutex_` only after `stopping_` is already `true`, finds the condition false at its very first check, and leaves without ever waiting or scanning. The thread ends just the same and `join` returns just the same; the difference is that no final scan happens, so a job marked pending in that interval is never counted. Which ordering occurs depends on scheduling between the constructing thread and the new one, and the code does nothing to choose.

References: the exit of `workerLoop`, src/work_queue.cpp (target) lines 28–37; the destructor's write and join it answers, lines 7–11.

**Show more:**

The final scan is a guarantee with a narrow scope: a job that is pending at the moment the worker wakes for the destructor's notify is counted. The lock fixes what can and cannot slip in around it. A submission that takes `mutex_` after the destructor's block has released it and before the worker has woken sets `pending` and is included in the final scan. A submission that arrives while the worker holds the lock, from the return of `wait` through the scan, the condition and the function's exit, blocks until the worker has released the mutex by returning; it then marks its job and notifies a condition variable nobody waits on any more, and the job is never counted. Both are uses of the queue during its destruction, which the destructor does not guard (previous step); the code states only what the worker does, not what the owner must refrain from.

The two orderings share one property: the loop exits only through the condition, and the condition is read under the lock, so the worker never leaves while another thread is between taking the lock and releasing it. There is no path on which the worker ends with the mutex held, since the `unique_lock` is a local of `workerLoop` and is released when the function returns, and the destructor's `join` therefore never waits for a thread that is stuck on the lock the destroying thread itself released.

After the thread has ended, the jobs remain as the last scan left them. Nothing resets `pending` or `runs` at shutdown, and nothing in these files reads them; a holder of a handle sees the final values, and the queue's own copies go when `slots_` is destroyed.

### W3 (walk): What the old submit did, and what is gone

*Purpose:* Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before.

#### W3.1 The old submit discarded the lookup

- submit in the base revision: `src/submit.cpp` base lines 3–5

This walk reads the earlier revision, so the code beside it is the old `submit`, not the one walk W1 started from. It is two lines of substance: a `void` function that calls `queue.find(key)` and does nothing with what comes back. `find` returns a `std::shared_ptr<Job>`, so the call produces a value, but as an expression statement that value is a temporary which is destroyed at the end of the line. **A caller of the old `submit` got nothing back and could observe nothing from having called it.** The function took a `WorkQueue` by reference and a key, and that was the whole of its contract.

What the call did inside the queue is the next step; the one thing to carry forward is that it was a lookup, and that the queue of this revision had no worker thread, no lock and no pending state for a lookup to affect. The old `submit` therefore left no lasting trace in the queue either, so there is no earlier behaviour that the new `submit` (walk W1, step 1) continues or preserves beyond accepting a key: the creation of a job, the worker and the returned handle are all new.

References: the old `submit`, src/submit.cpp (base) lines 3–5; `find` as it was declared, src/work_queue.h (base) line 12.

**Show more:**

The discarded result is the detail that decides how to read the change. The `std::shared_ptr` that `find` returned was a copy of the map's pointer, or null for an unknown key; constructing and destroying that temporary adjusts a reference count and nothing else, so even a caller who later inspected the queue could not tell that `submit` had been called. The new signature keeps the parameters and changes only the return type, so an existing call that ignores the result still compiles, but it now creates a slot, raises a flag and wakes a thread where before it looked something up and forgot it.

No header in either revision declares `submit`; it exists only as a definition in its own file. A caller in another translation unit must declare it itself, and such a declaration written for the old `void` return would no longer match the new definition. Whether any caller exists, and whether it was updated, cannot be read from these files.

#### W3.2 find looked up without creating

- find in the base revision: `src/work_queue.cpp` base lines 3–6 ← from the call in the old submit (`src/submit.cpp` 4–4)

Reached from the old `submit`'s call (previous step), still on the earlier revision. `WorkQueue::find` is a read-only lookup: `slots_.find(key)` is `std::map::find`, which searches for the key and returns an iterator to the entry or `end()`, and **never inserts**. The conditional turns that into the return value: `nullptr` for an unknown key, a copy of the stored `std::shared_ptr<Job>` for a known one. Nothing is written, nothing is created, and the map is the same size after the call as before.

Around it there was nothing else. The `WorkQueue` of this revision has one method and one member: no constructor, no mutex, no condition variable, no thread and no `stopping_`; `Job` has only its `key`. A call to `find` ran on the caller's thread, touched a map and returned, and needed no lock because no second thread existed.

That is what the change removed and what it replaced. `find` is gone from the new class, and its place is taken by `acquire`, which walk W1 explains: the same map, but consulted with `operator[]`, which inserts, followed by creation of a `Job`, a flag raised and a notification to a worker thread, all under a lock (walk W1, steps 2 and 4). The new queue has no lookup that leaves the map untouched; every lookup is a submission. A caller of the new `submit` therefore gets creation, a worker and a handle that the old path never offered, and loses the one thing the old path had, a query with no side effect.

References: `find`, src/work_queue.cpp (base) lines 3–6; the old class with its single method, src/work_queue.h (base) lines 10–16; its replacement `acquire`, src/work_queue.cpp (target) lines 14–24.

**Show more:**

As these files show it, `find` could never have returned anything but `nullptr`. `slots_` is private, `find` is the class's only member function, there is no constructor and no friend, and `find` itself does not insert, so nothing in the base revision ever put an entry into the map. The lookup was correct in form and empty in effect: the old `submit` asked for a job in a map that, within this code, had no way to hold one. Whether other code outside these files once populated it cannot be read here; with `slots_` private and the class otherwise closed, it would have had to change the class to do so.

Removing `find` also removes a capability rather than only a function. The new class exposes nothing that reads a job without marking it pending, so any code that wanted to ask "is there a job for this key?" has no replacement in the target revision; `acquire` answers by creating one. If such a use existed outside these files, it no longer compiles against the new header, which is the one place the change would be forced into view.

## The reviewer

### First verdict (turn 17)

**Verdict:** accept

**Assessment:** The reader can follow the course. W1 enters at submit, follows the call into acquire, pauses on the Job type with the detour named as such, continues to mark-notify-return, switches thread explicitly for the worker's scan, returns to the caller to say what the handle is and is not, and then revisits the branch point (existing slot) and the hand-over (worker not yet waiting) as alternatives, never as one run. W2 follows the worker's life from the constructor's initializer through the member-order dependency, lock-and-wait, the destructor's stop-notify-join and the final scan, with the two start-up orderings kept apart. W3 reads the base revision and makes explicit that the removed lookup could not, within these files, find anything. I checked the claims that carry weight against the code and they hold: the notification issued under the lock at src/work_queue.cpp target 22 against a worker that locks, checks stopping_ and waits without a predicate at target 27-29, so a notify before the first wait is lost and the job stays pending until a later acquire or the destructor's notify at target 10; the null entry that an allocation failure at target 18 would leave after operator[] at target 16, dereferenced without a check at target 31; the destructor's write under the lock, release, notify and join at target 6-11 and the two exits of the loop at target 28-37; the construction order fixed by src/work_queue.h target 24-28 with worker_ last; the return value copied before the lock_guard is destroyed at target 23; and the base class having no member that inserts (src/work_queue.h base 10-16, src/work_queue.cpp base 3-6). Every line reference in the steps points where the text says. Each shown place is explained at the Standard level rather than named, the language details the reader needs (operator[] insertion, lock_guard versus unique_lock, condition-variable wake and drop semantics, member construction order, shared_ptr ownership, the data-race rule) are placed where they are needed, and the Show more parts deepen the first part instead of repeating it. Two trivial imprecisions do not affect understanding and are not findings: W1.6 Show more says the worker's scan reads only pending, while runs += 1 at target 33 also reads runs, and W1.3's reference gives target 31-33 as the worker's writes when line 31 is the test. Nothing significant falls short, so I accept the walks as written.


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
- `base/` is From, commit 0979a4c58c29a912e317a944acaf2a04a213b20e
- `target/` is To, commit 5bf91078fda77b72d85659ad20e5cc65161d5c27
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: work-queue
From: 0979a4c58c29a912e317a944acaf2a04a213b20e (base commit)
To: 5bf91078fda77b72d85659ad20e5cc65161d5c27 (target commit)
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
  "summary": "The change turns WorkQueue from a passive lookup table into a queue with a background worker. Before, submit called find, which returned the existing Job for a key or nullptr and never created one, and submit threw the result away. Now WorkQueue starts a worker thread in its constructor; acquire creates a Job for an unknown key or reuses the existing one, marks it pending, notifies the worker through a condition variable and returns the shared handle, which submit now passes back to its caller. The worker loop sleeps on the condition variable under the queue's mutex and, on every wake-up, scans all slots, clears each pending flag and counts a run; the destructor sets a stop flag, wakes the worker and joins it. Job gains the pending flag and runs counter that the submitting thread and the worker use to hand work over.",
  "background": "Both revisions hold only these three files: there are no tests, build files, documentation or other callers of WorkQueue, so the walks follow submit as the only entry point and the constructor and destructor as the worker's lifecycle.\n\nIn this revision the worker's whole effect on a pending job is to clear the flag and increment runs; nothing else is executed for a job. The queue's mutex is a private member, and Job itself carries no synchronisation, so the handle submit returns is shared with the worker thread without a lock the caller could take.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when a caller submits a key",
      "question": "How does a submitted key become a pending job, who processes it, and what does the caller get back?",
      "purpose": "Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.",
      "steps": [
        {
          "title": "submit returns the job it acquires",
          "summary": "submit asks the queue to acquire the key and returns the Job handle to its caller.",
          "brief": "Entry point of the walk, on the caller's thread. Make clear that submit no longer discards the result: it returns the shared_ptr<Job> that acquire produces, so the caller keeps a handle on the slot. The reader takes to the next step that everything of interest happens inside acquire.",
          "places": [
            {
              "label": "submit in the new revision",
              "path": "src/submit.cpp",
              "side": "target",
              "start": 3,
              "end": 6,
              "anchor": "auto job = queue.acquire(key);"
            }
          ]
        },
        {
          "title": "acquire locks the queue and finds or creates the slot",
          "summary": "Under mutex_, slots_[key] yields the existing slot or a fresh empty one, which is then filled with a new Job.",
          "brief": "Reached by the call in submit. Make comprehensible that the lock_guard holds mutex_ for the whole function, that std::map::operator[] inserts a null shared_ptr when the key is new, and that the if (!slot) branch is where a Job is created and given its key. Follow the new-key outcome first; the existing-slot outcome is a path of its own later in this walk. The reader takes the slot reference to the Job type next.",
          "places": [
            {
              "label": "acquire: lock, lookup and creation",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 14,
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
          "title": "What a Job carries between submitter and worker",
          "summary": "Job gains a pending flag and a runs counter beside its key.",
          "brief": "A type dependency, not a call: the reader needs the two new fields before seeing them set. Make clear that pending is the request the submitter raises and the worker clears, that runs is the count the worker increments, and that Job itself holds no lock; the queue's mutex_ is what protects these fields while the queue touches them. The reader takes this to the step where acquire sets pending.",
          "places": [
            {
              "label": "the Job struct",
              "path": "src/work_queue.h",
              "side": "target",
              "start": 9,
              "end": 13,
              "anchor": "bool pending = false;"
            }
          ]
        },
        {
          "title": "The job is marked pending, the worker notified, the handle returned",
          "summary": "acquire sets pending, calls cv_.notify_all while still holding the lock, and returns the shared slot.",
          "brief": "Back in acquire once the slot holds a Job. Make comprehensible that pending = true is the handover, that notify_all is issued while mutex_ is still held and the lock is released only when the lock_guard is destroyed at the return, and that the returned shared_ptr is the very object the worker will mutate. The reader takes to the next step that this notification is what wakes the worker thread.",
          "places": [
            {
              "label": "acquire: mark, notify, return",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 21,
              "end": 23,
              "anchor": "cv_.notify_all();"
            }
          ]
        },
        {
          "title": "The worker wakes and processes every pending job",
          "summary": "On the worker thread, cv_.wait returns, the loop scans all slots and turns each pending flag into a counted run.",
          "brief": "A change of context: this code runs on the worker thread started in the constructor (see the walk 'How the worker thread starts, waits and stops'), which has been blocked in cv_.wait with mutex_ released. The notification from the previous step wakes it once acquire has released the lock, and wait reacquires mutex_ before returning. Make clear that the scan visits every slot, not only the submitted key, that the worker's whole effect on a job is pending = false and runs += 1, and that nothing else runs for a job in this revision. The reader takes to the next step that the caller meanwhile holds the same Job.",
          "places": [
            {
              "label": "workerLoop: wake-up and scan",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 29,
              "end": 35,
              "anchor": "job->runs += 1;"
            }
          ]
        },
        {
          "title": "Back on the caller's thread: what the returned handle shares",
          "summary": "The caller holds the same Job the worker writes to, and the only lock guarding its fields is private to the queue.",
          "brief": "Return to the caller's thread after submit has returned. The point now is the handle the caller is left with: the worker writes pending and runs under mutex_, mutex_ is a private member of WorkQueue, and Job carries no synchronisation of its own. This is where the reader judges what a caller may read from the handle and when; state what the code offers and leave the verdict to the reader.",
          "places": [
            {
              "label": "the handle leaving submit",
              "path": "src/submit.cpp",
              "side": "target",
              "start": 4,
              "end": 5,
              "anchor": "return job;"
            },
            {
              "label": "the queue's private lock",
              "path": "src/work_queue.h",
              "side": "target",
              "start": 21,
              "end": 24,
              "anchor": "std::mutex mutex_;"
            }
          ],
          "together": "Seeing the handle leave the queue beside the private mutex that guards its fields shows at once that a caller cannot take that lock.",
          "revisit": "Step 1 showed submit as the entry point; now the point is the handle the caller keeps, which the worker thread writes to concurrently."
        },
        {
          "title": "Back at the branch: the key already has a slot",
          "summary": "When slots_[key] returns a non-null slot, acquire skips creation and marks the existing Job pending again.",
          "brief": "An alternative outcome, starting again at the if (!slot) test of step 2: this time the key was acquired before, so operator[] returns the existing shared_ptr and the branch is not taken. Make clear that the same Job object is reused and pending is set again; if the worker has not scanned since the earlier submission, pending is already true and the two submissions become one run, and if it has, the job is counted a second time. The reader takes to the next path that timing against the worker decides what a submission counts for.",
          "places": [
            {
              "label": "acquire: the existing-slot outcome",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 16,
              "end": 21,
              "anchor": "if (!slot) {"
            }
          ],
          "revisit": "Shown in step 2 for the new-key outcome; now the existing-slot outcome, where the branch is skipped and pending is raised on a Job that already exists."
        },
        {
          "title": "Back at the handover: the worker is not yet waiting",
          "summary": "If acquire notifies before the worker thread has reached cv_.wait, nobody is waiting and the job stays pending until the next notification.",
          "brief": "A second alternative, in timing rather than data, starting again at the notify of step 4. The worker thread must first take mutex_ at line 27, check stopping_ and enter cv_.wait at line 29; if acquire holds the lock before the worker gets there, notify_all finds no waiter, and the wait has no predicate that would look at pending afterwards. Make clear from the code what then wakes the worker: a later acquire, or the destructor's notify, after which the loop scans once more before it exits (see the lifecycle walk). Say what the code does, not whether it is intended.",
          "places": [
            {
              "label": "workerLoop: entering the wait",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 27,
              "end": 29,
              "anchor": "cv_.wait(lock);"
            }
          ],
          "revisit": "Step 5 showed the wait returning; now the entry into the wait, and what a notification sent before it means."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How the worker thread starts, waits and stops",
      "question": "When does the worker thread run, what does it wait on, and how does a WorkQueue shut it down?",
      "purpose": "Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.",
      "steps": [
        {
          "title": "The constructor starts the worker thread",
          "summary": "WorkQueue's constructor launches worker_ with a lambda that calls workerLoop on this.",
          "brief": "Entry: constructing a WorkQueue. Make comprehensible that the thread starts inside the member initializer list, that the lambda captures this and runs workerLoop on the new thread, and that from this moment the queue is used from two threads. The reader takes to the next step the question of what already exists when that thread starts.",
          "places": [
            {
              "label": "the constructor",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 3,
              "end": 3,
              "anchor": "worker_([this] { workerLoop(); })"
            }
          ]
        },
        {
          "title": "Member order decides what the worker may use",
          "summary": "worker_ is declared last, after mutex_, cv_, stopping_ and slots_, so they are constructed before the thread runs.",
          "brief": "A declaration the previous step depends on: members are constructed in declaration order, so the position of worker_ at the end of the class is what lets the lambda touch the other members safely. Also show the shape of the class: the public surface is the constructor, destructor and acquire; workerLoop and every data member are private. The reader takes this to the loop itself.",
          "places": [
            {
              "label": "the WorkQueue class",
              "path": "src/work_queue.h",
              "side": "target",
              "start": 15,
              "end": 29,
              "anchor": "std::thread worker_;"
            }
          ]
        },
        {
          "title": "The worker loop takes the lock and waits",
          "summary": "On the worker thread, workerLoop locks mutex_ and, while stopping_ is false, blocks in cv_.wait, which releases the lock while waiting.",
          "brief": "Context: the worker thread, running the lambda from step 1. Make comprehensible that the unique_lock is held for the whole loop except inside wait, that wait has no predicate so the loop relies on being notified, that a spurious or unrelated wake-up only leads to a scan, and that the scan after each wake-up is what step 5 of the submit walk showed. The reader takes to the next step that only stopping_ ends the loop.",
          "places": [
            {
              "label": "workerLoop: lock and wait",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 26,
              "end": 29,
              "anchor": "while (!stopping_)"
            }
          ]
        },
        {
          "title": "The destructor asks the worker to stop and joins it",
          "summary": "~WorkQueue sets stopping_ under the lock, notifies the condition variable, and joins the thread before the members are destroyed.",
          "brief": "Entry of the shutdown path, on the thread that destroys the queue. Make clear why stopping_ is set inside its own block so the lock is released before notify_all and join, that join blocks until workerLoop returns, and that the data members are destroyed only after that. The reader takes to the next step how the worker observes the flag.",
          "places": [
            {
              "label": "the destructor",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 5,
              "end": 12,
              "anchor": "worker_.join();"
            }
          ]
        },
        {
          "title": "Back in the worker: the stop is seen after one more scan",
          "summary": "The notified worker wakes, scans the slots once more, then finds stopping_ true and leaves the loop, ending the thread.",
          "brief": "Context: the worker thread again, woken by the destructor's notify. Make comprehensible that wait returns with the lock held, that the scan still runs so pending jobs are counted one last time, that the while condition then fails and workerLoop returns, ending the lambda so join in the destructor returns. Also show the other ordering the code allows: if the worker had not yet reached wait when stopping_ was set, it finds the flag true at its first check and never waits.",
          "places": [
            {
              "label": "workerLoop: the exit",
              "path": "src/work_queue.cpp",
              "side": "target",
              "start": 28,
              "end": 37,
              "anchor": "while (!stopping_)"
            }
          ],
          "revisit": "Step 3 showed the loop entering the wait; now the exit: the last scan and the loop condition that fails."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What the old submit did, and what is gone",
      "question": "What did submit and find do before the change, and which behaviour was removed?",
      "purpose": "Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before.",
      "steps": [
        {
          "title": "The old submit discarded the lookup",
          "summary": "In the base revision, submit called queue.find(key) and returned nothing.",
          "brief": "Entry of the old path, read on the From side. Make clear that submit returned void and dropped the result of find, so a caller learned nothing from submitting. Its replacement is step 1 of the walk 'What happens when a caller submits a key'. The reader takes to the next step what find did.",
          "places": [
            {
              "label": "submit in the base revision",
              "path": "src/submit.cpp",
              "side": "base",
              "start": 3,
              "end": 5,
              "anchor": "queue.find(key);"
            }
          ]
        },
        {
          "title": "find looked up without creating",
          "summary": "find returned the existing Job for a key, or nullptr, and never inserted a slot or involved a thread.",
          "brief": "Reached from the call in the old submit. Make comprehensible that std::map::find does not insert, that an unknown key yielded nullptr, and that there was no mutex, no worker and no pending state in this revision. Its replacement, acquire, is explained in the submit walk; contrast it briefly rather than re-explaining it here.",
          "places": [
            {
              "label": "find in the base revision",
              "path": "src/work_queue.cpp",
              "side": "base",
              "start": 3,
              "end": 6,
              "anchor": "auto it = slots_.find(key);",
              "from": {
                "label": "the call in the old submit",
                "path": "src/submit.cpp",
                "side": "base",
                "start": 4,
                "end": 4
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

### W1 (walk): What happens when a caller submits a key
Purpose: Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Question: How does a submitted key become a pending job, who processes it, and what does the caller get back?
- W1.1 submit returns the job it acquires — submit asks the queue to acquire the key and returns the Job handle to its caller.
  - submit in the new revision: src/submit.cpp (To) lines 3–6
  - Brief: Entry point of the walk, on the caller's thread. Make clear that submit no longer discards the result: it returns the shared_ptr<Job> that acquire produces, so the caller keeps a handle on the slot. The reader takes to the next step that everything of interest happens inside acquire.
- W1.2 acquire locks the queue and finds or creates the slot — Under mutex_, slots_[key] yields the existing slot or a fresh empty one, which is then filled with a new Job.
  - acquire: lock, lookup and creation: src/work_queue.cpp (To) lines 14–20 — reached from the call in submit (src/submit.cpp target 4–4)
  - Brief: Reached by the call in submit. Make comprehensible that the lock_guard holds mutex_ for the whole function, that std::map::operator[] inserts a null shared_ptr when the key is new, and that the if (!slot) branch is where a Job is created and given its key. Follow the new-key outcome first; the existing-slot outcome is a path of its own later in this walk. The reader takes the slot reference to the Job type next.
- W1.3 What a Job carries between submitter and worker — Job gains a pending flag and a runs counter beside its key.
  - the Job struct: src/work_queue.h (To) lines 9–13
  - Brief: A type dependency, not a call: the reader needs the two new fields before seeing them set. Make clear that pending is the request the submitter raises and the worker clears, that runs is the count the worker increments, and that Job itself holds no lock; the queue's mutex_ is what protects these fields while the queue touches them. The reader takes this to the step where acquire sets pending.
- W1.4 The job is marked pending, the worker notified, the handle returned — acquire sets pending, calls cv_.notify_all while still holding the lock, and returns the shared slot.
  - acquire: mark, notify, return: src/work_queue.cpp (To) lines 21–23
  - Brief: Back in acquire once the slot holds a Job. Make comprehensible that pending = true is the handover, that notify_all is issued while mutex_ is still held and the lock is released only when the lock_guard is destroyed at the return, and that the returned shared_ptr is the very object the worker will mutate. The reader takes to the next step that this notification is what wakes the worker thread.
- W1.5 The worker wakes and processes every pending job — On the worker thread, cv_.wait returns, the loop scans all slots and turns each pending flag into a counted run.
  - workerLoop: wake-up and scan: src/work_queue.cpp (To) lines 29–35
  - Brief: A change of context: this code runs on the worker thread started in the constructor (see the walk 'How the worker thread starts, waits and stops'), which has been blocked in cv_.wait with mutex_ released. The notification from the previous step wakes it once acquire has released the lock, and wait reacquires mutex_ before returning. Make clear that the scan visits every slot, not only the submitted key, that the worker's whole effect on a job is pending = false and runs += 1, and that nothing else runs for a job in this revision. The reader takes to the next step that the caller meanwhile holds the same Job.
- W1.6 Back on the caller's thread: what the returned handle shares — The caller holds the same Job the worker writes to, and the only lock guarding its fields is private to the queue.
  - the handle leaving submit: src/submit.cpp (To) lines 4–5
  - the queue's private lock: src/work_queue.h (To) lines 21–24
  - Together: Seeing the handle leave the queue beside the private mutex that guards its fields shows at once that a caller cannot take that lock.
  - Revisit: Step 1 showed submit as the entry point; now the point is the handle the caller keeps, which the worker thread writes to concurrently.
  - Brief: Return to the caller's thread after submit has returned. The point now is the handle the caller is left with: the worker writes pending and runs under mutex_, mutex_ is a private member of WorkQueue, and Job carries no synchronisation of its own. This is where the reader judges what a caller may read from the handle and when; state what the code offers and leave the verdict to the reader.
- W1.7 Back at the branch: the key already has a slot — When slots_[key] returns a non-null slot, acquire skips creation and marks the existing Job pending again.
  - acquire: the existing-slot outcome: src/work_queue.cpp (To) lines 16–21
  - Revisit: Shown in step 2 for the new-key outcome; now the existing-slot outcome, where the branch is skipped and pending is raised on a Job that already exists.
  - Brief: An alternative outcome, starting again at the if (!slot) test of step 2: this time the key was acquired before, so operator[] returns the existing shared_ptr and the branch is not taken. Make clear that the same Job object is reused and pending is set again; if the worker has not scanned since the earlier submission, pending is already true and the two submissions become one run, and if it has, the job is counted a second time. The reader takes to the next path that timing against the worker decides what a submission counts for.
- W1.8 Back at the handover: the worker is not yet waiting — If acquire notifies before the worker thread has reached cv_.wait, nobody is waiting and the job stays pending until the next notification.
  - workerLoop: entering the wait: src/work_queue.cpp (To) lines 27–29
  - Revisit: Step 5 showed the wait returning; now the entry into the wait, and what a notification sent before it means.
  - Brief: A second alternative, in timing rather than data, starting again at the notify of step 4. The worker thread must first take mutex_ at line 27, check stopping_ and enter cv_.wait at line 29; if acquire holds the lock before the worker gets there, notify_all finds no waiter, and the wait has no predicate that would look at pending afterwards. Make clear from the code what then wakes the worker: a later acquire, or the destructor's notify, after which the loop scans once more before it exits (see the lifecycle walk). Say what the code does, not whether it is intended.

### W2 (walk): How the worker thread starts, waits and stops
Purpose: Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.
Question: When does the worker thread run, what does it wait on, and how does a WorkQueue shut it down?
- W2.1 The constructor starts the worker thread — WorkQueue's constructor launches worker_ with a lambda that calls workerLoop on this.
  - the constructor: src/work_queue.cpp (To) lines 3–3
  - Brief: Entry: constructing a WorkQueue. Make comprehensible that the thread starts inside the member initializer list, that the lambda captures this and runs workerLoop on the new thread, and that from this moment the queue is used from two threads. The reader takes to the next step the question of what already exists when that thread starts.
- W2.2 Member order decides what the worker may use — worker_ is declared last, after mutex_, cv_, stopping_ and slots_, so they are constructed before the thread runs.
  - the WorkQueue class: src/work_queue.h (To) lines 15–29
  - Brief: A declaration the previous step depends on: members are constructed in declaration order, so the position of worker_ at the end of the class is what lets the lambda touch the other members safely. Also show the shape of the class: the public surface is the constructor, destructor and acquire; workerLoop and every data member are private. The reader takes this to the loop itself.
- W2.3 The worker loop takes the lock and waits — On the worker thread, workerLoop locks mutex_ and, while stopping_ is false, blocks in cv_.wait, which releases the lock while waiting.
  - workerLoop: lock and wait: src/work_queue.cpp (To) lines 26–29
  - Brief: Context: the worker thread, running the lambda from step 1. Make comprehensible that the unique_lock is held for the whole loop except inside wait, that wait has no predicate so the loop relies on being notified, that a spurious or unrelated wake-up only leads to a scan, and that the scan after each wake-up is what step 5 of the submit walk showed. The reader takes to the next step that only stopping_ ends the loop.
- W2.4 The destructor asks the worker to stop and joins it — ~WorkQueue sets stopping_ under the lock, notifies the condition variable, and joins the thread before the members are destroyed.
  - the destructor: src/work_queue.cpp (To) lines 5–12
  - Brief: Entry of the shutdown path, on the thread that destroys the queue. Make clear why stopping_ is set inside its own block so the lock is released before notify_all and join, that join blocks until workerLoop returns, and that the data members are destroyed only after that. The reader takes to the next step how the worker observes the flag.
- W2.5 Back in the worker: the stop is seen after one more scan — The notified worker wakes, scans the slots once more, then finds stopping_ true and leaves the loop, ending the thread.
  - workerLoop: the exit: src/work_queue.cpp (To) lines 28–37
  - Revisit: Step 3 showed the loop entering the wait; now the exit: the last scan and the loop condition that fails.
  - Brief: Context: the worker thread again, woken by the destructor's notify. Make comprehensible that wait returns with the lock held, that the scan still runs so pending jobs are counted one last time, that the while condition then fails and workerLoop returns, ending the lambda so join in the destructor returns. Also show the other ordering the code allows: if the worker had not yet reached wait when stopping_ was set, it finds the flag true at its first check and never waits.

### W3 (walk): What the old submit did, and what is gone
Purpose: Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before.
Question: What did submit and find do before the change, and which behaviour was removed?
- W3.1 The old submit discarded the lookup — In the base revision, submit called queue.find(key) and returned nothing.
  - submit in the base revision: src/submit.cpp (From) lines 3–5
  - Brief: Entry of the old path, read on the From side. Make clear that submit returned void and dropped the result of find, so a caller learned nothing from submitting. Its replacement is step 1 of the walk 'What happens when a caller submits a key'. The reader takes to the next step what find did.
- W3.2 find looked up without creating — find returned the existing Job for a key, or nullptr, and never inserted a slot or involved a thread.
  - find in the base revision: src/work_queue.cpp (From) lines 3–6 — reached from the call in the old submit (src/submit.cpp base 4–4)
  - Brief: Reached from the call in the old submit. Make comprehensible that std::map::find does not insert, that an unknown key yielded nullptr, and that there was no mutex, no worker and no pending state in this revision. Its replacement, acquire, is explained in the submit walk; contrast it briefly rather than re-explaining it here.

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
- `base/` is From, commit 0979a4c58c29a912e317a944acaf2a04a213b20e
- `target/` is To, commit 5bf91078fda77b72d85659ad20e5cc65161d5c27
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## This step: W1.1 submit returns the job it acquires
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: submit asks the queue to acquire the key and returns the Job handle to its caller.
- submit in the new revision: src/submit.cpp (To) lines 3–6
Brief: Entry point of the walk, on the caller's thread. Make clear that submit no longer discards the result: it returns the shared_ptr<Job> that acquire produces, so the caller keeps a handle on the slot. The reader takes to the next step that everything of interest happens inside acquire.
The step after: W1.2 acquire locks the queue and finds or creates the slot — Under mutex_, slots_[key] yields the existing slot or a fresh empty one, which is then filled with a new Job.
```

</details>

<details><summary>Answer</summary>

```text
`submit` is where a caller hands a key to the queue, and in this revision it is a pure forwarding function: it calls `WorkQueue::acquire` with the key and returns what `acquire` returns, a `std::shared_ptr<Job>`. Nothing else happens on the caller's thread here. No lock is taken, nothing is checked, and the local `job` is only a name for the value on its way out, so the correctness of `submit` is the correctness of `acquire`.

What matters for the change is the return value. Before the change `submit` returned `void` and dropped the result of a lookup, so a caller learnt nothing from submitting. Now **the caller keeps a handle to the queue's own `Job` object**: the same object the queue stores in its slot and that the worker thread later writes to. Whether that `Job` is created fresh or reused from an earlier submission, and how the worker is told about it, is decided inside `acquire`, which the next step opens.

Two things are worth holding on to for the rest of the walk. `std::shared_ptr` means shared ownership, not a copy: the caller and the queue refer to one `Job`. And `submit` gives the caller no rule about when the fields of that `Job` may be read; that question is taken up in a later step (W1.6), once the worker's side has been seen.

References: `submit` at src/submit.cpp (target) lines 3–6; the call it forwards to, `WorkQueue::acquire`, declared at src/work_queue.h (target) line 19.

<!-- dspatch:details -->

The handle's lifetime follows from how `acquire` stores it: the queue keeps its own `std::shared_ptr` in `slots_` (src/work_queue.cpp (target) lines 16–23) and returns a copy, so the `Job` lives as long as either the slot or any caller's copy exists. Nothing in this revision erases a slot, so in practice the queue's copy keeps every `Job` alive for the queue's whole life; a caller's handle therefore never dangles, but it also never becomes the only owner while the queue exists.

Who calls `submit` is not visible in these files. No header declares it in either revision (src/work_queue.h (target) declares only `WorkQueue` and `Job`), and no file here calls it, so a caller in another translation unit would need its own declaration, and whether such a caller uses the returned handle or discards it cannot be read from this change. The signature allows both: a caller that ignores the return gets the old fire-and-forget shape of `submit`, but now with a slot created and a worker notified behind it.

```

</details>

### Turn 3: write-step (file-2) · W1.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.2 acquire locks the queue and finds or creates the slot
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: Under mutex_, slots_[key] yields the existing slot or a fresh empty one, which is then filled with a new Job.
- acquire: lock, lookup and creation: src/work_queue.cpp (To) lines 14–20 — reached from the call in submit (src/submit.cpp target 4–4)
Brief: Reached by the call in submit. Make comprehensible that the lock_guard holds mutex_ for the whole function, that std::map::operator[] inserts a null shared_ptr when the key is new, and that the if (!slot) branch is where a Job is created and given its key. Follow the new-key outcome first; the existing-slot outcome is a path of its own later in this walk. The reader takes the slot reference to the Job type next.
The step before: W1.1 submit returns the job it acquires — submit asks the queue to acquire the key and returns the Job handle to its caller.
The step after: W1.3 What a Job carries between submitter and worker — Job gains a pending flag and a runs counter beside its key.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
We are inside `WorkQueue::acquire`, still on the caller's thread, reached by the call that `submit` forwards (step W1.1). The first line takes the queue's lock: `std::lock_guard` locks `mutex_` when it is constructed and unlocks it only when it goes out of scope, which here is the end of the function. So **everything `acquire` does, including the marking and notification of a later step (W1.4), runs with `mutex_` held**, and the worker thread, which takes the same `mutex_` when it scans, can never be in the middle of a scan while this code runs.

The lookup and the creation are folded into one expression. `slots_[key]` is `std::map::operator[]`, and that operator does two things: it finds the entry for `key`, and if there is none it inserts one, default-constructed, and returns it. The mapped type is `std::shared_ptr<Job>`, whose default is a null pointer. `auto& slot` binds a reference to that entry inside the map, not a copy, so whatever is assigned to `slot` is what the map holds afterwards.

That is what the `if (!slot)` test is for. Following the new-key outcome first: the key has not been seen, `operator[]` has just inserted a null entry, the test is true, and the branch creates the `Job` with `std::make_shared<Job>()` and stores it through the reference into the slot, then writes the key into the `Job` itself. After the branch the slot holds a live `Job` whose `key` matches the map's key; the other fields take the defaults given in the `Job` type, which the next step shows. The other outcome, where the entry already held a `Job` and the branch is skipped, is a path of its own later in this walk (W1.7).

Worth noticing for the review: there is no lookup-without-insert here. Every distinct key passed to `acquire` leaves an entry in `slots_`, and nothing in this revision removes one, so the map only grows.

References: `acquire` at src/work_queue.cpp (target) lines 14–20; `mutex_` and `slots_` declared at src/work_queue.h (target) lines 24 and 27.

<!-- dspatch:details -->

The lock matters for the map as a container, not only for the `Job` fields. The worker loop iterates `slots_` with a range-for (src/work_queue.cpp (target) lines 30–35) while it holds `mutex_`, and `operator[]` here may insert a node while `acquire` holds it; because both sides take the same lock, an insertion can never happen during an iteration. A `std::map` is node-based, so inserting other keys does not invalidate the `slot` reference either, but inside this function that question does not arise: the reference is used only under the lock that excludes every other writer.

One case the code allows but does not handle, an observation from reading: `std::make_shared<Job>()` allocates, and if that allocation throws, the entry that `operator[]` already inserted stays in `slots_` as a null pointer, since the exception leaves the function before the assignment. The worker's scan dereferences every entry with `job->pending` without a null check, so a null slot left behind this way would be read as a `Job` on the next wake-up. Whether this is reachable in practice depends on the allocator and the caller's environment, which cannot be read from these files.

The key is stored twice, as the map's key and as `Job::key`, and `acquire` is the only place that writes the second copy. Nothing in this revision reads `Job::key` back, so the copy exists for whoever holds the returned handle rather than for the queue itself.

```

</details>

### Turn 4: write-step (file-2) · W1.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.3 What a Job carries between submitter and worker
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: Job gains a pending flag and a runs counter beside its key.
- the Job struct: src/work_queue.h (To) lines 9–13
Brief: A type dependency, not a call: the reader needs the two new fields before seeing them set. Make clear that pending is the request the submitter raises and the worker clears, that runs is the count the worker increments, and that Job itself holds no lock; the queue's mutex_ is what protects these fields while the queue touches them. The reader takes this to the step where acquire sets pending.
The step before: W1.2 acquire locks the queue and finds or creates the slot — Under mutex_, slots_[key] yields the existing slot or a fresh empty one, which is then filled with a new Job.
The step after: W1.4 The job is marked pending, the worker notified, the handle returned — acquire sets pending, calls cv_.notify_all while still holding the lock, and returns the shared slot.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
A short pause in the execution order: before `acquire` goes on to mark the `Job` it just created (step W1.2), here is the type it created. `Job` is a plain struct with public fields and no methods, no constructor and no lock. In the earlier revision it held only `key`; the change adds two fields, and they are the whole of what passes between the submitting thread and the worker.

- `pending` is a request flag. `acquire` sets it to `true` on the caller's thread (next step), and the worker sets it back to `false` when it processes the job (W1.5). It is a flag, not a counter: it says "there is a request outstanding", and setting it when it is already set changes nothing, which is what a repeated submission comes down to in a later step (W1.7).
- `runs` is a tally that only the worker touches: it is incremented by one each time the worker finds `pending` set. Nothing in this revision resets it, and nothing in these files reads it.

Both have default initialisers, `false` and `0`, so the `std::make_shared<Job>()` in `acquire` yields a job that is not yet pending and has never run; `acquire` then writes `key` and, in the next step, `pending`.

What the reader must hold on to is what this type does not provide. **`Job` carries no synchronisation of its own**: `pending` and `runs` are an ordinary `bool` and `int`. Every write to them in this revision happens while the queue holds its `mutex_`, in `acquire` and in `workerLoop`, and that lock is what makes those accesses safe against each other. The lock belongs to the queue, not to the `Job`, which is the point a later step returns to when it asks what a holder of the returned handle may read (W1.6).

References: `Job` at src/work_queue.h (target) lines 9–13; the writers of its fields are `acquire` at src/work_queue.cpp (target) lines 19–21 and `workerLoop` at lines 31–33.

<!-- dspatch:details -->

The consequence of plain fields is a rule of the language, not a matter of style: under the C++ memory model, one thread writing a non-atomic `bool` or `int` while another thread reads or writes it, with no lock or atomic ordering between them, is a data race and undefined behaviour. Inside the queue that race does not exist, because `acquire` and the worker's scan both run under `mutex_`. The type itself establishes nothing: an access from any code that holds the `std::shared_ptr<Job>` but not the lock is unordered against the worker's writes, and `Job` offers no way to take that lock or to read the fields atomically.

The fields are also public and mutable from anywhere a handle reaches. The queue is the only writer in these files, but the type does not reserve the writes to it; a holder of the handle can set `pending` or change `runs` without the queue noticing, and the worker would act on whatever it finds under the lock.

One limit of the two fields together, an observation from reading: they record whether a request is outstanding and how many times the worker has counted the job, but not how many times it was submitted. A job submitted twice before the worker scanned and a job submitted once both end as `pending == false`, `runs == 1`; the history of submissions is not kept anywhere in this revision.

```

</details>

### Turn 5: write-step (file-2) · W1.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.4 The job is marked pending, the worker notified, the handle returned
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: acquire sets pending, calls cv_.notify_all while still holding the lock, and returns the shared slot.
- acquire: mark, notify, return: src/work_queue.cpp (To) lines 21–23
Brief: Back in acquire once the slot holds a Job. Make comprehensible that pending = true is the handover, that notify_all is issued while mutex_ is still held and the lock is released only when the lock_guard is destroyed at the return, and that the returned shared_ptr is the very object the worker will mutate. The reader takes to the next step that this notification is what wakes the worker thread.
The step before: W1.3 What a Job carries between submitter and worker — Job gains a pending flag and a runs counter beside its key.
The step after: W1.5 The worker wakes and processes every pending job — On the worker thread, cv_.wait returns, the loop scans all slots and turns each pending flag into a counted run.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
Back in `acquire`, with `mutex_` still held from its first line and `slot` now holding a `Job` (step W1.2), three lines complete the caller's side of the hand-over.

`slot->pending = true` is the hand-over itself. It is the only thing the submitting thread records about its request: no queue entry, no task object, just the flag from the previous step raised on the `Job`. It is written under the lock, so when the worker later reads it under the same lock, it sees this write.

`cv_.notify_all()` tells whoever is blocked in `cv_.wait` on the queue's condition variable to wake. Two things about it decide what the reader can expect. First, it is issued **while `mutex_` is still held**: `lock_guard` releases the mutex only when `acquire` returns, and a thread woken from `cv_.wait` must reacquire that mutex before `wait` returns, so the worker cannot start its scan until this function has finished. Second, a notification is a signal, not a delivery: it reaches only a thread that is waiting at that moment and is otherwise simply dropped. The flag stays set either way, but the worker's `wait` has no condition that would look at it later; what then wakes the worker is the subject of a later step (W1.8).

`return slot` copies the `std::shared_ptr` out of the map entry; the language constructs the return value before the local `lock_guard` is destroyed, so the copy is made under the lock and the mutex is released only after it. What leaves is a second owner of **the very `Job` object the worker is about to write to**. From the instant the lock is released, the worker may wake, take the lock and turn this `pending` into a counted run, so by the time `submit` hands the pointer to its caller the job may already be in either state.

References: src/work_queue.cpp (target) lines 21–23; the waiting side, `cv_.wait` in `workerLoop`, at line 29.

<!-- dspatch:details -->

Ordering of the two threads from here, as the code allows it when the worker is already waiting: the worker's `wait` is woken by the notify but blocks inside `wait` on `mutex_`; `acquire` constructs its return value, destroys the `lock_guard`, and releases the mutex; the worker's `wait` returns with the mutex held and the scan of the next step begins. The write of `pending` and the worker's read of it are therefore ordered by the mutex, which is what makes a plain `bool` adequate here. Notifying under the lock costs a possible wake-then-block on the worker side; it does not change what the worker observes. The destructor takes the other choice, releasing the lock before it notifies (walk W2, step 4), and the two orders are both correct uses of a condition variable.

`notify_all` rather than `notify_one` makes no difference in this revision: `worker_` is the only thread that ever waits on `cv_`, and nothing in these files creates another. The choice would matter only if more waiters were added.

The copy made by `return slot` means the reference count of the `Job` rises to at least two, the map's and the caller's, under the lock; the caller's copy is then handed on by `submit` unchanged. No field of the `Job` other than `pending` is written on this path, so for a reused slot (W1.7) `runs` keeps whatever count the worker had reached.

```

</details>

### Turn 6: write-step (file-2) · W1.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.5 The worker wakes and processes every pending job
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: On the worker thread, cv_.wait returns, the loop scans all slots and turns each pending flag into a counted run.
- workerLoop: wake-up and scan: src/work_queue.cpp (To) lines 29–35
Brief: A change of context: this code runs on the worker thread started in the constructor (see the walk 'How the worker thread starts, waits and stops'), which has been blocked in cv_.wait with mutex_ released. The notification from the previous step wakes it once acquire has released the lock, and wait reacquires mutex_ before returning. Make clear that the scan visits every slot, not only the submitted key, that the worker's whole effect on a job is pending = false and runs += 1, and that nothing else runs for a job in this revision. The reader takes to the next step that the caller meanwhile holds the same Job.
The step before: W1.4 The job is marked pending, the worker notified, the handle returned — acquire sets pending, calls cv_.notify_all while still holding the lock, and returns the shared slot.
The step after: W1.6 Back on the caller's thread: what the returned handle shares — The caller holds the same Job the worker writes to, and the only lock guarding its fields is private to the queue.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
A change of thread. This code runs on the worker thread that the `WorkQueue` constructor starts (walk W2 explains its lifetime); until now that thread has been blocked inside `cv_.wait(lock)`, with `mutex_` released for the duration of the wait. The `notify_all` of the previous step wakes it, and `wait` does not return until it has reacquired `mutex_`, which is only possible once `acquire` has returned and released it. So when the scan begins, the worker holds the lock, the submitting thread is out of the queue, and `pending` has been set.

The scan is a range-for over `slots_`, with a structured binding `[key, job]` for each map entry; `key` is unused and `job` is a reference to the `std::shared_ptr<Job>` the map holds. For every job whose `pending` is set, the worker clears the flag and adds one to `runs`. **That is the whole of what the worker does for a job in this revision**: there is no work function, no callback and no use of the key; "running" a job is this bookkeeping. If the reader expected the submitted key to trigger something, the code does not support it.

Two properties of the scan matter for judging the change. It visits **every slot, not the submitted key**: one wake-up consumes every outstanding request, whichever keys raised them, and a job not pending costs only its check. And it runs entirely under `mutex_`, so no `acquire` can interleave with it; a submission that arrives during the scan blocks on the lock until the worker has finished and gone back to waiting.

After the scan the loop returns to its condition and, unless stopping was requested, to `cv_.wait`; the exit is shown in walk W2. The next step returns to the caller's thread, which has meanwhile been holding a handle to the same `Job` this code just wrote to.

References: src/work_queue.cpp (target) lines 29–35; the lock the worker holds is the `unique_lock` of line 27, and the submitting side's write of `pending` is line 21.

<!-- dspatch:details -->

The order of lock ownership makes the hand-over work without any state besides the flag: `acquire` writes `pending` under the mutex, releases it, and the worker reads `pending` under the same mutex, so the read is ordered after the write. A submission that blocks on the lock during a scan proceeds only after `wait` has released the mutex again, sets its flag, and notifies; if the worker has by then re-entered `wait` the notification wakes it, and if it has not, the case of a later step applies (W1.8).

`cv_.wait` is called without a predicate, so it may also return without any notify, which condition variables permit. Such a wake-up only runs the scan, which finds nothing pending and changes nothing, so the loop tolerates it; the cost is the scan, not a wrong result.

Because `slots_` never shrinks (W1.2), each scan touches every key the queue has ever seen, and the cost of a wake-up grows with that number rather than with the number of pending jobs. Each entry is dereferenced with `job->pending` as it is visited, with no check that the pointer is set.

What a caller holding the handle can see of this scan is not ordered by anything: the worker's two writes happen under a lock the caller cannot take, so a caller that reads `pending` or `runs` while this code runs reads them concurrently with the writes. The next step takes that up from the caller's side.

```

</details>

### Turn 7: write-step (file-2) · W1.6

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.6 Back on the caller's thread: what the returned handle shares
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: The caller holds the same Job the worker writes to, and the only lock guarding its fields is private to the queue.
- the handle leaving submit: src/submit.cpp (To) lines 4–5
- the queue's private lock: src/work_queue.h (To) lines 21–24
Together: Seeing the handle leave the queue beside the private mutex that guards its fields shows at once that a caller cannot take that lock.
Revisit: Step 1 showed submit as the entry point; now the point is the handle the caller keeps, which the worker thread writes to concurrently.
Brief: Return to the caller's thread after submit has returned. The point now is the handle the caller is left with: the worker writes pending and runs under mutex_, mutex_ is a private member of WorkQueue, and Job carries no synchronisation of its own. This is where the reader judges what a caller may read from the handle and when; state what the code offers and leave the verdict to the reader.
The step before: W1.5 The worker wakes and processes every pending job — On the worker thread, cv_.wait returns, the loop scans all slots and turns each pending flag into a counted run.
The step after: W1.7 Back at the branch: the key already has a slot — When slots_[key] returns a non-null slot, acquire skips creation and marks the existing Job pending again.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
Back on the caller's thread, where step W1.1 left it: `submit` has returned, and the caller holds the `std::shared_ptr<Job>` that `acquire` copied out of the slot. The point now is not how the handle was produced but what it is. It refers to the queue's own `Job`, whose `pending` and `runs` the worker thread writes every time it scans (W1.5), and the worker may do so at any moment from the instant `acquire` released the lock; the first scan may already be over, or may not have started.

Beside the handle stands the only thing that orders those writes: `mutex_`, declared under `private:` in `WorkQueue`, next to `workerLoop`. The public surface of the class is the constructor, the destructor and `acquire`, nothing else. **No public operation takes `mutex_` on a caller's behalf, reads a job's fields under it, or waits for a job to be run.** The `Job` itself adds no lock or atomic (W1.3). So a caller that reads `pending` or `runs` through the handle does so with no ordering against the worker's writes, and under the language's rules a plain read that is concurrent with a plain write is a data race, whatever value it happens to produce. The code offers the caller no ordered way to learn whether, or how many times, its job has run while the queue is alive.

What the code does offer the caller is narrower. The handle is safe to hold, copy and destroy from any thread, because `std::shared_ptr` manages its count atomically, and the `Job` stays alive as long as the queue's slot or any copy of the handle exists. `key` is written once, in `acquire` on the caller's own thread before the handle leaves, and the worker never touches it, so reading `key` is safe. And once the `WorkQueue` has been destroyed, its destructor has joined the worker (walk W2), so a handle that outlives the queue refers to a `Job` nothing writes to any more; that is the one point in this revision where `pending` and `runs` can be read without a concurrent writer.

What a caller may read from the handle, and when, is for the reader to judge from this; the code states the facts above and nothing more.

References: the handle leaving `submit`, src/submit.cpp (target) lines 4–5; `private:`, `workerLoop` and `mutex_`, src/work_queue.h (target) lines 21–24; the worker's writes, src/work_queue.cpp (target) lines 32–33.

<!-- dspatch:details -->

The data-race rule applies per access, which is why the three fields fare differently. `key` has one writer, the submitting thread inside `acquire`, and that write is sequenced before `acquire` returns on the same thread; a later read on that thread, or on any thread that received the handle from it, sees the written value, and the worker's scan reads only `pending`. `pending` and `runs` have the worker as a writer, under `mutex_`, and the caller as a possible reader without it; the two are unordered. The same holds in the other direction: the fields are public, so a caller may also write them, and such a write is unordered against the worker's read of `pending` and write of `runs`.

The handle's own safety comes from the library, not from the queue. Copying or dropping a `std::shared_ptr` from several threads is defined behaviour; it is the pointee's fields that carry no such guarantee. Holding the handle does not keep the worker from writing, and dropping it does not remove the slot, since `slots_` keeps its own copy and nothing erases entries.

The window after destruction is a consequence of two things read elsewhere in the walks: the destructor joins `worker_` before the members are destroyed (src/work_queue.cpp (target) line 11), and destroying `slots_` only drops the map's references to the jobs. A caller that kept its handle across the queue's lifetime therefore ends with a `Job` whose `runs` is final. Whether any caller is written to do that cannot be read from these files, where `submit` has no caller.

```

</details>

### Turn 8: write-step (file-2) · W1.7

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.7 Back at the branch: the key already has a slot
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: When slots_[key] returns a non-null slot, acquire skips creation and marks the existing Job pending again.
- acquire: the existing-slot outcome: src/work_queue.cpp (To) lines 16–21
Revisit: Shown in step 2 for the new-key outcome; now the existing-slot outcome, where the branch is skipped and pending is raised on a Job that already exists.
Brief: An alternative outcome, starting again at the if (!slot) test of step 2: this time the key was acquired before, so operator[] returns the existing shared_ptr and the branch is not taken. Make clear that the same Job object is reused and pending is set again; if the worker has not scanned since the earlier submission, pending is already true and the two submissions become one run, and if it has, the job is counted a second time. The reader takes to the next path that timing against the worker decides what a submission counts for.
The step before: W1.6 Back on the caller's thread: what the returned handle shares — The caller holds the same Job the worker writes to, and the only lock guarding its fields is private to the queue.
The step after: W1.8 Back at the handover: the worker is not yet waiting — If acquire notifies before the worker thread has reached cv_.wait, nobody is waiting and the job stays pending until the next notification.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The walk is back at the branch point of step W1.2, inside `acquire` with `mutex_` held, but this time the key has been acquired before. `slots_[key]` finds the existing entry and returns a reference to the `std::shared_ptr<Job>` it already holds, so `if (!slot)` is false and the creation branch is skipped: no new `Job`, no write to `key`. The lines that follow run exactly as in step W1.4, now on the old object: `pending` is set, the condition variable is notified, and a copy of the same handle is returned. **A key names one `Job` for the life of the queue**; every submission of that key, from any caller, marks and receives the same object, and `runs` on it is a count for the key, not for this submission.

What this submission counts for is then decided by where the worker is, which the code leaves to scheduling:

- If the worker has not scanned since the earlier submission, `pending` is still `true`, and setting it again changes nothing. The next scan clears it once and adds one to `runs`: the two submissions become one run.
- If the worker has already scanned, `pending` is `false` and `runs` already counts the earlier run. Setting `pending` here is a fresh request, and the next scan adds a second run.

Nothing in `acquire` distinguishes the two cases, and nothing records that a second submission happened; the only trace is whatever `runs` later shows. The notify is issued in both cases, so a submission that finds the flag already raised still costs the worker a wake-up. The next step takes the same hand-over from the other side: what the code does when the notify is sent before the worker is waiting at all.

References: src/work_queue.cpp (target) lines 16–21; the worker's clearing of the flag, lines 31–33.

<!-- dspatch:details -->

The two cases are the only two, because the scan and `acquire` exclude each other through `mutex_`. A second submission cannot arrive in the middle of a scan: it blocks in `lock_guard` while the worker holds the lock from the return of `wait` through the scan and the loop condition, and proceeds only once the worker has released the lock inside the next `wait`. In that ordering the earlier run is complete, `pending` is clear, and the submission's notify finds the worker waiting, so the second run follows. The coalescing case needs the opposite ordering, where the second submission takes the lock before the worker has woken for the first.

The reuse also fixes what the handle from step W1.6 means across submissions: two callers that submitted the same key hold pointers to one object and share its `pending` and `runs`, with the same absence of ordering between their reads and the worker's writes. A submitter has no way to lower `pending` through `acquire`; the only path that clears it is the worker's scan.

Should the creation branch ever have left a null entry behind (the allocation case noted in W1.2), this outcome would not repair it: `if (!slot)` would be true again on the next submission and the creation would simply be retried.

```

</details>

### Turn 9: write-step (file-2) · W1.8

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.8 Back at the handover: the worker is not yet waiting
Walk W1 (walk): What happens when a caller submits a key. Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.
Summary: If acquire notifies before the worker thread has reached cv_.wait, nobody is waiting and the job stays pending until the next notification.
- workerLoop: entering the wait: src/work_queue.cpp (To) lines 27–29
Revisit: Step 5 showed the wait returning; now the entry into the wait, and what a notification sent before it means.
Brief: A second alternative, in timing rather than data, starting again at the notify of step 4. The worker thread must first take mutex_ at line 27, check stopping_ and enter cv_.wait at line 29; if acquire holds the lock before the worker gets there, notify_all finds no waiter, and the wait has no predicate that would look at pending afterwards. Make clear from the code what then wakes the worker: a later acquire, or the destructor's notify, after which the loop scans once more before it exits (see the lifecycle walk). Say what the code does, not whether it is intended.
The step before: W1.7 Back at the branch: the key already has a slot — When slots_[key] returns a non-null slot, acquire skips creation and marks the existing Job pending again.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The walk returns once more to the `notify_all` of step W1.4, this time to ask what it reaches. Step W1.5 followed the worker from the moment `wait` returned; here is how it gets into that wait. The worker thread, started by the constructor, first takes `mutex_` with a `unique_lock`, checks `stopping_`, and only then calls `cv_.wait(lock)`, which releases the mutex and blocks until notified. Nothing in this sequence looks at `pending`.

That opens a timing window the data cannot close. **If `acquire` runs before the worker has reached `wait`**, because the queue was constructed and a key submitted before the new thread got as far as line 27, or because the worker is blocked on `mutex_` while `acquire` holds it, then `notify_all` is issued while no thread is waiting, and a notification with no waiter is simply dropped. `pending` is set all the same. The worker then takes the lock, finds `stopping_` false, and enters `wait` with a job already pending and no predicate that would make `wait` return at once. It blocks.

What wakes it next is, from the code, one of two things:

- a later `acquire`, for any key, whose notify finds the worker waiting; the scan that follows visits every slot (W1.5), so the job left pending here is counted together with the new one;
- the destructor's `notify_all` when the queue is destroyed, after which the worker scans once more before the loop condition ends it (walk W2, step 5), so the job is counted at shutdown.

Until one of those happens the job stays pending and uncounted, for as long as the queue lives if no further submission arrives. A spurious return from `wait`, which condition variables permit, would also run the scan, but the code does not arrange for one.

References: `workerLoop` entering the wait, src/work_queue.cpp (target) lines 27–29; the notify that may find no waiter, line 22; the destructor's notify, line 10.

<!-- dspatch:details -->

The window is narrower than it may look, and the code's own locking is what narrows it. `cv_.wait(lock)` releases the mutex and begins waiting as one atomic step with respect to a notify, so a notify cannot fall between "released the lock" and "waiting" once the loop is running. After a scan the worker keeps the lock through the loop condition and into the next `wait`, so no `acquire` can run in between either (W1.7). The only moment the worker neither holds the lock nor waits on the condition variable is therefore before its first `lock(mutex_)` at line 27: from the thread's launch in the constructor until it first acquires the mutex. A submission that takes the lock first in that interval is the case above; one that comes after the worker's first `wait` finds a waiter.

With a worker blocked on the mutex at line 27, the sequence is: `acquire` holds the lock, sets `pending`, notifies into the void, releases; the worker acquires, reads `stopping_` as false, and waits. The flag and the wait are both in place, but the flag was set before the wait was entered, and `wait` without a predicate has no memory of it.

The same start-up ordering has a harder edge at shutdown. If the destructor runs before the worker has reached line 27 at all, the worker's first check of `stopping_` is already true: it never waits, never scans, and a job marked pending in that interval is never counted at all. That is the other ordering the lifecycle walk shows; here it matters because the destructor's notify is the last chance named above, and in that one ordering it does not lead to a scan.

```

</details>

### Turn 10: write-step (file-2) · W2.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.1 The constructor starts the worker thread
Walk W2 (walk): How the worker thread starts, waits and stops. Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.
Summary: WorkQueue's constructor launches worker_ with a lambda that calls workerLoop on this.
- the constructor: src/work_queue.cpp (To) lines 3–3
Brief: Entry: constructing a WorkQueue. Make comprehensible that the thread starts inside the member initializer list, that the lambda captures this and runs workerLoop on the new thread, and that from this moment the queue is used from two threads. The reader takes to the next step the question of what already exists when that thread starts.
The step after: W2.2 Member order decides what the worker may use — worker_ is declared last, after mutex_, cv_, stopping_ and slots_, so they are constructed before the thread runs.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This walk starts where a `WorkQueue` comes into being. The earlier revision had no constructor of its own and no thread; here the constructor's whole content is in its member initializer list, and its body `{}` is empty. `worker_` is a `std::thread`, and constructing a `std::thread` with a callable starts a new thread that runs it at once. So **the worker thread begins running before the constructor has returned**, as a side effect of initialising a member.

The callable is a lambda that captures `this` and calls `workerLoop()`, a private member function. "Private" governs who may name it, not which thread may run it: the lambda is inside the class, so it may call `workerLoop`, and the new thread runs it on the very object that is still being constructed. `workerLoop` immediately uses `mutex_`, `stopping_`, `cv_` and `slots_` (walk W1, step 5 showed its scan; step 3 of this walk shows its start), all members of the same object.

From this line on the queue is therefore in use from two threads: the one that is constructing it and will go on to call `acquire`, and the worker, which is already on its way to the lock. What the reader must settle before trusting this is whether those members exist when the worker reaches them, which is a question about the order in which members are constructed; the next step answers it from the class declaration.

References: the constructor, src/work_queue.cpp (target) line 3; `worker_` declared at src/work_queue.h (target) line 28; `workerLoop` at src/work_queue.cpp (target) lines 26–37.

<!-- dspatch:details -->

Capturing `this` in a thread that outlives the constructor is safe only if the object stays at that address, and here the types settle it: `WorkQueue` holds a `std::mutex` and a `std::condition_variable`, which can be neither copied nor moved, so the class's copy and move operations are implicitly deleted and a `WorkQueue` can never be relocated after construction. The pointer the lambda holds therefore refers to the live object until the destructor runs, and the destructor joins the thread before the members go (step 4 of this walk).

If starting the thread fails, `std::thread`'s constructor throws `std::system_error`. The members initialised before `worker_` are then destroyed in reverse order, the constructor does not complete, and the destructor never runs for this object; since no thread was started, there is nothing to join. The order in which that unwinding and the normal start both rely on the declaration order is the subject of the next step.

The thread is not detached, and nothing else owns it: it ends only when `workerLoop` returns, which only `stopping_` causes. A `WorkQueue` that is never destroyed keeps its worker blocked in `wait` indefinitely, and a thread that is still joinable when its `std::thread` is destroyed terminates the program, which is why the destructor's join (step 4) is not optional.

```

</details>

### Turn 11: write-step (file-2) · W2.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.2 Member order decides what the worker may use
Walk W2 (walk): How the worker thread starts, waits and stops. Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.
Summary: worker_ is declared last, after mutex_, cv_, stopping_ and slots_, so they are constructed before the thread runs.
- the WorkQueue class: src/work_queue.h (To) lines 15–29
Brief: A declaration the previous step depends on: members are constructed in declaration order, so the position of worker_ at the end of the class is what lets the lambda touch the other members safely. Also show the shape of the class: the public surface is the constructor, destructor and acquire; workerLoop and every data member are private. The reader takes this to the loop itself.
The step before: W2.1 The constructor starts the worker thread — WorkQueue's constructor launches worker_ with a lambda that calls workerLoop on this.
The step after: W2.3 The worker loop takes the lock and waits — On the worker thread, workerLoop locks mutex_ and, while stopping_ is false, blocks in cv_.wait, which releases the lock while waiting.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The previous step left a question: when the worker thread starts inside the constructor, do the members it is about to use exist yet? The answer is in this declaration and in a rule of the language. **Non-static data members are constructed in the order they are declared in the class**, whatever order a constructor's initializer list names them in. Here `mutex_`, `cv_`, `stopping_` and `slots_` come first, and `worker_` is last. So when the constructor reaches `worker_` and the `std::thread` starts, the mutex and the condition variable are already constructed, `stopping_` already holds its default `false`, and `slots_` is an empty map. The first things `workerLoop` does, lock `mutex_` and read `stopping_` (next step), are therefore operating on live objects.

Nothing but the position of `worker_` provides that guarantee. The constructor's initializer list only names `worker_`; the other four take their default constructors or, for `stopping_`, the default member initialiser, and they do so in declaration order because that is where they are declared. The same rule, reversed, governs the end of life: members are destroyed in reverse declaration order, so `worker_` goes first and `mutex_` last, after the destructor's body has joined the thread (step 4 of this walk).

The declaration also shows the whole surface of the class. Public are the constructor, the destructor and `acquire`; private are `workerLoop` and every data member. Compared with the earlier revision, which had only `slots_` and a `find` method, all of the synchronisation and the thread are new, and none of it is reachable from outside: a user of the class can construct it, submit keys through `acquire`, and destroy it, and that is all. That the lock is unreachable from a caller is what gave the handle question its shape in walk W1 (step 6).

References: the class, src/work_queue.h (target) lines 15–29; the initializer list that relies on this order, src/work_queue.cpp (target) line 3.

<!-- dspatch:details -->

The dependency on declaration order is real but silent. Moving `worker_` above `mutex_` in the class would compile unchanged and let the new thread call `lock` on a mutex whose constructor has not run, which is undefined behaviour; moving it above `stopping_` would let the loop condition read a `bool` before its initialiser ran. No comment, static assertion or test in these files marks the order as load-bearing, so a reader judging the change has only the declaration itself to go on. This is an observation from the code, not a report of anything observed to go wrong.

Two members pair by use rather than by type. `cv_` is not bound to `mutex_` by its declaration; it is the `unique_lock<std::mutex>` passed to `cv_.wait` in `workerLoop` that ties them, and both `acquire` and the destructor rely on using that same `mutex_` around `stopping_` and the jobs. `stopping_` is a plain `bool` protected by the same convention: every access to it in these files is under `mutex_`, which is what makes the loop condition and the destructor's write ordered.

The reverse destruction order matters for the thread in particular. A `std::thread` that is still joinable when destroyed calls `std::terminate`, so `worker_`, destroyed first among the members, must already have been joined; the destructor body does that before any member destructor runs. And because `mutex_` and `cv_` are destroyed last, and only after the thread has ended, no thread can be blocked in `wait` on a condition variable that is being destroyed.

```

</details>

### Turn 12: write-step (file-2) · W2.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.3 The worker loop takes the lock and waits
Walk W2 (walk): How the worker thread starts, waits and stops. Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.
Summary: On the worker thread, workerLoop locks mutex_ and, while stopping_ is false, blocks in cv_.wait, which releases the lock while waiting.
- workerLoop: lock and wait: src/work_queue.cpp (To) lines 26–29
Brief: Context: the worker thread, running the lambda from step 1. Make comprehensible that the unique_lock is held for the whole loop except inside wait, that wait has no predicate so the loop relies on being notified, that a spurious or unrelated wake-up only leads to a scan, and that the scan after each wake-up is what step 5 of the submit walk showed. The reader takes to the next step that only stopping_ ends the loop.
The step before: W2.2 Member order decides what the worker may use — worker_ is declared last, after mutex_, cv_, stopping_ and slots_, so they are constructed before the thread runs.
The step after: W2.4 The destructor asks the worker to stop and joins it — ~WorkQueue sets stopping_ under the lock, notifies the condition variable, and joins the thread before the members are destroyed.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
We are on the worker thread, at the top of `workerLoop`, the function the constructor's lambda calls (step 1). Its first act is to take `mutex_`, and the choice of `std::unique_lock` rather than `lock_guard` is not cosmetic: a condition variable's `wait` needs a lock it can release and reacquire, and `unique_lock` is the type that allows that. From here **the worker holds `mutex_` for the whole of its life except while it is blocked inside `cv_.wait`**. The loop condition, the scan and every line between them run under the lock; the only moments another thread can take `mutex_` are while the worker waits, before this line, and after the function returns.

The loop condition is `!stopping_`, read under the lock, and it is checked before the first wait. Only this flag ends the loop; there is no other exit, no count of work and no timeout. Then `cv_.wait(lock)` releases the mutex, blocks the thread, and when it returns has reacquired the mutex, so the code after it runs with the lock held again.

`wait` is called without a predicate, and that decides the loop's character. The worker is not waiting for some condition to become true; it is waiting to be poked. Any `notify_all` on `cv_`, from `acquire` or from the destructor, and any spurious return that the library allows, wakes it the same way, and what follows is always the scan of the slots that walk W1 showed (step 5): a wake-up with nothing pending costs a scan and changes nothing. The flip side was shown in the same walk (step 8): a notification sent while the worker is not inside `wait` is not remembered, because nothing here looks at `pending` before waiting.

After each scan the thread comes back to the condition. Only when `stopping_` has been set, which is the destructor's job in the next step, does the loop end.

References: src/work_queue.cpp (target) lines 26–29; the scan that follows every wake-up, lines 30–35; `stopping_` declared at src/work_queue.h (target) line 26.

<!-- dspatch:details -->

The lock ownership timeline, as the code fixes it: the thread acquires `mutex_` at line 27 and from then on releases it only inside `wait`. Each `wait` call unlocks and begins waiting atomically with respect to notifiers, blocks, and relocks before returning; the scan and the next check of `stopping_` then happen without any release in between. `acquire` and the destructor, which both lock `mutex_` with a `lock_guard`, can therefore run only while the worker is waiting or has not yet reached line 27, which is the basis of the two timing cases walk W1 drew (steps 7 and 8).

`stopping_` is a plain `bool`, and its read here is made safe by the same lock that the destructor takes to write it: the write and this read are both under `mutex_`, so the worker sees the write on its next check after the destructor's critical section. No atomic is involved, and the loop would not be correct if the read were moved outside the lock.

The wait has no deadline, so a worker with nothing to do blocks until the next notify. Nothing in this revision wakes it periodically, and the function has no way to end other than observing `stopping_`; if an exception escaped from `wait` or from the scan, there is no handler in the thread's callable, and an exception leaving a `std::thread`'s function terminates the program.

```

</details>

### Turn 13: write-step (file-2) · W2.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.4 The destructor asks the worker to stop and joins it
Walk W2 (walk): How the worker thread starts, waits and stops. Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.
Summary: ~WorkQueue sets stopping_ under the lock, notifies the condition variable, and joins the thread before the members are destroyed.
- the destructor: src/work_queue.cpp (To) lines 5–12
Brief: Entry of the shutdown path, on the thread that destroys the queue. Make clear why stopping_ is set inside its own block so the lock is released before notify_all and join, that join blocks until workerLoop returns, and that the data members are destroyed only after that. The reader takes to the next step how the worker observes the flag.
The step before: W2.3 The worker loop takes the lock and waits — On the worker thread, workerLoop locks mutex_ and, while stopping_ is false, blocks in cv_.wait, which releases the lock while waiting.
The step after: W2.5 Back in the worker: the stop is seen after one more scan — The notified worker wakes, scans the slots once more, then finds stopping_ true and leaves the loop, ending the thread.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The shutdown path starts here, on whichever thread destroys the `WorkQueue`; the earlier revision, having no thread, needed no destructor. The body does three things in a fixed order, and the order is the point.

First, `stopping_` is set to `true` under `mutex_`, inside a block of its own. The write must be under the lock because the worker reads the flag under the same lock in its loop condition (previous step); that is what makes the read see the write. The block is there so that **the lock is released before the notify and before the join**. Releasing before `join` is not optional: `join` blocks this thread until `workerLoop` returns, and `workerLoop` can return only after `wait` has reacquired `mutex_`, scanned, and read the flag. Joining while still holding the mutex would wait for a worker that is itself waiting for the mutex. Releasing before `notify_all` is a choice rather than a necessity, and the opposite of what `acquire` does (walk W1, step 4); here the woken worker finds the mutex free and goes straight on.

Second, `cv_.notify_all()` wakes the worker if it is blocked in `wait`. If it is not, because it has not yet reached its first lock, the notify is dropped, and that is harmless for this flag in a way it was not for `pending` (walk W1, step 8): the worker checks `stopping_` before every wait, so it finds the flag set at its first check and never waits at all.

Third, `worker_.join()` blocks until the worker thread has ended. Only when `join` returns does the destructor body finish, and only then are the members destroyed, in reverse order (step 2): `worker_` first, by then no longer joinable, and `mutex_` and `cv_` last, with no thread left to use them. How the worker gets from the notify to the end of `workerLoop`, and what it does with any job still pending on the way, is the next step.

References: the destructor, src/work_queue.cpp (target) lines 5–12; the worker's read of `stopping_`, line 28; the notify-under-lock it contrasts with, line 22.

<!-- dspatch:details -->

What the destructor does not guard is use of the queue by other threads while it runs. Nothing stops a thread from calling `acquire` after `stopping_` is set: `acquire` takes the lock, marks a job pending and notifies, and whether the worker still scans depends on whether it has already left the loop. A call that reaches the object after `join`, during or after the destruction of the members, is a use of a destroyed object. The code places the responsibility for not submitting to a queue being destroyed on the owner, and states nothing about it.

Jobs survive the queue. `slots_` holds one `std::shared_ptr` per job and is destroyed with the other members, which only drops the map's references; a caller still holding a handle from `submit` keeps its `Job` alive, now with no thread that writes to it (walk W1, step 6). The map itself, and with it the queue's memory of which keys were ever seen, ends here.

`join` is the only thing that keeps the member destructors safe. If `workerLoop` never returned, the destructor would block forever at `join` rather than destroy a `std::thread` that is still joinable, which would terminate the program; the loop's only exit being `stopping_`, and the flag being set here, is what makes `join` return. The destructor must not run on the worker thread itself, since a thread cannot join itself, but nothing in this revision runs any user code on the worker that could do so.

```

</details>

### Turn 14: write-step (file-2) · W2.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.5 Back in the worker: the stop is seen after one more scan
Walk W2 (walk): How the worker thread starts, waits and stops. Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.
Summary: The notified worker wakes, scans the slots once more, then finds stopping_ true and leaves the loop, ending the thread.
- workerLoop: the exit: src/work_queue.cpp (To) lines 28–37
Revisit: Step 3 showed the loop entering the wait; now the exit: the last scan and the loop condition that fails.
Brief: Context: the worker thread again, woken by the destructor's notify. Make comprehensible that wait returns with the lock held, that the scan still runs so pending jobs are counted one last time, that the while condition then fails and workerLoop returns, ending the lambda so join in the destructor returns. Also show the other ordering the code allows: if the worker had not yet reached wait when stopping_ was set, it finds the flag true at its first check and never waits.
The step before: W2.4 The destructor asks the worker to stop and joins it — ~WorkQueue sets stopping_ under the lock, notifies the condition variable, and joins the thread before the members are destroyed.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
Back on the worker thread, blocked in `cv_.wait` as step 3 left it, and now woken by the destructor's `notify_all` from the previous step. `wait` reacquires `mutex_` before it returns; the destructor released the lock before notifying, so the worker takes it without contention and continues with the lock held.

What follows the wait is the scan, unconditionally. The loop body does not look at `stopping_` before scanning, and the worker has no way to tell a shutdown wake-up from a submission wake-up, so **every job still pending gets counted one last time**: `pending` cleared, `runs` incremented, exactly as in a normal round (walk W1, step 5). Only after the scan does control reach the `while` condition again, and this time `!stopping_` is false. The loop ends, `workerLoop` returns, the `unique_lock` is destroyed on the way out and releases `mutex_`, the lambda from the constructor returns, and the thread is finished. That is the event `join` in the destructor has been waiting for; the destroying thread now continues to the member destructors.

The code allows a second ordering, and it is worth holding beside the first. If the destructor runs before the worker has reached its first lock, the worker takes `mutex_` only after `stopping_` is already `true`, finds the condition false at its very first check, and leaves without ever waiting or scanning. The thread ends just the same and `join` returns just the same; the difference is that no final scan happens, so a job marked pending in that interval is never counted. Which ordering occurs depends on scheduling between the constructing thread and the new one, and the code does nothing to choose.

References: the exit of `workerLoop`, src/work_queue.cpp (target) lines 28–37; the destructor's write and join it answers, lines 7–11.

<!-- dspatch:details -->

The final scan is a guarantee with a narrow scope: a job that is pending at the moment the worker wakes for the destructor's notify is counted. The lock fixes what can and cannot slip in around it. A submission that takes `mutex_` after the destructor's block has released it and before the worker has woken sets `pending` and is included in the final scan. A submission that arrives while the worker holds the lock, from the return of `wait` through the scan, the condition and the function's exit, blocks until the worker has released the mutex by returning; it then marks its job and notifies a condition variable nobody waits on any more, and the job is never counted. Both are uses of the queue during its destruction, which the destructor does not guard (previous step); the code states only what the worker does, not what the owner must refrain from.

The two orderings share one property: the loop exits only through the condition, and the condition is read under the lock, so the worker never leaves while another thread is between taking the lock and releasing it. There is no path on which the worker ends with the mutex held, since the `unique_lock` is a local of `workerLoop` and is released when the function returns, and the destructor's `join` therefore never waits for a thread that is stuck on the lock the destroying thread itself released.

After the thread has ended, the jobs remain as the last scan left them. Nothing resets `pending` or `runs` at shutdown, and nothing in these files reads them; a holder of a handle sees the final values, and the queue's own copies go when `slots_` is destroyed.

```

</details>

### Turn 15: write-step (file-2) · W3.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W3.1 The old submit discarded the lookup
Walk W3 (walk): What the old submit did, and what is gone. Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before.
Summary: In the base revision, submit called queue.find(key) and returned nothing.
- submit in the base revision: src/submit.cpp (From) lines 3–5
Brief: Entry of the old path, read on the From side. Make clear that submit returned void and dropped the result of find, so a caller learned nothing from submitting. Its replacement is step 1 of the walk 'What happens when a caller submits a key'. The reader takes to the next step what find did.
The step after: W3.2 find looked up without creating — find returned the existing Job for a key, or nullptr, and never inserted a slot or involved a thread.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This walk reads the earlier revision, so the code beside it is the old `submit`, not the one walk W1 started from. It is two lines of substance: a `void` function that calls `queue.find(key)` and does nothing with what comes back. `find` returns a `std::shared_ptr<Job>`, so the call produces a value, but as an expression statement that value is a temporary which is destroyed at the end of the line. **A caller of the old `submit` got nothing back and could observe nothing from having called it.** The function took a `WorkQueue` by reference and a key, and that was the whole of its contract.

What the call did inside the queue is the next step; the one thing to carry forward is that it was a lookup, and that the queue of this revision had no worker thread, no lock and no pending state for a lookup to affect. The old `submit` therefore left no lasting trace in the queue either, so there is no earlier behaviour that the new `submit` (walk W1, step 1) continues or preserves beyond accepting a key: the creation of a job, the worker and the returned handle are all new.

References: the old `submit`, src/submit.cpp (base) lines 3–5; `find` as it was declared, src/work_queue.h (base) line 12.

<!-- dspatch:details -->

The discarded result is the detail that decides how to read the change. The `std::shared_ptr` that `find` returned was a copy of the map's pointer, or null for an unknown key; constructing and destroying that temporary adjusts a reference count and nothing else, so even a caller who later inspected the queue could not tell that `submit` had been called. The new signature keeps the parameters and changes only the return type, so an existing call that ignores the result still compiles, but it now creates a slot, raises a flag and wakes a thread where before it looked something up and forgot it.

No header in either revision declares `submit`; it exists only as a definition in its own file. A caller in another translation unit must declare it itself, and such a declaration written for the old `void` return would no longer match the new definition. Whether any caller exists, and whether it was updated, cannot be read from these files.

```

</details>

### Turn 16: write-step (file-2) · W3.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W3.2 find looked up without creating
Walk W3 (walk): What the old submit did, and what is gone. Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before.
Summary: find returned the existing Job for a key, or nullptr, and never inserted a slot or involved a thread.
- find in the base revision: src/work_queue.cpp (From) lines 3–6 — reached from the call in the old submit (src/submit.cpp base 4–4)
Brief: Reached from the call in the old submit. Make comprehensible that std::map::find does not insert, that an unknown key yielded nullptr, and that there was no mutex, no worker and no pending state in this revision. Its replacement, acquire, is explained in the submit walk; contrast it briefly rather than re-explaining it here.
The step before: W3.1 The old submit discarded the lookup — In the base revision, submit called queue.find(key) and returned nothing.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
Reached from the old `submit`'s call (previous step), still on the earlier revision. `WorkQueue::find` is a read-only lookup: `slots_.find(key)` is `std::map::find`, which searches for the key and returns an iterator to the entry or `end()`, and **never inserts**. The conditional turns that into the return value: `nullptr` for an unknown key, a copy of the stored `std::shared_ptr<Job>` for a known one. Nothing is written, nothing is created, and the map is the same size after the call as before.

Around it there was nothing else. The `WorkQueue` of this revision has one method and one member: no constructor, no mutex, no condition variable, no thread and no `stopping_`; `Job` has only its `key`. A call to `find` ran on the caller's thread, touched a map and returned, and needed no lock because no second thread existed.

That is what the change removed and what it replaced. `find` is gone from the new class, and its place is taken by `acquire`, which walk W1 explains: the same map, but consulted with `operator[]`, which inserts, followed by creation of a `Job`, a flag raised and a notification to a worker thread, all under a lock (walk W1, steps 2 and 4). The new queue has no lookup that leaves the map untouched; every lookup is a submission. A caller of the new `submit` therefore gets creation, a worker and a handle that the old path never offered, and loses the one thing the old path had, a query with no side effect.

References: `find`, src/work_queue.cpp (base) lines 3–6; the old class with its single method, src/work_queue.h (base) lines 10–16; its replacement `acquire`, src/work_queue.cpp (target) lines 14–24.

<!-- dspatch:details -->

As these files show it, `find` could never have returned anything but `nullptr`. `slots_` is private, `find` is the class's only member function, there is no constructor and no friend, and `find` itself does not insert, so nothing in the base revision ever put an entry into the map. The lookup was correct in form and empty in effect: the old `submit` asked for a job in a map that, within this code, had no way to hold one. Whether other code outside these files once populated it cannot be read here; with `slots_` private and the class otherwise closed, it would have had to change the class to do so.

Removing `find` also removes a capability rather than only a function. The new class exposes nothing that reads a job without marking it pending, so any code that wanted to ask "is there a job for this key?" has no replacement in the target revision; `acquire` answers by creating one. If such a use existed outside these files, it no longer compiles against the new header, which is the one place the change would be forced into view.

```

</details>

### Turn 17: review-walks (file-3)

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
### W1 (walk): What happens when a caller submits a key
Purpose: Understand how submit hands a job to the worker thread, what the worker does with it, and what the caller is left holding.

#### W1.1 submit returns the job it acquires
- submit in the new revision: src/submit.cpp (To) lines 3–6

`submit` is where a caller hands a key to the queue, and in this revision it is a pure forwarding function: it calls `WorkQueue::acquire` with the key and returns what `acquire` returns, a `std::shared_ptr<Job>`. Nothing else happens on the caller's thread here. No lock is taken, nothing is checked, and the local `job` is only a name for the value on its way out, so the correctness of `submit` is the correctness of `acquire`.

What matters for the change is the return value. Before the change `submit` returned `void` and dropped the result of a lookup, so a caller learnt nothing from submitting. Now **the caller keeps a handle to the queue's own `Job` object**: the same object the queue stores in its slot and that the worker thread later writes to. Whether that `Job` is created fresh or reused from an earlier submission, and how the worker is told about it, is decided inside `acquire`, which the next step opens.

Two things are worth holding on to for the rest of the walk. `std::shared_ptr` means shared ownership, not a copy: the caller and the queue refer to one `Job`. And `submit` gives the caller no rule about when the fields of that `Job` may be read; that question is taken up in a later step (W1.6), once the worker's side has been seen.

References: `submit` at src/submit.cpp (target) lines 3–6; the call it forwards to, `WorkQueue::acquire`, declared at src/work_queue.h (target) line 19.

Show more:
The handle's lifetime follows from how `acquire` stores it: the queue keeps its own `std::shared_ptr` in `slots_` (src/work_queue.cpp (target) lines 16–23) and returns a copy, so the `Job` lives as long as either the slot or any caller's copy exists. Nothing in this revision erases a slot, so in practice the queue's copy keeps every `Job` alive for the queue's whole life; a caller's handle therefore never dangles, but it also never becomes the only owner while the queue exists.

Who calls `submit` is not visible in these files. No header declares it in either revision (src/work_queue.h (target) declares only `WorkQueue` and `Job`), and no file here calls it, so a caller in another translation unit would need its own declaration, and whether such a caller uses the returned handle or discards it cannot be read from this change. The signature allows both: a caller that ignores the return gets the old fire-and-forget shape of `submit`, but now with a slot created and a worker notified behind it.

#### W1.2 acquire locks the queue and finds or creates the slot
- acquire: lock, lookup and creation: src/work_queue.cpp (To) lines 14–20 — reached from the call in submit (src/submit.cpp target 4–4)

We are inside `WorkQueue::acquire`, still on the caller's thread, reached by the call that `submit` forwards (step W1.1). The first line takes the queue's lock: `std::lock_guard` locks `mutex_` when it is constructed and unlocks it only when it goes out of scope, which here is the end of the function. So **everything `acquire` does, including the marking and notification of a later step (W1.4), runs with `mutex_` held**, and the worker thread, which takes the same `mutex_` when it scans, can never be in the middle of a scan while this code runs.

The lookup and the creation are folded into one expression. `slots_[key]` is `std::map::operator[]`, and that operator does two things: it finds the entry for `key`, and if there is none it inserts one, default-constructed, and returns it. The mapped type is `std::shared_ptr<Job>`, whose default is a null pointer. `auto& slot` binds a reference to that entry inside the map, not a copy, so whatever is assigned to `slot` is what the map holds afterwards.

That is what the `if (!slot)` test is for. Following the new-key outcome first: the key has not been seen, `operator[]` has just inserted a null entry, the test is true, and the branch creates the `Job` with `std::make_shared<Job>()` and stores it through the reference into the slot, then writes the key into the `Job` itself. After the branch the slot holds a live `Job` whose `key` matches the map's key; the other fields take the defaults given in the `Job` type, which the next step shows. The other outcome, where the entry already held a `Job` and the branch is skipped, is a path of its own later in this walk (W1.7).

Worth noticing for the review: there is no lookup-without-insert here. Every distinct key passed to `acquire` leaves an entry in `slots_`, and nothing in this revision removes one, so the map only grows.

References: `acquire` at src/work_queue.cpp (target) lines 14–20; `mutex_` and `slots_` declared at src/work_queue.h (target) lines 24 and 27.

Show more:
The lock matters for the map as a container, not only for the `Job` fields. The worker loop iterates `slots_` with a range-for (src/work_queue.cpp (target) lines 30–35) while it holds `mutex_`, and `operator[]` here may insert a node while `acquire` holds it; because both sides take the same lock, an insertion can never happen during an iteration. A `std::map` is node-based, so inserting other keys does not invalidate the `slot` reference either, but inside this function that question does not arise: the reference is used only under the lock that excludes every other writer.

One case the code allows but does not handle, an observation from reading: `std::make_shared<Job>()` allocates, and if that allocation throws, the entry that `operator[]` already inserted stays in `slots_` as a null pointer, since the exception leaves the function before the assignment. The worker's scan dereferences every entry with `job->pending` without a null check, so a null slot left behind this way would be read as a `Job` on the next wake-up. Whether this is reachable in practice depends on the allocator and the caller's environment, which cannot be read from these files.

The key is stored twice, as the map's key and as `Job::key`, and `acquire` is the only place that writes the second copy. Nothing in this revision reads `Job::key` back, so the copy exists for whoever holds the returned handle rather than for the queue itself.

#### W1.3 What a Job carries between submitter and worker
- the Job struct: src/work_queue.h (To) lines 9–13

A short pause in the execution order: before `acquire` goes on to mark the `Job` it just created (step W1.2), here is the type it created. `Job` is a plain struct with public fields and no methods, no constructor and no lock. In the earlier revision it held only `key`; the change adds two fields, and they are the whole of what passes between the submitting thread and the worker.

- `pending` is a request flag. `acquire` sets it to `true` on the caller's thread (next step), and the worker sets it back to `false` when it processes the job (W1.5). It is a flag, not a counter: it says "there is a request outstanding", and setting it when it is already set changes nothing, which is what a repeated submission comes down to in a later step (W1.7).
- `runs` is a tally that only the worker touches: it is incremented by one each time the worker finds `pending` set. Nothing in this revision resets it, and nothing in these files reads it.

Both have default initialisers, `false` and `0`, so the `std::make_shared<Job>()` in `acquire` yields a job that is not yet pending and has never run; `acquire` then writes `key` and, in the next step, `pending`.

What the reader must hold on to is what this type does not provide. **`Job` carries no synchronisation of its own**: `pending` and `runs` are an ordinary `bool` and `int`. Every write to them in this revision happens while the queue holds its `mutex_`, in `acquire` and in `workerLoop`, and that lock is what makes those accesses safe against each other. The lock belongs to the queue, not to the `Job`, which is the point a later step returns to when it asks what a holder of the returned handle may read (W1.6).

References: `Job` at src/work_queue.h (target) lines 9–13; the writers of its fields are `acquire` at src/work_queue.cpp (target) lines 19–21 and `workerLoop` at lines 31–33.

Show more:
The consequence of plain fields is a rule of the language, not a matter of style: under the C++ memory model, one thread writing a non-atomic `bool` or `int` while another thread reads or writes it, with no lock or atomic ordering between them, is a data race and undefined behaviour. Inside the queue that race does not exist, because `acquire` and the worker's scan both run under `mutex_`. The type itself establishes nothing: an access from any code that holds the `std::shared_ptr<Job>` but not the lock is unordered against the worker's writes, and `Job` offers no way to take that lock or to read the fields atomically.

The fields are also public and mutable from anywhere a handle reaches. The queue is the only writer in these files, but the type does not reserve the writes to it; a holder of the handle can set `pending` or change `runs` without the queue noticing, and the worker would act on whatever it finds under the lock.

One limit of the two fields together, an observation from reading: they record whether a request is outstanding and how many times the worker has counted the job, but not how many times it was submitted. A job submitted twice before the worker scanned and a job submitted once both end as `pending == false`, `runs == 1`; the history of submissions is not kept anywhere in this revision.

#### W1.4 The job is marked pending, the worker notified, the handle returned
- acquire: mark, notify, return: src/work_queue.cpp (To) lines 21–23

Back in `acquire`, with `mutex_` still held from its first line and `slot` now holding a `Job` (step W1.2), three lines complete the caller's side of the hand-over.

`slot->pending = true` is the hand-over itself. It is the only thing the submitting thread records about its request: no queue entry, no task object, just the flag from the previous step raised on the `Job`. It is written under the lock, so when the worker later reads it under the same lock, it sees this write.

`cv_.notify_all()` tells whoever is blocked in `cv_.wait` on the queue's condition variable to wake. Two things about it decide what the reader can expect. First, it is issued **while `mutex_` is still held**: `lock_guard` releases the mutex only when `acquire` returns, and a thread woken from `cv_.wait` must reacquire that mutex before `wait` returns, so the worker cannot start its scan until this function has finished. Second, a notification is a signal, not a delivery: it reaches only a thread that is waiting at that moment and is otherwise simply dropped. The flag stays set either way, but the worker's `wait` has no condition that would look at it later; what then wakes the worker is the subject of a later step (W1.8).

`return slot` copies the `std::shared_ptr` out of the map entry; the language constructs the return value before the local `lock_guard` is destroyed, so the copy is made under the lock and the mutex is released only after it. What leaves is a second owner of **the very `Job` object the worker is about to write to**. From the instant the lock is released, the worker may wake, take the lock and turn this `pending` into a counted run, so by the time `submit` hands the pointer to its caller the job may already be in either state.

References: src/work_queue.cpp (target) lines 21–23; the waiting side, `cv_.wait` in `workerLoop`, at line 29.

Show more:
Ordering of the two threads from here, as the code allows it when the worker is already waiting: the worker's `wait` is woken by the notify but blocks inside `wait` on `mutex_`; `acquire` constructs its return value, destroys the `lock_guard`, and releases the mutex; the worker's `wait` returns with the mutex held and the scan of the next step begins. The write of `pending` and the worker's read of it are therefore ordered by the mutex, which is what makes a plain `bool` adequate here. Notifying under the lock costs a possible wake-then-block on the worker side; it does not change what the worker observes. The destructor takes the other choice, releasing the lock before it notifies (walk W2, step 4), and the two orders are both correct uses of a condition variable.

`notify_all` rather than `notify_one` makes no difference in this revision: `worker_` is the only thread that ever waits on `cv_`, and nothing in these files creates another. The choice would matter only if more waiters were added.

The copy made by `return slot` means the reference count of the `Job` rises to at least two, the map's and the caller's, under the lock; the caller's copy is then handed on by `submit` unchanged. No field of the `Job` other than `pending` is written on this path, so for a reused slot (W1.7) `runs` keeps whatever count the worker had reached.

#### W1.5 The worker wakes and processes every pending job
- workerLoop: wake-up and scan: src/work_queue.cpp (To) lines 29–35

A change of thread. This code runs on the worker thread that the `WorkQueue` constructor starts (walk W2 explains its lifetime); until now that thread has been blocked inside `cv_.wait(lock)`, with `mutex_` released for the duration of the wait. The `notify_all` of the previous step wakes it, and `wait` does not return until it has reacquired `mutex_`, which is only possible once `acquire` has returned and released it. So when the scan begins, the worker holds the lock, the submitting thread is out of the queue, and `pending` has been set.

The scan is a range-for over `slots_`, with a structured binding `[key, job]` for each map entry; `key` is unused and `job` is a reference to the `std::shared_ptr<Job>` the map holds. For every job whose `pending` is set, the worker clears the flag and adds one to `runs`. **That is the whole of what the worker does for a job in this revision**: there is no work function, no callback and no use of the key; "running" a job is this bookkeeping. If the reader expected the submitted key to trigger something, the code does not support it.

Two properties of the scan matter for judging the change. It visits **every slot, not the submitted key**: one wake-up consumes every outstanding request, whichever keys raised them, and a job not pending costs only its check. And it runs entirely under `mutex_`, so no `acquire` can interleave with it; a submission that arrives during the scan blocks on the lock until the worker has finished and gone back to waiting.

After the scan the loop returns to its condition and, unless stopping was requested, to `cv_.wait`; the exit is shown in walk W2. The next step returns to the caller's thread, which has meanwhile been holding a handle to the same `Job` this code just wrote to.

References: src/work_queue.cpp (target) lines 29–35; the lock the worker holds is the `unique_lock` of line 27, and the submitting side's write of `pending` is line 21.

Show more:
The order of lock ownership makes the hand-over work without any state besides the flag: `acquire` writes `pending` under the mutex, releases it, and the worker reads `pending` under the same mutex, so the read is ordered after the write. A submission that blocks on the lock during a scan proceeds only after `wait` has released the mutex again, sets its flag, and notifies; if the worker has by then re-entered `wait` the notification wakes it, and if it has not, the case of a later step applies (W1.8).

`cv_.wait` is called without a predicate, so it may also return without any notify, which condition variables permit. Such a wake-up only runs the scan, which finds nothing pending and changes nothing, so the loop tolerates it; the cost is the scan, not a wrong result.

Because `slots_` never shrinks (W1.2), each scan touches every key the queue has ever seen, and the cost of a wake-up grows with that number rather than with the number of pending jobs. Each entry is dereferenced with `job->pending` as it is visited, with no check that the pointer is set.

What a caller holding the handle can see of this scan is not ordered by anything: the worker's two writes happen under a lock the caller cannot take, so a caller that reads `pending` or `runs` while this code runs reads them concurrently with the writes. The next step takes that up from the caller's side.

#### W1.6 Back on the caller's thread: what the returned handle shares
- the handle leaving submit: src/submit.cpp (To) lines 4–5
- the queue's private lock: src/work_queue.h (To) lines 21–24

Back on the caller's thread, where step W1.1 left it: `submit` has returned, and the caller holds the `std::shared_ptr<Job>` that `acquire` copied out of the slot. The point now is not how the handle was produced but what it is. It refers to the queue's own `Job`, whose `pending` and `runs` the worker thread writes every time it scans (W1.5), and the worker may do so at any moment from the instant `acquire` released the lock; the first scan may already be over, or may not have started.

Beside the handle stands the only thing that orders those writes: `mutex_`, declared under `private:` in `WorkQueue`, next to `workerLoop`. The public surface of the class is the constructor, the destructor and `acquire`, nothing else. **No public operation takes `mutex_` on a caller's behalf, reads a job's fields under it, or waits for a job to be run.** The `Job` itself adds no lock or atomic (W1.3). So a caller that reads `pending` or `runs` through the handle does so with no ordering against the worker's writes, and under the language's rules a plain read that is concurrent with a plain write is a data race, whatever value it happens to produce. The code offers the caller no ordered way to learn whether, or how many times, its job has run while the queue is alive.

What the code does offer the caller is narrower. The handle is safe to hold, copy and destroy from any thread, because `std::shared_ptr` manages its count atomically, and the `Job` stays alive as long as the queue's slot or any copy of the handle exists. `key` is written once, in `acquire` on the caller's own thread before the handle leaves, and the worker never touches it, so reading `key` is safe. And once the `WorkQueue` has been destroyed, its destructor has joined the worker (walk W2), so a handle that outlives the queue refers to a `Job` nothing writes to any more; that is the one point in this revision where `pending` and `runs` can be read without a concurrent writer.

What a caller may read from the handle, and when, is for the reader to judge from this; the code states the facts above and nothing more.

References: the handle leaving `submit`, src/submit.cpp (target) lines 4–5; `private:`, `workerLoop` and `mutex_`, src/work_queue.h (target) lines 21–24; the worker's writes, src/work_queue.cpp (target) lines 32–33.

Show more:
The data-race rule applies per access, which is why the three fields fare differently. `key` has one writer, the submitting thread inside `acquire`, and that write is sequenced before `acquire` returns on the same thread; a later read on that thread, or on any thread that received the handle from it, sees the written value, and the worker's scan reads only `pending`. `pending` and `runs` have the worker as a writer, under `mutex_`, and the caller as a possible reader without it; the two are unordered. The same holds in the other direction: the fields are public, so a caller may also write them, and such a write is unordered against the worker's read of `pending` and write of `runs`.

The handle's own safety comes from the library, not from the queue. Copying or dropping a `std::shared_ptr` from several threads is defined behaviour; it is the pointee's fields that carry no such guarantee. Holding the handle does not keep the worker from writing, and dropping it does not remove the slot, since `slots_` keeps its own copy and nothing erases entries.

The window after destruction is a consequence of two things read elsewhere in the walks: the destructor joins `worker_` before the members are destroyed (src/work_queue.cpp (target) line 11), and destroying `slots_` only drops the map's references to the jobs. A caller that kept its handle across the queue's lifetime therefore ends with a `Job` whose `runs` is final. Whether any caller is written to do that cannot be read from these files, where `submit` has no caller.

#### W1.7 Back at the branch: the key already has a slot
- acquire: the existing-slot outcome: src/work_queue.cpp (To) lines 16–21

The walk is back at the branch point of step W1.2, inside `acquire` with `mutex_` held, but this time the key has been acquired before. `slots_[key]` finds the existing entry and returns a reference to the `std::shared_ptr<Job>` it already holds, so `if (!slot)` is false and the creation branch is skipped: no new `Job`, no write to `key`. The lines that follow run exactly as in step W1.4, now on the old object: `pending` is set, the condition variable is notified, and a copy of the same handle is returned. **A key names one `Job` for the life of the queue**; every submission of that key, from any caller, marks and receives the same object, and `runs` on it is a count for the key, not for this submission.

What this submission counts for is then decided by where the worker is, which the code leaves to scheduling:

- If the worker has not scanned since the earlier submission, `pending` is still `true`, and setting it again changes nothing. The next scan clears it once and adds one to `runs`: the two submissions become one run.
- If the worker has already scanned, `pending` is `false` and `runs` already counts the earlier run. Setting `pending` here is a fresh request, and the next scan adds a second run.

Nothing in `acquire` distinguishes the two cases, and nothing records that a second submission happened; the only trace is whatever `runs` later shows. The notify is issued in both cases, so a submission that finds the flag already raised still costs the worker a wake-up. The next step takes the same hand-over from the other side: what the code does when the notify is sent before the worker is waiting at all.

References: src/work_queue.cpp (target) lines 16–21; the worker's clearing of the flag, lines 31–33.

Show more:
The two cases are the only two, because the scan and `acquire` exclude each other through `mutex_`. A second submission cannot arrive in the middle of a scan: it blocks in `lock_guard` while the worker holds the lock from the return of `wait` through the scan and the loop condition, and proceeds only once the worker has released the lock inside the next `wait`. In that ordering the earlier run is complete, `pending` is clear, and the submission's notify finds the worker waiting, so the second run follows. The coalescing case needs the opposite ordering, where the second submission takes the lock before the worker has woken for the first.

The reuse also fixes what the handle from step W1.6 means across submissions: two callers that submitted the same key hold pointers to one object and share its `pending` and `runs`, with the same absence of ordering between their reads and the worker's writes. A submitter has no way to lower `pending` through `acquire`; the only path that clears it is the worker's scan.

Should the creation branch ever have left a null entry behind (the allocation case noted in W1.2), this outcome would not repair it: `if (!slot)` would be true again on the next submission and the creation would simply be retried.

#### W1.8 Back at the handover: the worker is not yet waiting
- workerLoop: entering the wait: src/work_queue.cpp (To) lines 27–29

The walk returns once more to the `notify_all` of step W1.4, this time to ask what it reaches. Step W1.5 followed the worker from the moment `wait` returned; here is how it gets into that wait. The worker thread, started by the constructor, first takes `mutex_` with a `unique_lock`, checks `stopping_`, and only then calls `cv_.wait(lock)`, which releases the mutex and blocks until notified. Nothing in this sequence looks at `pending`.

That opens a timing window the data cannot close. **If `acquire` runs before the worker has reached `wait`**, because the queue was constructed and a key submitted before the new thread got as far as line 27, or because the worker is blocked on `mutex_` while `acquire` holds it, then `notify_all` is issued while no thread is waiting, and a notification with no waiter is simply dropped. `pending` is set all the same. The worker then takes the lock, finds `stopping_` false, and enters `wait` with a job already pending and no predicate that would make `wait` return at once. It blocks.

What wakes it next is, from the code, one of two things:

- a later `acquire`, for any key, whose notify finds the worker waiting; the scan that follows visits every slot (W1.5), so the job left pending here is counted together with the new one;
- the destructor's `notify_all` when the queue is destroyed, after which the worker scans once more before the loop condition ends it (walk W2, step 5), so the job is counted at shutdown.

Until one of those happens the job stays pending and uncounted, for as long as the queue lives if no further submission arrives. A spurious return from `wait`, which condition variables permit, would also run the scan, but the code does not arrange for one.

References: `workerLoop` entering the wait, src/work_queue.cpp (target) lines 27–29; the notify that may find no waiter, line 22; the destructor's notify, line 10.

Show more:
The window is narrower than it may look, and the code's own locking is what narrows it. `cv_.wait(lock)` releases the mutex and begins waiting as one atomic step with respect to a notify, so a notify cannot fall between "released the lock" and "waiting" once the loop is running. After a scan the worker keeps the lock through the loop condition and into the next `wait`, so no `acquire` can run in between either (W1.7). The only moment the worker neither holds the lock nor waits on the condition variable is therefore before its first `lock(mutex_)` at line 27: from the thread's launch in the constructor until it first acquires the mutex. A submission that takes the lock first in that interval is the case above; one that comes after the worker's first `wait` finds a waiter.

With a worker blocked on the mutex at line 27, the sequence is: `acquire` holds the lock, sets `pending`, notifies into the void, releases; the worker acquires, reads `stopping_` as false, and waits. The flag and the wait are both in place, but the flag was set before the wait was entered, and `wait` without a predicate has no memory of it.

The same start-up ordering has a harder edge at shutdown. If the destructor runs before the worker has reached line 27 at all, the worker's first check of `stopping_` is already true: it never waits, never scans, and a job marked pending in that interval is never counted at all. That is the other ordering the lifecycle walk shows; here it matters because the destructor's notify is the last chance named above, and in that one ordering it does not lead to a scan.

### W2 (walk): How the worker thread starts, waits and stops
Purpose: Understand the worker's lifetime from the constructor to the join in the destructor, and why the member order makes the start safe.

#### W2.1 The constructor starts the worker thread
- the constructor: src/work_queue.cpp (To) lines 3–3

This walk starts where a `WorkQueue` comes into being. The earlier revision had no constructor of its own and no thread; here the constructor's whole content is in its member initializer list, and its body `{}` is empty. `worker_` is a `std::thread`, and constructing a `std::thread` with a callable starts a new thread that runs it at once. So **the worker thread begins running before the constructor has returned**, as a side effect of initialising a member.

The callable is a lambda that captures `this` and calls `workerLoop()`, a private member function. "Private" governs who may name it, not which thread may run it: the lambda is inside the class, so it may call `workerLoop`, and the new thread runs it on the very object that is still being constructed. `workerLoop` immediately uses `mutex_`, `stopping_`, `cv_` and `slots_` (walk W1, step 5 showed its scan; step 3 of this walk shows its start), all members of the same object.

From this line on the queue is therefore in use from two threads: the one that is constructing it and will go on to call `acquire`, and the worker, which is already on its way to the lock. What the reader must settle before trusting this is whether those members exist when the worker reaches them, which is a question about the order in which members are constructed; the next step answers it from the class declaration.

References: the constructor, src/work_queue.cpp (target) line 3; `worker_` declared at src/work_queue.h (target) line 28; `workerLoop` at src/work_queue.cpp (target) lines 26–37.

Show more:
Capturing `this` in a thread that outlives the constructor is safe only if the object stays at that address, and here the types settle it: `WorkQueue` holds a `std::mutex` and a `std::condition_variable`, which can be neither copied nor moved, so the class's copy and move operations are implicitly deleted and a `WorkQueue` can never be relocated after construction. The pointer the lambda holds therefore refers to the live object until the destructor runs, and the destructor joins the thread before the members go (step 4 of this walk).

If starting the thread fails, `std::thread`'s constructor throws `std::system_error`. The members initialised before `worker_` are then destroyed in reverse order, the constructor does not complete, and the destructor never runs for this object; since no thread was started, there is nothing to join. The order in which that unwinding and the normal start both rely on the declaration order is the subject of the next step.

The thread is not detached, and nothing else owns it: it ends only when `workerLoop` returns, which only `stopping_` causes. A `WorkQueue` that is never destroyed keeps its worker blocked in `wait` indefinitely, and a thread that is still joinable when its `std::thread` is destroyed terminates the program, which is why the destructor's join (step 4) is not optional.

#### W2.2 Member order decides what the worker may use
- the WorkQueue class: src/work_queue.h (To) lines 15–29

The previous step left a question: when the worker thread starts inside the constructor, do the members it is about to use exist yet? The answer is in this declaration and in a rule of the language. **Non-static data members are constructed in the order they are declared in the class**, whatever order a constructor's initializer list names them in. Here `mutex_`, `cv_`, `stopping_` and `slots_` come first, and `worker_` is last. So when the constructor reaches `worker_` and the `std::thread` starts, the mutex and the condition variable are already constructed, `stopping_` already holds its default `false`, and `slots_` is an empty map. The first things `workerLoop` does, lock `mutex_` and read `stopping_` (next step), are therefore operating on live objects.

Nothing but the position of `worker_` provides that guarantee. The constructor's initializer list only names `worker_`; the other four take their default constructors or, for `stopping_`, the default member initialiser, and they do so in declaration order because that is where they are declared. The same rule, reversed, governs the end of life: members are destroyed in reverse declaration order, so `worker_` goes first and `mutex_` last, after the destructor's body has joined the thread (step 4 of this walk).

The declaration also shows the whole surface of the class. Public are the constructor, the destructor and `acquire`; private are `workerLoop` and every data member. Compared with the earlier revision, which had only `slots_` and a `find` method, all of the synchronisation and the thread are new, and none of it is reachable from outside: a user of the class can construct it, submit keys through `acquire`, and destroy it, and that is all. That the lock is unreachable from a caller is what gave the handle question its shape in walk W1 (step 6).

References: the class, src/work_queue.h (target) lines 15–29; the initializer list that relies on this order, src/work_queue.cpp (target) line 3.

Show more:
The dependency on declaration order is real but silent. Moving `worker_` above `mutex_` in the class would compile unchanged and let the new thread call `lock` on a mutex whose constructor has not run, which is undefined behaviour; moving it above `stopping_` would let the loop condition read a `bool` before its initialiser ran. No comment, static assertion or test in these files marks the order as load-bearing, so a reader judging the change has only the declaration itself to go on. This is an observation from the code, not a report of anything observed to go wrong.

Two members pair by use rather than by type. `cv_` is not bound to `mutex_` by its declaration; it is the `unique_lock<std::mutex>` passed to `cv_.wait` in `workerLoop` that ties them, and both `acquire` and the destructor rely on using that same `mutex_` around `stopping_` and the jobs. `stopping_` is a plain `bool` protected by the same convention: every access to it in these files is under `mutex_`, which is what makes the loop condition and the destructor's write ordered.

The reverse destruction order matters for the thread in particular. A `std::thread` that is still joinable when destroyed calls `std::terminate`, so `worker_`, destroyed first among the members, must already have been joined; the destructor body does that before any member destructor runs. And because `mutex_` and `cv_` are destroyed last, and only after the thread has ended, no thread can be blocked in `wait` on a condition variable that is being destroyed.

#### W2.3 The worker loop takes the lock and waits
- workerLoop: lock and wait: src/work_queue.cpp (To) lines 26–29

We are on the worker thread, at the top of `workerLoop`, the function the constructor's lambda calls (step 1). Its first act is to take `mutex_`, and the choice of `std::unique_lock` rather than `lock_guard` is not cosmetic: a condition variable's `wait` needs a lock it can release and reacquire, and `unique_lock` is the type that allows that. From here **the worker holds `mutex_` for the whole of its life except while it is blocked inside `cv_.wait`**. The loop condition, the scan and every line between them run under the lock; the only moments another thread can take `mutex_` are while the worker waits, before this line, and after the function returns.

The loop condition is `!stopping_`, read under the lock, and it is checked before the first wait. Only this flag ends the loop; there is no other exit, no count of work and no timeout. Then `cv_.wait(lock)` releases the mutex, blocks the thread, and when it returns has reacquired the mutex, so the code after it runs with the lock held again.

`wait` is called without a predicate, and that decides the loop's character. The worker is not waiting for some condition to become true; it is waiting to be poked. Any `notify_all` on `cv_`, from `acquire` or from the destructor, and any spurious return that the library allows, wakes it the same way, and what follows is always the scan of the slots that walk W1 showed (step 5): a wake-up with nothing pending costs a scan and changes nothing. The flip side was shown in the same walk (step 8): a notification sent while the worker is not inside `wait` is not remembered, because nothing here looks at `pending` before waiting.

After each scan the thread comes back to the condition. Only when `stopping_` has been set, which is the destructor's job in the next step, does the loop end.

References: src/work_queue.cpp (target) lines 26–29; the scan that follows every wake-up, lines 30–35; `stopping_` declared at src/work_queue.h (target) line 26.

Show more:
The lock ownership timeline, as the code fixes it: the thread acquires `mutex_` at line 27 and from then on releases it only inside `wait`. Each `wait` call unlocks and begins waiting atomically with respect to notifiers, blocks, and relocks before returning; the scan and the next check of `stopping_` then happen without any release in between. `acquire` and the destructor, which both lock `mutex_` with a `lock_guard`, can therefore run only while the worker is waiting or has not yet reached line 27, which is the basis of the two timing cases walk W1 drew (steps 7 and 8).

`stopping_` is a plain `bool`, and its read here is made safe by the same lock that the destructor takes to write it: the write and this read are both under `mutex_`, so the worker sees the write on its next check after the destructor's critical section. No atomic is involved, and the loop would not be correct if the read were moved outside the lock.

The wait has no deadline, so a worker with nothing to do blocks until the next notify. Nothing in this revision wakes it periodically, and the function has no way to end other than observing `stopping_`; if an exception escaped from `wait` or from the scan, there is no handler in the thread's callable, and an exception leaving a `std::thread`'s function terminates the program.

#### W2.4 The destructor asks the worker to stop and joins it
- the destructor: src/work_queue.cpp (To) lines 5–12

The shutdown path starts here, on whichever thread destroys the `WorkQueue`; the earlier revision, having no thread, needed no destructor. The body does three things in a fixed order, and the order is the point.

First, `stopping_` is set to `true` under `mutex_`, inside a block of its own. The write must be under the lock because the worker reads the flag under the same lock in its loop condition (previous step); that is what makes the read see the write. The block is there so that **the lock is released before the notify and before the join**. Releasing before `join` is not optional: `join` blocks this thread until `workerLoop` returns, and `workerLoop` can return only after `wait` has reacquired `mutex_`, scanned, and read the flag. Joining while still holding the mutex would wait for a worker that is itself waiting for the mutex. Releasing before `notify_all` is a choice rather than a necessity, and the opposite of what `acquire` does (walk W1, step 4); here the woken worker finds the mutex free and goes straight on.

Second, `cv_.notify_all()` wakes the worker if it is blocked in `wait`. If it is not, because it has not yet reached its first lock, the notify is dropped, and that is harmless for this flag in a way it was not for `pending` (walk W1, step 8): the worker checks `stopping_` before every wait, so it finds the flag set at its first check and never waits at all.

Third, `worker_.join()` blocks until the worker thread has ended. Only when `join` returns does the destructor body finish, and only then are the members destroyed, in reverse order (step 2): `worker_` first, by then no longer joinable, and `mutex_` and `cv_` last, with no thread left to use them. How the worker gets from the notify to the end of `workerLoop`, and what it does with any job still pending on the way, is the next step.

References: the destructor, src/work_queue.cpp (target) lines 5–12; the worker's read of `stopping_`, line 28; the notify-under-lock it contrasts with, line 22.

Show more:
What the destructor does not guard is use of the queue by other threads while it runs. Nothing stops a thread from calling `acquire` after `stopping_` is set: `acquire` takes the lock, marks a job pending and notifies, and whether the worker still scans depends on whether it has already left the loop. A call that reaches the object after `join`, during or after the destruction of the members, is a use of a destroyed object. The code places the responsibility for not submitting to a queue being destroyed on the owner, and states nothing about it.

Jobs survive the queue. `slots_` holds one `std::shared_ptr` per job and is destroyed with the other members, which only drops the map's references; a caller still holding a handle from `submit` keeps its `Job` alive, now with no thread that writes to it (walk W1, step 6). The map itself, and with it the queue's memory of which keys were ever seen, ends here.

`join` is the only thing that keeps the member destructors safe. If `workerLoop` never returned, the destructor would block forever at `join` rather than destroy a `std::thread` that is still joinable, which would terminate the program; the loop's only exit being `stopping_`, and the flag being set here, is what makes `join` return. The destructor must not run on the worker thread itself, since a thread cannot join itself, but nothing in this revision runs any user code on the worker that could do so.

#### W2.5 Back in the worker: the stop is seen after one more scan
- workerLoop: the exit: src/work_queue.cpp (To) lines 28–37

Back on the worker thread, blocked in `cv_.wait` as step 3 left it, and now woken by the destructor's `notify_all` from the previous step. `wait` reacquires `mutex_` before it returns; the destructor released the lock before notifying, so the worker takes it without contention and continues with the lock held.

What follows the wait is the scan, unconditionally. The loop body does not look at `stopping_` before scanning, and the worker has no way to tell a shutdown wake-up from a submission wake-up, so **every job still pending gets counted one last time**: `pending` cleared, `runs` incremented, exactly as in a normal round (walk W1, step 5). Only after the scan does control reach the `while` condition again, and this time `!stopping_` is false. The loop ends, `workerLoop` returns, the `unique_lock` is destroyed on the way out and releases `mutex_`, the lambda from the constructor returns, and the thread is finished. That is the event `join` in the destructor has been waiting for; the destroying thread now continues to the member destructors.

The code allows a second ordering, and it is worth holding beside the first. If the destructor runs before the worker has reached its first lock, the worker takes `mutex_` only after `stopping_` is already `true`, finds the condition false at its very first check, and leaves without ever waiting or scanning. The thread ends just the same and `join` returns just the same; the difference is that no final scan happens, so a job marked pending in that interval is never counted. Which ordering occurs depends on scheduling between the constructing thread and the new one, and the code does nothing to choose.

References: the exit of `workerLoop`, src/work_queue.cpp (target) lines 28–37; the destructor's write and join it answers, lines 7–11.

Show more:
The final scan is a guarantee with a narrow scope: a job that is pending at the moment the worker wakes for the destructor's notify is counted. The lock fixes what can and cannot slip in around it. A submission that takes `mutex_` after the destructor's block has released it and before the worker has woken sets `pending` and is included in the final scan. A submission that arrives while the worker holds the lock, from the return of `wait` through the scan, the condition and the function's exit, blocks until the worker has released the mutex by returning; it then marks its job and notifies a condition variable nobody waits on any more, and the job is never counted. Both are uses of the queue during its destruction, which the destructor does not guard (previous step); the code states only what the worker does, not what the owner must refrain from.

The two orderings share one property: the loop exits only through the condition, and the condition is read under the lock, so the worker never leaves while another thread is between taking the lock and releasing it. There is no path on which the worker ends with the mutex held, since the `unique_lock` is a local of `workerLoop` and is released when the function returns, and the destructor's `join` therefore never waits for a thread that is stuck on the lock the destroying thread itself released.

After the thread has ended, the jobs remain as the last scan left them. Nothing resets `pending` or `runs` at shutdown, and nothing in these files reads them; a holder of a handle sees the final values, and the queue's own copies go when `slots_` is destroyed.

### W3 (walk): What the old submit did, and what is gone
Purpose: Understand that the old path only looked up an existing job, so callers of the new code get creation, a worker and a returned handle they did not have before.

#### W3.1 The old submit discarded the lookup
- submit in the base revision: src/submit.cpp (From) lines 3–5

This walk reads the earlier revision, so the code beside it is the old `submit`, not the one walk W1 started from. It is two lines of substance: a `void` function that calls `queue.find(key)` and does nothing with what comes back. `find` returns a `std::shared_ptr<Job>`, so the call produces a value, but as an expression statement that value is a temporary which is destroyed at the end of the line. **A caller of the old `submit` got nothing back and could observe nothing from having called it.** The function took a `WorkQueue` by reference and a key, and that was the whole of its contract.

What the call did inside the queue is the next step; the one thing to carry forward is that it was a lookup, and that the queue of this revision had no worker thread, no lock and no pending state for a lookup to affect. The old `submit` therefore left no lasting trace in the queue either, so there is no earlier behaviour that the new `submit` (walk W1, step 1) continues or preserves beyond accepting a key: the creation of a job, the worker and the returned handle are all new.

References: the old `submit`, src/submit.cpp (base) lines 3–5; `find` as it was declared, src/work_queue.h (base) line 12.

Show more:
The discarded result is the detail that decides how to read the change. The `std::shared_ptr` that `find` returned was a copy of the map's pointer, or null for an unknown key; constructing and destroying that temporary adjusts a reference count and nothing else, so even a caller who later inspected the queue could not tell that `submit` had been called. The new signature keeps the parameters and changes only the return type, so an existing call that ignores the result still compiles, but it now creates a slot, raises a flag and wakes a thread where before it looked something up and forgot it.

No header in either revision declares `submit`; it exists only as a definition in its own file. A caller in another translation unit must declare it itself, and such a declaration written for the old `void` return would no longer match the new definition. Whether any caller exists, and whether it was updated, cannot be read from these files.

#### W3.2 find looked up without creating
- find in the base revision: src/work_queue.cpp (From) lines 3–6 — reached from the call in the old submit (src/submit.cpp base 4–4)

Reached from the old `submit`'s call (previous step), still on the earlier revision. `WorkQueue::find` is a read-only lookup: `slots_.find(key)` is `std::map::find`, which searches for the key and returns an iterator to the entry or `end()`, and **never inserts**. The conditional turns that into the return value: `nullptr` for an unknown key, a copy of the stored `std::shared_ptr<Job>` for a known one. Nothing is written, nothing is created, and the map is the same size after the call as before.

Around it there was nothing else. The `WorkQueue` of this revision has one method and one member: no constructor, no mutex, no condition variable, no thread and no `stopping_`; `Job` has only its `key`. A call to `find` ran on the caller's thread, touched a map and returned, and needed no lock because no second thread existed.

That is what the change removed and what it replaced. `find` is gone from the new class, and its place is taken by `acquire`, which walk W1 explains: the same map, but consulted with `operator[]`, which inserts, followed by creation of a `Job`, a flag raised and a notification to a worker thread, all under a lock (walk W1, steps 2 and 4). The new queue has no lookup that leaves the map untouched; every lookup is a submission. A caller of the new `submit` therefore gets creation, a worker and a handle that the old path never offered, and loses the one thing the old path had, a query with no side effect.

References: `find`, src/work_queue.cpp (base) lines 3–6; the old class with its single method, src/work_queue.h (base) lines 10–16; its replacement `acquire`, src/work_queue.cpp (target) lines 14–24.

Show more:
As these files show it, `find` could never have returned anything but `nullptr`. `slots_` is private, `find` is the class's only member function, there is no constructor and no friend, and `find` itself does not insert, so nothing in the base revision ever put an entry into the map. The lookup was correct in form and empty in effect: the old `submit` asked for a job in a map that, within this code, had no way to hold one. Whether other code outside these files once populated it cannot be read here; with `slots_` private and the class otherwise closed, it would have had to change the class to do so.

Removing `find` also removes a capability rather than only a function. The new class exposes nothing that reads a job without marking it pending, so any code that wanted to ask "is there a job for this key?" has no replacement in the target revision; `acquire` answers by creating one. If such a use existed outside these files, it no longer compiles against the new header, which is the one place the change would be forced into view.

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
- `base/` is From, commit 0979a4c58c29a912e317a944acaf2a04a213b20e
- `target/` is To, commit 5bf91078fda77b72d85659ad20e5cc65161d5c27
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.
```

</details>

<details><summary>Answer</summary>

```text
I read the three walks beside both revisions and checked each step's claims against the code; here is the assessment.

``​`json
{
  "assessment": "The reader can follow the course. W1 enters at submit, follows the call into acquire, pauses on the Job type with the detour named as such, continues to mark-notify-return, switches thread explicitly for the worker's scan, returns to the caller to say what the handle is and is not, and then revisits the branch point (existing slot) and the hand-over (worker not yet waiting) as alternatives, never as one run. W2 follows the worker's life from the constructor's initializer through the member-order dependency, lock-and-wait, the destructor's stop-notify-join and the final scan, with the two start-up orderings kept apart. W3 reads the base revision and makes explicit that the removed lookup could not, within these files, find anything. I checked the claims that carry weight against the code and they hold: the notification issued under the lock at src/work_queue.cpp target 22 against a worker that locks, checks stopping_ and waits without a predicate at target 27-29, so a notify before the first wait is lost and the job stays pending until a later acquire or the destructor's notify at target 10; the null entry that an allocation failure at target 18 would leave after operator[] at target 16, dereferenced without a check at target 31; the destructor's write under the lock, release, notify and join at target 6-11 and the two exits of the loop at target 28-37; the construction order fixed by src/work_queue.h target 24-28 with worker_ last; the return value copied before the lock_guard is destroyed at target 23; and the base class having no member that inserts (src/work_queue.h base 10-16, src/work_queue.cpp base 3-6). Every line reference in the steps points where the text says. Each shown place is explained at the Standard level rather than named, the language details the reader needs (operator[] insertion, lock_guard versus unique_lock, condition-variable wake and drop semantics, member construction order, shared_ptr ownership, the data-race rule) are placed where they are needed, and the Show more parts deepen the first part instead of repeating it. Two trivial imprecisions do not affect understanding and are not findings: W1.6 Show more says the worker's scan reads only pending, while runs += 1 at target 33 also reads runs, and W1.3's reference gives target 31-33 as the worker's writes when line 31 is the test. Nothing significant falls short, so I accept the walks as written.",
  "verdict": "accept",
  "findings": []
}
``​`

```

</details>
