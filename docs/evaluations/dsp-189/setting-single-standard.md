# setting · one call · standard

Run through DSpatch's real product path (the host's job service, the revision snapshot, today's one-call preparation) with a file-backed stand-in for the provider: every prompt the product sent was answered by a Claude model outside DSpatch's providers (a subagent reading the revision folder with read-only tools), and the product read, checked and stored the answers. **Not evidence of the product path with Niclas's provider.** Started 2026-11-10T02:30:33.722Z, ended 2026-11-10T02:33:59.767Z; job done: 2 walk(s) and 0 reading(s), 8 step(s). 2 changed line(s) are in none of them.

## Turns and their answer times (the stand-in model reading and writing; not a provider's latency)

| Turn | Task | Session | Answer time | Answer chars |
| --- | --- | --- | --- | --- |
| 1 | prepare-walks | file-1 | 3 min 25 s | 14172 |

Sum of answer times: 3 min 25 s.

## The walks as written in one call

**Summary:** The change makes the number of sync attempts configurable instead of hard-coded. `SyncConfig` gains a `retryLimit` field with a default of 3 in `DEFAULT_CONFIG`; `configFromEnvironment` reads the new `SYNC_RETRY_LIMIT` environment variable and accepts only a positive whole number, falling back to the default otherwise; and the loop in `sync` uses `config.retryLimit` as its bound where it used the literal 3. With no variable set, the program makes three attempts as before.

**Background:** - The field is named `retryLimit`, but its comment and the loop count attempts in total: `retryLimit: 1` means one attempt and no retry.
- A rejected `SYNC_RETRY_LIMIT` value is replaced by the default silently; nothing logs or throws. There is no upper bound on accepted values.
- The two revisions contain only the three source files. No test exercises `configFromEnvironment` or `sync`, so everything in the walks is read from the code, not observed.
- `attempt` in this repository is a stub that returns whether the endpoint is non-empty, so the retry loop cannot change an outcome here; the limit only matters once `attempt` can fail intermittently.

### W1 (walk): How SYNC_RETRY_LIMIT reaches the sync loop

*Purpose:* Follow a configured retry limit from the environment, through the config object, into the loop that bounds the attempts. · *Question:* Where does the retry limit come from, and how does sync() use it?

- **W1.1 main builds the config and starts sync** — The entry point turns the environment into a SyncConfig and passes it to sync().
  - The entry point: `src/app.ts` target 13–15
- **W1.2 configFromEnvironment validates SYNC_RETRY_LIMIT** — The variable is converted with Number() and accepted only as a positive whole number; otherwise the default applies.
  - Parsing and validating the variable: `src/app.ts` target 4–11 ← from The call in main (`src/app.ts` 14–14)
- **W1.3 The retryLimit field and its default** — SyncConfig requires the new field; DEFAULT_CONFIG sets it to 3, the number the loop used before.
  - The interface field and the default value: `src/config.ts` target 1–10 ← from The fallback in configFromEnvironment (`src/app.ts` 9–9)
- **W1.4 sync loops up to retryLimit attempts** — The loop bound is now config.retryLimit instead of the literal 3; the first successful attempt returns true, exhausting the loop returns false.
  - The retry loop: `src/sync.ts` target 7–14 ← from Called by main with the built config (`src/app.ts` 14–14)
- **W1.5 attempt is a stub in this repository** — attempt only checks that the endpoint is non-empty, so its result cannot change between iterations.
  - The attempt function: `src/sync.ts` target 3–5 ← from The call in the loop (`src/sync.ts` 9–9)

### W2 (walk): What happens when SYNC_RETRY_LIMIT is unset or invalid

*Purpose:* Follow the fallback branch of the validation and see that the old behaviour is kept, without any warning. · *Question:* Does an unconfigured or badly configured program still make three attempts?

- **W2.1 The condition rejects the value** — Back at the branch in configFromEnvironment, this time the value is missing or not a positive whole number.
  - The fallback branch of the ternary: `src/app.ts` target 5–9
