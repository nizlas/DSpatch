# The three profiles through the real provider flow · judgment

Niclas's follow-up of 10 November 2026 to DSP-192: the same change in the three profiles through DSpatch's real provider flow with the provider and model he has chosen, Claude with the model id `opus`, at instruction version 8. Nothing was simulated and no answer was written by hand; the product's job service, revision snapshot, walk loop drawing, roles, run engine, adapter and record did the work, driven through DSpatch's real windows over a fresh profile (`app/scripts/profile-real-trial.mjs`). The texts are in `side-by-side.md`; the records, definitions and the explanations store are under `records/`.

**Evidence of this provider and model on this day, and of nothing else.** One change, two steps, one sample per cell. No prompt was changed in this round, and DSP-192 stays in Review for Niclas's own assessment.

## What was run

| | |
| --- | --- |
| Change | The synthetic connect case (`tests/support/synthetic-walks.ts`, `CONNECT_CASE`): `src/link.ts` and `src/session.ts` at two commits, the same pair in every run. |
| Path A, written during the walk | Three loop runs on three reviews of the pair, one per profile: the planner plans, the writer writes every step in the chosen profile, the reviewer judges. Each run has the planner's own plan, because the product has no way to lock a plan across runs and the planner is not told the profile. |
| Path B, made after the walk | On the Standard walk, the reading profile switched to Essentials and to Teacher on two steps; each switch asked the step explanation channel for that step in that profile, with the walk's Standard text as material. |
| Steps | Simple: the registration in `startSession` (`src/session.ts` target 3–5; W1.1 in every plan). Complex: `settle`, where the slot is emptied and the callback deferred (`src/link.ts` target 32–38; W1.5 in the Standard plan, W1.4 in the other two). |
| Times | Planner 50–54 s; a writer step 4–15 s; the reviewer 19–31 s; a loop run 2.5–3.5 min; a profile alternative 14–24 s. |
| Reviewer | Standard: one correction asked (a false sentence in W1.3's Show more about overlapping `connect` calls), corrected by the writer, then accepted. Essentials and Teacher: accepted at once. |

The Essentials plan has two walks and leaves out the rejection path the other two plans cover (`transport.open` rejecting). The planner is not given the profile, so that is the planner's variance, not a profile effect; it is why the writer-path texts are compared by code place, not by step id.

## The simple step: the registration in startSession

**Standard, written during the walk.** The mechanism, in order: what changed ("In the earlier version it only awaited `link.connect(address)` and returned nothing to anyone. Now it also takes a `report` function"), the mapping as two bullets, the catch-all risk of the ternary, "**The callback is only handed over at this point; it does not run.**", and the await as the point where execution leaves. Show more: the two places that call `report`, the two messages on failure, the callback stored on the `Link` rather than tied to this call. Correct throughout; the help Niclas found promising in Standard is still there.

**Essentials, written during the walk.** Shorter than Standard and at a higher level. It frames the step as "it gives that function to two different paths": the settled callback ("only registers a callback here and does not run it… The `Link` decides when it runs") and the awaited result ("`startSession` checks that value itself on the lines that follow"), then what to carry forward: "**one connection attempt can now reach `report` through both paths, and each path runs on its own timing.** The rest of this walk follows the order in which they fire." It leaves the catch-all risk and the mapping's detail to the code, which does not mislead the main picture. Show more adds which path covers which outcome and one observation of its own, that the new required parameter breaks any old caller, true and not in Standard. This is a chosen main picture, not Standard compressed.

**Teacher, written during the walk.** Builds what the reasoning needs where it needs it: what a callback is ("In TypeScript, `(outcome) => ...` creates a function value without running it… so that the `Link` can call it later, once the connection attempt has *settled*, meaning it has a final outcome. This is what 'callback' means here"), that registering reports nothing, what `await` does ("suspends `startSession` until the promise from `connect` resolves"), and ends with why it matters: "To judge this change you need to know in what order these two paths run." No Show more; its length is about Standard's first part. Concepts added, facts the same.

**Essentials, made after the walk.** Here the profile does less. The text reorganises Standard's material into "Here it does two things, in this order" and "To judge this step, two things matter", and keeps nearly all of it: the mapping, the catch-all risk with "the compiler won't flag it", that nothing calls `startSession`; Show more keeps the one-slot point and the second caller. It is tidier than Standard and a little shorter, but it is Standard's content at Standard's level. With the Standard text given as material, the model kept the material rather than choosing again.

**Teacher, made after the walk.** The most pedagogical text of the simple step: the callback as "leaving a phone number: 'call me when it's settled'", why it must be registered first, `await` with a promise explained, `Outcome` as "a *union of string literal types*". Its Show more goes beyond what the step needs: the `type` import erasure and "Why the compiler stays quiet", a general lesson on the `never` check, are teaching terms rather than this step's reasoning, which the instruction asks it not to do. True, useful to a learner, but more than the step presupposes.

## The complex step: settle

**Standard, written during the walk.** Three numbered things ("copies `onSettled` into a local variable `callback` and then sets the field to `null`… one-shot", "does nothing if no callback is registered", "doesn't call the callback; it schedules it with `setTimeout(..., 0)`"), then "**Point 3 decides the order of everything that follows**" with the microtask rule stated as a rule. Show more: the closure keeps the captured callback, errors in the callback have nowhere to go, "0 ms" means a later task. Correct; the mechanism made understandable, as before.

**Essentials, written during the walk.** Two guarantees, not three statements: the callback taken out and the field cleared "in the same synchronous step, so a registered callback is scheduled at most once", and "**`settle` doesn't call the callback; it only queues it with `setTimeout(..., 0)`.** … `connect` returns `'connected'` before `'session ready'` has been reported." Show more: exception isolation and re-registration before the timer fires. Shorter than Standard, at a higher level, nothing misleading left out.

**Teacher, written during the walk.** The same two things, with the concept built in place: "The delay of `0` doesn't mean 'now'… A microtask is short follow-up work queued by promises. The continuation after an `await` is one. The language and the event-loop rules guarantee this order. It doesn't depend on how fast the machine is." Then the resulting order, bolded. Show more: the closure, no handle to cancel, and a careful observation that a caller awaiting `startSession` runs before the timer only while it waits on already resolved promises. Correct and clear, but close to Standard: Standard explains the microtask rule too, and the Teacher text's additions are the definitions and one sentence of reassurance. The help differs less here than the reference intends.

**Essentials, made after the walk.** Two bullets, "used once" and "scheduled, not called", with the rule stated, then what the order means in this walk and on the failure path. Show more: errors reach no caller, clearing first allows re-registration, `settle` is not reached when `open` rejects. Chosen and at a higher level; the strongest Essentials text of the four.

**Teacher, made after the walk.** Builds the whole foundation: "**Rule 1: code runs one piece at a time, to the end**", "**Rule 2: there are two queues, and one has priority**", then what the code does and the resulting order as four numbered events, "This order follows from the language rules, not from timing luck". Show more adds an analogy ("a clerk with two trays… an 'urgent' tray, which must be emptied completely before the clerk takes even one item from the 'timers' tray"), that the host is not named in either revision, and that an uncaught exception in Node.js ends the process by default. The best Teacher text of the set, and the one that most clearly builds understanding rather than restating facts; also the longest.

## Correctness

Every claim in the ten texts was read against the two files at both revisions. Nothing false was found in the texts kept here. The Standard run's reviewer found one false sentence in a step not compared here (W1.3's Show more) and the writer corrected it; the record holds both versions. Two Teacher claims rest on general knowledge rather than the code and say so: that Node.js ends the process on an uncaught exception by default, and that the host runtime is named nowhere in the revisions.

