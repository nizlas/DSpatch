# DSP-198 · Can an editorial reviewer do the revision? Judgment

Two review calls, one per answer, run once each on 11 November 2026 in new sessions, through the product's Claude adapter for analysis. The script is `app/scripts/standalone-call.mjs`, which uses no product prompt builder. Claude was requested as `opus` and reported as `claude-opus-5-5` in every model turn. The answers are chosen in `SELECTION.md`, and the texts are in `TEXTS.md`.

The reviewer received:
- the task Niclas wrote (`review-task.md`);
- a neutral orientation;
- the step's code and the revisions;
- the original answer.

The checks in `run-*/call.md` pass: the filled prompt was sent once and unchanged, and no other text part or system prompt carries a DSpatch instruction. A search of both prompts for phrases of the hand revision, the assessment or the planner's briefs found only the word "brief" in the task's own "a brief editorial assessment". The model could read only the revisions folder, which holds the sample code. No retry was made.

Each text is judged against the code (the target revision of `app/tests/support/synthetic-exec-debug.ts`) and the reader's need: the step's role in the flow, for an experienced developer with the code beside the text. Similarity to the hand revision is not a criterion.

## W1.2 (the pre-launch task)

**Corrected.**
- **The factual error is fixed, with the right code references.** The original said the defaults mean a mismatch "wouldn't fail loudly". The defaults (script lines 5–6) apply only when a variable is unset. A wrong container name stops the script (lines 8–11), and a wrong port makes the attach fail (compose line 9, launch line 9).
- **No new factual errors.** The added statements are correct: the task runs on the host, the port's container and host sides, and the `env` block restating the defaults.

**Not corrected.**
- **The readiness implication stays.** "That gives the editor something to connect to", followed by "VS Code waits for this task to finish before it attaches. That works because the script starts debugpy in detached mode and returns straight away", still lets the reader conclude that the debugger is ready when the task ends. Nothing says that the task's end does not mean debugpy listens. This is the misleading simplification that matters most for this step's role.

**The level did not rise. It moved further into configuration.**
- **More configuration than before.** The revision keeps the label match. It turns the original's checklist into a list of how `orders-dev` and `5678` link to `compose.yaml` and `launch.json`, including which side of the port mapping each file uses, and adds a paragraph on the defaults and when the `env` block "matters".
- **The added material does not serve the role.** Each item is correct, but none of it changes the reader's understanding of what the step does in the flow. The text is longer than the original (1,401 characters against 1,004 for the explanation alone).

**Result: a failure on the main purpose.** The reviewer repaired the factual error well. It kept the misleading picture of readiness and replaced one configuration inventory with a more precise one.

## W1.7 (the detached start under debugpy)

**Corrected.**
- **The decisive consequence is sharper.** The original already said that nothing waits for debugpy. The reviewer adds what follows from it: "the attach can arrive before anything is listening". It also adds that "successful" means only that Docker accepted the command. Both prevent a real wrong conclusion: that the debugger is ready, or that a successful task means debugpy came up.
- **No new factual errors.** The process outlives the task, its output is not in the task terminal, and the task is not a background task: all correct (script line 24; `tasks.json` has no `isBackground`).

**Kept and added.**
- **The walk-through stays.** The flag-by-flag walk-through of `-d`, `0.0.0.0` and `--wait-for-client` is kept.
- **One more detail.** The point about output not reaching the task terminal is added. It is true but not central to the role.
- **Longer text.** The text grows (1,291 against 901 characters).

**Result: a modest improvement in accuracy, none in level.** The reviewer stated explicitly that it found no factual errors and judged the operation-level text a reasonable Essentials explanation. It did not use the room the task gave to remove implementation detail that obscures the role.

## What this shows, and what not

- **It shows that this reviewer task makes an agent correct factual errors well.** The W1.2 correction is precise and cites the code.
- **It shows that the agent does not, on its own, lift an operation-level text to an orientation.** In both cases it kept the walk-through and added material: configuration precision in W1.2, an output detail and qualifications in W1.7. The instruction not to expand "with every qualification" and to treat detail that obscures the role as a defect was not enough to make it remove material.
- **It shows that a misleading simplification can survive editing.** The W1.2 readiness implication was not caught, although the reviewer read the script and described the detached start.
- **It does not show how the product would behave.** These are two calls, one sample each, on one invented example. They do not show whether a different reviewer task, a reviewer told the step's role, or a loop with the writer would do better. No such variant was tried, as the task required.
