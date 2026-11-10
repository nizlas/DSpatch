# snapshot · one call · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, today's one-call preparation) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:30:33.777Z, ended 2026-11-10T02:36:00.045Z; job done: 3 walk(s) and 0 reading(s), 12 step(s). 2 changed line(s) are in none of them.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | prepare-walks | file-1 | 5 min 25 s | 22931 |

Sum of answer times: 5 min 25 s.

## The walks as written in one call

**Summary:** The change stops `SnapshotSlot` from copying the whole `DataSnapshot` on every read and every update. The slot now holds a `std::shared_ptr<const DataSnapshot>`: `get()` hands the caller a shared pointer to the snapshot currently published, and `set()` installs a pointer the updater built beforehand, so the mutex is held only while that pointer is copied or swapped. The consumer thread reads the rows in place through its pointer, and the feed builds the next snapshot on the heap once and gives up its own handle to it. The new header comment states the intent: readers keep the snapshot they took while the updater installs the next one, and the mutex protects the pointer, not the rows, so the time spent under the lock no longer grows with the number of rows.

**Background:** The material holds only the three source files. There are no tests, no build files and no caller of `onUpdate`, and `useRows` is only declared, so which thread updates the slot and what the rows are used for cannot be established here. The walks describe what the code allows, not anything observed to run.

The change alters the slot's public interface: `get()` now returns a pointer and `set()` takes one. Any caller outside this material that used the old signatures would need the same adjustment the consumer and the feed received here.

Sharing one object between two threads is safe only because the object never changes after it is published. The slot enforces that through the `const` in its pointer type; the feed contributes by giving up its non-const pointer with `std::move`. The slot cannot detect a caller that keeps a mutable pointer, nor one that passes an empty pointer. The walks point at these spots.

### W1 (walk): Publishing an update without copying under the lock

*Purpose:* How a new snapshot is built, handed over and installed, and what the mutex covers during an update and what it does not. · *Question:* What happens when onUpdate publishes a new snapshot while the consumer may still be reading the old one?

- **W1.1 The contract the slot now states** — The header comment names the design the rest of the walk checks against the code: one immutable snapshot at a time, shared by pointer.
  - The design statement above SnapshotSlot: `include/snapshot_slot.h` target 12–14
- **W1.2 The feed builds the next snapshot on the heap, outside any lock** — onUpdate allocates a fresh DataSnapshot with make_shared and fills it from the payload while nothing else can see it.
  - onUpdate builds the next snapshot: `src/feed.cpp` target 9–11
- **W1.3 Handing the only mutable pointer to the slot** — std::move transfers the pointer into set's parameter and converts it to a pointer-to-const; after this line the feed has no handle to the snapshot.
  - The feed hands the pointer to the slot: `src/feed.cpp` target 12–12
- **W1.4 set installs the new pointer under the mutex and lets go of the old one** — Under the lock, the move assignment points current_ at the new snapshot and releases the slot's share of the previous one; what happens to that previous snapshot depends on who else holds it.
  - SnapshotSlot::set: `include/snapshot_slot.h` target 20–23 ← from The call in onUpdate (`src/feed.cpp` 12–12)

### W2 (walk): The consumer reads a snapshot without copying it

*Purpose:* How a read takes a shared pointer under the lock and then uses the rows with no lock and no copy, and why the pointer is never empty. · *Question:* What does the consumer thread hold while it uses the rows, and what keeps that safe while an update arrives?

- **W2.1 The consumer runs on its own thread** — startConsumer launches a thread that runs consume until stopping is set; this is the execution context the walk follows.
  - startConsumer creates the consumer thread: `src/consumer.cpp` target 14–16
- **W2.2 Each loop iteration takes the current snapshot as a shared pointer** — The consumer no longer owns a private DataSnapshot; it owns a share of whichever snapshot the slot publishes at this moment.
  - consume takes the current snapshot: `src/consumer.cpp` target 9–9
- **W2.3 get() copies the pointer under the lock, not the rows** — Under the mutex, get returns a copy of the shared pointer; the copy increments the snapshot's reference count and nothing else is touched.
  - SnapshotSlot::get: `include/snapshot_slot.h` target 16–19 ← from The call in consume (`src/consumer.cpp` 9–9)
- **W2.4 Why the pointer can be used without a null check: the initial snapshot** — current_ starts as a pointer to an empty snapshot, so get() never returns an empty pointer before the first update.
  - The stored pointer and its initial value: `include/snapshot_slot.h` target 27–27
