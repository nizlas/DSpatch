# Explain this on src/work_queue.cpp lines 14–24 (work-queue case, acquire)

*Explain this* is the quality reference the code-walk reference names (section 5). The prompt below is the exact product prompt (`selectionPrompt`, unchanged since DSP-188), built by `app/scripts/explain-prompt.mjs --selection` over the synthetic case; the answer was written on 9 November 2026 by a Claude model outside DSpatch's providers reading the revision folder with read-only tools, for DSP-188, and judged there. Not evidence of the product path with Niclas's provider.

## The answer

```json
{
  "answer": "`WorkQueue::acquire` (target, src/work_queue.cpp 14–24) is the one way to hand work to the queue in the new revision. Given a `key`, it finds or creates the `Job` for that key, marks the Job as pending, wakes the queue's background worker thread, and returns a shared handle to the Job. In the base revision the queue only had `find`, a read-only lookup that returned `nullptr` for an unknown key and involved no thread; this change replaces that with a method that **creates work and sets its execution in motion**.\n\nWhat happens, in order, all while holding the queue's mutex:\n\n1. `std::lock_guard<std::mutex> lock(mutex_)` takes `mutex_` for the whole method. The worker thread reads `slots_` and each Job's `pending` flag under the same mutex (`workerLoop`, target lines 26–37), so the map and the flags stay consistent between the two threads.\n2. `slots_[key]` is `std::map::operator[]`: if `key` is not in the map it inserts an empty `shared_ptr<Job>` and returns a reference to that entry; if it is, it returns the existing entry. `slot` is therefore a reference straight into the map, not a copy.\n3. `if (!slot)` catches the freshly inserted empty entry: a new `Job` is allocated with `std::make_shared` and given its key. A second `acquire` with the same key skips this and reuses the same Job object, so there is one slot per key rather than one item per call.\n4. `slot->pending = true` is the actual work request. When the worker runs it scans every slot and, for each Job with `pending` set, clears the flag and adds one to `runs` (target lines 30–35).\n5. `cv_.notify_all()` wakes the worker, which blocks in `cv_.wait(lock)` (target line 29). The notify happens while `acquire` still holds the mutex, so the worker wakes but waits for `acquire` to return and release the lock before it sees the new state.\n6. The returned `shared_ptr<Job>` shares ownership with the map entry: the caller holds the very object the worker will later update.\n\nWho calls it: `submit` (target, src/submit.cpp 3–6) calls `acquire` and returns the Job to its own caller. In base, `submit` (src/submit.cpp 3–5) called `find` and discarded the result.",
  "details": "Why the base `find` could not do this. The base `WorkQueue` (src/work_queue.h base 10–16) had only the `slots_` map and `find` (src/work_queue.cpp base 3–6). In the base files nothing ever inserts into `slots_`, so `find` always returned `nullptr` here. The target adds everything `acquire` relies on: `pending` and `runs` on `Job` (src/work_queue.h target 9–13), and `mutex_`, `cv_`, `stopping_` and `worker_` on `WorkQueue` (target 24–28). The constructor (src/work_queue.cpp target 3) starts the worker thread at once; the destructor (target 5–12) sets `stopping_` under the mutex, notifies the same condition variable and joins the thread.\n\nCoalescing follows from `pending` being a flag. Because `pending` is a `bool` and not a counter, several `acquire` calls on the same key before the worker scans collapse into one run: the worker sees `pending == true` once, clears it, and adds 1 to `runs`. `runs` therefore counts worker passes over that Job, not `acquire` calls.\n\nTwo points worth noticing; these are conclusions from reading the code, not observed behaviour:\n\n- The worker's `cv_.wait(lock)` (target line 29) has no predicate. From the moment it wakes, through its scan, until it waits again, the worker holds `mutex_` (wait releases it atomically), so `acquire` cannot run between a scan and the next wait. There is one window, though: between the constructor starting the thread (target line 3) and the thread first reaching `cv_.wait`, an `acquire` can take the mutex, set `pending`, and notify a condition variable nobody is waiting on yet. That Job then stays pending until the next `notify_all`, which comes from the next `acquire` of any key or from the destructor; the destructor's wake-up does cause one final scan, because the loop body runs before `stopping_` is re-checked.\n- `acquire` hands the live `Job` to code outside the queue through `submit`, while `pending` and `runs` are written by the worker under `mutex_`, which is private. Outside code that reads those fields while the queue is alive cannot take the lock, so such reads are not synchronised with the worker's writes.",
  "references": [
    {
      "label": "The selected method: lock, find-or-create the slot, mark pending, notify, return",
      "path": "src/work_queue.cpp",
      "side": "target",
      "start": 14,
      "end": 24
    },
    {
      "label": "workerLoop: waits on cv_, then clears pending and increments runs for each pending Job",
      "path": "src/work_queue.cpp",
      "side": "target",
      "start": 26,
      "end": 37
    },
    {
      "label": "Constructor starts the worker thread; destructor sets stopping_, notifies and joins",
      "path": "src/work_queue.cpp",
      "side": "target",
      "start": 3,
      "end": 12
    },
    {
      "label": "Job gains the pending flag and runs counter the worker acts on",
      "path": "src/work_queue.h",
      "side": "target",
      "start": 9,
      "end": 13
    },
    {
      "label": "acquire replaces find as the public entry point",
      "path": "src/work_queue.h",
      "side": "target",
      "start": 17,
      "end": 19
    },
    {
      "label": "The members acquire uses: mutex_, cv_, stopping_, slots_, worker_",
      "path": "src/work_queue.h",
      "side": "target",
      "start": 24,
      "end": 28
    },
    {
      "label": "submit calls acquire and returns the Job to its caller",
      "path": "src/submit.cpp",
      "side": "target",
      "start": 3,
      "end": 6
    },
    {
      "label": "Base find: read-only lookup, nullptr for an unknown key, no lock, no thread",
      "path": "src/work_queue.cpp",
      "side": "base",
      "start": 3,
      "end": 6
    },
    {
      "label": "Base WorkQueue had only slots_ and find",
      "path": "src/work_queue.h",
      "side": "base",
      "start": 10,
      "end": 16
    },
    {
      "label": "Base submit called find and discarded the result",
      "path": "src/submit.cpp",
      "side": "base",
      "start": 3,
      "end": 5
    }
  ],
  "insufficient": false
}
```

