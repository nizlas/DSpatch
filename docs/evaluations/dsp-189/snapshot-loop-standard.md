# snapshot · planner, writer and reviewer · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, the walk loop drawing, its roles, the run engine and the run record) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:30:33.780Z, ended 2026-11-10T02:42:11.756Z; job done: 2 walk(s) and 1 reading(s), 9 step(s). 9 changed line(s) are in none of them. The reviewer accepted the walks at once.

Loop: status **delivered**, path plan → write → review → delivered; correction rounds 0; 11 provider turns; 11 min 37 s in all; usage not reported (unknown). Graph dspatch-walk-loop graph-8e84007492c1b56f; roles walk-planner, walk-writer, walk-reviewer.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | plan-walks | file-1 | 3 min 25 s | 14821 |
| 2 | write-step | file-2 | 52 s | 3115 |
| 3 | write-step | file-2 | 36 s | 3093 |
| 4 | write-step | file-2 | 42 s | 3289 |
| 5 | write-step | file-2 | 36 s | 3507 |
| 6 | write-step | file-2 | 30 s | 2857 |
| 7 | write-step | file-2 | 40 s | 3131 |
| 8 | write-step | file-2 | 44 s | 3446 |
| 9 | write-step | file-2 | 40 s | 3485 |
| 10 | write-step | file-2 | 36 s | 3669 |
| 11 | review-walks | file-3 | 2 min 14 s | 2854 |

Sum of answer times: 11 min 35 s.

## The plan (the planner's first answer)

**Summary:** SnapshotSlot now hands out a shared pointer to an immutable DataSnapshot instead of a copy of it. Before, every get() copied the whole snapshot, its vector of strings included, while holding the mutex, and set() copied it again under the same lock; the consumer loop in consume() does this on every iteration. Now the slot stores a std::shared_ptr<const DataSnapshot>: get() copies only the pointer under the lock, a reader keeps the snapshot it took for as long as it uses it, and onUpdate() builds the next snapshot once on the heap and installs it with a pointer swap. The two callers, consume() and onUpdate(), are adapted to the new signatures.

**Background:** The slot starts with an empty snapshot made in the member initialiser, so get() never returns a null pointer and the consumer's `snapshot->rows` is safe before the first update.

The previous snapshot is released when the pointer is swapped: a reader that still holds it keeps it alive until its loop iteration ends; if nobody holds it, its rows are freed inside set(), while the mutex is still held.

No test and no caller of onUpdate() or startConsumer() is in the material, and the comment at include/snapshot_slot.h lines 12-13 is the change's only stated intent. Everything below is read from the code; nothing was run.

### W1 (walk): What happens when the consumer reads a snapshot?

*Purpose:* The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends. · *Question:* How does a read get the rows now, what does the lock cover, and what keeps the rows valid while useRows runs?

- **W1.1 The consumer loop runs on its own thread** — startConsumer launches a thread that runs consume() with references to the shared slot and the stop flag.
  - startConsumer launches the consumer thread: `src/consumer.cpp` target 14–16
  - brief: Unchanged code, read for context: startConsumer() creates a std::thread whose lambda calls consume() with the slot and the stopping flag, so everything in this walk happens on that thread, concurrently with whoever calls onUpdate() (see the update walk). Make comprehensible that the loop runs continuously until stopping is set, and that no caller of startConsumer() is in the material. The reader takes to the next step the body of consume().
- **W1.2 Each iteration takes a pointer, not a copy** — The loop's local is now a shared_ptr<const DataSnapshot> where it used to be a DataSnapshot by value.
  - The loop body takes a shared pointer from the slot: `src/consumer.cpp` target 9–9 ← from The thread lambda that calls consume() (`src/consumer.cpp` 15–15)
  - brief: Reached from the thread lambda in the previous step. Make comprehensible that taking a snapshot no longer copies its rows: the local is a shared pointer to a const DataSnapshot (base line 9 held a DataSnapshot by value), and the const means this thread can read the rows but not change what others share. The reader takes to the next step the call slot.get(), to see what the lock covers and what the returned pointer owns.
- **W1.3 get() copies the pointer under the lock, where it used to copy every row** — The lock_guard now covers a shared_ptr copy and a reference-count increment, not a deep copy of DataSnapshot.
  - The old get(): a copy of the whole snapshot under the lock: `include/snapshot_slot.h` base 13–16
  - The new get(): a copy of the shared pointer under the lock: `include/snapshot_slot.h` target 16–19 ← from slot.get() in the consumer loop (`src/consumer.cpp` 9–9)
  - together: Side by side the two bodies look identical; what differs is the type, and with it what the lock protects: a pointer copy instead of a copy of all rows.
  - brief: Reached from slot.get() on line 9 of consume(). Make comprehensible that the lock_guard now covers only a copy of the shared_ptr (a pointer plus a reference-count increment), while the old get() copied the whole DataSnapshot, every string in rows included, under the same lock. Explain why the mutex is still needed at all: copying a shared_ptr while set() assigns the same shared_ptr object is a data race on that object, since only the count is atomic, not the pointer. The reader takes away that the returned pointer co-owns the snapshot with the slot, so a later swap in the slot cannot free what this thread holds.
- **W1.4 The rows are used with no lock held** — useRows reads through the pointer after get() has released the mutex; the local pointer is what keeps the rows alive until the iteration ends.
  - useRows reads through the pointer; the iteration ends: `src/consumer.cpp` target 10–11
  - brief: Back in consume() after get() returned. Make comprehensible that useRows() (declared on line 5, defined outside this material) reads the rows through the pointer after the lock_guard inside get() has already released the mutex, and that an update installed meanwhile neither changes nor frees these rows, because this thread's `snapshot` still owns them. At the closing brace of the iteration the local pointer is destroyed and its reference dropped; if the slot has already moved on, that is where the old snapshot's rows are freed, on this thread. The reader takes to the next step the question whether the pointer can ever be null.
- **W1.5 The slot never holds a null pointer** — The member initialiser installs an empty snapshot, so get() returns a valid pointer before the first update.
  - The member starts as a non-null empty snapshot: `include/snapshot_slot.h` target 27–27
  - brief: Teaching order, not execution order: this initialiser ran when the SnapshotSlot was constructed, before the consumer thread started. Make comprehensible that it installs an empty snapshot (version 0, no rows), so the `snapshot->rows` dereference in the previous step is safe even before the first onUpdate(); in the old version the same guarantee came for free from a value member (base line 24). The reader leaves the walk knowing that a read is cheap, is used with no lock held, and is never null.

### W2 (walk): What happens when an update arrives?

*Purpose:* The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it. · *Question:* How is the next snapshot built and installed, and what becomes of the one it replaces?

- **W2.1 onUpdate builds the next snapshot on the heap** — A fresh DataSnapshot is allocated with make_shared and filled from the payload.
  - onUpdate allocates and fills the next snapshot: `src/feed.cpp` target 8–11
  - brief: Entry point: onUpdate() is called with a Payload by feed code that is not in the material, on a thread this material does not show; the slot's mutex is what allows it to be a different thread from the consumer's. Make comprehensible that a new DataSnapshot is allocated with make_shared and filled from the payload: the rows are still copied, once, here, where the old version copied them into a stack DataSnapshot and then again inside set(). `next` points at a non-const DataSnapshot so that it can be filled. The reader takes the filled `next` to the handover on line 12.
- **W2.2 Handover: set() takes ownership of a read-only snapshot** — std::move passes ownership into set()'s by-value const parameter; under the lock the slot's pointer is swapped.
  - The old set(): copies the snapshot into the member under the lock: `include/snapshot_slot.h` base 17–20
  - The new set(): takes an owned const pointer and moves it in under the lock: `include/snapshot_slot.h` target 20–23 ← from slot.set(std::move(next)) in onUpdate() (`src/feed.cpp` 12–12)
  - together: Seeing the old and the new set() side by side shows the parameter change from a const reference to an owned pointer and the copy becoming a move.
  - brief: Reached from slot.set(std::move(next)) on line 12 of onUpdate(). Make comprehensible the boundary at the call: std::move hands ownership to the by-value parameter without a reference-count bump, and the parameter type shared_ptr<const DataSnapshot> is where the snapshot becomes read-only for everyone who reads it afterwards (the conversion from shared_ptr<DataSnapshot> is implicit). Then, under the lock, `current_ = std::move(next)` swaps the slot's pointer; the old set() copied every row of `next` into current_ under the same lock. The reader takes to the next step the question what the assignment does to the pointer current_ held before.
- **W2.3 What becomes of the previous snapshot** — The assignment drops the slot's reference; the old snapshot survives in any reader that still holds it, or is freed right here under the lock.
  - The pointer swap, read for what it releases: `include/snapshot_slot.h` target 22–22
  - revisit: The previous step showed this assignment as the install; now the point is the reference it drops and the two fates of the old snapshot that follow from it.
  - brief: The same assignment as in the previous step, now read for what it releases rather than what it installs. Make comprehensible that there are two outcomes decided by the reference count, not by any branch in the code: if a consumer iteration still holds the old snapshot (src/consumer.cpp target lines 9-11, read walk step 4), it stays alive until that local goes out of scope and is freed on the consumer's thread; if nobody holds it, its rows are freed right here, inside set(), while the mutex is still held, since the lock_guard is released only at the closing brace. After the move, `next` is empty, so nothing further is released when the parameter is destroyed at return. The reader takes to the reading of the header comment the question whether this matches what the comment promises.

### R1 (reading): The contract the new header comment states

*Purpose:* The person can hold the two walks against the change's only stated intent. · *Question:* What does the comment promise about readers, the updater and the mutex, and which code does each promise rest on?

- **R1.1 The comment's promises and where they live in the code** — New text: a published snapshot is immutable, readers keep the one they took while the updater installs the next, and the mutex guards the pointer only.
  - The design comment above SnapshotSlot: `include/snapshot_slot.h` target 12–13
  - brief: New text with no counterpart in base, the change's only stated intent. Make comprehensible which code each sentence rests on: immutability is the const in the member and parameter types (target lines 20 and 27), readers keeping theirs is the shared ownership shown in the read walk, and the mutex scope is the two lock_guards on lines 17 and 21. Note what the comment does not say: what happens to the previous snapshot when its last holder drops it, which the update walk's last step covers.

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:42 UTC, through the planner, writer and reviewer loop. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7). The planner planned the walks, the writer explained each step in its own call, and the reviewer judged them against the code and accepted them without a correction round. The reviewer is an agent: its acceptance approves nothing of the code.

### W1 (walk): What happens when the consumer reads a snapshot?

*Purpose:* The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.

#### W1.1 The consumer loop runs on its own thread

- startConsumer launches the consumer thread: `src/consumer.cpp` target lines 14–16

This is unchanged code, and it is here to fix the execution context for the whole walk. `startConsumer` creates a `std::thread` whose body is a lambda that calls `consume(slot, stopping)`, and it returns the thread object to its caller. From that moment on, `consume` runs on a thread of its own: every read of the slot in the steps that follow happens on this thread, while `onUpdate` (the update walk) may run on any other thread at the same time. The `SnapshotSlot` and its mutex exist for exactly this situation.

The lambda captures `slot` and `stopping` by reference, so the consumer thread works on the same `SnapshotSlot` object that the updater writes to, and reads the same `std::atomic<bool>` that someone else will set to end it. `consume` loops `while (!stopping)` and does two things per iteration: take a snapshot from the slot and hand its rows to `useRows` (src/consumer.cpp, target lines 7–12). There is no sleep or wait in the loop, so this thread calls `slot.get()` again as soon as `useRows` returns; the loop ends only when `stopping` becomes true, and the check sits at the top of the loop, so the iteration that is in progress completes first.

Nothing in the material calls `startConsumer`, sets `stopping`, or defines `useRows` (only its declaration is here, line 5). What you can judge from this code is the thread's shape; who owns the thread, when it is stopped and how long `slot` outlives it are decided by code you cannot see here. Take the body of `consume` to the next step, where its local variable is what the change touches.

**Show more:**

Two language rules matter for reading this safely, and both are the caller's responsibility rather than this file's. First, the by-reference captures mean that `slot` and `stopping` must stay alive for as long as the thread runs; the lambda holds no ownership of either, so if the caller lets them go out of scope before the thread has finished, the consumer reads freed memory. Second, the returned `std::thread` is joinable, and destroying a joinable `std::thread` without `join()` or `detach()` calls `std::terminate`; the caller must do one of the two, and the usual pattern is to set `stopping` and then join. Neither can be checked from this material.

Because `stopping` is a `std::atomic<bool>`, the plain `!stopping` test in the loop condition is a well-defined read even while another thread stores `true` into it; no lock is needed for the flag, and the slot's mutex has nothing to do with it. The flag is also the only coupling between the loop and the outside world: `consume` does not block on the slot, so it will spin through `get()` and `useRows` continuously between the moment the thread starts and the moment the flag is seen. Whether that is acceptable depends on what `useRows` costs and how often updates arrive, neither of which this code shows.

The identical lines in the earlier revision (src/consumer.cpp, base lines 14–16) confirm that the change did not touch how the consumer is started or stopped; it only changes what each iteration takes from the slot, which is the subject of the next step.

#### W1.2 Each iteration takes a pointer, not a copy

- The loop body takes a shared pointer from the slot: `src/consumer.cpp` target lines 9–9 ← from The thread lambda that calls consume() (`src/consumer.cpp` 15–15)

We are inside the loop that the consumer thread runs, as the previous step showed. This line is the consumer's side of the change: the local `snapshot` is now a `std::shared_ptr<const DataSnapshot>`, where the earlier revision declared it as a `DataSnapshot` held by value (src/consumer.cpp, base line 9). In the old form every iteration owned its own `DataSnapshot`, with its own copy of every string in `rows`; in the new form the iteration owns a pointer to a `DataSnapshot` that it shares with the slot and with anyone else who took the same snapshot, and no row is copied here.

The `const` in the pointee type is what makes sharing safe to read. Through `snapshot`, `rows` and `version` are readable but not assignable, so this thread cannot alter the object that the slot still publishes and that other readers may hold. That fits the only use made of it: `useRows` takes a `const std::vector<std::string>&`, so passing `snapshot->rows` needs nothing more than read access. The restriction is enforced by the compiler on this code, not by anything at run time.

Two things follow that the reader should carry forward. The snapshot is cheap to take, which the next step shows by reading `get()`: what the lock covers and what the returned pointer owns. And the snapshot lives exactly as long as this local does, that is, until the closing brace of the iteration; a later step shows what that means while `useRows` runs and when an update arrives in the meantime.

**Show more:**

The declared type is spelled out rather than written as `auto`, and it matches the return type of `SnapshotSlot::get()` exactly (include/snapshot_slot.h, target line 16), so the initialisation is a plain move of the returned `shared_ptr` into the local, with no conversion and no extra reference-count traffic on this line. The count work that does happen is inside `get()`, which the next step reads.

The local is a new object each time round the loop. The pointer from the previous iteration was destroyed at that iteration's closing brace, so at the top of each pass this thread holds no snapshot at all; it holds one only between this line and the end of the iteration. Taken together with the previous step, that means the consumer never pins more than one `DataSnapshot` at a time, but it does pin one for the whole duration of `useRows`.