- **W2.5 The rows are used in place and the share is dropped at the end of the iteration** — useRows reads the rows through the pointer with no lock and no copy; when the iteration ends, the consumer releases its share, which may be the last one.
  - consume reads the rows through the pointer: `src/consumer.cpp` target 10–10

### W3 (walk): What the copying version did, and what callers lose

*Purpose:* The behaviour that disappears: whole-snapshot copies made under the lock in both directions, and a private mutable copy in the reader. · *Question:* What did the old get and set do, and what can a caller no longer do after this change?

- **W3.1 The old slot copied the whole snapshot in both directions, under the lock** — get returned a DataSnapshot by value and set copied the caller's snapshot into current_, both while holding the mutex.
  - The old get and set: `include/snapshot_slot.h` base 13–20
- **W3.2 The reader's private, mutable copy is gone** — The consumer owned a non-const DataSnapshot per iteration; it now holds a shared pointer to a const object.
  - The old consumer loop body: `src/consumer.cpp` base 9–10
- **W3.3 The feed's stack snapshot was copied twice** — onUpdate filled a local DataSnapshot from the payload and set() copied it again into the slot under the lock.
  - The old onUpdate: `src/feed.cpp` base 9–12

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:35 UTC. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7).

### W1 (walk): Publishing an update without copying under the lock

*Purpose:* How a new snapshot is built, handed over and installed, and what the mutex covers during an update and what it does not.

#### W1.1 The contract the slot now states

- The design statement above SnapshotSlot: `include/snapshot_slot.h` target lines 12–14

Before following an update from its entry point, this step takes the design statement on its own; the execution path starts in the next step.

The comment makes two claims that the reader can check in the code:

- **Immutable**: once a snapshot is installed, nobody changes it. Readers that still hold the previous snapshot keep reading it unchanged while a new one is installed beside it.
- **The mutex protects the pointer, not the rows**: the lock is held only to copy or swap the pointer in `current_`, never while rows are copied or read. Readers and the updater therefore do not wait for each other's work on the data.

Neither claim is enforced by this comment. The first rests on the `const` in `std::shared_ptr<const DataSnapshot>` and on the feed giving up its only non-const pointer (the third step). The second rests on how short the critical sections in `set()` (the fourth step) and `get()` (the next walk) are.

#### W1.2 The feed builds the next snapshot on the heap, outside any lock

- onUpdate builds the next snapshot: `src/feed.cpp` target lines 9–11

`onUpdate` is the updater's entry point. No caller of it is in the material, so which thread runs it is unknown; what matters for the walk is that it may run at the same time as the consumer thread.

`std::make_shared<DataSnapshot>()` allocates the snapshot together with its reference count in one block and returns a `std::shared_ptr<DataSnapshot>`. The pointee is deliberately **not** `const` here: the two assignments that follow need to write `version` and `rows`. At this point `next` is the only pointer to the object, so filling it needs no lock.

The copy of the rows from `payload.rows` is the one copy an update still makes, and it happens here, before the slot is involved. In the previous version the same copy went into a stack-allocated `DataSnapshot`, and `set()` then copied every row a second time while holding the mutex (the third item shows that version).

#### W1.3 Handing the only mutable pointer to the slot

- The feed hands the pointer to the slot: `src/feed.cpp` target lines 12–12

`set()` takes its argument by value. Without `std::move`, the call would copy the shared pointer and `next` would keep a second, non-const handle to the snapshot. With `std::move`, the parameter takes the pointer over and `next` is left empty.

The parameter's type is `std::shared_ptr<const DataSnapshot>`, so the conversion from pointer-to-`DataSnapshot` to pointer-to-`const DataSnapshot` happens in this call. From here on the object is reachable only through pointers that forbid modification. **This line is where "immutable" becomes true**: the type of the slot's pointer rules out changes through the slot, and the one pointer that allowed changes no longer exists.

What the reader should notice is that this is a discipline, not a check: `SnapshotSlot` cannot tell whether a caller kept another copy of the non-const pointer and keeps writing to the rows after they are published. This caller does not; a future caller would have to follow the same pattern.

*Why:* If the updater ever modified a snapshot after installing it, the consumer in the next walk would read rows that change under it with no lock held, which is exactly what the previous copying design made impossible.

#### W1.4 set installs the new pointer under the mutex and lets go of the old one

