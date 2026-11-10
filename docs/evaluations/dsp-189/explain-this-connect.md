# Explain this on src/link.ts lines 17–30 (connect case)

*Explain this* is the quality reference the code-walk reference names (section 5). The prompt below is the exact product prompt (`selectionPrompt`, unchanged since DSP-188), built by `app/scripts/explain-prompt.mjs --selection` over the synthetic case; the answer was written on 9 November 2026 by a Claude model outside DSpatch's providers reading the revision folder with read-only tools, for DSP-188, and judged there. Not evidence of the product path with Niclas's provider.

## The answer

```json
{
  "answer": "In To (target), `Link.connect` turns a single connection attempt into a bounded retry loop and reports a named outcome instead of a bare boolean. It is the centre of this change: the new `Outcome` type, the `attempts` and `onSettled` fields, `whenSettled`, `settle` and `pause` all exist to serve it, and `startSession` in `src/session.ts` is rewritten to consume what it returns.\n\nWhat it does, in order:\n\n1. Resets `this.attempts` to 0, so every call to `connect` starts counting afresh.\n2. Loops while `attempts < maxAttempts`. `maxAttempts` is a constructor parameter with default 3 (target line 11). Each round increments `attempts` and awaits `this.transport.open(address)`, which answers `true` or `false` according to the unchanged `Transport` interface.\n3. On `true` it calls `this.settle('connected')` and returns `'connected'`.\n4. On `false` it awaits `pause(this.attempts * 100)`: 100 ms after the first failure, 200 ms after the second, 300 ms after the third, a linear back-off.\n5. When the loop runs out it calls `this.settle('gave-up')` and returns `'gave-up'`.\n\nSo the method tells its caller the result in two ways: as the returned `Outcome`, and through the callback registered with `whenSettled`, which `settle` fires once via `setTimeout(..., 0)` and then clears.\n\nIn From (base), `connect` was `return this.transport.open(address)`: one attempt, result `Promise<boolean>`, no retry and no callback, and `startSession` ignored that boolean.\n\nTwo things worth noticing (my reading of the code, not observed behaviour):\n\n- The pause also runs after the **last** failed attempt, because the loop checks `attempts < maxAttempts` only at the top. With the default 3, a link that never opens waits 100 + 200 + 300 ms, and the final 300 ms precedes no further attempt.\n- A rejection from `transport.open` is not caught: it leaves `connect` before any `settle`, so the `whenSettled` callback is never fired and stays registered.",
  "details": "**How the caller uses it (target `src/session.ts`, lines 3–9).** `startSession` now takes a `report` function. It registers a `whenSettled` callback that reports `'session ready'` for `'connected'` and `'offline mode'` for `'gave-up'`, then awaits `connect` and, on `'gave-up'`, additionally reports `'retrying later'`. Because `settle` schedules the callback with `setTimeout(..., 0)` while the `await` continuation in `startSession` runs as a microtask, the code implies that `'retrying later'` is reported before `'offline mode'` when the link gives up. Nothing in either revision schedules an actual later retry; `'retrying later'` is only text handed to `report`.\n\n**Single-slot callback.** `whenSettled` (target lines 13–15) stores one callback in `onSettled`; a second registration replaces the first. `settle` (target lines 32–38) reads the field, sets it to `null`, and only then fires the callback, so each registration fires at most once. A later `connect` on the same `Link` without re-registering settles silently and only its return value reports the outcome.\n\n**Shared counter.** `attempts` is an instance field (target line 8) that `connect` resets at its start. Two overlapping `connect` calls on the same `Link` would share and reset it; the code does not guard against that. For one call at a time it behaves as a plain loop counter.\n\n**`pause`** (target lines 41–43) is a module-level helper that wraps `setTimeout` in a Promise; it is the only source of delay in the loop.\n\nThe two revisions hold only `src/link.ts` and `src/session.ts`: no tests or documentation for `Link`, so the choice of 3 attempts and 100 ms steps is read from the code alone.",
  "references": [
    {
      "label": "The selected retry loop in Link.connect (target)",
      "path": "src/link.ts",
      "side": "target",
      "start": 17,
      "end": 30
    },
    {
      "label": "The single-attempt connect it replaces (base)",
      "path": "src/link.ts",
      "side": "base",
      "start": 8,
      "end": 10
    },
    {
      "label": "Transport.open, the boolean source the loop polls (unchanged)",
      "path": "src/link.ts",
      "side": "target",
      "start": 1,
      "end": 3
    },
    {
      "label": "The Outcome type connect now returns",
      "path": "src/link.ts",
      "side": "target",
      "start": 5,
      "end": 5
    },
    {
      "label": "attempts and onSettled fields the loop and settle use",
      "path": "src/link.ts",
      "side": "target",
      "start": 8,
      "end": 9
    },
    {
      "label": "Constructor with maxAttempts, default 3",
      "path": "src/link.ts",
      "side": "target",
      "start": 11,
      "end": 11
    },
    {
      "label": "whenSettled stores the one callback",
      "path": "src/link.ts",
      "side": "target",
      "start": 13,
      "end": 15
    },
    {
      "label": "settle clears the callback and fires it via setTimeout 0",
      "path": "src/link.ts",
      "side": "target",
      "start": 32,
      "end": 38
    },
    {
      "label": "pause, the back-off delay helper",
      "path": "src/link.ts",
      "side": "target",
      "start": 41,
      "end": 43
    },
    {
      "label": "startSession consuming the Outcome and the callback (target)",
      "path": "src/session.ts",
      "side": "target",
      "start": 3,
      "end": 9
    },
    {
      "label": "startSession ignoring the boolean (base)",
      "path": "src/session.ts",
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

### Part 1: src/link.ts at To (target, commit 021c118458dbf2faeed6f7133e485a902a40fb9b)
ADDED: this code is only in To (target). It did not exist in From; it is behaviour the change brings.
Lines 17–30 at that side.
Selected text, exactly:
``​`
  async connect(address: string): Promise<Outcome> {
    this.attempts = 0;
    while (this.attempts < this.maxAttempts) {
      this.attempts += 1;
      const open = await this.transport.open(address);
      if (open) {
        this.settle('connected');
        return 'connected';
      }
      await pause(this.attempts * 100);
    }
    this.settle('gave-up');
    return 'gave-up';
  }