- **W2.2 The default is 3** — DEFAULT_CONFIG supplies the value the loop used before the change.
  - The default value: `src/config.ts` target 7–10 ← from The fallback in configFromEnvironment (`src/app.ts` 9–9)
- **W2.3 sync makes three attempts, as before** — With retryLimit 3 the loop condition is tries < 3, the same bound as the removed literal.
  - The retry loop with the default bound: `src/sync.ts` target 7–14 ← from Called by main with the built config (`src/app.ts` 14–14)

## The delivered walks, step by step (as the person reads them)

Definition provenance: Prepared by Claude (file-answer) on 2026-11-10 02:33 UTC. It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing. The step explanations are written in the Standard profile (instruction version 7).

### W1 (walk): How SYNC_RETRY_LIMIT reaches the sync loop

*Purpose:* Follow a configured retry limit from the environment, through the config object, into the loop that bounds the attempts.

#### W1.1 main builds the config and starts sync

- The entry point: `src/app.ts` target lines 13–15

`main` is the only entry point in this repository. It receives `env`, a map of string-or-undefined values shaped like `process.env`, and does two things on one line: it calls `configFromEnvironment(env)` to build a `SyncConfig`, and it hands that object straight to `sync`. Whatever `sync` resolves to (a boolean, true for success) becomes `main`'s result.

Nothing else reads the environment, so **every setting `sync` sees passes through `configFromEnvironment`**, which the next step opens. This line is unchanged by the commit; it is here as the route into the change.

#### W1.2 configFromEnvironment validates SYNC_RETRY_LIMIT

- Parsing and validating the variable: `src/app.ts` target lines 4–11 ← from The call in main (`src/app.ts` 14–14)

Called from `main`, `configFromEnvironment` now reads a second variable. Two things decide what ends up in `retryLimit`:

1. `Number(env.SYNC_RETRY_LIMIT)` converts the raw value. Environment values are strings or `undefined`, and `Number` is lenient: `undefined` becomes `NaN` and `'3'` becomes `3`, but also `''` becomes `0`, `'2.5'` becomes `2.5`, `'abc'` becomes `NaN`, and `' 4 '`, `'1e2'` and `'0x10'` become `4`, `100` and `16`.
2. The condition `Number.isInteger(limit) && limit > 0` then accepts only a positive whole number. `Number.isInteger` is false for `NaN`, `Infinity` and fractions; `limit > 0` rejects `0` and negatives. Everything rejected falls back to `DEFAULT_CONFIG.retryLimit`, defined in the next step.

The object literal spreads `DEFAULT_CONFIG` first and then assigns `endpoint` and `retryLimit` explicitly, so `retryLimit` is always set here; the spread only carries any future fields. Note that the two settings have different fallback rules: `endpoint` uses `??`, which falls back only for `undefined`, so an empty `SYNC_ENDPOINT` is kept as `''`, while an empty `SYNC_RETRY_LIMIT` falls back to the default.

Worth judging: **a rejected value is replaced silently** (nothing logs or throws) and there is no upper bound, so `'1000000'` is accepted as is. The fallback outcome is followed on its own in the second walk.

**Show more:**

Some inputs and what this code makes of them, following the JavaScript rules for `Number` and `Number.isInteger`; no test in the revisions exercises them:

| `SYNC_RETRY_LIMIT` | `Number(...)` | accepted? | `retryLimit` |
| --- | --- | --- | --- |
| unset | `NaN` | no | 3 (default) |
| `''` | `0` | no | 3 |
| `'5'` | `5` | yes | 5 |
| `'3.0'` | `3` | yes | 3 |
| `'2.5'` | `2.5` | no | 3 |
| `'-1'` | `-1` | no | 3 |
| `'1e3'` | `1000` | yes | 1000 |
| `'Infinity'` | `Infinity` | no | 3 |
| `'three'` | `NaN` | no | 3 |

*Why:* This condition alone decides whether the operator's value or the default governs the loop bound shown in a later step.