- SnapshotSlot::set: `include/snapshot_slot.h` target lines 20–23 ← from The call in onUpdate (`src/feed.cpp` 12–12)

Reached from the call in the previous step. `std::lock_guard` locks `mutex_` on construction and unlocks it when the function returns, so the whole body is the critical section.

`current_ = std::move(next)` is a move assignment of `std::shared_ptr`: `current_` gives up the snapshot it managed and takes over the one `next` managed, leaving `next` empty. The assignment must be under the lock because the consumer's `get()` may be copying `current_` at the same moment: the standard allows different `shared_ptr` objects that point to the same snapshot to be used from different threads without synchronisation, but not one and the same `shared_ptr` object, and `current_` is one object read by `get()` and written here.

Giving up the old snapshot has two outcomes, decided by the reference count:

- Another holder exists, typically the consumer thread in the middle of `useRows` (next walk): the count drops by one and the old `DataSnapshot` stays alive. It will be destroyed later, on whatever thread drops the last share.
- Nobody else holds it: the old snapshot, rows included, is destroyed right here, **inside the critical section**. This is the one case in which more than a pointer swap still happens under the mutex; freeing a large row set takes time proportional to its size.

After the function returns, the now-empty parameter `next` is destroyed, which does nothing.

**Show more:**

In the base revision this function was `set(const DataSnapshot& next)` and its body under the same lock was `current_ = next;`, a copy of `version` and every row made while readers waited; the third item shows it side by side with the old `get()`.

`set()` accepts any `std::shared_ptr<const DataSnapshot>`, including an empty one, and does not check it. The consumer dereferences what `get()` returns without a null check; the next walk's step on the initial snapshot explains why that is safe with the callers in this material.

### W2 (walk): The consumer reads a snapshot without copying it

*Purpose:* How a read takes a shared pointer under the lock and then uses the rows with no lock and no copy, and why the pointer is never empty.

#### W2.1 The consumer runs on its own thread

- startConsumer creates the consumer thread: `src/consumer.cpp` target lines 14–16

This code is unchanged, but the change only makes sense with it in view: `consume` runs on a thread of its own, so every read of the slot may coincide with an update from whichever thread calls `onUpdate` (previous walk).

The lambda captures `slot` and `stopping` by reference, so the caller of `startConsumer` must keep both alive until the thread has finished; that obligation is as before. `stopping` is a `std::atomic<bool>`, so the loop's check of it in the next step is well defined across threads without any lock.

From here the walk follows the consumer thread.

#### W2.2 Each loop iteration takes the current snapshot as a shared pointer

- consume takes the current snapshot: `src/consumer.cpp` target lines 9–9

The loop polls the slot continuously, as before; nothing in it waits for a new version. What changed is the type of `snapshot`: a `std::shared_ptr<const DataSnapshot>` instead of a `DataSnapshot` by value.

That type change is the whole mechanism from the consumer's side. The variable is a share in the published object, not a copy of it. It is declared inside the loop body, so it lives for one iteration: created here, used in the call two lines down, destroyed at the closing brace. The next step shows what `get()` does to produce it.

#### W2.3 get() copies the pointer under the lock, not the rows

- SnapshotSlot::get: `include/snapshot_slot.h` target lines 16–19 ← from The call in consume (`src/consumer.cpp` 9–9)

Reached from the call in the previous step. As in `set()`, `std::lock_guard` holds `mutex_` for the whole body.

The statement `return current_;` copies the `std::shared_ptr`, which bumps the snapshot's reference count and copies two pointers. A language detail decides that this happens under the lock: C++ constructs the return value from `current_` before the local `lock` is destroyed, so the copy is complete before the mutex is released. This is also why the function returns the pointer by value and not by reference: a reference to `current_` would be used by the caller after the unlock, while `set()` may be overwriting it.

The mutex is needed for exactly this access to `current_`, the one `std::shared_ptr` object that `set()` writes and `get()` reads. The reference count inside the shared object is updated atomically by the standard library, so the consumer's own copy can later be dropped on its thread without any lock.

`get()` is a `const` member function and `mutex_` is declared `mutable`, which is what allows a const method to lock it; that part is unchanged.

**Show more:**

In the base revision `get()` returned `DataSnapshot` by value, so every iteration copied `version` and all the rows while holding the mutex; a read's cost, and the time it blocked an update, grew with the row count. The third item shows that version.

