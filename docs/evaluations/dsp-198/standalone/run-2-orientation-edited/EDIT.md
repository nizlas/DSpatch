# An editorial revision of the second standalone answer (DSP-198)

The answer in `../run-2-orientation/answer.md` (commit c52bccd), revised once by hand on 11 November 2026 and checked against the code of the target revision. No model was called, and the original is unchanged. The code is the invented example's: `.vscode/tasks.json` lines 4–10 (the step), `scripts/start-debugger.sh`, `.vscode/launch.json` and `compose.yaml`.

## The revised answer

> This task is what the debug configuration runs before it attaches. It hands the start script the container name and the debug port, and the script does the work: it starts the orders service under the debugger inside the dev container, which must already be running, and the debugger holds the service until the editor connects.
>
> VS Code treats the task as finished when the script exits, and the script exits as soon as it has handed that start to the container. So a finished task does not by itself mean the debugger is ready to accept a connection.

The text alone is in [`answer-edited.md`](answer-edited.md).

## The original, statement by statement

Each statement of the original is classified as one of three things:
- **factual error:** the code does not support it;
- **misleading simplification:** a reader draws a wrong conclusion that matters for the step's role or behaviour;
- **legitimately omitted detail:** the detail is in the code but is not needed for the orientation.

Each change names the wrong conclusion it prevents.

**"This task is what the debug configuration from the previous step runs before it attaches."** Correct and central: `launch.json` line 8 names the task as `preLaunchTask`. Kept.

**"Its job is to get the orders service running under the debugger inside the already-running dev container, so the editor has something to connect to."** Two misleading simplifications.
- **"Running" is too strong.** The script starts debugpy with `--wait-for-client` (line 24), so the service's own code does not run until the editor connects. The wrong conclusion it leads to: that the service is up and serving when the task ends. The revision says the debugger holds the service until the editor connects.
- **The sentence implies the debugger is ready.** "So the editor has something to connect to" suggests that when the task ends, the debugger is there to connect to. In fact VS Code treats this task as finished when the script exits (it is not a background task), and the script exits as soon as `docker exec -d` has handed the start over (line 24, the last line). Nothing waits for debugpy to listen. The wrong conclusion it leads to: that the attach cannot come too early, so a first failed attach would be looked for in the wrong place. The revision adds one sentence on this; it is the one consequence of this step that the main picture needs.

"Already-running dev container" is correct: the script stops if the container is not running (lines 8–10). The revision keeps it as "which must already be running".

**"The task itself does very little. It names the start script and gives it the container name and port to use, and the script does the actual work."** Correct (lines 7–8 of the task). Kept in shorter form.

**The list of the label, the port and the container name, "for this to stay accurate".** The facts are correct but not needed here, so the list is a legitimately omitted detail.
- **The label match** is visible in both files, and the first sentence already says the configuration runs this task.
- **The port and the container name** written in several files are a maintenance risk. They do not decide what this step does, and the steps that show `compose.yaml` and the attach show them.

Leaving the list out leads the reader to no wrong conclusion about the step's role. The original's heading for it, "For this to stay accurate", also misreads the task's request for a condition: the condition that keeps this summary accurate is the readiness gap, not the consistency of the values.

**"The script falls back to these same values if the variables aren't set. That means a mismatch introduced here wouldn't fail loudly; the editor would simply try to attach to the wrong place."** A factual error.
- **The fallback does not apply.** The defaults on script lines 5–6 apply only when a variable is unset or empty. A value changed in the task is passed to the script, so the fallback has nothing to do with a mismatch introduced here.
- **"Wouldn't fail loudly" is wrong for two of the three values.** A changed label makes VS Code report that it cannot find the task. A changed container name makes the script stop with its "not running" message and exit 1 (lines 8–10).
- **Only a changed port goes unnoticed until the attach.** debugpy then listens on a port compose does not publish (`compose.yaml` line 9), while the editor still connects to 5678 (`launch.json` line 9).

The sentence is removed rather than corrected, since the list it qualifies is not needed either.

## What is left out, and why that is legitimate

Not one of the following changes what this step does in the flow, and none of them, left out, leads to a wrong conclusion about it:
- the label match;
- the duplicated port and container name;
- the empty `problemMatcher`;
- debugpy being installed when it is missing (script lines 13–16);
- the log folder's ownership (lines 18–21);
- the failure path when the container is not running, which the walk follows in its own branch; "which must already be running" keeps the condition;
- how the script would run on a Windows host.

The code beside the text shows the task's fields, and later steps or questions can take up the rest.

## For a future reviewer of Essentials

This one case suggests a rule a reviewer can apply without turning Essentials into a walk-through:
- **A finding must name the wrong conclusion.** It names the conclusion the text leads the reader to, and shows in the code why it is wrong. That is either a factual error or a misleading simplification.
- **The fix is the smallest one that removes that conclusion.** Here that was one word ("holds" instead of "running") and one sentence (the readiness gap).
- **A detail that is only missing is not a finding.** A detail that is in the code, correct or interesting is no finding unless its absence leads to a wrong conclusion. That includes every failure path, every field and every repetition of a value.
- **Extra material can be a finding too.** In this answer, the field list and the fallback sentence made the text both longer and wrong.

This is one edit of one answer by hand. It shows what a corrected Essentials text for this step can look like. It says nothing about how reliably the product would produce one.