## The prompt

<details><summary>Prompt</summary>

```text
DSPATCH-REVIEW-TASK: explain-selection

A person reviewing this change selected code in the diff and asks you to explain it. Examine the code with your reading tools as far as the explanation needs (what the selected code calls, what calls it, the data and types it uses, and how it differs between the revisions), then answer. Explaining approves nothing and is not a review.

## The selected code
1 part(s), in the order they appear in the diff. Each part is on one side of the diff; keep the sides apart.

### Part 1: src/work_queue.cpp at To (target, commit 7beed6e7fdc73947da95a3c891f96f1d2f4c5718)
ADDED: this code is only in To (target). It did not exist in From; it is behaviour the change brings.
Lines 14–24 at that side.
Selected text, exactly:
``​`
std::shared_ptr<Job> WorkQueue::acquire(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto& slot = slots_[key];
  if (!slot) {
    slot = std::make_shared<Job>();
    slot->key = key;
  }
  slot->pending = true;
  cv_.notify_all();
  return slot;
}
``​`
The lines around it at that side (selected lines marked >):
``​`
   8 |     stopping_ = true;
   9 |   }
  10 |   cv_.notify_all();
  11 |   worker_.join();
  12 | }
  13 | 
> 14 | std::shared_ptr<Job> WorkQueue::acquire(const std::string& key) {
> 15 |   std::lock_guard<std::mutex> lock(mutex_);
> 16 |   auto& slot = slots_[key];
> 17 |   if (!slot) {
> 18 |     slot = std::make_shared<Job>();
> 19 |     slot->key = key;
> 20 |   }
> 21 |   slot->pending = true;
> 22 |   cv_.notify_all();
> 23 |   return slot;
> 24 | }
  25 | 
  26 | void WorkQueue::workerLoop() {
  27 |   std::unique_lock<std::mutex> lock(mutex_);
  28 |   while (!stopping_) {
  29 |     cv_.wait(lock);
  30 |     for (auto& [key, job] : slots_) {
``​`

## The selection (machine-readable)
``​`json
[{"path":"src/work_queue.cpp","side":"target","start":14,"end":24,"kind":"added"}]
``​`

## What the person asks now
Explain the selected code.

## How to answer (language: English)
Start with what the selected code does and why it is relevant in this change. Then give the context needed to understand it, such as what it depends on and what depends on it, in short paragraphs.
Keep the revisions apart: say which revision each statement is about. Never describe removed code as what the code does now, or added code as what it did before. When the selection holds both, say what was replaced by what.
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
- "answer" is the short part and stands on its own: the concept and the details that matter most, enough to understand it without reading further. Any uncertainty that changes the answer belongs there.
- "details" is the deepening only, for when the person asks for more: complementary mechanics, special cases, longer evidence, more code references, in the same manner as the short part. Leave it empty when there is nothing to add, and do not repeat the short part in it.
- When the person explicitly asks for details, give them: the short part still answers first.
If the code you could read does not settle it, say what is missing and set "insufficient": true.

Answer with one JSON object in a ``​`json fence and nothing else:
``​`json
{
  "answer": "The explanation in Markdown.",
  "details": "More detail in Markdown, or an empty string.",
  "references": [
    {
      "label": "What this place shows",
      "path": "src/file.ts",
      "side": "target",
      "start": 10,
      "end": 14
    }
  ],
  "insufficient": false
}
``​`
Every reference names a path, a side and 1-based lines at that side; DSpatch checks each against the commit.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit d18a344c55f4574cff4bcb7df13fdba1b70a6e68
- `target/` is To, commit 7beed6e7fdc73947da95a3c891f96f1d2f4c5718
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: work-queue
From: d18a344c55f4574cff4bcb7df13fdba1b70a6e68 (base commit)
To: 7beed6e7fdc73947da95a3c891f96f1d2f4c5718 (target commit)
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