#### W2.4 Why the pointer can be used without a null check: the initial snapshot

- The stored pointer and its initial value: `include/snapshot_slot.h` target lines 27–27

A detour from the execution path to the member's initialiser, because the dereference in the next step depends on it.

`current_` is initialised with `std::make_shared<const DataSnapshot>()`, a heap-allocated snapshot with the struct's defaults: `version` 0 and no rows. Before the first `set()`, `get()` hands out this object, and the consumer calls `useRows` with an empty vector. That is the same observable start-up state as before the change, when `current_` was a default-constructed `DataSnapshot` by value.

What is guaranteed, and what is not:

- Guaranteed by this initialiser: the slot never publishes an empty pointer on its own.
- Not guaranteed: `set()` accepts an empty `std::shared_ptr` without checking (previous walk, last step). If a future caller passed one, the consumer's `snapshot->rows` in the next step would dereference null. In this material the only caller, `onUpdate`, always passes the result of `make_shared`.

#### W2.5 The rows are used in place and the share is dropped at the end of the iteration

- consume reads the rows through the pointer: `src/consumer.cpp` target lines 10–10

Back on the consumer thread after `get()` returned. `snapshot->rows` is a reference into the shared object, and `useRows` takes a `const std::vector<std::string>&`, so no row is copied. Only the declaration of `useRows` is in the material; what it does with the rows cannot be read here.

No lock is held during this call, and that is safe for one reason only: nobody writes to this object. The consumer cannot, because the pointer is to `const DataSnapshot`; the updater cannot, because it gave up its non-const pointer when it published (previous walk, third step). An update that arrives during the call installs a **different** object in the slot; this one stays alive because `snapshot` holds a share of it.

At the closing brace of the loop body, `snapshot` is destroyed and drops that share. If the slot has moved on in the meantime, this is where the old snapshot is actually freed, on the consumer thread and without the mutex; if the slot still publishes it, only the count drops. So at most the slot's current snapshot, the one the consumer is still reading and the one the feed is building coexist, and none of them is copied under the lock.

**Show more:**

The previous version of these two lines gave the consumer its own non-const `DataSnapshot`, independent of later updates and free to modify. `useRows` only reads, so nothing in this material relied on that freedom; code that wants to change the rows now has to copy the snapshot explicitly. The third item shows the old lines.

### W3 (walk): What the copying version did, and what callers lose

*Purpose:* The behaviour that disappears: whole-snapshot copies made under the lock in both directions, and a private mutable copy in the reader.

#### W3.1 The old slot copied the whole snapshot in both directions, under the lock

- The old get and set: `include/snapshot_slot.h` base lines 13–20

This item takes the removed version apart on its own rather than following a run; the previous two walks showed what replaced it.

`get()` returned `DataSnapshot` by value: the `return current_;` copied `version` and every row while `mutex_` was locked, because the return value is built before the local `lock` is destroyed. `set()` took a `const DataSnapshot&` and the assignment `current_ = next;` copied every row again, also under the lock.

This was correct: the mutex covered every access to `current_`, and each caller walked away with data of its own that no later update could touch. Its cost was that the time under the lock grew with the number of rows, so a reader copying out and an updater copying in waited for each other, and each update meant two full copies of the rows (the next two steps).

For a reviewer: both signatures are gone. Any caller outside this material that called `get()` for a value or `set()` with a `DataSnapshot` would need the same change the consumer and the feed received.

#### W3.2 The reader's private, mutable copy is gone

- The old consumer loop body: `src/consumer.cpp` base lines 9–10

Each iteration received its own `DataSnapshot`, copied under the lock by the `get()` of the previous step and then destroyed at the end of the iteration. Being a non-const value, it could have been modified before or after `useRows`; nothing here did, since `useRows` takes a const reference.

After the change the consumer holds `std::shared_ptr<const DataSnapshot>` (second walk). Two things change for any reader: it can no longer modify what it got without copying it first, and the data it reads is the published object itself, which stays alive for as long as the reader holds the pointer rather than for as long as the slot publishes it.

#### W3.3 The feed's stack snapshot was copied twice

- The old onUpdate: `src/feed.cpp` base lines 9–12

`next` lived on the stack of `onUpdate`. Its rows were copied once from `payload.rows`, outside any lock, and then a second time by `set(next)` into `current_` under the mutex (first step of this item). On return, `next` was destroyed with its rows.