## What this shows

- **Essentials through the loop's writer is what the reference asks for**, on both steps: a chosen main picture at a higher level, shorter than Standard, with the mechanics after Show more. The reviewer's acceptance of that run says the same in its own words: "most of the extra mechanics come after Show more, where they continue the first part rather than repeat it."
- **Essentials as an alternative made after the walk is where the old behaviour remains**, on the simple step: with the Standard text as material, the model kept Standard's content and reorganised it. On the complex step the same path selected well. The difference between the two paths is larger than the difference between the two steps.
- **Teacher builds concepts on both paths**, and more so after the walk than during it. During the walk, Teacher on the complex step stays close to Standard, because Standard already explains the microtask rule; after the walk, Teacher builds the two rules of the event loop and an analogy. On the simple step after the walk it also teaches more than the step needs (`type` import erasure, the `never` check).
- **Standard keeps its mechanism explanation**, correct and ordered, and the correction round works with a real provider: one false sentence found, corrected, accepted.
- **The reviewer's new rule is visible in its assessments**: for Essentials it judged what the walks "bring out" and where the mechanics went; for Teacher, that "each step builds the concepts it needs, right where it needs them" and that later steps "refer back to these explanations instead of deriving them again". It asked no profile for more or less material.
- **Length followed the help** without a count: Essentials shortest and Teacher longest on the alternative path; on the writer path Teacher's first part is about Standard's length and Essentials is shorter than both.

## What it cannot show, and what remains open

- One change, two steps, one sample per cell, one provider and model, one day. Another change or another day can differ.
- The three loop plans differ (the planner's variance), so the writer-path texts are compared by code place; the alternatives are the only like-for-like comparison on one plan.
- Whether the alternative path's Essentials would select more with a different wording of the regenerate rule, or whether the Standard text as material should be given differently, is a question for Niclas's judgment and for DSP-192's review; no instruction was changed here.
- Whether Teacher's extra lessons after the walk (the `never` check, `type` erasure) are welcome or too much is a matter for the reader, not settled here.