In the earlier revision the cost of this line was hidden in `get()`'s return statement, which produced the `DataSnapshot` by copying the member; the local then took that temporary without a further copy. So the change does not remove a copy from this line as such; it removes the copy that this line used to cause inside the slot, and replaces ownership of a private copy with shared ownership of a published one. The price is that the rows this thread reads may be older than the slot's current ones by the time `useRows` finishes, which is also what the design intends: the comment above `SnapshotSlot` says readers keep the snapshot they took (include/snapshot_slot.h, target lines 12–13), and the reading at the end of the walks returns to that.

#### W1.3 get() copies the pointer under the lock, where it used to copy every row

- The old get(): a copy of the whole snapshot under the lock: `include/snapshot_slot.h` base lines 13–16
- The new get(): a copy of the shared pointer under the lock: `include/snapshot_slot.h` target lines 16–19 ← from slot.get() in the consumer loop (`src/consumer.cpp` 9–9)

The consumer's `slot.get()` from the previous step lands here. The two versions of `get()` read the same: take a `std::lock_guard` on `mutex_`, then `return current_;`. Everything that changed is in the types, and the types decide how much work that one return statement does while the lock is held.

In the old version `current_` is a `DataSnapshot` and the return copies it: `version`, the `std::vector<std::string>`, and a fresh allocation for every string in it. The updater's `set()` waits on the same mutex, so the critical section grew with the number of rows, and each consumer iteration paid that copy. In the new version `current_` is a `std::shared_ptr<const DataSnapshot>` and the return copies the pointer: two words of pointer and one atomic increment of the reference count, in constant time and with no allocation. **The lock still spans the whole copy, but the copy is now the pointer, not the rows.**

The mutex is not made redundant by `shared_ptr`. What `shared_ptr` makes thread-safe is its reference count, shared by all copies; the `shared_ptr` object itself, the member `current_`, is ordinary memory. Reading it here while `set()` assigns to it on another thread (the update walk shows that assignment) would be a data race on that object, and the lock on both sides is what rules it out. So the guarantee is exactly as the header comment above the class puts it: the mutex protects the pointer, and only the pointer.

What this thread takes away is a pointer that co-owns the `DataSnapshot` together with the slot. From this moment the count is at least two, and a later `set()` that replaces `current_` can only drop the slot's share; it cannot free the rows this thread is about to read. The next step uses them with the lock already released.

**Show more:**

The order of events at the return is fixed by the language: the return value is constructed from `current_` first, and the `lock_guard` is destroyed afterwards, as the function's locals go out of scope. So the pointer copy is complete, and the count already incremented, before the mutex is released; there is no window in which the caller holds a pointer that was not yet counted. The same rule made the old version's full copy complete under the lock too.

`get()` is a `const` member function, and locking a mutex modifies it; that is why `mutex_` is declared `mutable` in both revisions (include/snapshot_slot.h, base line 23, target line 26). Nothing else in the class is written by `get()`.

Two points are worth holding in mind for judging the design, and the walks return to both. First, the pointer's constness is what lets the rows be read without a lock: no one with a `shared_ptr<const DataSnapshot>` can change them, and the only non-`const` handle to a snapshot in this material is `next` inside `onUpdate` before it is handed over, which the update walk's first step covers. Second, the lock shrinks but does not disappear: with one consumer spinning through `get()` as the first step showed, the updater still contends for the mutex on every update, only now for a few instructions rather than for a copy of every row. The language also offers `std::atomic<std::shared_ptr<T>>` for a lock-free pointer swap; this code does not use it, and the mutex is the chosen mechanism.

#### W1.4 The rows are used with no lock held

- useRows reads through the pointer; the iteration ends: `src/consumer.cpp` target lines 10–11

Back in `consume`, with the pointer that `get()` returned in the previous step. By the time this line runs, the `lock_guard` inside `get()` has already been destroyed, so `useRows` reads the rows with no lock held at all. `snapshot->rows` is a `const std::vector<std::string>&` into the shared `DataSnapshot`; nothing is copied, and `useRows` (declared at the top of the file, defined outside this material) sees the same memory that the slot and any other reader of this snapshot see.

What makes that safe is the combination the walk has built up. The rows cannot change under `useRows`, because every published handle is a pointer to `const` and an update installs a different object rather than editing this one. And the rows cannot be freed under `useRows`, because this thread's `snapshot` holds a share of the ownership; an update that replaces the slot's pointer in the meantime (shown in the update walk) only removes the slot's share. **The local pointer, not the mutex, is what keeps the rows valid for the whole of this line.** In the earlier revision the same call read the iteration's private copy, which was safe for the simpler reason that nobody else could see it.

At the closing brace the iteration ends and `snapshot` is destroyed, which releases its share. Two outcomes are possible, decided by the count rather than by any code here: if the slot still publishes this snapshot, it stays alive and nothing happens; if the slot has moved on and this was the last share, the `DataSnapshot` and all of its strings are destroyed right here, on the consumer's thread, outside any lock. Then the loop re-tests `stopping` and, if it goes on, takes a fresh pointer.

One thing this material cannot settle: the reference handed to `useRows` is valid only until that closing brace. If `useRows` kept the reference, or a pointer into the rows, beyond its return, it would dangle as soon as this thread drops the last share. Its definition is not here. The next step turns to the other precondition of `snapshot->rows`: that the pointer is never null.

**Show more:**

The deallocation moving to the consumer is a consequence worth seeing clearly. In the earlier revision each iteration freed its own copy at the closing brace, every time, so the consumer always paid for a destruction of all rows per pass. Now it pays only when it is the last holder of a superseded snapshot, that is, once per update that arrived while it was busy; while no update arrives, the brace decrements a counter and nothing else. In exchange the consumer, not the updater, carries the cost of tearing down the old rows in that case, and it does so between its own iterations, where the updater is not waiting on it.

Nothing in `consume` looks at `version` or compares one snapshot with the last. The loop calls `useRows` on whatever the slot holds, so with no update in flight it processes the same rows again and again, and with updates faster than its iterations it skips the ones that were replaced before it looked. Both were true of the earlier revision too; the change alters the cost of a read, not which reads happen. Whether `useRows` tolerates repeated or skipped snapshots is a question for its definition.

The dereference itself is the only place where `snapshot` must be non-null: `operator->` on an empty `shared_ptr` is undefined behaviour, and `get()` returns whatever `current_` holds. That the slot never holds an empty pointer is established by its initialiser, which the next step reads.

#### W1.5 The slot never holds a null pointer

- The member starts as a non-null empty snapshot: `include/snapshot_slot.h` target lines 27–27

This step is out of execution order: the initialiser here ran when the `SnapshotSlot` was constructed, before `startConsumer` launched the thread of the first step, since the thread captures a reference to a slot that already exists. It is read last because it answers the question the previous step left open: `snapshot->rows` is only defined if the pointer is non-null, and this is where that is made so.

The default member initialiser calls `std::make_shared<const DataSnapshot>()`, so `current_` begins life pointing at one heap-allocated `DataSnapshot` with its default contents: `version` is 0 from the in-class initialiser on the struct, and `rows` is an empty vector. A consumer that runs before the first `onUpdate` therefore gets a real pointer from `get()`, and `useRows` is called with no rows rather than with a crash. In the earlier revision the member was a `DataSnapshot` by value (include/snapshot_slot.h, base line 24), default-constructed to the same empty state, and the question of null could not arise because there was no pointer; here the same starting state has to be installed deliberately, at the cost of one allocation per slot.

