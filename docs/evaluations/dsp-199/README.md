# DSP-199 · Essentials made extremely short: verification

Material for [DSP-199](../../../backlog/tasks/dsp-199%20-%20Essentials-becomes-extremely-short-about-two-natural-sentences-before-Show-more-in-the-reference-and-in-every-generation-path.md), at instruction version 12.

**Provider:** the configured one, Claude, requested `opus`, reported `claude-opus-5-5` in every call. **Example:** the invented `app/tests/support/synthetic-exec-debug.ts`. **Texts:** `TEXTS.md` holds every text the person would read, before and behind Show more.

| Path | What it is |
| --- | --- |
| `TEXTS.md` | The Essentials texts of every path, before and behind Show more, and the Standard and Teacher sizes. |
| `prompts/before-v11/`, `prompts/after-v12/` | Every prompt each profile can be built into (walk section, one-call, loop writer, loop reviewer, profile switch, regeneration, and the deepening sections), before and after the change, with no model call. |
| `locked/` | The loop writer in all three profiles and the profile switch to Essentials and Teacher on the DSP-196 locked plan, steps W1.2 (the pre-launch task) and W1.7 (the detached start). |
| `one-call/`, `loop/` | A whole Essentials walk by the one-call preparation and one by the loop with its reviewer: definitions, turns, answers, and the reviewer's prompt and answer. |
| `window/` | The window trial: pictures of the Step panel taken from DSpatch's own windows, before and with Show more open, and the panel's texts. |

## What the person now sees

**The visible block.** In an Essentials walk from version 12, the Step panel shows the short part and the Show more control, with no summary line above it (picture `window/step-W1.5-essens-prepared.png`). "Why it matters" stays empty: no one-call step filled it.

**The short part is at the intended size in every path.**

| Path | Short part (characters) | Sentences |
| --- | --- | --- |
| Loop writer, locked plan, W1.2 / W1.7 | 364 / 269 | 3 / 2 |
| Profile switch to Essentials, W1.2 / W1.7 | 355 / 358 | 3 / 3 |
| One-call walk, nine steps | 112 to 274 | 2 (one step 3) |
| Loop walk, eleven steps | 237 to 395 | 2 to 3 (one step 4) |
| Window trial, W1.2 / W1.5 | 243 / 194 | 3 / 2 |

None of them packs a walkthrough into long sentences. Example, the one-call walk's detached start:

> `docker exec -d` starts `orders.main` under debugpy and returns at once, so the script and the task finish. Thanks to `--wait-for-client`, debugpy holds `main` back until the editor connects.

**Correctness.** One overclaim was found. The profile switch's W1.2 says VS Code "attaches only if the exit code is zero". After a failed pre-launch task VS Code normally offers to debug anyway, so "only" is too strong. The other short parts are correct as far as checked against the code.

**The readiness gap** (the task ends before debugpy is known to listen) is in the short part in the profile switch's W1.7. In the one-call, loop and window walks it is behind Show more, which the new definition allows: the short part is correct without it and does not claim the opposite.

**Show more opens and adds understanding,** such as the readiness gap, silent failures and repeat runs. But it is often a list: "Some consequences …", "Two cases the code allows", "Three points … worth checking". The definition says it is not an inventory; in practice it is close to one in several texts.

**Standard and Teacher.**
- **Prompts:** unchanged in substance in every path. The only changed line is the writer and reviewer roles' shared sentence, which now describes Essentials the new way (`prompts/`).
- **Texts:** Standard still explains the mechanism, and Teacher keeps its breadth. Their sizes vary within the sample spread (TEXTS.md section 4).

**The loop reviewer accepted the Essentials walk at once.** It did not ask for detail back, but it did not correct anything either, so its new checks were not exercised on a text that needed them.

## Checks

- **Static checks:** typecheck and build.
- **Targeted prompt and walk tests:** 134 pass.
- **Test groups:** presentation 317 pass and loop 675 pass. Review has 349 passing and 1 failing: `review-context.test.ts` fails on Windows on the code before this change too, as recorded in DSP-195.
- **Window trial:** the window trial with Claude (`profile-real-trial.mjs --case exec-debug --method single`) passed its 24 checks.

The follow trial with the simulated provider could not run. It drives the windows with real input and takes screen pictures, and another full-screen application was in front on the desktop at the time. Its pictures were deleted, since they showed the desktop. So the profile switch, regeneration and the return to the saved text were not exercised in real windows here. They are covered by the prompt tests and by the window trial's profile switch.

## Limits

- **Sample size:** one sample per path on one invented example.
- **Live coverage:** regeneration was not run live; its prompt is shown in `prompts/after-v12/essens-regenerate.md`.
- **Reviewer:** its behaviour on a too-long Essentials text was not observed.
- **Show more:** it still tends towards lists.
- **No release** was made; Niclas judges the form first.
