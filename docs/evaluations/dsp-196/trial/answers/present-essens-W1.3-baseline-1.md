This is the script's guard step. It is new in this change, as is the whole script; the base revision has no `scripts/` folder. As we saw in [W1.2], the pre-launch task runs the script with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. Here the script settles those two values. Then it refuses to go on unless the container is actually running. The script doesn't start the container itself; that stays a manual `docker compose up -d dev`.

What matters for the walk:

- **The script fails fast.** `set -euo pipefail` makes the script exit with a non-zero code when any later `docker exec` step fails. The task's result is the script's exit code, and VS Code attaches only if the task succeeds. So any failure in this script, including this check, stops the attach.
- **The defaults only apply when you run the script by hand.** The fallbacks `orders-dev` and `5678` are the same values the task passes. `PORT` isn't used in this step; it's used when debugpy starts listening in [W1.7].
- **The check passes only on an exact `true`.** If the container is running, the walk continues. If the container is stopped or doesn't exist at all, the check fails the same way: the script prints a hint to stderr and exits with 1. That branch is followed in [W2.1].

The name `orders-dev` matches the `container_name` that the compose file sets for the `dev` service, shown in the next step [W1.4].

<!-- dspatch:details -->

**Why a missing container fails the check too.** For a container that doesn't exist, `docker inspect` fails, and `2>/dev/null` discards its error message. Its stdout is then empty, so the comparison with `"true"` fails. Strict mode doesn't stop the script there: the failure happens inside a command substitution that is part of an `[ … ]` test, and `-e` doesn't apply in an `if` condition. So control reaches the hint in both cases. A side effect is that other `docker inspect` failures look exactly like "not running" — for example, Docker not being reachable at all. Either way the user gets the same `docker compose up -d dev` hint.

**`DEBUG_PORT` changes only one end of the connection (observation).** `DEBUG_PORT` changes only the port debugpy listens on inside the container. The compose file publishes `5678:5678`, and the debug configuration connects to `localhost:5678`. Both are fixed values. If the task passed a different port, the script would still run without error, but VS Code would not be able to connect. Today the values match, so this only matters if someone changes one of them.

```dspatch-references
{"references": [{"label": "Strict mode, defaults and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "How the task starts the script", "step": "W1.2"}, {"label": "The container the script expects", "step": "W1.4"}, {"label": "Where PORT is used", "step": "W1.7"}, {"label": "The not-running branch", "step": "W2.1"}, {"label": "Published debug port is fixed at 5678", "path": "compose.yaml", "side": "target", "start": 8, "end": 9}, {"label": "Attach connects to port 5678", "path": ".vscode/launch.json", "side": "target", "start": 9, "end": 9}], "insufficient": false}
```