Be exact about what this guarantees. The initialiser makes the pointer non-null at the start; `set()` then stores whatever it is given, with no check, so the slot stays non-null only as long as every caller of `set()` passes a pointer to a real snapshot. The one caller in this material, `onUpdate`, always does, because it builds its argument with `make_shared` (the update walk's first step shows it). A caller elsewhere that passed an empty `shared_ptr` would make the consumer's next dereference undefined behaviour, and nothing in the class would stop it.

With this the read side is complete: a read is a pointer copy under the lock, the rows are used with no lock held and stay valid for the iteration, and the pointer is never null while the slot is used as this material uses it.

**Show more:**

The empty snapshot is an ordinary snapshot, not a "nothing published yet" state. A consumer cannot tell it from an update that legitimately carried version 0 and no rows, and `consume` does not look at `version` in any case, as an earlier step noted. If the first `useRows` call must wait for real data, that is not something the slot expresses; it would have to come from the caller that starts the consumer, which is outside the material.

`make_shared<const DataSnapshot>()` creates the object as `const` from the outset, so the resulting pointer type is exactly the member's `std::shared_ptr<const DataSnapshot>` and no conversion takes place. The non-null invariant it establishes is not mentioned in the comment above the class, which speaks of immutability, readers and the mutex; the reading at the end of the walks holds that comment against what the two walks have shown.

### W2 (walk): What happens when an update arrives?

*Purpose:* The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.

#### W2.1 onUpdate builds the next snapshot on the heap

- onUpdate allocates and fills the next snapshot: `src/feed.cpp` target lines 8–11

This walk starts at the other end of the slot. `onUpdate` is the entry point for new data: it receives a `Payload`, a `version` and a vector of `rows` as declared just above, from feed code that is not in this material, on a thread the material does not show. Nothing here ties it to the consumer thread of the read walk, and nothing needs to: the slot's mutex is what lets the two run on different threads.

The work here is to build the snapshot that will replace the current one. `std::make_shared<DataSnapshot>()` allocates a new `DataSnapshot` on the heap and gives `next` sole ownership of it; the two assignments then fill it from the payload. `next->rows = payload.rows` is a full copy of every string, because `payload` is a `const` reference and cannot be moved from. **This is the one copy of the rows that the new design still makes, and it happens on the updater's thread with no lock held.** In the earlier revision `next` was a `DataSnapshot` on the stack (src/feed.cpp, base lines 9–11), filled the same way, and then `set()` copied it a second time into the slot's member under the lock; the second copy is what disappears, as the next step shows.

Notice the type: `next` is a `std::shared_ptr<DataSnapshot>`, not to `const`, and it is the only non-`const` handle to any snapshot in this material. That is deliberate and harmless at this point. Until the handover, nobody but this thread can reach the object, its reference count is one, and filling it needs no synchronisation. It becomes read-only for everyone the moment it is passed on, which is the next step's subject. The reader takes the filled `next` to that call.

**Show more:**

Building the snapshot outside the slot has a consequence for failure as well as for cost. The only allocations that can fail here are the `make_shared` and the string copies into `next->rows`, and both happen before the slot is touched; if one of them throws, `next` is destroyed on the way out and the slot still publishes the previous snapshot, unchanged. In the earlier revision the row copy that could fail was the one inside `set()`, into the live member, under the lock. The language only promises that a `std::vector` left behind by a failed copy assignment is in a valid state, not which one, so a reader could have taken a partially replaced snapshot. Whether that case mattered in practice is not something this material shows.

The cost moves as well as shrinks. Each update now pays one heap allocation for the `DataSnapshot` and its control block, which `make_shared` combines into one, plus the row copy; it no longer pays for destroying `next` at the end of `onUpdate`, because the object lives on as the published snapshot, and whoever holds it last destroys it, which the read walk showed can be the consumer's thread.

The copy from `payload.rows` is forced by the signature, since `const Payload&` forbids moving. A caller that no longer needed its payload could avoid it if `onUpdate` took the payload by value or by rvalue reference; that is an alternative the change does not take, and the caller is not here to show whether it would help.

#### W2.2 Handover: set() takes ownership of a read-only snapshot

- The old set(): copies the snapshot into the member under the lock: `include/snapshot_slot.h` base lines 17–20
- The new set(): takes an owned const pointer and moves it in under the lock: `include/snapshot_slot.h` target lines 20–23 ← from slot.set(std::move(next)) in onUpdate() (`src/feed.cpp` 12–12)

The filled `next` from the previous step arrives here through `slot.set(std::move(next))`. Two things happen at that call boundary before any lock is taken, and both are decided by the signature.

First, ownership moves. `std::move` turns the caller's `next` into an rvalue, and the by-value parameter `next` of `set()` is constructed from it by moving: the pointer and its control block pass into the parameter, the caller's variable is left empty, and the reference count stays at one. No copy of anything, and no count traffic, happens on the way in. Second, the snapshot becomes read-only. The caller held a `std::shared_ptr<DataSnapshot>`; the parameter is a `std::shared_ptr<const DataSnapshot>`, and the conversion is implicit because a pointer to `DataSnapshot` converts to a pointer to `const DataSnapshot`. **From this parameter onward every handle to the snapshot is a pointer to `const`**, and since the caller's non-`const` handle was emptied by the move, the object it filled is now immutable for everyone who can reach it. That is the mechanism behind the read walk's claim that rows cannot change under a reader.

Inside, under the lock, `current_ = std::move(next)` makes the slot point at the new snapshot, in constant time. The old `set()` is the same two lines in shape, but its parameter was a `const DataSnapshot&` and the assignment copied `version` and every string in `rows` into the member while the consumer's `get()` waited on the mutex; that was the second copy of each update, and the one the change removes. The new assignment also lets go of the pointer the slot held until now; what that releases is the next step's subject.

**Show more:**

The lock does more here than guard the pointer. The rows were written on the updater's thread with no lock, in the previous step; what makes those writes visible to a consumer is that the updater's release of `mutex_` at the end of `set()` synchronises with the consumer's later acquire of it in `get()`. A consumer that takes the new pointer therefore sees the completed fill, by the language's rules for mutexes, with no separate fence or atomic needed. A consumer that reached `get()` before this `set()` took the lock keeps the previous snapshot, as the read walk showed.

The parameter is taken by value rather than by rvalue reference, which leaves callers a choice: pass an rvalue, as `onUpdate` does, and nothing is copied; pass an lvalue, and the parameter is a copy with the count incremented, the caller keeping its own handle. The second form is allowed by the signature but not used in this material. It is also where the immutability guarantee has its edge: a caller that kept a non-`const` `std::shared_ptr<DataSnapshot>` after passing a copy could still write to a published snapshot, and nothing in `SnapshotSlot` could prevent it. The guarantee rests on callers handing their only handle over, which `onUpdate` does by moving.

Compared with the earlier revision there is a change of ownership direction too. The old `set()` borrowed the caller's stack object and the caller destroyed it on return; the new `set()` takes the object over, and after this call the updater no longer owns the snapshot it built. The parameter itself is empty after the move, so its destruction at the closing brace of `set()` releases nothing; the only release in this function is the one the assignment performs on the previous `current_`, read in the next step.

#### W2.3 What becomes of the previous snapshot

- The pointer swap, read for what it releases: `include/snapshot_slot.h` target lines 22–22

The same assignment as in the previous step, now read for the other half of what a `shared_ptr` assignment does. Before this line, `current_` holds a share of the previous snapshot; assigning a new pointer into it gives that share up, and the old snapshot's reference count drops by one at the semicolon. **Nothing in the code decides what happens next; the count does.** There is no branch here, and the two possible outcomes are both written inside `std::shared_ptr`.

- A reader still holds it. If a consumer iteration is between its `get()` and its closing brace, as the read walk showed, its local `snapshot` keeps a share; the count stays above zero and the old rows stay intact for as long as that iteration needs them. They are freed later, when the last such local is destroyed, on that reader's thread and outside any lock.
- Nobody holds it. If the consumer is between iterations, or has not looked since, the slot's share was the last one. Then the count reaches zero here, and the `DataSnapshot` with every string in its `rows` is destroyed inside `set()`, on the updater's thread, while the mutex is still held, because the `lock_guard` is released only at the closing brace that follows.

Which of the two occurs depends on timing between the threads; the code allows either and this material cannot say which is common. The parameter `next` plays no part in it: it was emptied by the move, as the previous step established, so its destruction at return releases nothing.

The second case is worth seeing for what it does to the lock. The swap itself is constant time, but when the old snapshot dies here, its destruction, proportional to the number of rows, runs under the mutex, and a consumer arriving at `get()` waits for it. The reading that follows holds the header comment against both walks, and one question to take there is that the comment says what readers keep, not where the old snapshot ends.

**Show more:**

The destruction under the lock is not new in kind. In the earlier revision the copy assignment into the member overwrote the old strings in place, under the same lock, so freeing the old rows on the updater's thread with the mutex held was the rule then; what the change adds is the first case, where the old rows are not freed here at all because a reader is still using them, and the deallocation moves to that reader. The remaining cost under the lock could be moved out as well, by swapping the old pointer into a local inside the locked region and letting that local die after the `lock_guard`; the code does not do this, and the mutex-held destruction is what it has.

"A reader" is anyone who called `get()`, not only the consumer in this material. `get()` is public, and every copy it returned is a share; a caller that stored one in a longer-lived place would keep that snapshot, and its rows, alive across any number of updates. Memory for superseded snapshots is therefore bounded by how long readers hold their pointers, which the slot neither tracks nor limits.

The release itself is thread-safe without the lock, as the decrement is atomic, and in the first case the final release on the consumer's thread races with nothing: at that point the slot no longer points at the object, so no other `get()` can produce a new share of it. The lock here protects the assignment to `current_` from a concurrent `get()`, exactly as the read walk's third step described; the old object's fate needs no protection beyond its count.

### R1 (reading): The contract the new header comment states

*Purpose:* The person can hold the two walks against the change's only stated intent.

#### R1.1 The comment's promises and where they live in the code

- The design comment above SnapshotSlot: `include/snapshot_slot.h` target lines 12–13

This comment is new; the earlier revision's `SnapshotSlot` had none, and nothing else in the change says what it is for. It makes three promises, and after the two walks each can be placed on the code it rests on.

**"Publishes an immutable snapshot."** This rests on the `const` in the types: `current_` is a `std::shared_ptr<const DataSnapshot>`, `get()` returns the same type, and `set()` accepts it. Every handle that leaves the slot or enters it points at `const`, so no holder of a published snapshot can write to it. The walks showed the one place where a snapshot is not yet `const`: `next` inside `onUpdate` before the handover, where the move empties the only non-`const` handle. The promise therefore holds for this material's callers, and depends on callers handing their handle over as `onUpdate` does.

**"Readers keep the one they took while the updater installs the next."** This is shared ownership, nothing more: `get()` hands out a share of the current snapshot, the consumer's local keeps that share until its iteration ends, and the assignment in `set()` gives up only the slot's own share. A reader holding the old pointer is unaffected by the install, as the read walk's fourth step and the update walk's last step showed from both sides.

**"The mutex protects the pointer, not the rows."** The two `lock_guard`s in `get()` and `set()` enclose a pointer copy and a pointer move-assignment respectively; the rows are filled in `onUpdate` before `set()` is called, and read in `consume` after `get()` has returned, both with no lock. What keeps the rows safe is the first two promises, not the third.

What the comment leaves out is as useful to hold against the walks as what it says. It does not say where the previous snapshot ends: on the last holder's thread when a reader outlives the install, or inside `set()` under the mutex when none does, which is the update walk's last step. It does not say that the slot starts with a real, empty snapshot and is never null, which the read walk's last step found in the initialiser. And it does not bound how long a reader may keep what it took, which is the same freedom as the second promise seen from the memory side.

**Show more:**

"Not the rows" is exact about what the mutex guards and slightly understates what it does. The rows are written on the updater's thread and read on the consumer's thread with no lock on either access, and the comment is right that the mutex is not what makes those accesses safe. But the updater's unlock at the end of `set()` and the consumer's lock in `get()` are also what order the fill before the read, so a reader that takes the new pointer sees completed rows. The mutex guards the pointer and, as a consequence, publishes the rows; the second part is not stated.

The third promise also has a case where the rows are touched under the mutex after all: when the slot's share was the last one, the old snapshot's destructor runs inside `set()` with the lock held. That is destruction, not protection, and it does not contradict the comment; it is a cost the comment does not mention, and the update walk's last step shows the alternative of releasing it outside the lock.

Two things the class does not enforce lie behind the first promise. `set()` stores whatever it is given, so an empty pointer from a caller would end the non-null guarantee the initialiser established; and a caller that passed a copy rather than moving would keep a writable handle to a published snapshot. Neither happens in this material, and `onUpdate` is the only caller shown. Whether other callers exist, and whether they follow the same pattern, cannot be read here.

## The reviewer

### First verdict (turn 11)

**Verdict:** accept

**Assessment:** The reader can follow both walks and the reading from start to end. W1 enters at the consumer thread (src/consumer.cpp target 14–16), follows the loop body into get() with the call named as the transition, returns to consume with the pointer in hand, and places the initialiser (target 27) last while saying plainly that it is out of execution order and why it is read there. W2 enters at onUpdate (src/feed.cpp target 8–11), follows the std::move into set() with the implicit DataSnapshot→const DataSnapshot conversion explained at the boundary, and reads the assignment on target 22 a second time for what it releases, presenting the two outcomes (a reader still holds the old snapshot; nobody does, so it dies inside set() under the lock) as alternatives decided by the count, not as one run. Every claim I checked is true of the code: the by-reference captures and the atomic loop test, the identical shape of get()/set() on both sides with the work decided by the types (base 13–20 versus target 16–23), mutable mutex_ (base 23, target 26), the by-value const-pointer parameter, make_shared<const DataSnapshot>() keeping the slot non-null, and the lock_guard still held at the destruction on target 22–23. The text explains rather than names: at each place it says what happens here, why it matters for the change, and what decides the outcome, at a Standard level, with language rules (return-value construction before lock_guard destruction, mutex release/acquire ordering the fill before the read, what shared_ptr does and does not make thread-safe) given where the reader needs them to interpret the code. The Show more parts deepen rather than repeat: lifetime and join obligations, exception safety of building outside the slot, the publishing effect of the mutex, the bound on superseded-snapshot memory, and the alternatives the change did not take. R1 holds the three promises of the new comment against what the walks showed and names what the comment leaves out, which is the right use of a comment under section 3. Evidence and inference are kept apart; what the material cannot show (callers, useRows, thread ownership) is said once and not belaboured. One sentence in W1.4 Show more quantifies the consumer's deallocation cost as 'once per update that arrived while it was busy'; strictly it is once per iteration during which an update arrived, since intermediate snapshots die in set() as W2.3 shows. The surrounding mechanism statement is correct and the two walks together make this clear, so it does not mislead the reader about how the design works and is not a finding. Nothing significant falls short; the verdict is to accept.


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
- `base/` is From, commit 4bf3aafdfb59a6d761abe660995219abc80157f5
- `target/` is To, commit bf4c284e08fcce809aefe315546083995b218c0c
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: snapshot
From: 4bf3aafdfb59a6d761abe660995219abc80157f5 (base commit)
To: bf4c284e08fcce809aefe315546083995b218c0c (target commit)
Line numbers are 1-based; "base" is From and "target" is To.

## Changed lines (machine-readable)
``​`json
[{"path":"include/snapshot_slot.h","side":"base","start":13,"end":13},{"path":"include/snapshot_slot.h","side":"base","start":17,"end":17},{"path":"include/snapshot_slot.h","side":"base","start":19,"end":19},{"path":"include/snapshot_slot.h","side":"base","start":24,"end":24},{"path":"src/consumer.cpp","side":"base","start":9,"end":10},{"path":"src/feed.cpp","side":"base","start":9,"end":12},{"path":"include/snapshot_slot.h","side":"target","start":2,"end":2},{"path":"include/snapshot_slot.h","side":"target","start":12,"end":13},{"path":"include/snapshot_slot.h","side":"target","start":16,"end":16},{"path":"include/snapshot_slot.h","side":"target","start":20,"end":20},{"path":"include/snapshot_slot.h","side":"target","start":22,"end":22},{"path":"include/snapshot_slot.h","side":"target","start":27,"end":27},{"path":"src/consumer.cpp","side":"target","start":9,"end":10},{"path":"src/feed.cpp","side":"target","start":9,"end":12}]
``​`

## Changed files
- modified include/snapshot_slot.h
- modified src/consumer.cpp
- modified src/feed.cpp

## Diff (orientation)
``​`diff
diff --git a/include/snapshot_slot.h b/include/snapshot_slot.h
index 769e59f..96094a9 100644
--- a/include/snapshot_slot.h
+++ b/include/snapshot_slot.h
@@ -1,4 +1,5 @@
 #pragma once
+#include <memory>
 #include <mutex>
 #include <string>
 #include <vector>
@@ -8,18 +9,20 @@ struct DataSnapshot {
   std::vector<std::string> rows;
 };
 
+// Publishes an immutable snapshot: readers keep the one they took while the
+// updater installs the next. The mutex protects the pointer, not the rows.
 class SnapshotSlot {
  public:
-  DataSnapshot get() const {
+  std::shared_ptr<const DataSnapshot> get() const {
     std::lock_guard<std::mutex> lock(mutex_);
     return current_;
   }
-  void set(const DataSnapshot& next) {
+  void set(std::shared_ptr<const DataSnapshot> next) {
     std::lock_guard<std::mutex> lock(mutex_);
-    current_ = next;
+    current_ = std::move(next);
   }
 
  private:
   mutable std::mutex mutex_;
-  DataSnapshot current_;
+  std::shared_ptr<const DataSnapshot> current_ = std::make_shared<const DataSnapshot>();
 };
diff --git a/src/consumer.cpp b/src/consumer.cpp
index 658670a..0efe1e6 100644
--- a/src/consumer.cpp
+++ b/src/consumer.cpp
@@ -6,8 +6,8 @@ void useRows(const std::vector<std::string>& rows);
 
 void consume(SnapshotSlot& slot, std::atomic<bool>& stopping) {
   while (!stopping) {
-    DataSnapshot snapshot = slot.get();
-    useRows(snapshot.rows);
+    std::shared_ptr<const DataSnapshot> snapshot = slot.get();
+    useRows(snapshot->rows);
   }
 }
 
diff --git a/src/feed.cpp b/src/feed.cpp
index 3001b09..efb77c8 100644
--- a/src/feed.cpp
+++ b/src/feed.cpp
@@ -6,8 +6,8 @@ struct Payload {
 };
 
 void onUpdate(SnapshotSlot& slot, const Payload& payload) {
-  DataSnapshot next;
-  next.version = payload.version;
-  next.rows = payload.rows;
-  slot.set(next);
+  auto next = std::make_shared<DataSnapshot>();
+  next->version = payload.version;
+  next->rows = payload.rows;
+  slot.set(std::move(next));
 }
``​`
```

</details>

<details><summary>Answer</summary>

```text
``​`json
{
  "summary": "SnapshotSlot now hands out a shared pointer to an immutable DataSnapshot instead of a copy of it. Before, every get() copied the whole snapshot, its vector of strings included, while holding the mutex, and set() copied it again under the same lock; the consumer loop in consume() does this on every iteration. Now the slot stores a std::shared_ptr<const DataSnapshot>: get() copies only the pointer under the lock, a reader keeps the snapshot it took for as long as it uses it, and onUpdate() builds the next snapshot once on the heap and installs it with a pointer swap. The two callers, consume() and onUpdate(), are adapted to the new signatures.",
  "background": "The slot starts with an empty snapshot made in the member initialiser, so get() never returns a null pointer and the consumer's `snapshot->rows` is safe before the first update.\n\nThe previous snapshot is released when the pointer is swapped: a reader that still holds it keeps it alive until its loop iteration ends; if nobody holds it, its rows are freed inside set(), while the mutex is still held.\n\nNo test and no caller of onUpdate() or startConsumer() is in the material, and the comment at include/snapshot_slot.h lines 12-13 is the change's only stated intent. Everything below is read from the code; nothing was run.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the consumer reads a snapshot?",
      "question": "How does a read get the rows now, what does the lock cover, and what keeps the rows valid while useRows runs?",
      "purpose": "The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.",
      "steps": [
        {
          "title": "The consumer loop runs on its own thread",
          "summary": "startConsumer launches a thread that runs consume() with references to the shared slot and the stop flag.",
          "brief": "Unchanged code, read for context: startConsumer() creates a std::thread whose lambda calls consume() with the slot and the stopping flag, so everything in this walk happens on that thread, concurrently with whoever calls onUpdate() (see the update walk). Make comprehensible that the loop runs continuously until stopping is set, and that no caller of startConsumer() is in the material. The reader takes to the next step the body of consume().",
          "places": [
            {
              "label": "startConsumer launches the consumer thread",
              "path": "src/consumer.cpp",
              "side": "target",
              "start": 14,
              "end": 16,
              "anchor": "consume(slot, stopping)"
            }
          ]
        },
        {
          "title": "Each iteration takes a pointer, not a copy",
          "summary": "The loop's local is now a shared_ptr<const DataSnapshot> where it used to be a DataSnapshot by value.",
          "brief": "Reached from the thread lambda in the previous step. Make comprehensible that taking a snapshot no longer copies its rows: the local is a shared pointer to a const DataSnapshot (base line 9 held a DataSnapshot by value), and the const means this thread can read the rows but not change what others share. The reader takes to the next step the call slot.get(), to see what the lock covers and what the returned pointer owns.",
          "places": [
            {
              "label": "The loop body takes a shared pointer from the slot",
              "path": "src/consumer.cpp",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "std::shared_ptr<const DataSnapshot> snapshot = slot.get();",
              "from": {
                "label": "The thread lambda that calls consume()",
                "path": "src/consumer.cpp",
                "side": "target",
                "start": 15,
                "end": 15
              }
            }
          ]
        },
        {
          "title": "get() copies the pointer under the lock, where it used to copy every row",
          "summary": "The lock_guard now covers a shared_ptr copy and a reference-count increment, not a deep copy of DataSnapshot.",
          "brief": "Reached from slot.get() on line 9 of consume(). Make comprehensible that the lock_guard now covers only a copy of the shared_ptr (a pointer plus a reference-count increment), while the old get() copied the whole DataSnapshot, every string in rows included, under the same lock. Explain why the mutex is still needed at all: copying a shared_ptr while set() assigns the same shared_ptr object is a data race on that object, since only the count is atomic, not the pointer. The reader takes away that the returned pointer co-owns the snapshot with the slot, so a later swap in the slot cannot free what this thread holds.",
          "places": [
            {
              "label": "The old get(): a copy of the whole snapshot under the lock",
              "path": "include/snapshot_slot.h",
              "side": "base",
              "start": 13,
              "end": 16,
              "anchor": "DataSnapshot get() const"
            },
            {
              "label": "The new get(): a copy of the shared pointer under the lock",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 16,
              "end": 19,
              "anchor": "std::shared_ptr<const DataSnapshot> get() const",
              "from": {
                "label": "slot.get() in the consumer loop",
                "path": "src/consumer.cpp",
                "side": "target",
                "start": 9,
                "end": 9
              }
            }
          ],
          "together": "Side by side the two bodies look identical; what differs is the type, and with it what the lock protects: a pointer copy instead of a copy of all rows."
        },
        {
          "title": "The rows are used with no lock held",
          "summary": "useRows reads through the pointer after get() has released the mutex; the local pointer is what keeps the rows alive until the iteration ends.",
          "brief": "Back in consume() after get() returned. Make comprehensible that useRows() (declared on line 5, defined outside this material) reads the rows through the pointer after the lock_guard inside get() has already released the mutex, and that an update installed meanwhile neither changes nor frees these rows, because this thread's `snapshot` still owns them. At the closing brace of the iteration the local pointer is destroyed and its reference dropped; if the slot has already moved on, that is where the old snapshot's rows are freed, on this thread. The reader takes to the next step the question whether the pointer can ever be null.",
          "places": [
            {
              "label": "useRows reads through the pointer; the iteration ends",
              "path": "src/consumer.cpp",
              "side": "target",
              "start": 10,
              "end": 11,
              "anchor": "useRows(snapshot->rows);"
            }
          ]
        },
        {
          "title": "The slot never holds a null pointer",
          "summary": "The member initialiser installs an empty snapshot, so get() returns a valid pointer before the first update.",
          "brief": "Teaching order, not execution order: this initialiser ran when the SnapshotSlot was constructed, before the consumer thread started. Make comprehensible that it installs an empty snapshot (version 0, no rows), so the `snapshot->rows` dereference in the previous step is safe even before the first onUpdate(); in the old version the same guarantee came for free from a value member (base line 24). The reader leaves the walk knowing that a read is cheap, is used with no lock held, and is never null.",
          "places": [
            {
              "label": "The member starts as a non-null empty snapshot",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 27,
              "end": 27,
              "anchor": "std::make_shared<const DataSnapshot>()"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What happens when an update arrives?",
      "question": "How is the next snapshot built and installed, and what becomes of the one it replaces?",
      "purpose": "The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.",
      "steps": [
        {
          "title": "onUpdate builds the next snapshot on the heap",
          "summary": "A fresh DataSnapshot is allocated with make_shared and filled from the payload.",
          "brief": "Entry point: onUpdate() is called with a Payload by feed code that is not in the material, on a thread this material does not show; the slot's mutex is what allows it to be a different thread from the consumer's. Make comprehensible that a new DataSnapshot is allocated with make_shared and filled from the payload: the rows are still copied, once, here, where the old version copied them into a stack DataSnapshot and then again inside set(). `next` points at a non-const DataSnapshot so that it can be filled. The reader takes the filled `next` to the handover on line 12.",
          "places": [
            {
              "label": "onUpdate allocates and fills the next snapshot",
              "path": "src/feed.cpp",
              "side": "target",
              "start": 8,
              "end": 11,
              "anchor": "auto next = std::make_shared<DataSnapshot>();"
            }
          ]
        },
        {
          "title": "Handover: set() takes ownership of a read-only snapshot",
          "summary": "std::move passes ownership into set()'s by-value const parameter; under the lock the slot's pointer is swapped.",
          "brief": "Reached from slot.set(std::move(next)) on line 12 of onUpdate(). Make comprehensible the boundary at the call: std::move hands ownership to the by-value parameter without a reference-count bump, and the parameter type shared_ptr<const DataSnapshot> is where the snapshot becomes read-only for everyone who reads it afterwards (the conversion from shared_ptr<DataSnapshot> is implicit). Then, under the lock, `current_ = std::move(next)` swaps the slot's pointer; the old set() copied every row of `next` into current_ under the same lock. The reader takes to the next step the question what the assignment does to the pointer current_ held before.",
          "places": [
            {
              "label": "The old set(): copies the snapshot into the member under the lock",
              "path": "include/snapshot_slot.h",
              "side": "base",
              "start": 17,
              "end": 20,
              "anchor": "void set(const DataSnapshot& next)"
            },
            {
              "label": "The new set(): takes an owned const pointer and moves it in under the lock",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 20,
              "end": 23,
              "anchor": "void set(std::shared_ptr<const DataSnapshot> next)",
              "from": {
                "label": "slot.set(std::move(next)) in onUpdate()",
                "path": "src/feed.cpp",
                "side": "target",
                "start": 12,
                "end": 12
              }
            }
          ],
          "together": "Seeing the old and the new set() side by side shows the parameter change from a const reference to an owned pointer and the copy becoming a move."
        },
        {
          "title": "What becomes of the previous snapshot",
          "summary": "The assignment drops the slot's reference; the old snapshot survives in any reader that still holds it, or is freed right here under the lock.",
          "brief": "The same assignment as in the previous step, now read for what it releases rather than what it installs. Make comprehensible that there are two outcomes decided by the reference count, not by any branch in the code: if a consumer iteration still holds the old snapshot (src/consumer.cpp target lines 9-11, read walk step 4), it stays alive until that local goes out of scope and is freed on the consumer's thread; if nobody holds it, its rows are freed right here, inside set(), while the mutex is still held, since the lock_guard is released only at the closing brace. After the move, `next` is empty, so nothing further is released when the parameter is destroyed at return. The reader takes to the reading of the header comment the question whether this matches what the comment promises.",
          "places": [
            {
              "label": "The pointer swap, read for what it releases",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 22,
              "end": 22,
              "anchor": "current_ = std::move(next);"
            }
          ],
          "revisit": "The previous step showed this assignment as the install; now the point is the reference it drops and the two fates of the old snapshot that follow from it."
        }
      ]
    },
    {
      "kind": "reading",
      "title": "The contract the new header comment states",
      "question": "What does the comment promise about readers, the updater and the mutex, and which code does each promise rest on?",
      "purpose": "The person can hold the two walks against the change's only stated intent.",
      "steps": [
        {
          "title": "The comment's promises and where they live in the code",
          "summary": "New text: a published snapshot is immutable, readers keep the one they took while the updater installs the next, and the mutex guards the pointer only.",
          "brief": "New text with no counterpart in base, the change's only stated intent. Make comprehensible which code each sentence rests on: immutability is the const in the member and parameter types (target lines 20 and 27), readers keeping theirs is the shared ownership shown in the read walk, and the mutex scope is the two lock_guards on lines 17 and 21. Note what the comment does not say: what happens to the previous snapshot when its last holder drops it, which the update walk's last step covers.",
          "places": [
            {
              "label": "The design comment above SnapshotSlot",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 12,
              "end": 13,
              "anchor": "The mutex protects the pointer, not the rows."
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

### W1 (walk): What happens when the consumer reads a snapshot?
Purpose: The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.
Question: How does a read get the rows now, what does the lock cover, and what keeps the rows valid while useRows runs?
- W1.1 The consumer loop runs on its own thread — startConsumer launches a thread that runs consume() with references to the shared slot and the stop flag.
  - startConsumer launches the consumer thread: src/consumer.cpp (To) lines 14–16
  - Brief: Unchanged code, read for context: startConsumer() creates a std::thread whose lambda calls consume() with the slot and the stopping flag, so everything in this walk happens on that thread, concurrently with whoever calls onUpdate() (see the update walk). Make comprehensible that the loop runs continuously until stopping is set, and that no caller of startConsumer() is in the material. The reader takes to the next step the body of consume().
- W1.2 Each iteration takes a pointer, not a copy — The loop's local is now a shared_ptr<const DataSnapshot> where it used to be a DataSnapshot by value.
  - The loop body takes a shared pointer from the slot: src/consumer.cpp (To) lines 9–9 — reached from The thread lambda that calls consume() (src/consumer.cpp target 15–15)
  - Brief: Reached from the thread lambda in the previous step. Make comprehensible that taking a snapshot no longer copies its rows: the local is a shared pointer to a const DataSnapshot (base line 9 held a DataSnapshot by value), and the const means this thread can read the rows but not change what others share. The reader takes to the next step the call slot.get(), to see what the lock covers and what the returned pointer owns.
- W1.3 get() copies the pointer under the lock, where it used to copy every row — The lock_guard now covers a shared_ptr copy and a reference-count increment, not a deep copy of DataSnapshot.
  - The old get(): a copy of the whole snapshot under the lock: include/snapshot_slot.h (From) lines 13–16
  - The new get(): a copy of the shared pointer under the lock: include/snapshot_slot.h (To) lines 16–19 — reached from slot.get() in the consumer loop (src/consumer.cpp target 9–9)
  - Together: Side by side the two bodies look identical; what differs is the type, and with it what the lock protects: a pointer copy instead of a copy of all rows.
  - Brief: Reached from slot.get() on line 9 of consume(). Make comprehensible that the lock_guard now covers only a copy of the shared_ptr (a pointer plus a reference-count increment), while the old get() copied the whole DataSnapshot, every string in rows included, under the same lock. Explain why the mutex is still needed at all: copying a shared_ptr while set() assigns the same shared_ptr object is a data race on that object, since only the count is atomic, not the pointer. The reader takes away that the returned pointer co-owns the snapshot with the slot, so a later swap in the slot cannot free what this thread holds.
- W1.4 The rows are used with no lock held — useRows reads through the pointer after get() has released the mutex; the local pointer is what keeps the rows alive until the iteration ends.
  - useRows reads through the pointer; the iteration ends: src/consumer.cpp (To) lines 10–11
  - Brief: Back in consume() after get() returned. Make comprehensible that useRows() (declared on line 5, defined outside this material) reads the rows through the pointer after the lock_guard inside get() has already released the mutex, and that an update installed meanwhile neither changes nor frees these rows, because this thread's `snapshot` still owns them. At the closing brace of the iteration the local pointer is destroyed and its reference dropped; if the slot has already moved on, that is where the old snapshot's rows are freed, on this thread. The reader takes to the next step the question whether the pointer can ever be null.
- W1.5 The slot never holds a null pointer — The member initialiser installs an empty snapshot, so get() returns a valid pointer before the first update.
  - The member starts as a non-null empty snapshot: include/snapshot_slot.h (To) lines 27–27
  - Brief: Teaching order, not execution order: this initialiser ran when the SnapshotSlot was constructed, before the consumer thread started. Make comprehensible that it installs an empty snapshot (version 0, no rows), so the `snapshot->rows` dereference in the previous step is safe even before the first onUpdate(); in the old version the same guarantee came for free from a value member (base line 24). The reader leaves the walk knowing that a read is cheap, is used with no lock held, and is never null.

### W2 (walk): What happens when an update arrives?
Purpose: The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.
Question: How is the next snapshot built and installed, and what becomes of the one it replaces?
- W2.1 onUpdate builds the next snapshot on the heap — A fresh DataSnapshot is allocated with make_shared and filled from the payload.
  - onUpdate allocates and fills the next snapshot: src/feed.cpp (To) lines 8–11
  - Brief: Entry point: onUpdate() is called with a Payload by feed code that is not in the material, on a thread this material does not show; the slot's mutex is what allows it to be a different thread from the consumer's. Make comprehensible that a new DataSnapshot is allocated with make_shared and filled from the payload: the rows are still copied, once, here, where the old version copied them into a stack DataSnapshot and then again inside set(). `next` points at a non-const DataSnapshot so that it can be filled. The reader takes the filled `next` to the handover on line 12.
- W2.2 Handover: set() takes ownership of a read-only snapshot — std::move passes ownership into set()'s by-value const parameter; under the lock the slot's pointer is swapped.
  - The old set(): copies the snapshot into the member under the lock: include/snapshot_slot.h (From) lines 17–20
  - The new set(): takes an owned const pointer and moves it in under the lock: include/snapshot_slot.h (To) lines 20–23 — reached from slot.set(std::move(next)) in onUpdate() (src/feed.cpp target 12–12)
  - Together: Seeing the old and the new set() side by side shows the parameter change from a const reference to an owned pointer and the copy becoming a move.
  - Brief: Reached from slot.set(std::move(next)) on line 12 of onUpdate(). Make comprehensible the boundary at the call: std::move hands ownership to the by-value parameter without a reference-count bump, and the parameter type shared_ptr<const DataSnapshot> is where the snapshot becomes read-only for everyone who reads it afterwards (the conversion from shared_ptr<DataSnapshot> is implicit). Then, under the lock, `current_ = std::move(next)` swaps the slot's pointer; the old set() copied every row of `next` into current_ under the same lock. The reader takes to the next step the question what the assignment does to the pointer current_ held before.
- W2.3 What becomes of the previous snapshot — The assignment drops the slot's reference; the old snapshot survives in any reader that still holds it, or is freed right here under the lock.
  - The pointer swap, read for what it releases: include/snapshot_slot.h (To) lines 22–22
  - Revisit: The previous step showed this assignment as the install; now the point is the reference it drops and the two fates of the old snapshot that follow from it.
  - Brief: The same assignment as in the previous step, now read for what it releases rather than what it installs. Make comprehensible that there are two outcomes decided by the reference count, not by any branch in the code: if a consumer iteration still holds the old snapshot (src/consumer.cpp target lines 9-11, read walk step 4), it stays alive until that local goes out of scope and is freed on the consumer's thread; if nobody holds it, its rows are freed right here, inside set(), while the mutex is still held, since the lock_guard is released only at the closing brace. After the move, `next` is empty, so nothing further is released when the parameter is destroyed at return. The reader takes to the reading of the header comment the question whether this matches what the comment promises.

### R1 (reading): The contract the new header comment states
Purpose: The person can hold the two walks against the change's only stated intent.
Question: What does the comment promise about readers, the updater and the mutex, and which code does each promise rest on?
- R1.1 The comment's promises and where they live in the code — New text: a published snapshot is immutable, readers keep the one they took while the updater installs the next, and the mutex guards the pointer only.
  - The design comment above SnapshotSlot: include/snapshot_slot.h (To) lines 12–13
  - Brief: New text with no counterpart in base, the change's only stated intent. Make comprehensible which code each sentence rests on: immutability is the const in the member and parameter types (target lines 20 and 27), readers keeping theirs is the shared ownership shown in the read walk, and the mutex scope is the two lock_guards on lines 17 and 21. Note what the comment does not say: what happens to the previous snapshot when its last holder drops it, which the update walk's last step covers.

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
- `base/` is From, commit 4bf3aafdfb59a6d761abe660995219abc80157f5
- `target/` is To, commit bf4c284e08fcce809aefe315546083995b218c0c
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## This step: W1.1 The consumer loop runs on its own thread
Walk W1 (walk): What happens when the consumer reads a snapshot?. The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.
Summary: startConsumer launches a thread that runs consume() with references to the shared slot and the stop flag.
- startConsumer launches the consumer thread: src/consumer.cpp (To) lines 14–16
Brief: Unchanged code, read for context: startConsumer() creates a std::thread whose lambda calls consume() with the slot and the stopping flag, so everything in this walk happens on that thread, concurrently with whoever calls onUpdate() (see the update walk). Make comprehensible that the loop runs continuously until stopping is set, and that no caller of startConsumer() is in the material. The reader takes to the next step the body of consume().
The step after: W1.2 Each iteration takes a pointer, not a copy — The loop's local is now a shared_ptr<const DataSnapshot> where it used to be a DataSnapshot by value.
```

</details>

<details><summary>Answer</summary>

```text
This is unchanged code, and it is here to fix the execution context for the whole walk. `startConsumer` creates a `std::thread` whose body is a lambda that calls `consume(slot, stopping)`, and it returns the thread object to its caller. From that moment on, `consume` runs on a thread of its own: every read of the slot in the steps that follow happens on this thread, while `onUpdate` (the update walk) may run on any other thread at the same time. The `SnapshotSlot` and its mutex exist for exactly this situation.

The lambda captures `slot` and `stopping` by reference, so the consumer thread works on the same `SnapshotSlot` object that the updater writes to, and reads the same `std::atomic<bool>` that someone else will set to end it. `consume` loops `while (!stopping)` and does two things per iteration: take a snapshot from the slot and hand its rows to `useRows` (src/consumer.cpp, target lines 7–12). There is no sleep or wait in the loop, so this thread calls `slot.get()` again as soon as `useRows` returns; the loop ends only when `stopping` becomes true, and the check sits at the top of the loop, so the iteration that is in progress completes first.

Nothing in the material calls `startConsumer`, sets `stopping`, or defines `useRows` (only its declaration is here, line 5). What you can judge from this code is the thread's shape; who owns the thread, when it is stopped and how long `slot` outlives it are decided by code you cannot see here. Take the body of `consume` to the next step, where its local variable is what the change touches.

<!-- dspatch:details -->

Two language rules matter for reading this safely, and both are the caller's responsibility rather than this file's. First, the by-reference captures mean that `slot` and `stopping` must stay alive for as long as the thread runs; the lambda holds no ownership of either, so if the caller lets them go out of scope before the thread has finished, the consumer reads freed memory. Second, the returned `std::thread` is joinable, and destroying a joinable `std::thread` without `join()` or `detach()` calls `std::terminate`; the caller must do one of the two, and the usual pattern is to set `stopping` and then join. Neither can be checked from this material.

Because `stopping` is a `std::atomic<bool>`, the plain `!stopping` test in the loop condition is a well-defined read even while another thread stores `true` into it; no lock is needed for the flag, and the slot's mutex has nothing to do with it. The flag is also the only coupling between the loop and the outside world: `consume` does not block on the slot, so it will spin through `get()` and `useRows` continuously between the moment the thread starts and the moment the flag is seen. Whether that is acceptable depends on what `useRows` costs and how often updates arrive, neither of which this code shows.

The identical lines in the earlier revision (src/consumer.cpp, base lines 14–16) confirm that the change did not touch how the consumer is started or stopped; it only changes what each iteration takes from the slot, which is the subject of the next step.

```

</details>

### Turn 3: write-step (file-2) · W1.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.2 Each iteration takes a pointer, not a copy
Walk W1 (walk): What happens when the consumer reads a snapshot?. The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.
Summary: The loop's local is now a shared_ptr<const DataSnapshot> where it used to be a DataSnapshot by value.
- The loop body takes a shared pointer from the slot: src/consumer.cpp (To) lines 9–9 — reached from The thread lambda that calls consume() (src/consumer.cpp target 15–15)
Brief: Reached from the thread lambda in the previous step. Make comprehensible that taking a snapshot no longer copies its rows: the local is a shared pointer to a const DataSnapshot (base line 9 held a DataSnapshot by value), and the const means this thread can read the rows but not change what others share. The reader takes to the next step the call slot.get(), to see what the lock covers and what the returned pointer owns.
The step before: W1.1 The consumer loop runs on its own thread — startConsumer launches a thread that runs consume() with references to the shared slot and the stop flag.
The step after: W1.3 get() copies the pointer under the lock, where it used to copy every row — The lock_guard now covers a shared_ptr copy and a reference-count increment, not a deep copy of DataSnapshot.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
We are inside the loop that the consumer thread runs, as the previous step showed. This line is the consumer's side of the change: the local `snapshot` is now a `std::shared_ptr<const DataSnapshot>`, where the earlier revision declared it as a `DataSnapshot` held by value (src/consumer.cpp, base line 9). In the old form every iteration owned its own `DataSnapshot`, with its own copy of every string in `rows`; in the new form the iteration owns a pointer to a `DataSnapshot` that it shares with the slot and with anyone else who took the same snapshot, and no row is copied here.

The `const` in the pointee type is what makes sharing safe to read. Through `snapshot`, `rows` and `version` are readable but not assignable, so this thread cannot alter the object that the slot still publishes and that other readers may hold. That fits the only use made of it: `useRows` takes a `const std::vector<std::string>&`, so passing `snapshot->rows` needs nothing more than read access. The restriction is enforced by the compiler on this code, not by anything at run time.

Two things follow that the reader should carry forward. The snapshot is cheap to take, which the next step shows by reading `get()`: what the lock covers and what the returned pointer owns. And the snapshot lives exactly as long as this local does, that is, until the closing brace of the iteration; a later step shows what that means while `useRows` runs and when an update arrives in the meantime.

<!-- dspatch:details -->

The declared type is spelled out rather than written as `auto`, and it matches the return type of `SnapshotSlot::get()` exactly (include/snapshot_slot.h, target line 16), so the initialisation is a plain move of the returned `shared_ptr` into the local, with no conversion and no extra reference-count traffic on this line. The count work that does happen is inside `get()`, which the next step reads.

The local is a new object each time round the loop. The pointer from the previous iteration was destroyed at that iteration's closing brace, so at the top of each pass this thread holds no snapshot at all; it holds one only between this line and the end of the iteration. Taken together with the previous step, that means the consumer never pins more than one `DataSnapshot` at a time, but it does pin one for the whole duration of `useRows`.

In the earlier revision the cost of this line was hidden in `get()`'s return statement, which produced the `DataSnapshot` by copying the member; the local then took that temporary without a further copy. So the change does not remove a copy from this line as such; it removes the copy that this line used to cause inside the slot, and replaces ownership of a private copy with shared ownership of a published one. The price is that the rows this thread reads may be older than the slot's current ones by the time `useRows` finishes, which is also what the design intends: the comment above `SnapshotSlot` says readers keep the snapshot they took (include/snapshot_slot.h, target lines 12–13), and the reading at the end of the walks returns to that.

```

</details>

### Turn 4: write-step (file-2) · W1.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.3 get() copies the pointer under the lock, where it used to copy every row
Walk W1 (walk): What happens when the consumer reads a snapshot?. The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.
Summary: The lock_guard now covers a shared_ptr copy and a reference-count increment, not a deep copy of DataSnapshot.
- The old get(): a copy of the whole snapshot under the lock: include/snapshot_slot.h (From) lines 13–16
- The new get(): a copy of the shared pointer under the lock: include/snapshot_slot.h (To) lines 16–19 — reached from slot.get() in the consumer loop (src/consumer.cpp target 9–9)
Together: Side by side the two bodies look identical; what differs is the type, and with it what the lock protects: a pointer copy instead of a copy of all rows.
Brief: Reached from slot.get() on line 9 of consume(). Make comprehensible that the lock_guard now covers only a copy of the shared_ptr (a pointer plus a reference-count increment), while the old get() copied the whole DataSnapshot, every string in rows included, under the same lock. Explain why the mutex is still needed at all: copying a shared_ptr while set() assigns the same shared_ptr object is a data race on that object, since only the count is atomic, not the pointer. The reader takes away that the returned pointer co-owns the snapshot with the slot, so a later swap in the slot cannot free what this thread holds.
The step before: W1.2 Each iteration takes a pointer, not a copy — The loop's local is now a shared_ptr<const DataSnapshot> where it used to be a DataSnapshot by value.
The step after: W1.4 The rows are used with no lock held — useRows reads through the pointer after get() has released the mutex; the local pointer is what keeps the rows alive until the iteration ends.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The consumer's `slot.get()` from the previous step lands here. The two versions of `get()` read the same: take a `std::lock_guard` on `mutex_`, then `return current_;`. Everything that changed is in the types, and the types decide how much work that one return statement does while the lock is held.

In the old version `current_` is a `DataSnapshot` and the return copies it: `version`, the `std::vector<std::string>`, and a fresh allocation for every string in it. The updater's `set()` waits on the same mutex, so the critical section grew with the number of rows, and each consumer iteration paid that copy. In the new version `current_` is a `std::shared_ptr<const DataSnapshot>` and the return copies the pointer: two words of pointer and one atomic increment of the reference count, in constant time and with no allocation. **The lock still spans the whole copy, but the copy is now the pointer, not the rows.**

The mutex is not made redundant by `shared_ptr`. What `shared_ptr` makes thread-safe is its reference count, shared by all copies; the `shared_ptr` object itself, the member `current_`, is ordinary memory. Reading it here while `set()` assigns to it on another thread (the update walk shows that assignment) would be a data race on that object, and the lock on both sides is what rules it out. So the guarantee is exactly as the header comment above the class puts it: the mutex protects the pointer, and only the pointer.

What this thread takes away is a pointer that co-owns the `DataSnapshot` together with the slot. From this moment the count is at least two, and a later `set()` that replaces `current_` can only drop the slot's share; it cannot free the rows this thread is about to read. The next step uses them with the lock already released.

<!-- dspatch:details -->

The order of events at the return is fixed by the language: the return value is constructed from `current_` first, and the `lock_guard` is destroyed afterwards, as the function's locals go out of scope. So the pointer copy is complete, and the count already incremented, before the mutex is released; there is no window in which the caller holds a pointer that was not yet counted. The same rule made the old version's full copy complete under the lock too.

`get()` is a `const` member function, and locking a mutex modifies it; that is why `mutex_` is declared `mutable` in both revisions (include/snapshot_slot.h, base line 23, target line 26). Nothing else in the class is written by `get()`.

Two points are worth holding in mind for judging the design, and the walks return to both. First, the pointer's constness is what lets the rows be read without a lock: no one with a `shared_ptr<const DataSnapshot>` can change them, and the only non-`const` handle to a snapshot in this material is `next` inside `onUpdate` before it is handed over, which the update walk's first step covers. Second, the lock shrinks but does not disappear: with one consumer spinning through `get()` as the first step showed, the updater still contends for the mutex on every update, only now for a few instructions rather than for a copy of every row. The language also offers `std::atomic<std::shared_ptr<T>>` for a lock-free pointer swap; this code does not use it, and the mutex is the chosen mechanism.

```

</details>

### Turn 5: write-step (file-2) · W1.4

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.4 The rows are used with no lock held
Walk W1 (walk): What happens when the consumer reads a snapshot?. The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.
Summary: useRows reads through the pointer after get() has released the mutex; the local pointer is what keeps the rows alive until the iteration ends.
- useRows reads through the pointer; the iteration ends: src/consumer.cpp (To) lines 10–11
Brief: Back in consume() after get() returned. Make comprehensible that useRows() (declared on line 5, defined outside this material) reads the rows through the pointer after the lock_guard inside get() has already released the mutex, and that an update installed meanwhile neither changes nor frees these rows, because this thread's `snapshot` still owns them. At the closing brace of the iteration the local pointer is destroyed and its reference dropped; if the slot has already moved on, that is where the old snapshot's rows are freed, on this thread. The reader takes to the next step the question whether the pointer can ever be null.
The step before: W1.3 get() copies the pointer under the lock, where it used to copy every row — The lock_guard now covers a shared_ptr copy and a reference-count increment, not a deep copy of DataSnapshot.
The step after: W1.5 The slot never holds a null pointer — The member initialiser installs an empty snapshot, so get() returns a valid pointer before the first update.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
Back in `consume`, with the pointer that `get()` returned in the previous step. By the time this line runs, the `lock_guard` inside `get()` has already been destroyed, so `useRows` reads the rows with no lock held at all. `snapshot->rows` is a `const std::vector<std::string>&` into the shared `DataSnapshot`; nothing is copied, and `useRows` (declared at the top of the file, defined outside this material) sees the same memory that the slot and any other reader of this snapshot see.

What makes that safe is the combination the walk has built up. The rows cannot change under `useRows`, because every published handle is a pointer to `const` and an update installs a different object rather than editing this one. And the rows cannot be freed under `useRows`, because this thread's `snapshot` holds a share of the ownership; an update that replaces the slot's pointer in the meantime (shown in the update walk) only removes the slot's share. **The local pointer, not the mutex, is what keeps the rows valid for the whole of this line.** In the earlier revision the same call read the iteration's private copy, which was safe for the simpler reason that nobody else could see it.

At the closing brace the iteration ends and `snapshot` is destroyed, which releases its share. Two outcomes are possible, decided by the count rather than by any code here: if the slot still publishes this snapshot, it stays alive and nothing happens; if the slot has moved on and this was the last share, the `DataSnapshot` and all of its strings are destroyed right here, on the consumer's thread, outside any lock. Then the loop re-tests `stopping` and, if it goes on, takes a fresh pointer.

One thing this material cannot settle: the reference handed to `useRows` is valid only until that closing brace. If `useRows` kept the reference, or a pointer into the rows, beyond its return, it would dangle as soon as this thread drops the last share. Its definition is not here. The next step turns to the other precondition of `snapshot->rows`: that the pointer is never null.

<!-- dspatch:details -->

The deallocation moving to the consumer is a consequence worth seeing clearly. In the earlier revision each iteration freed its own copy at the closing brace, every time, so the consumer always paid for a destruction of all rows per pass. Now it pays only when it is the last holder of a superseded snapshot, that is, once per update that arrived while it was busy; while no update arrives, the brace decrements a counter and nothing else. In exchange the consumer, not the updater, carries the cost of tearing down the old rows in that case, and it does so between its own iterations, where the updater is not waiting on it.

Nothing in `consume` looks at `version` or compares one snapshot with the last. The loop calls `useRows` on whatever the slot holds, so with no update in flight it processes the same rows again and again, and with updates faster than its iterations it skips the ones that were replaced before it looked. Both were true of the earlier revision too; the change alters the cost of a read, not which reads happen. Whether `useRows` tolerates repeated or skipped snapshots is a question for its definition.

The dereference itself is the only place where `snapshot` must be non-null: `operator->` on an empty `shared_ptr` is undefined behaviour, and `get()` returns whatever `current_` holds. That the slot never holds an empty pointer is established by its initialiser, which the next step reads.

```

</details>

### Turn 6: write-step (file-2) · W1.5

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W1.5 The slot never holds a null pointer
Walk W1 (walk): What happens when the consumer reads a snapshot?. The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.
Summary: The member initialiser installs an empty snapshot, so get() returns a valid pointer before the first update.
- The member starts as a non-null empty snapshot: include/snapshot_slot.h (To) lines 27–27
Brief: Teaching order, not execution order: this initialiser ran when the SnapshotSlot was constructed, before the consumer thread started. Make comprehensible that it installs an empty snapshot (version 0, no rows), so the `snapshot->rows` dereference in the previous step is safe even before the first onUpdate(); in the old version the same guarantee came for free from a value member (base line 24). The reader leaves the walk knowing that a read is cheap, is used with no lock held, and is never null.
The step before: W1.4 The rows are used with no lock held — useRows reads through the pointer after get() has released the mutex; the local pointer is what keeps the rows alive until the iteration ends.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This step is out of execution order: the initialiser here ran when the `SnapshotSlot` was constructed, before `startConsumer` launched the thread of the first step, since the thread captures a reference to a slot that already exists. It is read last because it answers the question the previous step left open: `snapshot->rows` is only defined if the pointer is non-null, and this is where that is made so.

The default member initialiser calls `std::make_shared<const DataSnapshot>()`, so `current_` begins life pointing at one heap-allocated `DataSnapshot` with its default contents: `version` is 0 from the in-class initialiser on the struct, and `rows` is an empty vector. A consumer that runs before the first `onUpdate` therefore gets a real pointer from `get()`, and `useRows` is called with no rows rather than with a crash. In the earlier revision the member was a `DataSnapshot` by value (include/snapshot_slot.h, base line 24), default-constructed to the same empty state, and the question of null could not arise because there was no pointer; here the same starting state has to be installed deliberately, at the cost of one allocation per slot.

Be exact about what this guarantees. The initialiser makes the pointer non-null at the start; `set()` then stores whatever it is given, with no check, so the slot stays non-null only as long as every caller of `set()` passes a pointer to a real snapshot. The one caller in this material, `onUpdate`, always does, because it builds its argument with `make_shared` (the update walk's first step shows it). A caller elsewhere that passed an empty `shared_ptr` would make the consumer's next dereference undefined behaviour, and nothing in the class would stop it.

With this the read side is complete: a read is a pointer copy under the lock, the rows are used with no lock held and stay valid for the iteration, and the pointer is never null while the slot is used as this material uses it.

<!-- dspatch:details -->

The empty snapshot is an ordinary snapshot, not a "nothing published yet" state. A consumer cannot tell it from an update that legitimately carried version 0 and no rows, and `consume` does not look at `version` in any case, as an earlier step noted. If the first `useRows` call must wait for real data, that is not something the slot expresses; it would have to come from the caller that starts the consumer, which is outside the material.

`make_shared<const DataSnapshot>()` creates the object as `const` from the outset, so the resulting pointer type is exactly the member's `std::shared_ptr<const DataSnapshot>` and no conversion takes place. The non-null invariant it establishes is not mentioned in the comment above the class, which speaks of immutability, readers and the mutex; the reading at the end of the walks holds that comment against what the two walks have shown.

```

</details>

### Turn 7: write-step (file-2) · W2.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.1 onUpdate builds the next snapshot on the heap
Walk W2 (walk): What happens when an update arrives?. The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.
Summary: A fresh DataSnapshot is allocated with make_shared and filled from the payload.
- onUpdate allocates and fills the next snapshot: src/feed.cpp (To) lines 8–11
Brief: Entry point: onUpdate() is called with a Payload by feed code that is not in the material, on a thread this material does not show; the slot's mutex is what allows it to be a different thread from the consumer's. Make comprehensible that a new DataSnapshot is allocated with make_shared and filled from the payload: the rows are still copied, once, here, where the old version copied them into a stack DataSnapshot and then again inside set(). `next` points at a non-const DataSnapshot so that it can be filled. The reader takes the filled `next` to the handover on line 12.
The step after: W2.2 Handover: set() takes ownership of a read-only snapshot — std::move passes ownership into set()'s by-value const parameter; under the lock the slot's pointer is swapped.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This walk starts at the other end of the slot. `onUpdate` is the entry point for new data: it receives a `Payload`, a `version` and a vector of `rows` as declared just above, from feed code that is not in this material, on a thread the material does not show. Nothing here ties it to the consumer thread of the read walk, and nothing needs to: the slot's mutex is what lets the two run on different threads.

The work here is to build the snapshot that will replace the current one. `std::make_shared<DataSnapshot>()` allocates a new `DataSnapshot` on the heap and gives `next` sole ownership of it; the two assignments then fill it from the payload. `next->rows = payload.rows` is a full copy of every string, because `payload` is a `const` reference and cannot be moved from. **This is the one copy of the rows that the new design still makes, and it happens on the updater's thread with no lock held.** In the earlier revision `next` was a `DataSnapshot` on the stack (src/feed.cpp, base lines 9–11), filled the same way, and then `set()` copied it a second time into the slot's member under the lock; the second copy is what disappears, as the next step shows.

Notice the type: `next` is a `std::shared_ptr<DataSnapshot>`, not to `const`, and it is the only non-`const` handle to any snapshot in this material. That is deliberate and harmless at this point. Until the handover, nobody but this thread can reach the object, its reference count is one, and filling it needs no synchronisation. It becomes read-only for everyone the moment it is passed on, which is the next step's subject. The reader takes the filled `next` to that call.

<!-- dspatch:details -->

Building the snapshot outside the slot has a consequence for failure as well as for cost. The only allocations that can fail here are the `make_shared` and the string copies into `next->rows`, and both happen before the slot is touched; if one of them throws, `next` is destroyed on the way out and the slot still publishes the previous snapshot, unchanged. In the earlier revision the row copy that could fail was the one inside `set()`, into the live member, under the lock. The language only promises that a `std::vector` left behind by a failed copy assignment is in a valid state, not which one, so a reader could have taken a partially replaced snapshot. Whether that case mattered in practice is not something this material shows.

The cost moves as well as shrinks. Each update now pays one heap allocation for the `DataSnapshot` and its control block, which `make_shared` combines into one, plus the row copy; it no longer pays for destroying `next` at the end of `onUpdate`, because the object lives on as the published snapshot, and whoever holds it last destroys it, which the read walk showed can be the consumer's thread.

The copy from `payload.rows` is forced by the signature, since `const Payload&` forbids moving. A caller that no longer needed its payload could avoid it if `onUpdate` took the payload by value or by rvalue reference; that is an alternative the change does not take, and the caller is not here to show whether it would help.

```

</details>

### Turn 8: write-step (file-2) · W2.2

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.2 Handover: set() takes ownership of a read-only snapshot
Walk W2 (walk): What happens when an update arrives?. The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.
Summary: std::move passes ownership into set()'s by-value const parameter; under the lock the slot's pointer is swapped.
- The old set(): copies the snapshot into the member under the lock: include/snapshot_slot.h (From) lines 17–20
- The new set(): takes an owned const pointer and moves it in under the lock: include/snapshot_slot.h (To) lines 20–23 — reached from slot.set(std::move(next)) in onUpdate() (src/feed.cpp target 12–12)
Together: Seeing the old and the new set() side by side shows the parameter change from a const reference to an owned pointer and the copy becoming a move.
Brief: Reached from slot.set(std::move(next)) on line 12 of onUpdate(). Make comprehensible the boundary at the call: std::move hands ownership to the by-value parameter without a reference-count bump, and the parameter type shared_ptr<const DataSnapshot> is where the snapshot becomes read-only for everyone who reads it afterwards (the conversion from shared_ptr<DataSnapshot> is implicit). Then, under the lock, `current_ = std::move(next)` swaps the slot's pointer; the old set() copied every row of `next` into current_ under the same lock. The reader takes to the next step the question what the assignment does to the pointer current_ held before.
The step before: W2.1 onUpdate builds the next snapshot on the heap — A fresh DataSnapshot is allocated with make_shared and filled from the payload.
The step after: W2.3 What becomes of the previous snapshot — The assignment drops the slot's reference; the old snapshot survives in any reader that still holds it, or is freed right here under the lock.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The filled `next` from the previous step arrives here through `slot.set(std::move(next))`. Two things happen at that call boundary before any lock is taken, and both are decided by the signature.

First, ownership moves. `std::move` turns the caller's `next` into an rvalue, and the by-value parameter `next` of `set()` is constructed from it by moving: the pointer and its control block pass into the parameter, the caller's variable is left empty, and the reference count stays at one. No copy of anything, and no count traffic, happens on the way in. Second, the snapshot becomes read-only. The caller held a `std::shared_ptr<DataSnapshot>`; the parameter is a `std::shared_ptr<const DataSnapshot>`, and the conversion is implicit because a pointer to `DataSnapshot` converts to a pointer to `const DataSnapshot`. **From this parameter onward every handle to the snapshot is a pointer to `const`**, and since the caller's non-`const` handle was emptied by the move, the object it filled is now immutable for everyone who can reach it. That is the mechanism behind the read walk's claim that rows cannot change under a reader.

Inside, under the lock, `current_ = std::move(next)` makes the slot point at the new snapshot, in constant time. The old `set()` is the same two lines in shape, but its parameter was a `const DataSnapshot&` and the assignment copied `version` and every string in `rows` into the member while the consumer's `get()` waited on the mutex; that was the second copy of each update, and the one the change removes. The new assignment also lets go of the pointer the slot held until now; what that releases is the next step's subject.

<!-- dspatch:details -->

The lock does more here than guard the pointer. The rows were written on the updater's thread with no lock, in the previous step; what makes those writes visible to a consumer is that the updater's release of `mutex_` at the end of `set()` synchronises with the consumer's later acquire of it in `get()`. A consumer that takes the new pointer therefore sees the completed fill, by the language's rules for mutexes, with no separate fence or atomic needed. A consumer that reached `get()` before this `set()` took the lock keeps the previous snapshot, as the read walk showed.

The parameter is taken by value rather than by rvalue reference, which leaves callers a choice: pass an rvalue, as `onUpdate` does, and nothing is copied; pass an lvalue, and the parameter is a copy with the count incremented, the caller keeping its own handle. The second form is allowed by the signature but not used in this material. It is also where the immutability guarantee has its edge: a caller that kept a non-`const` `std::shared_ptr<DataSnapshot>` after passing a copy could still write to a published snapshot, and nothing in `SnapshotSlot` could prevent it. The guarantee rests on callers handing their only handle over, which `onUpdate` does by moving.

Compared with the earlier revision there is a change of ownership direction too. The old `set()` borrowed the caller's stack object and the caller destroyed it on return; the new `set()` takes the object over, and after this call the updater no longer owns the snapshot it built. The parameter itself is empty after the move, so its destruction at the closing brace of `set()` releases nothing; the only release in this function is the one the assignment performs on the previous `current_`, read in the next step.

```

</details>

### Turn 9: write-step (file-2) · W2.3

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: W2.3 What becomes of the previous snapshot
Walk W2 (walk): What happens when an update arrives?. The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.
Summary: The assignment drops the slot's reference; the old snapshot survives in any reader that still holds it, or is freed right here under the lock.
- The pointer swap, read for what it releases: include/snapshot_slot.h (To) lines 22–22
Revisit: The previous step showed this assignment as the install; now the point is the reference it drops and the two fates of the old snapshot that follow from it.
Brief: The same assignment as in the previous step, now read for what it releases rather than what it installs. Make comprehensible that there are two outcomes decided by the reference count, not by any branch in the code: if a consumer iteration still holds the old snapshot (src/consumer.cpp target lines 9-11, read walk step 4), it stays alive until that local goes out of scope and is freed on the consumer's thread; if nobody holds it, its rows are freed right here, inside set(), while the mutex is still held, since the lock_guard is released only at the closing brace. After the move, `next` is empty, so nothing further is released when the parameter is destroyed at return. The reader takes to the reading of the header comment the question whether this matches what the comment promises.
The step before: W2.2 Handover: set() takes ownership of a read-only snapshot — std::move passes ownership into set()'s by-value const parameter; under the lock the slot's pointer is swapped.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
The same assignment as in the previous step, now read for the other half of what a `shared_ptr` assignment does. Before this line, `current_` holds a share of the previous snapshot; assigning a new pointer into it gives that share up, and the old snapshot's reference count drops by one at the semicolon. **Nothing in the code decides what happens next; the count does.** There is no branch here, and the two possible outcomes are both written inside `std::shared_ptr`.

- A reader still holds it. If a consumer iteration is between its `get()` and its closing brace, as the read walk showed, its local `snapshot` keeps a share; the count stays above zero and the old rows stay intact for as long as that iteration needs them. They are freed later, when the last such local is destroyed, on that reader's thread and outside any lock.
- Nobody holds it. If the consumer is between iterations, or has not looked since, the slot's share was the last one. Then the count reaches zero here, and the `DataSnapshot` with every string in its `rows` is destroyed inside `set()`, on the updater's thread, while the mutex is still held, because the `lock_guard` is released only at the closing brace that follows.

Which of the two occurs depends on timing between the threads; the code allows either and this material cannot say which is common. The parameter `next` plays no part in it: it was emptied by the move, as the previous step established, so its destruction at return releases nothing.

The second case is worth seeing for what it does to the lock. The swap itself is constant time, but when the old snapshot dies here, its destruction, proportional to the number of rows, runs under the mutex, and a consumer arriving at `get()` waits for it. The reading that follows holds the header comment against both walks, and one question to take there is that the comment says what readers keep, not where the old snapshot ends.

<!-- dspatch:details -->

The destruction under the lock is not new in kind. In the earlier revision the copy assignment into the member overwrote the old strings in place, under the same lock, so freeing the old rows on the updater's thread with the mutex held was the rule then; what the change adds is the first case, where the old rows are not freed here at all because a reader is still using them, and the deallocation moves to that reader. The remaining cost under the lock could be moved out as well, by swapping the old pointer into a local inside the locked region and letting that local die after the `lock_guard`; the code does not do this, and the mutex-held destruction is what it has.

"A reader" is anyone who called `get()`, not only the consumer in this material. `get()` is public, and every copy it returned is a share; a caller that stored one in a longer-lived place would keep that snapshot, and its rows, alive across any number of updates. Memory for superseded snapshots is therefore bounded by how long readers hold their pointers, which the slot neither tracks nor limits.

The release itself is thread-safe without the lock, as the decrement is atomic, and in the first case the final release on the consumer's thread races with nothing: at that point the slot no longer points at the object, so no other `get()` can produce a new share of it. The lock here protects the assignment to `current_` from a concurrent `get()`, exactly as the read walk's third step described; the old object's fate needs no protection beyond its count.

```

</details>

### Turn 10: write-step (file-2) · R1.1

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: write-step

## This step: R1.1 The comment's promises and where they live in the code
Walk R1 (reading): The contract the new header comment states. The person can hold the two walks against the change's only stated intent.
Summary: New text: a published snapshot is immutable, readers keep the one they took while the updater installs the next, and the mutex guards the pointer only.
- The design comment above SnapshotSlot: include/snapshot_slot.h (To) lines 12–13
Brief: New text with no counterpart in base, the change's only stated intent. Make comprehensible which code each sentence rests on: immutability is the const in the member and parameter types (target lines 20 and 27), readers keeping theirs is the shared ownership shown in the read walk, and the mutex scope is the two lock_guards on lines 17 and 21. Note what the comment does not say: what happens to the previous snapshot when its last holder drops it, which the update walk's last step covers.

Answer with the explanation of this step only, as before.
```

</details>

<details><summary>Answer</summary>

```text
This comment is new; the earlier revision's `SnapshotSlot` had none, and nothing else in the change says what it is for. It makes three promises, and after the two walks each can be placed on the code it rests on.

**"Publishes an immutable snapshot."** This rests on the `const` in the types: `current_` is a `std::shared_ptr<const DataSnapshot>`, `get()` returns the same type, and `set()` accepts it. Every handle that leaves the slot or enters it points at `const`, so no holder of a published snapshot can write to it. The walks showed the one place where a snapshot is not yet `const`: `next` inside `onUpdate` before the handover, where the move empties the only non-`const` handle. The promise therefore holds for this material's callers, and depends on callers handing their handle over as `onUpdate` does.

**"Readers keep the one they took while the updater installs the next."** This is shared ownership, nothing more: `get()` hands out a share of the current snapshot, the consumer's local keeps that share until its iteration ends, and the assignment in `set()` gives up only the slot's own share. A reader holding the old pointer is unaffected by the install, as the read walk's fourth step and the update walk's last step showed from both sides.

**"The mutex protects the pointer, not the rows."** The two `lock_guard`s in `get()` and `set()` enclose a pointer copy and a pointer move-assignment respectively; the rows are filled in `onUpdate` before `set()` is called, and read in `consume` after `get()` has returned, both with no lock. What keeps the rows safe is the first two promises, not the third.

What the comment leaves out is as useful to hold against the walks as what it says. It does not say where the previous snapshot ends: on the last holder's thread when a reader outlives the install, or inside `set()` under the mutex when none does, which is the update walk's last step. It does not say that the slot starts with a real, empty snapshot and is never null, which the read walk's last step found in the initialiser. And it does not bound how long a reader may keep what it took, which is the same freedom as the second promise seen from the memory side.

<!-- dspatch:details -->

"Not the rows" is exact about what the mutex guards and slightly understates what it does. The rows are written on the updater's thread and read on the consumer's thread with no lock on either access, and the comment is right that the mutex is not what makes those accesses safe. But the updater's unlock at the end of `set()` and the consumer's lock in `get()` are also what order the fill before the read, so a reader that takes the new pointer sees completed rows. The mutex guards the pointer and, as a consequence, publishes the rows; the second part is not stated.

The third promise also has a case where the rows are touched under the mutex after all: when the slot's share was the last one, the old snapshot's destructor runs inside `set()` with the lock held. That is destruction, not protection, and it does not contradict the comment; it is a cost the comment does not mention, and the update walk's last step shows the alternative of releasing it outside the lock.

Two things the class does not enforce lie behind the first promise. `set()` stores whatever it is given, so an empty pointer from a caller would end the non-null guarantee the initialiser established; and a caller that passed a copy rather than moving would keep a writable handle to a published snapshot. Neither happens in this material, and `onUpdate` is the only caller shown. Whether other callers exist, and whether they follow the same pattern, cannot be read here.

```

</details>

### Turn 11: review-walks (file-3)

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
### W1 (walk): What happens when the consumer reads a snapshot?
Purpose: The person sees that a read is a pointer copy under the lock and that the taken snapshot stays valid, unlocked, until the loop iteration ends.

#### W1.1 The consumer loop runs on its own thread
- startConsumer launches the consumer thread: src/consumer.cpp (To) lines 14–16

This is unchanged code, and it is here to fix the execution context for the whole walk. `startConsumer` creates a `std::thread` whose body is a lambda that calls `consume(slot, stopping)`, and it returns the thread object to its caller. From that moment on, `consume` runs on a thread of its own: every read of the slot in the steps that follow happens on this thread, while `onUpdate` (the update walk) may run on any other thread at the same time. The `SnapshotSlot` and its mutex exist for exactly this situation.

The lambda captures `slot` and `stopping` by reference, so the consumer thread works on the same `SnapshotSlot` object that the updater writes to, and reads the same `std::atomic<bool>` that someone else will set to end it. `consume` loops `while (!stopping)` and does two things per iteration: take a snapshot from the slot and hand its rows to `useRows` (src/consumer.cpp, target lines 7–12). There is no sleep or wait in the loop, so this thread calls `slot.get()` again as soon as `useRows` returns; the loop ends only when `stopping` becomes true, and the check sits at the top of the loop, so the iteration that is in progress completes first.

Nothing in the material calls `startConsumer`, sets `stopping`, or defines `useRows` (only its declaration is here, line 5). What you can judge from this code is the thread's shape; who owns the thread, when it is stopped and how long `slot` outlives it are decided by code you cannot see here. Take the body of `consume` to the next step, where its local variable is what the change touches.

Show more:
Two language rules matter for reading this safely, and both are the caller's responsibility rather than this file's. First, the by-reference captures mean that `slot` and `stopping` must stay alive for as long as the thread runs; the lambda holds no ownership of either, so if the caller lets them go out of scope before the thread has finished, the consumer reads freed memory. Second, the returned `std::thread` is joinable, and destroying a joinable `std::thread` without `join()` or `detach()` calls `std::terminate`; the caller must do one of the two, and the usual pattern is to set `stopping` and then join. Neither can be checked from this material.

Because `stopping` is a `std::atomic<bool>`, the plain `!stopping` test in the loop condition is a well-defined read even while another thread stores `true` into it; no lock is needed for the flag, and the slot's mutex has nothing to do with it. The flag is also the only coupling between the loop and the outside world: `consume` does not block on the slot, so it will spin through `get()` and `useRows` continuously between the moment the thread starts and the moment the flag is seen. Whether that is acceptable depends on what `useRows` costs and how often updates arrive, neither of which this code shows.

The identical lines in the earlier revision (src/consumer.cpp, base lines 14–16) confirm that the change did not touch how the consumer is started or stopped; it only changes what each iteration takes from the slot, which is the subject of the next step.

#### W1.2 Each iteration takes a pointer, not a copy
- The loop body takes a shared pointer from the slot: src/consumer.cpp (To) lines 9–9 — reached from The thread lambda that calls consume() (src/consumer.cpp target 15–15)

We are inside the loop that the consumer thread runs, as the previous step showed. This line is the consumer's side of the change: the local `snapshot` is now a `std::shared_ptr<const DataSnapshot>`, where the earlier revision declared it as a `DataSnapshot` held by value (src/consumer.cpp, base line 9). In the old form every iteration owned its own `DataSnapshot`, with its own copy of every string in `rows`; in the new form the iteration owns a pointer to a `DataSnapshot` that it shares with the slot and with anyone else who took the same snapshot, and no row is copied here.

The `const` in the pointee type is what makes sharing safe to read. Through `snapshot`, `rows` and `version` are readable but not assignable, so this thread cannot alter the object that the slot still publishes and that other readers may hold. That fits the only use made of it: `useRows` takes a `const std::vector<std::string>&`, so passing `snapshot->rows` needs nothing more than read access. The restriction is enforced by the compiler on this code, not by anything at run time.

Two things follow that the reader should carry forward. The snapshot is cheap to take, which the next step shows by reading `get()`: what the lock covers and what the returned pointer owns. And the snapshot lives exactly as long as this local does, that is, until the closing brace of the iteration; a later step shows what that means while `useRows` runs and when an update arrives in the meantime.

Show more:
The declared type is spelled out rather than written as `auto`, and it matches the return type of `SnapshotSlot::get()` exactly (include/snapshot_slot.h, target line 16), so the initialisation is a plain move of the returned `shared_ptr` into the local, with no conversion and no extra reference-count traffic on this line. The count work that does happen is inside `get()`, which the next step reads.

The local is a new object each time round the loop. The pointer from the previous iteration was destroyed at that iteration's closing brace, so at the top of each pass this thread holds no snapshot at all; it holds one only between this line and the end of the iteration. Taken together with the previous step, that means the consumer never pins more than one `DataSnapshot` at a time, but it does pin one for the whole duration of `useRows`.

In the earlier revision the cost of this line was hidden in `get()`'s return statement, which produced the `DataSnapshot` by copying the member; the local then took that temporary without a further copy. So the change does not remove a copy from this line as such; it removes the copy that this line used to cause inside the slot, and replaces ownership of a private copy with shared ownership of a published one. The price is that the rows this thread reads may be older than the slot's current ones by the time `useRows` finishes, which is also what the design intends: the comment above `SnapshotSlot` says readers keep the snapshot they took (include/snapshot_slot.h, target lines 12–13), and the reading at the end of the walks returns to that.

#### W1.3 get() copies the pointer under the lock, where it used to copy every row
- The old get(): a copy of the whole snapshot under the lock: include/snapshot_slot.h (From) lines 13–16
- The new get(): a copy of the shared pointer under the lock: include/snapshot_slot.h (To) lines 16–19 — reached from slot.get() in the consumer loop (src/consumer.cpp target 9–9)

The consumer's `slot.get()` from the previous step lands here. The two versions of `get()` read the same: take a `std::lock_guard` on `mutex_`, then `return current_;`. Everything that changed is in the types, and the types decide how much work that one return statement does while the lock is held.

In the old version `current_` is a `DataSnapshot` and the return copies it: `version`, the `std::vector<std::string>`, and a fresh allocation for every string in it. The updater's `set()` waits on the same mutex, so the critical section grew with the number of rows, and each consumer iteration paid that copy. In the new version `current_` is a `std::shared_ptr<const DataSnapshot>` and the return copies the pointer: two words of pointer and one atomic increment of the reference count, in constant time and with no allocation. **The lock still spans the whole copy, but the copy is now the pointer, not the rows.**

The mutex is not made redundant by `shared_ptr`. What `shared_ptr` makes thread-safe is its reference count, shared by all copies; the `shared_ptr` object itself, the member `current_`, is ordinary memory. Reading it here while `set()` assigns to it on another thread (the update walk shows that assignment) would be a data race on that object, and the lock on both sides is what rules it out. So the guarantee is exactly as the header comment above the class puts it: the mutex protects the pointer, and only the pointer.

What this thread takes away is a pointer that co-owns the `DataSnapshot` together with the slot. From this moment the count is at least two, and a later `set()` that replaces `current_` can only drop the slot's share; it cannot free the rows this thread is about to read. The next step uses them with the lock already released.

Show more:
The order of events at the return is fixed by the language: the return value is constructed from `current_` first, and the `lock_guard` is destroyed afterwards, as the function's locals go out of scope. So the pointer copy is complete, and the count already incremented, before the mutex is released; there is no window in which the caller holds a pointer that was not yet counted. The same rule made the old version's full copy complete under the lock too.

`get()` is a `const` member function, and locking a mutex modifies it; that is why `mutex_` is declared `mutable` in both revisions (include/snapshot_slot.h, base line 23, target line 26). Nothing else in the class is written by `get()`.

Two points are worth holding in mind for judging the design, and the walks return to both. First, the pointer's constness is what lets the rows be read without a lock: no one with a `shared_ptr<const DataSnapshot>` can change them, and the only non-`const` handle to a snapshot in this material is `next` inside `onUpdate` before it is handed over, which the update walk's first step covers. Second, the lock shrinks but does not disappear: with one consumer spinning through `get()` as the first step showed, the updater still contends for the mutex on every update, only now for a few instructions rather than for a copy of every row. The language also offers `std::atomic<std::shared_ptr<T>>` for a lock-free pointer swap; this code does not use it, and the mutex is the chosen mechanism.

#### W1.4 The rows are used with no lock held
- useRows reads through the pointer; the iteration ends: src/consumer.cpp (To) lines 10–11

Back in `consume`, with the pointer that `get()` returned in the previous step. By the time this line runs, the `lock_guard` inside `get()` has already been destroyed, so `useRows` reads the rows with no lock held at all. `snapshot->rows` is a `const std::vector<std::string>&` into the shared `DataSnapshot`; nothing is copied, and `useRows` (declared at the top of the file, defined outside this material) sees the same memory that the slot and any other reader of this snapshot see.

What makes that safe is the combination the walk has built up. The rows cannot change under `useRows`, because every published handle is a pointer to `const` and an update installs a different object rather than editing this one. And the rows cannot be freed under `useRows`, because this thread's `snapshot` holds a share of the ownership; an update that replaces the slot's pointer in the meantime (shown in the update walk) only removes the slot's share. **The local pointer, not the mutex, is what keeps the rows valid for the whole of this line.** In the earlier revision the same call read the iteration's private copy, which was safe for the simpler reason that nobody else could see it.

At the closing brace the iteration ends and `snapshot` is destroyed, which releases its share. Two outcomes are possible, decided by the count rather than by any code here: if the slot still publishes this snapshot, it stays alive and nothing happens; if the slot has moved on and this was the last share, the `DataSnapshot` and all of its strings are destroyed right here, on the consumer's thread, outside any lock. Then the loop re-tests `stopping` and, if it goes on, takes a fresh pointer.

One thing this material cannot settle: the reference handed to `useRows` is valid only until that closing brace. If `useRows` kept the reference, or a pointer into the rows, beyond its return, it would dangle as soon as this thread drops the last share. Its definition is not here. The next step turns to the other precondition of `snapshot->rows`: that the pointer is never null.

Show more:
The deallocation moving to the consumer is a consequence worth seeing clearly. In the earlier revision each iteration freed its own copy at the closing brace, every time, so the consumer always paid for a destruction of all rows per pass. Now it pays only when it is the last holder of a superseded snapshot, that is, once per update that arrived while it was busy; while no update arrives, the brace decrements a counter and nothing else. In exchange the consumer, not the updater, carries the cost of tearing down the old rows in that case, and it does so between its own iterations, where the updater is not waiting on it.

Nothing in `consume` looks at `version` or compares one snapshot with the last. The loop calls `useRows` on whatever the slot holds, so with no update in flight it processes the same rows again and again, and with updates faster than its iterations it skips the ones that were replaced before it looked. Both were true of the earlier revision too; the change alters the cost of a read, not which reads happen. Whether `useRows` tolerates repeated or skipped snapshots is a question for its definition.

The dereference itself is the only place where `snapshot` must be non-null: `operator->` on an empty `shared_ptr` is undefined behaviour, and `get()` returns whatever `current_` holds. That the slot never holds an empty pointer is established by its initialiser, which the next step reads.

#### W1.5 The slot never holds a null pointer
- The member starts as a non-null empty snapshot: include/snapshot_slot.h (To) lines 27–27

This step is out of execution order: the initialiser here ran when the `SnapshotSlot` was constructed, before `startConsumer` launched the thread of the first step, since the thread captures a reference to a slot that already exists. It is read last because it answers the question the previous step left open: `snapshot->rows` is only defined if the pointer is non-null, and this is where that is made so.

The default member initialiser calls `std::make_shared<const DataSnapshot>()`, so `current_` begins life pointing at one heap-allocated `DataSnapshot` with its default contents: `version` is 0 from the in-class initialiser on the struct, and `rows` is an empty vector. A consumer that runs before the first `onUpdate` therefore gets a real pointer from `get()`, and `useRows` is called with no rows rather than with a crash. In the earlier revision the member was a `DataSnapshot` by value (include/snapshot_slot.h, base line 24), default-constructed to the same empty state, and the question of null could not arise because there was no pointer; here the same starting state has to be installed deliberately, at the cost of one allocation per slot.

Be exact about what this guarantees. The initialiser makes the pointer non-null at the start; `set()` then stores whatever it is given, with no check, so the slot stays non-null only as long as every caller of `set()` passes a pointer to a real snapshot. The one caller in this material, `onUpdate`, always does, because it builds its argument with `make_shared` (the update walk's first step shows it). A caller elsewhere that passed an empty `shared_ptr` would make the consumer's next dereference undefined behaviour, and nothing in the class would stop it.

With this the read side is complete: a read is a pointer copy under the lock, the rows are used with no lock held and stay valid for the iteration, and the pointer is never null while the slot is used as this material uses it.

Show more:
The empty snapshot is an ordinary snapshot, not a "nothing published yet" state. A consumer cannot tell it from an update that legitimately carried version 0 and no rows, and `consume` does not look at `version` in any case, as an earlier step noted. If the first `useRows` call must wait for real data, that is not something the slot expresses; it would have to come from the caller that starts the consumer, which is outside the material.

`make_shared<const DataSnapshot>()` creates the object as `const` from the outset, so the resulting pointer type is exactly the member's `std::shared_ptr<const DataSnapshot>` and no conversion takes place. The non-null invariant it establishes is not mentioned in the comment above the class, which speaks of immutability, readers and the mutex; the reading at the end of the walks holds that comment against what the two walks have shown.

### W2 (walk): What happens when an update arrives?
Purpose: The person sees that the rows are copied once on the updater's side, that the swap happens under the lock, and that the old snapshot lives exactly as long as some reader still holds it.

#### W2.1 onUpdate builds the next snapshot on the heap
- onUpdate allocates and fills the next snapshot: src/feed.cpp (To) lines 8–11

This walk starts at the other end of the slot. `onUpdate` is the entry point for new data: it receives a `Payload`, a `version` and a vector of `rows` as declared just above, from feed code that is not in this material, on a thread the material does not show. Nothing here ties it to the consumer thread of the read walk, and nothing needs to: the slot's mutex is what lets the two run on different threads.

The work here is to build the snapshot that will replace the current one. `std::make_shared<DataSnapshot>()` allocates a new `DataSnapshot` on the heap and gives `next` sole ownership of it; the two assignments then fill it from the payload. `next->rows = payload.rows` is a full copy of every string, because `payload` is a `const` reference and cannot be moved from. **This is the one copy of the rows that the new design still makes, and it happens on the updater's thread with no lock held.** In the earlier revision `next` was a `DataSnapshot` on the stack (src/feed.cpp, base lines 9–11), filled the same way, and then `set()` copied it a second time into the slot's member under the lock; the second copy is what disappears, as the next step shows.

Notice the type: `next` is a `std::shared_ptr<DataSnapshot>`, not to `const`, and it is the only non-`const` handle to any snapshot in this material. That is deliberate and harmless at this point. Until the handover, nobody but this thread can reach the object, its reference count is one, and filling it needs no synchronisation. It becomes read-only for everyone the moment it is passed on, which is the next step's subject. The reader takes the filled `next` to that call.

Show more:
Building the snapshot outside the slot has a consequence for failure as well as for cost. The only allocations that can fail here are the `make_shared` and the string copies into `next->rows`, and both happen before the slot is touched; if one of them throws, `next` is destroyed on the way out and the slot still publishes the previous snapshot, unchanged. In the earlier revision the row copy that could fail was the one inside `set()`, into the live member, under the lock. The language only promises that a `std::vector` left behind by a failed copy assignment is in a valid state, not which one, so a reader could have taken a partially replaced snapshot. Whether that case mattered in practice is not something this material shows.

The cost moves as well as shrinks. Each update now pays one heap allocation for the `DataSnapshot` and its control block, which `make_shared` combines into one, plus the row copy; it no longer pays for destroying `next` at the end of `onUpdate`, because the object lives on as the published snapshot, and whoever holds it last destroys it, which the read walk showed can be the consumer's thread.

The copy from `payload.rows` is forced by the signature, since `const Payload&` forbids moving. A caller that no longer needed its payload could avoid it if `onUpdate` took the payload by value or by rvalue reference; that is an alternative the change does not take, and the caller is not here to show whether it would help.

#### W2.2 Handover: set() takes ownership of a read-only snapshot
- The old set(): copies the snapshot into the member under the lock: include/snapshot_slot.h (From) lines 17–20
- The new set(): takes an owned const pointer and moves it in under the lock: include/snapshot_slot.h (To) lines 20–23 — reached from slot.set(std::move(next)) in onUpdate() (src/feed.cpp target 12–12)

The filled `next` from the previous step arrives here through `slot.set(std::move(next))`. Two things happen at that call boundary before any lock is taken, and both are decided by the signature.

First, ownership moves. `std::move` turns the caller's `next` into an rvalue, and the by-value parameter `next` of `set()` is constructed from it by moving: the pointer and its control block pass into the parameter, the caller's variable is left empty, and the reference count stays at one. No copy of anything, and no count traffic, happens on the way in. Second, the snapshot becomes read-only. The caller held a `std::shared_ptr<DataSnapshot>`; the parameter is a `std::shared_ptr<const DataSnapshot>`, and the conversion is implicit because a pointer to `DataSnapshot` converts to a pointer to `const DataSnapshot`. **From this parameter onward every handle to the snapshot is a pointer to `const`**, and since the caller's non-`const` handle was emptied by the move, the object it filled is now immutable for everyone who can reach it. That is the mechanism behind the read walk's claim that rows cannot change under a reader.

Inside, under the lock, `current_ = std::move(next)` makes the slot point at the new snapshot, in constant time. The old `set()` is the same two lines in shape, but its parameter was a `const DataSnapshot&` and the assignment copied `version` and every string in `rows` into the member while the consumer's `get()` waited on the mutex; that was the second copy of each update, and the one the change removes. The new assignment also lets go of the pointer the slot held until now; what that releases is the next step's subject.

Show more:
The lock does more here than guard the pointer. The rows were written on the updater's thread with no lock, in the previous step; what makes those writes visible to a consumer is that the updater's release of `mutex_` at the end of `set()` synchronises with the consumer's later acquire of it in `get()`. A consumer that takes the new pointer therefore sees the completed fill, by the language's rules for mutexes, with no separate fence or atomic needed. A consumer that reached `get()` before this `set()` took the lock keeps the previous snapshot, as the read walk showed.

The parameter is taken by value rather than by rvalue reference, which leaves callers a choice: pass an rvalue, as `onUpdate` does, and nothing is copied; pass an lvalue, and the parameter is a copy with the count incremented, the caller keeping its own handle. The second form is allowed by the signature but not used in this material. It is also where the immutability guarantee has its edge: a caller that kept a non-`const` `std::shared_ptr<DataSnapshot>` after passing a copy could still write to a published snapshot, and nothing in `SnapshotSlot` could prevent it. The guarantee rests on callers handing their only handle over, which `onUpdate` does by moving.

Compared with the earlier revision there is a change of ownership direction too. The old `set()` borrowed the caller's stack object and the caller destroyed it on return; the new `set()` takes the object over, and after this call the updater no longer owns the snapshot it built. The parameter itself is empty after the move, so its destruction at the closing brace of `set()` releases nothing; the only release in this function is the one the assignment performs on the previous `current_`, read in the next step.

#### W2.3 What becomes of the previous snapshot
- The pointer swap, read for what it releases: include/snapshot_slot.h (To) lines 22–22

The same assignment as in the previous step, now read for the other half of what a `shared_ptr` assignment does. Before this line, `current_` holds a share of the previous snapshot; assigning a new pointer into it gives that share up, and the old snapshot's reference count drops by one at the semicolon. **Nothing in the code decides what happens next; the count does.** There is no branch here, and the two possible outcomes are both written inside `std::shared_ptr`.

- A reader still holds it. If a consumer iteration is between its `get()` and its closing brace, as the read walk showed, its local `snapshot` keeps a share; the count stays above zero and the old rows stay intact for as long as that iteration needs them. They are freed later, when the last such local is destroyed, on that reader's thread and outside any lock.
- Nobody holds it. If the consumer is between iterations, or has not looked since, the slot's share was the last one. Then the count reaches zero here, and the `DataSnapshot` with every string in its `rows` is destroyed inside `set()`, on the updater's thread, while the mutex is still held, because the `lock_guard` is released only at the closing brace that follows.

Which of the two occurs depends on timing between the threads; the code allows either and this material cannot say which is common. The parameter `next` plays no part in it: it was emptied by the move, as the previous step established, so its destruction at return releases nothing.

The second case is worth seeing for what it does to the lock. The swap itself is constant time, but when the old snapshot dies here, its destruction, proportional to the number of rows, runs under the mutex, and a consumer arriving at `get()` waits for it. The reading that follows holds the header comment against both walks, and one question to take there is that the comment says what readers keep, not where the old snapshot ends.

Show more:
The destruction under the lock is not new in kind. In the earlier revision the copy assignment into the member overwrote the old strings in place, under the same lock, so freeing the old rows on the updater's thread with the mutex held was the rule then; what the change adds is the first case, where the old rows are not freed here at all because a reader is still using them, and the deallocation moves to that reader. The remaining cost under the lock could be moved out as well, by swapping the old pointer into a local inside the locked region and letting that local die after the `lock_guard`; the code does not do this, and the mutex-held destruction is what it has.

"A reader" is anyone who called `get()`, not only the consumer in this material. `get()` is public, and every copy it returned is a share; a caller that stored one in a longer-lived place would keep that snapshot, and its rows, alive across any number of updates. Memory for superseded snapshots is therefore bounded by how long readers hold their pointers, which the slot neither tracks nor limits.

The release itself is thread-safe without the lock, as the decrement is atomic, and in the first case the final release on the consumer's thread races with nothing: at that point the slot no longer points at the object, so no other `get()` can produce a new share of it. The lock here protects the assignment to `current_` from a concurrent `get()`, exactly as the read walk's third step described; the old object's fate needs no protection beyond its count.

### R1 (reading): The contract the new header comment states
Purpose: The person can hold the two walks against the change's only stated intent.

#### R1.1 The comment's promises and where they live in the code
- The design comment above SnapshotSlot: include/snapshot_slot.h (To) lines 12–13

This comment is new; the earlier revision's `SnapshotSlot` had none, and nothing else in the change says what it is for. It makes three promises, and after the two walks each can be placed on the code it rests on.

**"Publishes an immutable snapshot."** This rests on the `const` in the types: `current_` is a `std::shared_ptr<const DataSnapshot>`, `get()` returns the same type, and `set()` accepts it. Every handle that leaves the slot or enters it points at `const`, so no holder of a published snapshot can write to it. The walks showed the one place where a snapshot is not yet `const`: `next` inside `onUpdate` before the handover, where the move empties the only non-`const` handle. The promise therefore holds for this material's callers, and depends on callers handing their handle over as `onUpdate` does.

**"Readers keep the one they took while the updater installs the next."** This is shared ownership, nothing more: `get()` hands out a share of the current snapshot, the consumer's local keeps that share until its iteration ends, and the assignment in `set()` gives up only the slot's own share. A reader holding the old pointer is unaffected by the install, as the read walk's fourth step and the update walk's last step showed from both sides.

**"The mutex protects the pointer, not the rows."** The two `lock_guard`s in `get()` and `set()` enclose a pointer copy and a pointer move-assignment respectively; the rows are filled in `onUpdate` before `set()` is called, and read in `consume` after `get()` has returned, both with no lock. What keeps the rows safe is the first two promises, not the third.

What the comment leaves out is as useful to hold against the walks as what it says. It does not say where the previous snapshot ends: on the last holder's thread when a reader outlives the install, or inside `set()` under the mutex when none does, which is the update walk's last step. It does not say that the slot starts with a real, empty snapshot and is never null, which the read walk's last step found in the initialiser. And it does not bound how long a reader may keep what it took, which is the same freedom as the second promise seen from the memory side.

Show more:
"Not the rows" is exact about what the mutex guards and slightly understates what it does. The rows are written on the updater's thread and read on the consumer's thread with no lock on either access, and the comment is right that the mutex is not what makes those accesses safe. But the updater's unlock at the end of `set()` and the consumer's lock in `get()` are also what order the fill before the read, so a reader that takes the new pointer sees completed rows. The mutex guards the pointer and, as a consequence, publishes the rows; the second part is not stated.

The third promise also has a case where the rows are touched under the mutex after all: when the slot's share was the last one, the old snapshot's destructor runs inside `set()` with the lock held. That is destruction, not protection, and it does not contradict the comment; it is a cost the comment does not mention, and the update walk's last step shows the alternative of releasing it outside the lock.

Two things the class does not enforce lie behind the first promise. `set()` stores whatever it is given, so an empty pointer from a caller would end the non-null guarantee the initialiser established; and a caller that passed a copy rather than moving would keep a writable handle to a published snapshot. Neither happens in this material, and `onUpdate` is the only caller shown. Whether other callers exist, and whether they follow the same pattern, cannot be read here.

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
- `base/` is From, commit 4bf3aafdfb59a6d761abe660995219abc80157f5
- `target/` is To, commit bf4c284e08fcce809aefe315546083995b218c0c
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.
```

</details>

<details><summary>Answer</summary>

```text
I read all six files on both sides and checked each step's claims and line references against them; here is my assessment.

``​`json
{
  "assessment": "The reader can follow both walks and the reading from start to end. W1 enters at the consumer thread (src/consumer.cpp target 14–16), follows the loop body into get() with the call named as the transition, returns to consume with the pointer in hand, and places the initialiser (target 27) last while saying plainly that it is out of execution order and why it is read there. W2 enters at onUpdate (src/feed.cpp target 8–11), follows the std::move into set() with the implicit DataSnapshot→const DataSnapshot conversion explained at the boundary, and reads the assignment on target 22 a second time for what it releases, presenting the two outcomes (a reader still holds the old snapshot; nobody does, so it dies inside set() under the lock) as alternatives decided by the count, not as one run. Every claim I checked is true of the code: the by-reference captures and the atomic loop test, the identical shape of get()/set() on both sides with the work decided by the types (base 13–20 versus target 16–23), mutable mutex_ (base 23, target 26), the by-value const-pointer parameter, make_shared<const DataSnapshot>() keeping the slot non-null, and the lock_guard still held at the destruction on target 22–23. The text explains rather than names: at each place it says what happens here, why it matters for the change, and what decides the outcome, at a Standard level, with language rules (return-value construction before lock_guard destruction, mutex release/acquire ordering the fill before the read, what shared_ptr does and does not make thread-safe) given where the reader needs them to interpret the code. The Show more parts deepen rather than repeat: lifetime and join obligations, exception safety of building outside the slot, the publishing effect of the mutex, the bound on superseded-snapshot memory, and the alternatives the change did not take. R1 holds the three promises of the new comment against what the walks showed and names what the comment leaves out, which is the right use of a comment under section 3. Evidence and inference are kept apart; what the material cannot show (callers, useRows, thread ownership) is said once and not belaboured. One sentence in W1.4 Show more quantifies the consumer's deallocation cost as 'once per update that arrived while it was busy'; strictly it is once per iteration during which an update arrived, since intermediate snapshots die in set() as W2.3 shows. The surrounding mechanism statement is correct and the two walks together make this clear, so it does not mislead the reader about how the design works and is not a finding. Nothing significant falls short; the verdict is to accept.",
  "verdict": "accept",
  "findings": []
}
``​`

```

</details>