#### W1.3 The retryLimit field and its default

- The interface field and the default value: `src/config.ts` target lines 1–10 ← from The fallback in configFromEnvironment (`src/app.ts` 9–9)

`DEFAULT_CONFIG.retryLimit`, the fallback in the previous step, is defined here. Adding `readonly retryLimit: number` to the `SyncConfig` interface makes TypeScript require the field in every object typed as `SyncConfig`; that is why `DEFAULT_CONFIG` must gain a value in the same commit, and why `configFromEnvironment` cannot leave the field out.

The default `3` equals the literal the loop in `sync` used before this change, so an unconfigured program keeps its old number of attempts (the next step shows the loop). The comment fixes the meaning of the number: **how many attempts in total**, not how many retries after a first failure, despite the name `retryLimit`; a value of 1 means a single attempt.

Notice that the type is plain `number`. The positive-integer guarantee lives only in `configFromEnvironment`; a `SyncConfig` built anywhere else is not checked. In this repository there is no other place that builds one.

#### W1.4 sync loops up to retryLimit attempts

- The retry loop: `src/sync.ts` target lines 7–14 ← from Called by main with the built config (`src/app.ts` 14–14)

`sync` receives the config object `main` built in the earlier steps. The only change is the loop condition: `tries < config.retryLimit` where it was `tries < 3`. `tries` starts at 0, so the body runs at most `retryLimit` times, which matches the comment from the previous step: the number is the total count of attempts.

Each pass awaits `attempt(config.endpoint)`; the first `true` returns `true` at once, and if the loop ends, `sync` returns `false`. With the default of 3 this is exactly the old behaviour. The bound is read on every iteration, but `config` is `readonly` and nothing in the loop changes it, so it is fixed for the whole call.

What the code relies on: `configFromEnvironment` guarantees a positive whole number, and `sync` does no checking of its own. A `SyncConfig` from another source with `retryLimit` of `NaN` or `0` would make the first `tries < config.retryLimit` false, and `sync` would return `false` without a single attempt. There is also no pause between attempts, so a large limit means that many back-to-back calls before giving up.

#### W1.5 attempt is a stub in this repository

- The attempt function: `src/sync.ts` target lines 3–5 ← from The call in the loop (`src/sync.ts` 9–9)

Stepping into the callee of the loop: `attempt` does not contact anything. It returns whether `endpoint` is non-empty, with no side effects, so it gives the same answer on every iteration. With this implementation `sync` either succeeds on the first pass or fails `retryLimit` times identically; **the limit cannot change the outcome here**.

That is a fact about this repository, not a flaw in the change: the configurable bound only becomes meaningful once `attempt` can fail intermittently. A reviewer should judge the change knowing that nothing in these revisions exercises that case.

### W2 (walk): What happens when SYNC_RETRY_LIMIT is unset or invalid

*Purpose:* Follow the fallback branch of the validation and see that the old behaviour is kept, without any warning.

#### W2.1 The condition rejects the value

- The fallback branch of the ternary: `src/app.ts` target lines 5–9

This walk returns to the ternary in `configFromEnvironment` and follows the other outcome: `Number.isInteger(limit) && limit > 0` is false. That is the case when `SYNC_RETRY_LIMIT` is unset (`Number(undefined)` is `NaN`), empty (`0`, rejected by `limit > 0`), `'0'`, negative, a fraction such as `'2.5'`, or text such as `'three'` (`NaN`).

In all these cases the ternary yields `DEFAULT_CONFIG.retryLimit`, and the object is otherwise built exactly as on the accepted path. **Nothing distinguishes a deliberate omission from a typo**: there is no log, error or flag, so an operator who sets `SYNC_RETRY_LIMIT=three` gets the default without knowing.

#### W2.2 The default is 3

- The default value: `src/config.ts` target lines 7–10 ← from The fallback in configFromEnvironment (`src/app.ts` 9–9)

