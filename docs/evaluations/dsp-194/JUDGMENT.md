# DSP-194 · What drives Essentials' detail, the fix, and the comparison on one locked plan

**Evidence of Copilot (`copilot-default`) on 10 November 2026, one sample per cell.** Every text here was written by Copilot through DSpatch's own Copilot adapter with the existing sign-in on Niclas's machine; the prompts were built by the product's own builders. The adapter reports no resolved model id for `copilot-default`, so which model answered is not established. DSP-192's real run used Claude with the model `opus`; that run and this one are not mixed. Nothing here is Niclas's judgment, which this does not replace.

## What was run

| | |
| --- | --- |
| Locked plan | The planner's answer of the DSP-192 real Standard run (Claude `opus`), read with the product's `readPlanAnswer`: three walks, thirteen steps, the same briefs in every prompt (`locked/plan.json`). |
| Code | The synthetic connect case, written as the revision folder the host writes (base/ and target/); the material by the host's own `ReviewPairs.material`. |
| Steps | W1.1, the registration in `startSession` (simple); W1.5, `settle` (the slot emptied and the callback deferred; interacting mechanisms). |
| Writer path | `writeStepPrompt` for Essentials, Standard and Teacher: what the loop's writer gets for a step, as a first turn in a fresh session. |
| Profile-switch path | `stepExplanationPrompt` with the envelope filled as the host fills it (the walk's own text is the step's short part): what switching the reading profile on a walk asks. The walk's own text is that run's own Standard text from the writer. |
| Not run by the locked harness | The job service, the run engine, the planner and reviewer turns, the explanation channel's store, the windows. In the loop the writer's later steps share one session; here each prompt has its own. |
| Product path, separately | `app/scripts/profile-real-trial.mjs --provider copilot --switch-only` at version 9: a Standard loop through DSpatch's real windows, then the reading profile switched to Essentials and Teacher on two of its steps; that run plans anew (`product-path/`). |

## What drives the detail: the ablation at version 8

Each variation changes one thing in the built prompt text; they are an experiment, not product prompts.

| Variation | W1.1 Essentials | W1.5 Essentials |
| --- | --- | --- |
| Writer, as built | Retells the registration, the mapping, that it stores for later, a comparison with the base revision. | Lists the operations the brief names: takes the callback out, clears the field, schedules nothing when there is none, `setTimeout` moves it out of `connect`. |
| Writer, briefs taken out | "registers its outcome-to-message callback before calling `link.connect`, so the callback is in place when `Link` settles": the purpose, chosen. | "That defers the report instead of running it inside `connect`'s success branch, so `startSession` can resume from its `await` first; the timer callback reports afterward": the target level. |
| Profile switch, as built | Adds the failure path's "retrying later", the base comparison and the rejection path that neither the code here nor Standard's text asked for. | Chosen, with the one-shot and "if none" detail in the first part. |
| Profile switch, answer format's content rules taken out | Close to Standard's own level; the failure path and the rejection path are gone. | Much the same as built. |
| Profile switch, walk's text taken out | Still the base comparison and the rejection path. | More detail, not less. |

**Established in this sample.** In the writer path, the planner's brief is read as a list of what must be said: it is written before the profile is known and names mechanics for a Standard-like reader. In the profile-switch path, the review question's answer format (a risk said in the first part, cause and effect with real names, what could not be read named) adds to Essentials what the profile leaves to the code. **Not supported.** That the walk's own text anchors Essentials at its level: with it taken out, Copilot did not select more. With Claude `opus` in DSP-192 the profile-switch Essentials did keep Standard's content; whether that was the text, the format or the model is not separated by that run, so for Claude it stays a hypothesis.

## The fix (instruction version 9)

- **The brief, at its source in the writer's prompt and role.** The writer's step section labels it "The planner's brief, written for every profile"; the writer role says the brief is orientation written before the profile is known, neither evidence nor a list of what must be said, and that the profile decides which of its points the reader needs. The planner's own instruction is unchanged (the locked plan's briefs could not test a change there).
- **The answer format, for a profile's explanation of a step.** Present and regenerate get the form only (the first part, the marker, the references block, which revision), without the review question's content rules; what to say is the profile's section's. Ordinary review questions, Tell me more, Explain more simply and Explain this keep their format.
- **Essentials in positive terms.** The reader says what a mechanism achieves and what follows from it for the main behaviour, not the calls, flags, loop steps, types, queues or guards that achieve it; the same in the reference's section 4, with a detail earning its place by changing the understanding of the main behaviour. Standard's and Teacher's readers are word for word as before.

