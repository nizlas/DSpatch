The script is new in this change; the base revision has no `scripts/` folder. As we saw in [W1.2], the task "Start debugger in dev container" runs it before VS Code attaches. This first part decides which container the remaining `docker exec` calls go to, and makes sure there is a running container to send them to.

**Which container and port.** `${VAR:-default}` uses the default when the variable is unset *or* empty. The task sets `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`, and the defaults are the same values. So running the script from a terminal behaves just like running it through VS Code. `orders-dev` matches the `container_name` in `compose.yaml`, which the next step [W1.4] shows.

**Strict mode.** `set -euo pipefail` sets three options:
- `-e`: stop at the first failing command.
- `-u`: treat an unset variable as an error.
- `-o pipefail`: a pipeline fails if any command in it fails.

`-e` matters most for the later steps. If `pip install`, `mkdir`, `chown` or the final `docker exec -d` fails, the script ends with a non-zero code, and VS Code treats the pre-launch task as failed.

**The running check.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false`. Any output other than `true` leads to the hint on stderr and `exit 1`. There are two failing cases:
- **Stopped container:** the output is `false`.
- **Container that doesn't exist:** `docker inspect` fails. `2>/dev/null` hides its error and the substitution gives an empty string.

`set -e` doesn't stop the script on the failed `docker inspect`. The failure happens inside a command substitution that is only an argument to `[`, and `-e` looks at the exit status of `[`. So the script reaches the `if` and prints its own hint, not a raw Docker error. The same is true when the `docker` command itself is missing: Docker's error text is hidden, and the developer sees "is not running".

This walk continues on the branch where the check passes. Walk W2 follows the failing branch ([W2.1]).

<!-- dspatch:details -->

**The port setting only reaches one of three places.** In the script, `PORT` is used only in the final `debugpy --listen "0.0.0.0:$PORT"` (target `scripts/start-debugger.sh` line 24). Two other places have `5678` written in directly:
- `compose.yaml` publishes `"5678:5678"`.
- `launch.json` connects to `localhost:5678`.

So if you change `DEBUG_PORT` in the task alone, debugpy listens on a port that isn't published, and the attach fails. I'm noting this from reading the code, not as a confirmed problem. The defaults and the task values agree, so nothing breaks as the code stands.

**What the check doesn't cover.** It only checks that a container with that name is running. It doesn't check that it was started from this project's compose file, or that `/workspace` is this workspace. Any running container named `orders-dev` passes. Later steps rely on the bind mount (`.:/workspace` in `compose.yaml`) for the log folder and for `orders.main` to import.

```dspatch-references
{"references": [{"label": "Settings and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that runs the script", "step": "W1.2"}, {"label": "The container the script expects", "step": "W1.4"}, {"label": "Only use of PORT", "path": "scripts/start-debugger.sh", "side": "target", "start": 24, "end": 24}, {"label": "Port fixed in launch.json", "path": ".vscode/launch.json", "side": "target", "start": 9, "end": 9}, {"label": "Port fixed in compose.yaml", "path": "compose.yaml", "side": "target", "start": 8, "end": 10}, {"label": "Failing branch", "step": "W2.1"}], "insufficient": false}
```