The fallback value is the `3` set here, chosen to match the literal the loop had before the commit. The interface field above it is what forces the default to exist at all: without it, `DEFAULT_CONFIG` would no longer satisfy `SyncConfig`.

#### W2.3 sync makes three attempts, as before

- The retry loop with the default bound: `src/sync.ts` target lines 7–14 ← from Called by main with the built config (`src/app.ts` 14–14)

`sync` receives the config with `retryLimit` 3, so the condition `tries < config.retryLimit` is evaluated as `tries < 3`, the literal that stood here before the change. The loop therefore runs its body at most three times, returns `true` at the first successful `attempt` and `false` otherwise, exactly as in the previous revision.

This equivalence is read from the code; the revisions contain no test that pins it. It holds only for the unconfigured case: once a value is accepted, the first walk applies.

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
- `base/` is From, commit 8d18914227d76034234234732abf0c31a51b7d13
- `target/` is To, commit 3edd7d3aaac55b7979a10f3adef258b76868bbca
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.

## The change
Repository: setting
From: 8d18914227d76034234234732abf0c31a51b7d13 (base commit)
To: 3edd7d3aaac55b7979a10f3adef258b76868bbca (target commit)
Line numbers are 1-based; "base" is From and "target" is To.

## Changed lines (machine-readable)
``​`json
[{"path":"src/app.ts","side":"base","start":5,"end":5},{"path":"src/sync.ts","side":"base","start":8,"end":8},{"path":"src/app.ts","side":"target","start":5,"end":10},{"path":"src/config.ts","side":"target","start":3,"end":4},{"path":"src/config.ts","side":"target","start":9,"end":9},{"path":"src/sync.ts","side":"target","start":8,"end":8}]
``​`

## Changed files
- modified src/app.ts
- modified src/config.ts
- modified src/sync.ts

