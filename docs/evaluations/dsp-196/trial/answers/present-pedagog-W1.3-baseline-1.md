This is the first code that runs on the host after the editor starts the task. As [W1.2] showed, the task "Start debugger in dev container" runs this script with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in its environment. What the task needs back is one exit code: zero means "go ahead and attach", and anything else means "stop". These lines decide which settings the script uses and whether there is a container to work with at all. The script is new in this change; the base revision has no `scripts/` folder.

**Strict mode: how a failure gets back to VS Code.** By default, bash carries on after a command fails. `set -euo pipefail` changes three things:
- `-e`: the script exits as soon as a command fails.
- `-u`: using a variable that was never set is an error, not an empty string.
- `pipefail`: a pipeline such as `a | b` fails if any part fails, not only the last command.

This matters for the whole walk. Each later `docker exec` (W1.5–W1.7) can fail, and `-e` turns any such failure into a non-zero exit of the script. That makes the task fail, and the editor does not attach (that path is shown in [W2.2]). You can think of it as the shell version of "an unhandled exception ends the program".

**Defaults that also work with `-u`.** `${DEV_CONTAINER:-orders-dev}` means "use `DEV_CONTAINER` if it is set and not empty, otherwise use `orders-dev`". Because of the fallback, `-u` has nothing to complain about when someone runs the script by hand without these variables. The fallbacks are the same values the task passes, and `orders-dev` is also the `container_name` in the compose file ([W1.4]). So with or without the task, the script looks for the same container. `PORT` is not used here; it is used in [W1.7], where debugpy starts listening.

**The running check.** `docker inspect -f '{{.State.Running}}' NAME` looks up the object called NAME. The `-f` option takes a Go template that picks one field, so for a container it prints just `true` or `false`. The `$( … )` around it captures that output as a string, and `[ … != "true" ]` compares the string. The script continues only when the output is exactly `true`. Everything else goes into the `if`:
- **Container running:** the output is `true` and the script continues. This walk follows that case.
- **Container exists but is stopped:** the output is `false`. The script prints the hint to stderr (`>&2`) and runs `exit 1`. [W2.1] follows this branch.
- **No container with that name:** `docker inspect` fails, `2>/dev/null` discards its error message, and the captured output is empty. Empty is not `true`, so this ends in the same branch.

One thing that may look surprising under `-e`: in the last case, `docker inspect` fails, but the script does not exit at that point. The failing command is inside a command substitution that only builds an argument for `[`. Only the exit status of `[` counts, and bash does not apply `-e` to the condition of an `if`. That is why the script reaches its own clear message instead of dying silently.

<!-- dspatch:details -->

**Why "compare to `true`" is a safe design.** The check accepts one exact value instead of trying to recognise failure. So any outcome nobody planned for ends in the error branch, not in a script that carries on against a container that isn't there. A few cases that are not listed above show this:
- **Docker not installed, or the Docker daemon not running:** `docker inspect` fails and the output is empty. The script says "Container orders-dev is not running" and suggests `docker compose up -d`. That is the safe outcome, but the message points at the container when the actual cause is Docker itself. This is my reading of the code, not something I saw happen.
- **A non-container object with the same name:** without `--type container`, `docker inspect` can also match an image, a volume or a network. Those have no `.State`, so the template fails and the output is empty again. The result is still "not running", which is safe.
- **Container restarting or paused:** `.State.Running` describes the container's state flags, and the script trusts it as it is. This step does not check whether the container is healthy or ready, only whether Docker reports it as running.

**The port is set in more than one place.** `DEBUG_PORT` lets you change the port the script passes to debugpy. But the launch configuration connects to the fixed port `5678` (`.vscode/launch.json` lines 9 in target), and compose publishes `"5678:5678"` (`compose.yaml` line 9 in target). Changing only `DEBUG_PORT` in the task would make debugpy listen on a port that is neither published nor the one the editor connects to. This is an observation from reading the files, not a finding of the review. In practice, the variable is only safe to change together with those two places.

**What is known once these lines are done.** The variables are set, and Docker reported the named container as running when it was checked. Nothing locks that state in. If the container stops between this check and the later `docker exec` calls, those calls fail, and `-e` again ends the script with a non-zero code. The check gives a friendly message for the common case; strict mode handles the rest.

```dspatch-references
{"references": [{"label": "Strict mode, defaults and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that runs the script and sets the variables", "step": "W1.2"}, {"label": "Container name the default must match", "step": "W1.4"}, {"label": "Where PORT is used", "step": "W1.7"}, {"label": "Fixed port the editor connects to", "path": ".vscode/launch.json", "side": "target", "start": 9, "end": 9}, {"label": "Published port in compose", "path": "compose.yaml", "side": "target", "start": 8, "end": 10}, {"label": "The not-running branch", "step": "W2.1"}, {"label": "Failed task blocks the attach", "step": "W2.2"}], "insufficient": false}
```