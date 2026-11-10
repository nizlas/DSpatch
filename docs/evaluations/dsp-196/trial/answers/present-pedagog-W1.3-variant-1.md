This step is the script's first check. In the previous step [W1.2], the pre-launch task started `start-debugger.sh` with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in its environment. The task needs one thing back from the script: its **exit code**. Exit code 0 means success and VS Code goes on to attach. Any other code means failure and the attach does not happen. Everything in these lines helps make that exit code tell the truth. The whole script is new in this change; the base revision has no `scripts/` folder.

**Strict mode turns failures into a non-zero exit.** By default, bash keeps going after a command fails, and the script's exit code is the status of whatever ran last. A failed `docker exec` in the middle could then be hidden by a later command that succeeds. `set -euo pipefail` changes three rules:
- `-e`: stop as soon as a command fails.
- `-u`: treat use of an unset variable as an error.
- `pipefail`: a pipeline fails if any command in it fails, not only the last one.

This script has no pipes, so `pipefail` is just a precaution. The rule that matters is `-e`: if a later `docker exec` step fails (W1.5–W1.7), the script ends right there with a non-zero code.

**Defaults through parameter expansion.** `"${DEV_CONTAINER:-orders-dev}"` means "use the value of `DEV_CONTAINER` if it is set and not empty, otherwise use `orders-dev`". This form is also allowed under `-u`, so you can run the script by hand without setting either variable. The defaults are the same values the task passes, so they only matter for manual runs. `PORT` is not used here; the last step that runs inside the container uses it [W1.7].

**The running check.** `docker inspect -f '{{.State.Running}}' NAME` looks up the container and prints one field of its state. The `-f` argument is a Go template, and the result is the text `true` or `false`. `$( … )` captures that output as a string, and `[ … != "true" ]` compares it. There are three cases:
- **Running:** the output is `true`, the test is false, and the script continues. This walk follows that case.
- **Exists but stopped:** the output is `false`. The script prints the hint to stderr (`>&2`) and runs `exit 1`. The other walk, "When the dev container is not running", follows this branch [W2.1].
- **No container with that name:** `docker inspect` fails and writes an error. `2>/dev/null` discards the error, so the captured string is empty. Empty is not `"true"`, so the script takes the same exit-1 branch.

The name `orders-dev` is not arbitrary. It matches the `container_name` that the compose file gives the `dev` service, as the next step shows [W1.4].

<!-- dspatch:details -->

**Why `-e` does not stop the script when `docker inspect` fails.** In the "no such container" case, the `docker inspect` command fails, yet the script does not stop at line 8 and prints its own message instead. Two rules explain this:
- Bash ignores `-e` for any command that is the condition of an `if`.
- The status `[` reports comes from the comparison, not from the command inside `$( … )`.

So a failed `docker inspect` here only produces an empty string, and the explicit `exit 1` ends the script. That is the intended behaviour: the reader gets the `docker compose up -d dev` hint instead of Docker's raw error. The same rule explains the debugpy check in a later step [W1.5], which uses `if ! docker exec …` on purpose so that a failure means "not installed" and does not abort the script.

**What `exit 1` causes.** VS Code sees a non-zero exit from the pre-launch task and does not attach. The other walk shows that effect [W2.2]. The message goes to stderr so it shows as an error in the task terminal and does not mix with normal output.

**What the check does not guarantee.** These are my own reading of the code, not something verified by running it:
- The check is a single snapshot. If the container stops between line 8 and the later `docker exec` calls, those calls fail and `-e` ends the script with a non-zero code. The attach is still blocked, but the reader sees Docker's error and not the friendly hint.
- An exact match on `"true"` also sends a paused container down the "not running" path only if Docker reports `false` for it. As far as I know, `State.Running` stays `true` for a paused container, so the check would pass and a later `docker exec` would fail. Nothing in this repository settles that point.

```dspatch-references
{"references": [{"label": "Strict mode, defaults and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that runs the script with the environment", "step": "W1.2"}, {"label": "Container name the default matches", "step": "W1.4"}, {"label": "Same if-condition pattern for the debugpy check", "step": "W1.5"}, {"label": "Where PORT is used", "step": "W1.7"}, {"label": "Branch when the container is not running", "step": "W2.1"}, {"label": "Failed task blocks the attach", "step": "W2.2"}], "insufficient": false}
```