No rule was added on top of a contradiction: the brief and the format are the sources that contradicted the profile, and each is changed where it arises.

## The comparison at version 9 (the texts are in `locked/side-by-side.md`)

**W1.5, Essentials, writer.** "`settle` schedules the registered callback instead of running it inside `connect`. This lets `connect` return and `startSession` resume after its `await` before the timer callback runs; W1.6 follows that order through to the reports." The take-and-clear and the empty case went to Show more. Chosen: what the mechanism achieves and the order the reader takes onward; at version 8 the first part listed the operations.

**W1.5, Essentials, profile switch.** "On the successful path, `settle` schedules the registered notification for a later timer turn rather than running it inline. `connect` can return `'connected'` first; then `startSession` resumes after its `await`, and the callback reports `'session ready'` in the next step." The one-shot is in Show more. Left out of the first part: the clearing of the field, the empty case, the closure over the outcome; kept: the deferral and the order, which a reviewer of the next two steps needs. The main picture is accurate: nothing left out changes the success path's behaviour.

**W1.1, Essentials, writer.** "`startSession` accepts a `report` function and registers a callback … That callback turns a `connected` outcome into `session ready` and any other outcome into `offline mode`; `startSession` then awaits `link.connect(address)`." Not worse than version 8 (the base comparison is gone), but it restates the code rather than saying what the registration is for; the variation without briefs at version 8 ("so the callback is in place when `Link` settles") was the better Essentials. Uneven.

**W1.1, Essentials, profile switch.** Still adds "on `gave-up`, `startSession` also reports 'retrying later'" and the base comparison to the first part, and the rejection path to Show more. With the content rules taken out at version 8 the same prompt did not; at version 9, with the same change in the product, it did again. One sample each way: the format is a driver, not the only one. Not improved for this step.

**Standard.** Version 8 and 9 read alike for both steps: the mechanism in order (the registration and its mapping; for `settle`, the take-and-clear, the deferral, and in Show more the microtask before the timer). Copilot's Standard is short in both versions; DSP-192's Claude `opus` Standard was much fuller, so Copilot's Standard is not a fuller mechanism explanation that Essentials could select from, and the two are close on the simple step for that reason too.

**Teacher.** Version 8 and 9 build the same concepts: on the profile switch, what `report` is, that registering is not calling, that a zero-delay timer runs later and is no exact time; in the writer, little beyond Standard in both versions (Copilot's Teacher is modest at either version). No sign that the common change took anything from it; it was not made shorter.

**The product path, Copilot, through the windows (`product-path/side-by-side.md`).** Its own plan, so not locked. Essentials on `settle` (its W1.6): "consumes the currently registered handler and, if one exists, schedules it with the outcome instead of running it inside `connect`. That lets the connection path proceed without invoking the session's reporting logic inline", the take-and-clear detail in Show more: chosen, if vaguer about whom the order serves. Essentials on the registration: again the failure-path report and the base comparison beside the purpose. Teacher in both: concepts built ("two ways to hear about the same operation"; a zero-millisecond timer is not an immediate call). All four explanations were made at version 9 with `copilot-default`, and nothing else was asked.

## What this shows, and what it cannot

- Essentials selects better at version 9 in the step where several mechanisms interact, in both generation paths and in the product path: it says what the deferral achieves and the order the reader takes onward, with the operations in Show more.
- In the simple step it is uneven: in the writer path it restates the code without choosing a purpose; in the profile-switch path it adds the failure-path report and the base comparison, which Standard's text did not carry. The answer format was one driver there; another remains (the shared task's "how it connects to what the reader will see" and the walk's transition rules may pull in the other outcome, untested).
- Standard and Teacher are as they were, within one sample's variation.
- One provider, one model, one change, two steps, one sample per cell. The ablation's variations are single samples too; they separate drivers in this sample and are not a measurement of their size.
