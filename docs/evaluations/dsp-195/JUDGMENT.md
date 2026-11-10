# DSP-195 · Judgment

## What the person saw, and what the target is

Niclas's observation: in a whole walk generated in Essentials, the step "The attach configuration" showed before Show more a summary, several paragraphs on attach versus launch, a numbered walk-through of the pre-launch task and the attach order, the success condition, and settings later steps treat; Standard looked nearly the same. His calibration of the intended level (an example, not a template):

> This configuration connects the debugger to Python in the container. It first runs the startup task, then attempts to attach—but completion of that task does not guarantee that the debug server is ready. The next step follows that startup task.

The observed run is not on this machine, so its provider and versions are not known. The reproduction is the invented attach case.

## Where the long text arose

| Stage | Finding | Evidence |
| --- | --- | --- |
| Profile, version, state (E) | Correct in every run: the prompt carried "How to explain the steps (Essentials)" and the definition recorded the version. | `one-call/*/exchange/*prompt.md`, `definition.review.json` |
| The writer's first answer (A) | **Where the length arises.** With Claude the first answer is already long; the one-call preparation has no reviewer at all. With Copilot every profile is short. | `one-call/`, `locked/before-*` |
| Inputs beside the profile | A reader and a content list of their own in four places: the shared task, the writer role's purpose, the writing rules, the one-call answer format's `body` and `why`; the reviewer's place check named the same list. A partial, inconsistent contributor. | version 9 prompts in `locked/before-claude/prompts/`, `one-call/v9-attach-single-essens-claude/` |
| The reviewer (B) | Did not ask for detail back. Copilot asked once for a main-behaviour fact (what the service serves); Claude accepted at once. | `loop/`, `side-by-side.md` section 4 |
| The fields together (C) | At version 9 `summary`, `body` and `why` were each described by part of the same list; the summary often restates the body. | `one-call/` |
| Rendering (D) | Nothing behind Show more leaked; "Why it matters" stood after the Show more control though always visible. | `app/src/renderer/ReviewView.tsx` before this change |

The controlled variations with Claude changed no single input with a clear effect: taking out the content line, giving the choice to the profile in the task and the role, taking out the brief, adding the reference's background-worker calibration (version 9), and taking out the shared rules on understanding, scope, orientation and transitions (version 10) each stayed within the spread of repeated samples. So no one rule makes Claude's Essentials long. What remains is the model's own selection under the Essentials reader as written.

## What changed (instruction version 10)

With a profile, what a step must contain is said once, in the profile's section: the shared task names what an explanation may cover and leaves the choice and the level to the profile, the writer's role and the reviewer's check name no list of their own, the writing rules give the form only, and the one-call answer format describes its fields without a list. "Why it matters" stands before the Show more control. No brevity rule, quota, identifier limit or clipping; code access, the walk context, Standard's mechanism and Teacher's concepts are kept. The reference is unchanged.

## What the person now sees before Show more

**Original generation, one-call, Claude.** Version 9, the sample with the observed traits:

> VS Code no longer starts the program. It runs a task first and then connects to a debug server.
>
> This is the entry point: the configuration the developer picks in VS Code's Run and Debug view.
>
> Old configuration (`request: "launch"` with `program`): VS Code's debugpy extension started `service/main.py` itself, in the integrated terminal, on the host's Python.
>
> New configuration (`request: "attach"`): VS Code starts no process. It does two things, in this order:
> 1. It runs `preLaunchTask`, the task labelled "Start the service container" (next step).
> 2. It connects to a debugpy server at the `connect` address (a later step).
>
> The launch configuration is replaced, not added to. **Running the service locally under the debugger now needs Docker.**

Version 10, the sample nearest the calibration:

> F5 now attaches to a running debugpy instead of starting the program locally.
>
> The old configuration used `request: launch`, so VS Code started `service/main.py` itself. The new one uses `request: attach`, so VS Code starts nothing. It connects to a debugpy server that something else must already have started.
>
> That something is `preLaunchTask`. Before attaching, VS Code runs the task named "Start the service container" (next step). Only after that task ends does VS Code try `localhost:5678`.
>
> Why it matters: **Attaching depends on debugpy already listening when the task ends.** Later steps show why that is not guaranteed.

The other four version 10 samples are of the same size (491 to 623 visible characters against 517 to 813 at version 9), with no numbered walk-through. Only one of them states the readiness consequence, which the calibration treats as decisive; most restate the change from launch.

**After a profile switch, Claude.** No systematic change: Essentials 825 to 1179 visible characters at W1.1 (1163 at version 9), with the same kind of content. DSP-194 had already given this path the form of the answer only; the shared task was the remaining change here.

**In the real windows (one-call, version 10).** With Claude, the Essentials walk showed for the attach step a summary line and two short paragraphs (500 characters) with one sentence behind Show more; Standard as an alternative on the same step showed 1528 characters before Show more. With Copilot, the Essentials walk showed one summary line and one paragraph (359 characters); Essentials after a switch from a Standard walk showed one paragraph of 564 characters, which named the readiness gap ("Attachment depends on debugpy being ready at the published port") but also the path mapping and `justMyCode`. Pictures: `window/`.

**Copilot.** Short in every profile before and after.

## Established, and not

Established: the observation reproduces with Claude, not with Copilot; it arises in the writer's first answer; the reviewer did not add detail in the loops run; the duplicated lists existed and are gone; the rendering order is corrected. Claude's one-call Essentials became somewhat shorter and lost the numbered walk-through in the samples; on the locked plan and after a switch the change is within the spread.

Not established: the observed run's provider and versions; whether Claude's Essentials reaches the calibration without a change to the Essentials definition or the model (a decision for Niclas, not a brevity rule to add here); the pedagogical quality, which is Niclas's own reading. Five samples per version in one path and one to three elsewhere are a limited round: a difference smaller than the spread shown is not a finding.
