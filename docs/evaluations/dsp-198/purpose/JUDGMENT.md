# DSP-198 purpose trial · Judgment

**Question:** does a description of what Essentials is for, and why leaving correct detail out is part of the job, help the model choose the level?

**Setup:**
- Four generations, one per step and variant, each in a new session.
- The product's Claude adapter for analysis, through `app/scripts/standalone-call.mjs` with no product prompt builder.
- Claude, requested `opus`, reported `claude-opus-5-5` in every model turn.
- Within a step, A and B differ only in the writing task (`prompt-<step>-A.md` and `prompt-<step>-B.md`). W1.2's A is character for character `../standalone/prompt-2-orientation.md`. The checks in `run-*/call.md` pass: only the prompt came from DSpatch.

This is a first diagnostic, one sample per cell. The texts are in `TEXTS.md`. Each is judged against the target revision of `app/tests/support/synthetic-exec-debug.ts` and the reader's need: the step's role in the flow, with the code beside the text. Length is an observation only.

## The facts these texts turn on

- **Why VS Code waits.** The task (`tasks.json`) is not a background task, so VS Code waits for the script to exit before attaching. The empty `problemMatcher` only means the output is not scanned; it is not why VS Code waits.
- **When the script exits.** The script's last line starts debugpy with `docker exec -d` and exits at once (`start-debugger.sh` line 24). Nothing waits for debugpy to listen, so a finished task does not mean the debugger is ready.
- **The port.** debugpy listens on `$PORT` inside the container. Compose publishes only `5678:5678` (`compose.yaml` line 9), and the editor connects to `localhost:5678` (`launch.json` line 9).

## W1.2, the pre-launch task

**A.**
- **Misleading main picture.** It closes its first paragraph with "So the task's job is to make sure a debug server is waiting for the editor before the attach happens". The task makes sure of no such thing; the script returns as soon as the start is handed off. A reader concludes that the debugger is ready when the attach starts.
- **Factual error.** "With an empty `problemMatcher`, VS Code waits for the task to finish" gives the wrong cause.
- **Organisation.** After a role-first opening the text becomes a checklist: "This only holds if a few things stay true:", with the label, the port, the container and the task finishing.

**B.**
- **Opens with the role,** without a checklist: "This task is the link between the debug configuration and the start script … VS Code runs this task first and attaches only after the task has finished".
- **Correct cause.** It names it rightly: "It is not a background task, and the empty `problemMatcher` means VS Code doesn't scan the output".
- **A misleading simplification about the port.** "The port matters most here", and `DEBUG_PORT` "has to match the `connect.port` in `launch.json`, because debugpy will listen on that port inside the container and the editor will try to connect to it." That treats the container port and the host port as one. Matching the two numbers is not enough, because compose publishes only 5678. It also makes a configuration value the step's central point.
- **Still walks the fields.** The label, the host shell, the two environment variables, the defaults, `isBackground` and `problemMatcher` all appear. They are written as prose with reasons, not as a list.
- **Readiness is not claimed.** "debugpy then waits for the editor to connect" leans that way only mildly. No addition is required there, because no stronger wrong conclusion follows from the text.

## W1.7, the detached start under debugpy

**A** (718 characters).
- **The most role-oriented of the four.** "This line starts the orders service inside the running dev container, but holds it back until the editor connects. The script returns right away."
- **Misleading main picture.** It goes on: "The service then waits in the background, so the editor can attach (W1.8) before any of `orders.main` runs". A reader concludes that the debugger is listening when the editor attaches. This step is where that gap is created, so here it is central.
- **Condition.** It chose the port's consistency as its condition: correct, but not the one that keeps the main picture accurate.

**B.**
- **Explains why each flag is needed.** It frames the step as handing "control from the script to the editor". Without `-d` the task would never end and the attach would never start. `--wait-for-client` means "breakpoints in startup code still get hit". That is understanding beyond reading the line, organised around how the two flags depend on each other, not around the operations alone.
- **The same readiness implication.** "Together, the script exits straight away and the service waits for the editor."
- **Two side details.** It adds "Two smaller points": the `0.0.0.0` listener with the port mapping, and the root user with the log folder. Both are correct, and B itself calls them smaller. They do not change the understanding of this step.
- **No factual errors.**

## Comparison

- **The purpose description changed how the texts are organised more than what they select.** In W1.2 it removed A's checklist and its wrong claims about the cause and about readiness. In W1.7 it produced an explanation of why the two flags are there rather than a summary. B did not leave out more correct detail. It labelled some of it "smaller" and kept it.
- **It did not bring the decisive condition.** None of the four texts says that a finished task does not mean the debugger listens. Two of them say the opposite: W1.2 A outright, W1.7 A by implication. The texts that do this do so whether or not they are short.
- **Neither variant produced dense sentences that still list everything.** The detail that remains is in plain paragraphs or short lists. Length does not separate the variants: 1,256 and 1,290 characters for W1.2; 718 and 1,415 for W1.7.

## What this shows, and what not

It suggests that explaining the purpose moves the model from conditions and checklists towards reasons and relationships. That is a change in organisation. It does not suggest that the purpose description alone makes the model leave correct detail out, or state the one condition that keeps the picture accurate.

One sample per cell on one invented example cannot separate the effect of the task from sample variation. A's W1.2 here differs from the earlier run of the same prompt in `../standalone/run-2-orientation/`. No rewrite, retry or further variant was made.