In the new version (first walk, second and third steps) the single copy from the payload goes straight into a heap-allocated snapshot, and ownership of that snapshot is moved into the slot. The copy under the lock is what disappears; the copy from the payload remains.

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
  "summary": "The change stops `SnapshotSlot` from copying the whole `DataSnapshot` on every read and every update. The slot now holds a `std::shared_ptr<const DataSnapshot>`: `get()` hands the caller a shared pointer to the snapshot currently published, and `set()` installs a pointer the updater built beforehand, so the mutex is held only while that pointer is copied or swapped. The consumer thread reads the rows in place through its pointer, and the feed builds the next snapshot on the heap once and gives up its own handle to it. The new header comment states the intent: readers keep the snapshot they took while the updater installs the next one, and the mutex protects the pointer, not the rows, so the time spent under the lock no longer grows with the number of rows.",
  "background": "The material holds only the three source files. There are no tests, no build files and no caller of `onUpdate`, and `useRows` is only declared, so which thread updates the slot and what the rows are used for cannot be established here. The walks describe what the code allows, not anything observed to run.\n\nThe change alters the slot's public interface: `get()` now returns a pointer and `set()` takes one. Any caller outside this material that used the old signatures would need the same adjustment the consumer and the feed received here.\n\nSharing one object between two threads is safe only because the object never changes after it is published. The slot enforces that through the `const` in its pointer type; the feed contributes by giving up its non-const pointer with `std::move`. The slot cannot detect a caller that keeps a mutable pointer, nor one that passes an empty pointer. The walks point at these spots.",
  "walks": [
    {
      "kind": "walk",
      "title": "Publishing an update without copying under the lock",
      "question": "What happens when onUpdate publishes a new snapshot while the consumer may still be reading the old one?",
      "purpose": "How a new snapshot is built, handed over and installed, and what the mutex covers during an update and what it does not.",
      "steps": [
        {
          "title": "The contract the slot now states",
          "summary": "The header comment names the design the rest of the walk checks against the code: one immutable snapshot at a time, shared by pointer.",
          "body": "Before following an update from its entry point, this step takes the design statement on its own; the execution path starts in the next step.\n\nThe comment makes two claims that the reader can check in the code:\n\n- **Immutable**: once a snapshot is installed, nobody changes it. Readers that still hold the previous snapshot keep reading it unchanged while a new one is installed beside it.\n- **The mutex protects the pointer, not the rows**: the lock is held only to copy or swap the pointer in `current_`, never while rows are copied or read. Readers and the updater therefore do not wait for each other's work on the data.\n\nNeither claim is enforced by this comment. The first rests on the `const` in `std::shared_ptr<const DataSnapshot>` and on the feed giving up its only non-const pointer (the third step). The second rests on how short the critical sections in `set()` (the fourth step) and `get()` (the next walk) are.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The design statement above SnapshotSlot",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 12,
              "end": 14,
              "anchor": "The mutex protects the pointer, not the rows"
            }
          ]
        },
        {
          "title": "The feed builds the next snapshot on the heap, outside any lock",
          "summary": "onUpdate allocates a fresh DataSnapshot with make_shared and fills it from the payload while nothing else can see it.",
          "body": "`onUpdate` is the updater's entry point. No caller of it is in the material, so which thread runs it is unknown; what matters for the walk is that it may run at the same time as the consumer thread.\n\n`std::make_shared<DataSnapshot>()` allocates the snapshot together with its reference count in one block and returns a `std::shared_ptr<DataSnapshot>`. The pointee is deliberately **not** `const` here: the two assignments that follow need to write `version` and `rows`. At this point `next` is the only pointer to the object, so filling it needs no lock.\n\nThe copy of the rows from `payload.rows` is the one copy an update still makes, and it happens here, before the slot is involved. In the previous version the same copy went into a stack-allocated `DataSnapshot`, and `set()` then copied every row a second time while holding the mutex (the third item shows that version).",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "onUpdate builds the next snapshot",
              "path": "src/feed.cpp",
              "side": "target",
              "start": 9,
              "end": 11,
              "anchor": "auto next = std::make_shared<DataSnapshot>();"
            }
          ]
        },
        {
          "title": "Handing the only mutable pointer to the slot",
          "summary": "std::move transfers the pointer into set's parameter and converts it to a pointer-to-const; after this line the feed has no handle to the snapshot.",
          "body": "`set()` takes its argument by value. Without `std::move`, the call would copy the shared pointer and `next` would keep a second, non-const handle to the snapshot. With `std::move`, the parameter takes the pointer over and `next` is left empty.\n\nThe parameter's type is `std::shared_ptr<const DataSnapshot>`, so the conversion from pointer-to-`DataSnapshot` to pointer-to-`const DataSnapshot` happens in this call. From here on the object is reachable only through pointers that forbid modification. **This line is where \"immutable\" becomes true**: the type of the slot's pointer rules out changes through the slot, and the one pointer that allowed changes no longer exists.\n\nWhat the reader should notice is that this is a discipline, not a check: `SnapshotSlot` cannot tell whether a caller kept another copy of the non-const pointer and keeps writing to the rows after they are published. This caller does not; a future caller would have to follow the same pattern.",
          "why": "If the updater ever modified a snapshot after installing it, the consumer in the next walk would read rows that change under it with no lock held, which is exactly what the previous copying design made impossible.",
          "details": "",
          "places": [
            {
              "label": "The feed hands the pointer to the slot",
              "path": "src/feed.cpp",
              "side": "target",
              "start": 12,
              "end": 12,
              "anchor": "slot.set(std::move(next));"
            }
          ]
        },
        {
          "title": "set installs the new pointer under the mutex and lets go of the old one",
          "summary": "Under the lock, the move assignment points current_ at the new snapshot and releases the slot's share of the previous one; what happens to that previous snapshot depends on who else holds it.",
          "body": "Reached from the call in the previous step. `std::lock_guard` locks `mutex_` on construction and unlocks it when the function returns, so the whole body is the critical section.\n\n`current_ = std::move(next)` is a move assignment of `std::shared_ptr`: `current_` gives up the snapshot it managed and takes over the one `next` managed, leaving `next` empty. The assignment must be under the lock because the consumer's `get()` may be copying `current_` at the same moment: the standard allows different `shared_ptr` objects that point to the same snapshot to be used from different threads without synchronisation, but not one and the same `shared_ptr` object, and `current_` is one object read by `get()` and written here.\n\nGiving up the old snapshot has two outcomes, decided by the reference count:\n\n- Another holder exists, typically the consumer thread in the middle of `useRows` (next walk): the count drops by one and the old `DataSnapshot` stays alive. It will be destroyed later, on whatever thread drops the last share.\n- Nobody else holds it: the old snapshot, rows included, is destroyed right here, **inside the critical section**. This is the one case in which more than a pointer swap still happens under the mutex; freeing a large row set takes time proportional to its size.\n\nAfter the function returns, the now-empty parameter `next` is destroyed, which does nothing.",
          "why": "",
          "details": "In the base revision this function was `set(const DataSnapshot& next)` and its body under the same lock was `current_ = next;`, a copy of `version` and every row made while readers waited; the third item shows it side by side with the old `get()`.\n\n`set()` accepts any `std::shared_ptr<const DataSnapshot>`, including an empty one, and does not check it. The consumer dereferences what `get()` returns without a null check; the next walk's step on the initial snapshot explains why that is safe with the callers in this material.",
          "places": [
            {
              "label": "SnapshotSlot::set",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 20,
              "end": 23,
              "anchor": "current_ = std::move(next);",
              "from": {
                "label": "The call in onUpdate",
                "path": "src/feed.cpp",
                "side": "target",
                "start": 12,
                "end": 12
              }
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "The consumer reads a snapshot without copying it",
      "question": "What does the consumer thread hold while it uses the rows, and what keeps that safe while an update arrives?",
      "purpose": "How a read takes a shared pointer under the lock and then uses the rows with no lock and no copy, and why the pointer is never empty.",
      "steps": [
        {
          "title": "The consumer runs on its own thread",
          "summary": "startConsumer launches a thread that runs consume until stopping is set; this is the execution context the walk follows.",
          "body": "This code is unchanged, but the change only makes sense with it in view: `consume` runs on a thread of its own, so every read of the slot may coincide with an update from whichever thread calls `onUpdate` (previous walk).\n\nThe lambda captures `slot` and `stopping` by reference, so the caller of `startConsumer` must keep both alive until the thread has finished; that obligation is as before. `stopping` is a `std::atomic<bool>`, so the loop's check of it in the next step is well defined across threads without any lock.\n\nFrom here the walk follows the consumer thread.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "startConsumer creates the consumer thread",
              "path": "src/consumer.cpp",
              "side": "target",
              "start": 14,
              "end": 16,
              "anchor": "consume(slot, stopping)"
            }
          ]
        },
        {
          "title": "Each loop iteration takes the current snapshot as a shared pointer",
          "summary": "The consumer no longer owns a private DataSnapshot; it owns a share of whichever snapshot the slot publishes at this moment.",
          "body": "The loop polls the slot continuously, as before; nothing in it waits for a new version. What changed is the type of `snapshot`: a `std::shared_ptr<const DataSnapshot>` instead of a `DataSnapshot` by value.\n\nThat type change is the whole mechanism from the consumer's side. The variable is a share in the published object, not a copy of it. It is declared inside the loop body, so it lives for one iteration: created here, used in the call two lines down, destroyed at the closing brace. The next step shows what `get()` does to produce it.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "consume takes the current snapshot",
              "path": "src/consumer.cpp",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "std::shared_ptr<const DataSnapshot> snapshot = slot.get();"
            }
          ]
        },
        {
          "title": "get() copies the pointer under the lock, not the rows",
          "summary": "Under the mutex, get returns a copy of the shared pointer; the copy increments the snapshot's reference count and nothing else is touched.",
          "body": "Reached from the call in the previous step. As in `set()`, `std::lock_guard` holds `mutex_` for the whole body.\n\nThe statement `return current_;` copies the `std::shared_ptr`, which bumps the snapshot's reference count and copies two pointers. A language detail decides that this happens under the lock: C++ constructs the return value from `current_` before the local `lock` is destroyed, so the copy is complete before the mutex is released. This is also why the function returns the pointer by value and not by reference: a reference to `current_` would be used by the caller after the unlock, while `set()` may be overwriting it.\n\nThe mutex is needed for exactly this access to `current_`, the one `std::shared_ptr` object that `set()` writes and `get()` reads. The reference count inside the shared object is updated atomically by the standard library, so the consumer's own copy can later be dropped on its thread without any lock.\n\n`get()` is a `const` member function and `mutex_` is declared `mutable`, which is what allows a const method to lock it; that part is unchanged.",
          "why": "",
          "details": "In the base revision `get()` returned `DataSnapshot` by value, so every iteration copied `version` and all the rows while holding the mutex; a read's cost, and the time it blocked an update, grew with the row count. The third item shows that version.",
          "places": [
            {
              "label": "SnapshotSlot::get",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 16,
              "end": 19,
              "anchor": "return current_;",
              "from": {
                "label": "The call in consume",
                "path": "src/consumer.cpp",
                "side": "target",
                "start": 9,
                "end": 9
              }
            }
          ]
        },
        {
          "title": "Why the pointer can be used without a null check: the initial snapshot",
          "summary": "current_ starts as a pointer to an empty snapshot, so get() never returns an empty pointer before the first update.",
          "body": "A detour from the execution path to the member's initialiser, because the dereference in the next step depends on it.\n\n`current_` is initialised with `std::make_shared<const DataSnapshot>()`, a heap-allocated snapshot with the struct's defaults: `version` 0 and no rows. Before the first `set()`, `get()` hands out this object, and the consumer calls `useRows` with an empty vector. That is the same observable start-up state as before the change, when `current_` was a default-constructed `DataSnapshot` by value.\n\nWhat is guaranteed, and what is not:\n\n- Guaranteed by this initialiser: the slot never publishes an empty pointer on its own.\n- Not guaranteed: `set()` accepts an empty `std::shared_ptr` without checking (previous walk, last step). If a future caller passed one, the consumer's `snapshot->rows` in the next step would dereference null. In this material the only caller, `onUpdate`, always passes the result of `make_shared`.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The stored pointer and its initial value",
              "path": "include/snapshot_slot.h",
              "side": "target",
              "start": 27,
              "end": 27,
              "anchor": "std::make_shared<const DataSnapshot>()"
            }
          ]
        },
        {
          "title": "The rows are used in place and the share is dropped at the end of the iteration",
          "summary": "useRows reads the rows through the pointer with no lock and no copy; when the iteration ends, the consumer releases its share, which may be the last one.",
          "body": "Back on the consumer thread after `get()` returned. `snapshot->rows` is a reference into the shared object, and `useRows` takes a `const std::vector<std::string>&`, so no row is copied. Only the declaration of `useRows` is in the material; what it does with the rows cannot be read here.\n\nNo lock is held during this call, and that is safe for one reason only: nobody writes to this object. The consumer cannot, because the pointer is to `const DataSnapshot`; the updater cannot, because it gave up its non-const pointer when it published (previous walk, third step). An update that arrives during the call installs a **different** object in the slot; this one stays alive because `snapshot` holds a share of it.\n\nAt the closing brace of the loop body, `snapshot` is destroyed and drops that share. If the slot has moved on in the meantime, this is where the old snapshot is actually freed, on the consumer thread and without the mutex; if the slot still publishes it, only the count drops. So at most the slot's current snapshot, the one the consumer is still reading and the one the feed is building coexist, and none of them is copied under the lock.",
          "why": "",
          "details": "The previous version of these two lines gave the consumer its own non-const `DataSnapshot`, independent of later updates and free to modify. `useRows` only reads, so nothing in this material relied on that freedom; code that wants to change the rows now has to copy the snapshot explicitly. The third item shows the old lines.",
          "places": [
            {
              "label": "consume reads the rows through the pointer",
              "path": "src/consumer.cpp",
              "side": "target",
              "start": 10,
              "end": 10,
              "anchor": "useRows(snapshot->rows);"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What the copying version did, and what callers lose",
      "question": "What did the old get and set do, and what can a caller no longer do after this change?",
      "purpose": "The behaviour that disappears: whole-snapshot copies made under the lock in both directions, and a private mutable copy in the reader.",
      "steps": [
        {
          "title": "The old slot copied the whole snapshot in both directions, under the lock",
          "summary": "get returned a DataSnapshot by value and set copied the caller's snapshot into current_, both while holding the mutex.",
          "body": "This item takes the removed version apart on its own rather than following a run; the previous two walks showed what replaced it.\n\n`get()` returned `DataSnapshot` by value: the `return current_;` copied `version` and every row while `mutex_` was locked, because the return value is built before the local `lock` is destroyed. `set()` took a `const DataSnapshot&` and the assignment `current_ = next;` copied every row again, also under the lock.\n\nThis was correct: the mutex covered every access to `current_`, and each caller walked away with data of its own that no later update could touch. Its cost was that the time under the lock grew with the number of rows, so a reader copying out and an updater copying in waited for each other, and each update meant two full copies of the rows (the next two steps).\n\nFor a reviewer: both signatures are gone. Any caller outside this material that called `get()` for a value or `set()` with a `DataSnapshot` would need the same change the consumer and the feed received.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The old get and set",
              "path": "include/snapshot_slot.h",
              "side": "base",
              "start": 13,
              "end": 20,
              "anchor": "DataSnapshot get() const {"
            }
          ]
        },
        {
          "title": "The reader's private, mutable copy is gone",
          "summary": "The consumer owned a non-const DataSnapshot per iteration; it now holds a shared pointer to a const object.",
          "body": "Each iteration received its own `DataSnapshot`, copied under the lock by the `get()` of the previous step and then destroyed at the end of the iteration. Being a non-const value, it could have been modified before or after `useRows`; nothing here did, since `useRows` takes a const reference.\n\nAfter the change the consumer holds `std::shared_ptr<const DataSnapshot>` (second walk). Two things change for any reader: it can no longer modify what it got without copying it first, and the data it reads is the published object itself, which stays alive for as long as the reader holds the pointer rather than for as long as the slot publishes it.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The old consumer loop body",
              "path": "src/consumer.cpp",
              "side": "base",
              "start": 9,
              "end": 10,
              "anchor": "DataSnapshot snapshot = slot.get();"
            }
          ]
        },
        {
          "title": "The feed's stack snapshot was copied twice",
          "summary": "onUpdate filled a local DataSnapshot from the payload and set() copied it again into the slot under the lock.",
          "body": "`next` lived on the stack of `onUpdate`. Its rows were copied once from `payload.rows`, outside any lock, and then a second time by `set(next)` into `current_` under the mutex (first step of this item). On return, `next` was destroyed with its rows.\n\nIn the new version (first walk, second and third steps) the single copy from the payload goes straight into a heap-allocated snapshot, and ownership of that snapshot is moved into the slot. The copy under the lock is what disappears; the copy from the payload remains.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "The old onUpdate",
              "path": "src/feed.cpp",
              "side": "base",
              "start": 9,
              "end": 12,
              "anchor": "slot.set(next);"
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