``​`
The lines around it at that side (selected lines marked >):
``​`
  11 |   constructor(private readonly transport: Transport, private readonly maxAttempts = 3) {}
  12 | 
  13 |   whenSettled(callback: (outcome: Outcome) => void): void {
  14 |     this.onSettled = callback;
  15 |   }
  16 | 
> 17 |   async connect(address: string): Promise<Outcome> {
> 18 |     this.attempts = 0;
> 19 |     while (this.attempts < this.maxAttempts) {
> 20 |       this.attempts += 1;
> 21 |       const open = await this.transport.open(address);
> 22 |       if (open) {
> 23 |         this.settle('connected');
> 24 |         return 'connected';
> 25 |       }
> 26 |       await pause(this.attempts * 100);
> 27 |     }
> 28 |     this.settle('gave-up');
> 29 |     return 'gave-up';
> 30 |   }
  31 | 
  32 |   private settle(outcome: Outcome): void {
  33 |     const callback = this.onSettled;
  34 |     this.onSettled = null;
  35 |     if (callback !== null) {
  36 |       setTimeout(() => callback(outcome), 0);
``​`

## The selection (machine-readable)
``​`json
[{"path":"src/link.ts","side":"target","start":17,"end":30,"kind":"added"}]
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
- `base/` is From, commit 552a4ad2197181f4a64c379fee7b53d3fe461b6b
- `target/` is To, commit 021c118458dbf2faeed6f7133e485a902a40fb9b
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: connect
From: 552a4ad2197181f4a64c379fee7b53d3fe461b6b (base commit)
To: 021c118458dbf2faeed6f7133e485a902a40fb9b (target commit)
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