## Diff (orientation)
``​`diff
diff --git a/src/app.ts b/src/app.ts
index 4925c48..11482b4 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -2,7 +2,12 @@ import { DEFAULT_CONFIG, type SyncConfig } from './config';
 import { sync } from './sync';
 
 export function configFromEnvironment(env: Record<string, string | undefined>): SyncConfig {
-  return { ...DEFAULT_CONFIG, endpoint: env.SYNC_ENDPOINT ?? DEFAULT_CONFIG.endpoint };
+  const limit = Number(env.SYNC_RETRY_LIMIT);
+  return {
+    ...DEFAULT_CONFIG,
+    endpoint: env.SYNC_ENDPOINT ?? DEFAULT_CONFIG.endpoint,
+    retryLimit: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONFIG.retryLimit,
+  };
 }
 
 export async function main(env: Record<string, string | undefined>): Promise<boolean> {
diff --git a/src/config.ts b/src/config.ts
index b72d54c..2f41537 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,7 +1,10 @@
 export interface SyncConfig {
   readonly endpoint: string;
+  /** How many attempts sync() makes before it gives up. */
+  readonly retryLimit: number;
 }
 
 export const DEFAULT_CONFIG: SyncConfig = {
   endpoint: 'https://example.invalid/sync',
+  retryLimit: 3,
 };
diff --git a/src/sync.ts b/src/sync.ts
index bec7ca4..d255871 100644
--- a/src/sync.ts
+++ b/src/sync.ts
@@ -5,7 +5,7 @@ async function attempt(endpoint: string): Promise<boolean> {
 }
 
 export async function sync(config: SyncConfig): Promise<boolean> {
-  for (let tries = 0; tries < 3; tries += 1) {
+  for (let tries = 0; tries < config.retryLimit; tries += 1) {
     if (await attempt(config.endpoint)) {
       return true;
     }
``​`
```

</details>

<details><summary>Answer</summary>

```text
``​`json
{
  "summary": "The change makes the number of sync attempts configurable instead of hard-coded. `SyncConfig` gains a `retryLimit` field with a default of 3 in `DEFAULT_CONFIG`; `configFromEnvironment` reads the new `SYNC_RETRY_LIMIT` environment variable and accepts only a positive whole number, falling back to the default otherwise; and the loop in `sync` uses `config.retryLimit` as its bound where it used the literal 3. With no variable set, the program makes three attempts as before.",
  "background": "- The field is named `retryLimit`, but its comment and the loop count attempts in total: `retryLimit: 1` means one attempt and no retry.\n- A rejected `SYNC_RETRY_LIMIT` value is replaced by the default silently; nothing logs or throws. There is no upper bound on accepted values.\n- The two revisions contain only the three source files. No test exercises `configFromEnvironment` or `sync`, so everything in the walks is read from the code, not observed.\n- `attempt` in this repository is a stub that returns whether the endpoint is non-empty, so the retry loop cannot change an outcome here; the limit only matters once `attempt` can fail intermittently.",
  "walks": [
    {
      "kind": "walk",
      "title": "How SYNC_RETRY_LIMIT reaches the sync loop",
      "question": "Where does the retry limit come from, and how does sync() use it?",
      "purpose": "Follow a configured retry limit from the environment, through the config object, into the loop that bounds the attempts.",
      "steps": [
        {
          "title": "main builds the config and starts sync",
          "summary": "The entry point turns the environment into a SyncConfig and passes it to sync().",
          "body": "`main` is the only entry point in this repository. It receives `env`, a map of string-or-undefined values shaped like `process.env`, and does two things on one line: it calls `configFromEnvironment(env)` to build a `SyncConfig`, and it hands that object straight to `sync`. Whatever `sync` resolves to (a boolean, true for success) becomes `main`'s result.\n\nNothing else reads the environment, so **every setting `sync` sees passes through `configFromEnvironment`**, which the next step opens. This line is unchanged by the commit; it is here as the route into the change.",
          "details": "",
          "places": [
            {
              "label": "The entry point",
              "path": "src/app.ts",
              "side": "target",
              "start": 13,
              "end": 15,
              "anchor": "return sync(configFromEnvironment(env));"
            }
          ]
        },
        {
          "title": "configFromEnvironment validates SYNC_RETRY_LIMIT",
          "summary": "The variable is converted with Number() and accepted only as a positive whole number; otherwise the default applies.",
          "body": "Called from `main`, `configFromEnvironment` now reads a second variable. Two things decide what ends up in `retryLimit`:\n\n1. `Number(env.SYNC_RETRY_LIMIT)` converts the raw value. Environment values are strings or `undefined`, and `Number` is lenient: `undefined` becomes `NaN` and `'3'` becomes `3`, but also `''` becomes `0`, `'2.5'` becomes `2.5`, `'abc'` becomes `NaN`, and `' 4 '`, `'1e2'` and `'0x10'` become `4`, `100` and `16`.\n2. The condition `Number.isInteger(limit) && limit > 0` then accepts only a positive whole number. `Number.isInteger` is false for `NaN`, `Infinity` and fractions; `limit > 0` rejects `0` and negatives. Everything rejected falls back to `DEFAULT_CONFIG.retryLimit`, defined in the next step.\n\nThe object literal spreads `DEFAULT_CONFIG` first and then assigns `endpoint` and `retryLimit` explicitly, so `retryLimit` is always set here; the spread only carries any future fields. Note that the two settings have different fallback rules: `endpoint` uses `??`, which falls back only for `undefined`, so an empty `SYNC_ENDPOINT` is kept as `''`, while an empty `SYNC_RETRY_LIMIT` falls back to the default.\n\nWorth judging: **a rejected value is replaced silently** (nothing logs or throws) and there is no upper bound, so `'1000000'` is accepted as is. The fallback outcome is followed on its own in the second walk.",
          "why": "This condition alone decides whether the operator's value or the default governs the loop bound shown in a later step.",
          "details": "Some inputs and what this code makes of them, following the JavaScript rules for `Number` and `Number.isInteger`; no test in the revisions exercises them:\n\n| `SYNC_RETRY_LIMIT` | `Number(...)` | accepted? | `retryLimit` |\n| --- | --- | --- | --- |\n| unset | `NaN` | no | 3 (default) |\n| `''` | `0` | no | 3 |\n| `'5'` | `5` | yes | 5 |\n| `'3.0'` | `3` | yes | 3 |\n| `'2.5'` | `2.5` | no | 3 |\n| `'-1'` | `-1` | no | 3 |\n| `'1e3'` | `1000` | yes | 1000 |\n| `'Infinity'` | `Infinity` | no | 3 |\n| `'three'` | `NaN` | no | 3 |",
          "places": [
            {
              "label": "Parsing and validating the variable",
              "path": "src/app.ts",
              "side": "target",
              "start": 4,
              "end": 11,
              "anchor": "const limit = Number(env.SYNC_RETRY_LIMIT);",
              "from": {
                "label": "The call in main",
                "path": "src/app.ts",
                "side": "target",
                "start": 14,
                "end": 14
              }
            }
          ]
        },
        {
          "title": "The retryLimit field and its default",
          "summary": "SyncConfig requires the new field; DEFAULT_CONFIG sets it to 3, the number the loop used before.",
          "body": "`DEFAULT_CONFIG.retryLimit`, the fallback in the previous step, is defined here. Adding `readonly retryLimit: number` to the `SyncConfig` interface makes TypeScript require the field in every object typed as `SyncConfig`; that is why `DEFAULT_CONFIG` must gain a value in the same commit, and why `configFromEnvironment` cannot leave the field out.\n\nThe default `3` equals the literal the loop in `sync` used before this change, so an unconfigured program keeps its old number of attempts (the next step shows the loop). The comment fixes the meaning of the number: **how many attempts in total**, not how many retries after a first failure, despite the name `retryLimit`; a value of 1 means a single attempt.\n\nNotice that the type is plain `number`. The positive-integer guarantee lives only in `configFromEnvironment`; a `SyncConfig` built anywhere else is not checked. In this repository there is no other place that builds one.",
          "details": "",
          "places": [
            {
              "label": "The interface field and the default value",
              "path": "src/config.ts",
              "side": "target",
              "start": 1,
              "end": 10,
              "anchor": "retryLimit: 3",
              "from": {
                "label": "The fallback in configFromEnvironment",
                "path": "src/app.ts",
                "side": "target",
                "start": 9,
                "end": 9
              }
            }
          ]
        },
        {
          "title": "sync loops up to retryLimit attempts",
          "summary": "The loop bound is now config.retryLimit instead of the literal 3; the first successful attempt returns true, exhausting the loop returns false.",
          "body": "`sync` receives the config object `main` built in the earlier steps. The only change is the loop condition: `tries < config.retryLimit` where it was `tries < 3`. `tries` starts at 0, so the body runs at most `retryLimit` times, which matches the comment from the previous step: the number is the total count of attempts.\n\nEach pass awaits `attempt(config.endpoint)`; the first `true` returns `true` at once, and if the loop ends, `sync` returns `false`. With the default of 3 this is exactly the old behaviour. The bound is read on every iteration, but `config` is `readonly` and nothing in the loop changes it, so it is fixed for the whole call.\n\nWhat the code relies on: `configFromEnvironment` guarantees a positive whole number, and `sync` does no checking of its own. A `SyncConfig` from another source with `retryLimit` of `NaN` or `0` would make the first `tries < config.retryLimit` false, and `sync` would return `false` without a single attempt. There is also no pause between attempts, so a large limit means that many back-to-back calls before giving up.",
          "details": "",
          "places": [
            {
              "label": "The retry loop",
              "path": "src/sync.ts",
              "side": "target",
              "start": 7,
              "end": 14,
              "anchor": "tries < config.retryLimit",
              "from": {
                "label": "Called by main with the built config",
                "path": "src/app.ts",
                "side": "target",
                "start": 14,
                "end": 14
              }
            }
          ]
        },
        {
          "title": "attempt is a stub in this repository",
          "summary": "attempt only checks that the endpoint is non-empty, so its result cannot change between iterations.",
          "body": "Stepping into the callee of the loop: `attempt` does not contact anything. It returns whether `endpoint` is non-empty, with no side effects, so it gives the same answer on every iteration. With this implementation `sync` either succeeds on the first pass or fails `retryLimit` times identically; **the limit cannot change the outcome here**.\n\nThat is a fact about this repository, not a flaw in the change: the configurable bound only becomes meaningful once `attempt` can fail intermittently. A reviewer should judge the change knowing that nothing in these revisions exercises that case.",
          "details": "",
          "places": [
            {
              "label": "The attempt function",
              "path": "src/sync.ts",
              "side": "target",
              "start": 3,
              "end": 5,
              "anchor": "return endpoint !== '';",
              "from": {
                "label": "The call in the loop",
                "path": "src/sync.ts",
                "side": "target",
                "start": 9,
                "end": 9
              }
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What happens when SYNC_RETRY_LIMIT is unset or invalid",
      "question": "Does an unconfigured or badly configured program still make three attempts?",
      "purpose": "Follow the fallback branch of the validation and see that the old behaviour is kept, without any warning.",
      "steps": [
        {
          "title": "The condition rejects the value",
          "summary": "Back at the branch in configFromEnvironment, this time the value is missing or not a positive whole number.",
          "body": "This walk returns to the ternary in `configFromEnvironment` and follows the other outcome: `Number.isInteger(limit) && limit > 0` is false. That is the case when `SYNC_RETRY_LIMIT` is unset (`Number(undefined)` is `NaN`), empty (`0`, rejected by `limit > 0`), `'0'`, negative, a fraction such as `'2.5'`, or text such as `'three'` (`NaN`).\n\nIn all these cases the ternary yields `DEFAULT_CONFIG.retryLimit`, and the object is otherwise built exactly as on the accepted path. **Nothing distinguishes a deliberate omission from a typo**: there is no log, error or flag, so an operator who sets `SYNC_RETRY_LIMIT=three` gets the default without knowing.",
          "details": "",
          "places": [
            {
              "label": "The fallback branch of the ternary",
              "path": "src/app.ts",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "DEFAULT_CONFIG.retryLimit"
            }
          ]
        },
        {
          "title": "The default is 3",
          "summary": "DEFAULT_CONFIG supplies the value the loop used before the change.",
          "body": "The fallback value is the `3` set here, chosen to match the literal the loop had before the commit. The interface field above it is what forces the default to exist at all: without it, `DEFAULT_CONFIG` would no longer satisfy `SyncConfig`.",
          "details": "",
          "places": [
            {
              "label": "The default value",
              "path": "src/config.ts",
              "side": "target",
              "start": 7,
              "end": 10,
              "anchor": "retryLimit: 3",
              "from": {
                "label": "The fallback in configFromEnvironment",
                "path": "src/app.ts",
                "side": "target",
                "start": 9,
                "end": 9
              }
            }
          ]
        },
        {
          "title": "sync makes three attempts, as before",
          "summary": "With retryLimit 3 the loop condition is tries < 3, the same bound as the removed literal.",
          "body": "`sync` receives the config with `retryLimit` 3, so the condition `tries < config.retryLimit` is evaluated as `tries < 3`, the literal that stood here before the change. The loop therefore runs its body at most three times, returns `true` at the first successful `attempt` and `false` otherwise, exactly as in the previous revision.\n\nThis equivalence is read from the code; the revisions contain no test that pins it. It holds only for the unconfigured case: once a value is accepted, the first walk applies.",
          "details": "",
          "places": [
            {
              "label": "The retry loop with the default bound",
              "path": "src/sync.ts",
              "side": "target",
              "start": 7,
              "end": 14,
              "anchor": "tries < config.retryLimit",
              "from": {
                "label": "Called by main with the built config",
                "path": "src/app.ts",
                "side": "target",
                "start": 14,
                "end": 14
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
