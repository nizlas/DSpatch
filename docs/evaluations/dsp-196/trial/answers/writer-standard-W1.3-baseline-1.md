The task from the previous step started this script with `DEV_CONTAINER` and `DEBUG_PORT` in its environment. Before the script runs anything in the container, it settles those two values and makes sure the container is up.

**Strict mode.** `set -euo pipefail` makes the script stop at the first command that fails (`-e`). It also turns the use of an unset variable into an error (`-u`), and makes a pipeline fail when any part of it fails (`pipefail`). This matters for the whole walk: the script's exit code is the task's result, and VS Code uses that result to decide whether to attach. Any failure in the later `docker exec` steps therefore ends the script with a non-zero code, and VS Code does not attach.

**Defaults.** `${DEV_CONTAINER:-orders-dev}` and `${DEBUG_PORT:-5678}` use the value from the environment if it is set and not empty, and the fallback otherwise. The `:-` form also keeps `-u` from failing when the script runs outside the task. The defaults match what the task passes, so they only matter when someone runs the script by hand. `PORT` is not used in the check. It is used later, when debugpy starts listening (W1.7).

**The running check.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false` for an existing container. The script continues only if the output is exactly `true`:
- If the container is running, the output is `true`, and the script continues. This walk follows that case.
- If the container exists but is stopped, the output is `false`. The script prints the `docker compose up -d dev` hint to stderr and exits with 1. W2 follows this branch.
- If no container has that name, `docker inspect` fails. Its error message is discarded by `2>/dev/null` and its output is empty, so the comparison goes to the same branch.

<!-- dspatch:details -->
**Why `-e` doesn't stop the script on a failed inspect.** `docker inspect` fails for a missing container, but `-e` does not end the script there. The failing command runs inside `$(...)`, and its output is only an argument to the `[` test in an `if` condition. Bash does not apply `-e` to commands in an `if` condition, so the failure just becomes an empty string that the test compares.

**Other failures get the same hint.** Reading the code, I expect a few other failures to end up in the "not running" branch too. This is my inference, not something I ran:
- The Docker daemon is not reachable.
- The `docker` command is not installed. Bash's "command not found" message goes to the redirected stderr as well.
- `docker inspect` finds a different kind of Docker object with that name, for example an image called `orders-dev`. That object has no `.State.Running`, so the template fails and the output is not `true`.

In each case the developer sees the hint to start the container, even though the real cause is something else.

The container name `orders-dev` that the default and the task both use is defined by `container_name` in the compose service. The next step shows that service.