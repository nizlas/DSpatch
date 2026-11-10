This is the script's first gate. The pre-launch task from [W1.2] starts it with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` set. Before the script runs anything inside a container, it makes sure the container is there and running. The whole script is new in this change: the base revision has no `scripts/` folder.

**How the check works.** `docker inspect -f '{{.State.Running}}'` prints the Go-template field `State.Running` of the named container. That is the text `true` or `false`. The `$(...)` captures this output, and `[ ... != "true" ]` checks for the exact string `true`. Anything else counts as "not running":

- **Stopped container:** the output is `false`.
- **No such container:** `docker inspect` fails. `2>/dev/null` hides its error message, and the captured output is empty.

Both cases print the same hint on stderr (`>&2`) and end with `exit 1`. VS Code then reports the task as failed, which is walk [W2.1]/[W2.2].

**How this fits with `set -euo pipefail`.** `-e` stops the script at the first failing command, and later steps rely on that. Here, though, a failed `docker inspect` does not stop the script. It runs inside a command substitution that is an argument to `[`. Only `[`'s own exit status counts, and that status is the result of the string comparison. So this part reports a missing container through the explicit comparison, not through `-e`. `-u` makes the script fail if it reads a variable that was never set. `${VAR:-default}` avoids that and also covers a variable that is set but empty.

**The settings.** `CONTAINER` falls back to `orders-dev`, which is the `container_name` of the `dev` service in the compose file (next step, [W1.4]). The hint's `docker compose up -d dev` starts exactly that service. `PORT` falls back to `5678`, which is what the task passes. So the script behaves the same when you run it by hand.

<!-- dspatch:details -->

**`PORT` only looks configurable.** Here `PORT` is only read. Its one use is the port debugpy listens on inside the container ([W1.7]). The other two places that depend on it are fixed. The compose file publishes `"5678:5678"`, and the debug configuration connects to `localhost` port `5678` ([W1.8]). If you change `DEBUG_PORT` in the task alone, debugpy listens on a port that is neither published nor the one VS Code dials, and the attach fails. The same applies to `DEV_CONTAINER`: the hint always says `docker compose up -d dev`, but the compose service only creates a container named `orders-dev`. The variable lets you point the script at another container, but the hint would then be wrong.

**A misleading message in one more case.** The only thing the check looks at is the captured output. So the "not running" hint also appears in these cases:

- `docker` is not on the `PATH`.
- The Docker daemon is not reachable.
- The user has no permission to talk to it.

In all of them stderr is discarded, the output is empty, and the developer is told to start the container, which also fails. This is an observation about the code's behaviour, not something the review has marked as a finding.

**Running is not the same as ready.** The check passes once `State.Running` is `true`. The compose service's command is `sleep infinity`, so "running" here means the container is idle and ready for `docker exec`. The script doesn't expect the service to be up yet, because it starts the service itself in a later step.

```dspatch-references
{"references": [{"label": "Settings and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that starts the script and sets the variables", "step": "W1.2"}, {"label": "The dev container the check expects", "step": "W1.4"}, {"label": "Only use of PORT: debugpy's listen address", "step": "W1.7"}, {"label": "VS Code connects to a fixed port 5678", "step": "W1.8"}, {"label": "Failing branch of this check", "step": "W2.1"}, {"label": "Compose publishes 5678 to 5678 and idles with sleep infinity", "path": "compose.yaml", "side": "target", "start": 8, "end": 11}], "insufficient": false}
```