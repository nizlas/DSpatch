This is the script's guard. It uses the settings from `DEV_CONTAINER` and `DEBUG_PORT` (with defaults), then checks that the container is already running. If it isn't, the script stops at once with a hint. **The script never starts the container. It expects someone to have run `docker compose up -d dev` first.**

Recall from W1.2 that the pre-launch task runs this script with both variables set. The script's exit code is the task's result. Because of `set -euo pipefail`, a failed `docker exec` in any later step also ends the script with a non-zero code. Every failure in this walk therefore reaches VS Code the same way, and VS Code then skips the attach.

The check passes only when `docker inspect` prints exactly `true`. Two other cases fail it:
- The container exists but is stopped.
- No container has that name. The error is discarded, so the output is empty.

In both cases the script prints the hint to stderr and exits with 1. W2 follows that branch. In this walk the container is running, so the script goes on to set up debugpy (W1.5). The next step (W1.4) shows that `orders-dev` is the `container_name` set in the compose file.

<!-- dspatch:details -->

**The defaults only matter for manual runs.** `${VAR:-default}` also covers a variable that is set but empty, and it keeps `-u` from failing when the script runs outside the task. The task passes the same values as the defaults (`orders-dev`, `5678`), so the fallbacks only apply when someone runs the script by hand.

**`DEBUG_PORT` doesn't change the port end to end (my observation from the target files).** `PORT` is used in only one place: debugpy's `--listen "0.0.0.0:$PORT"` inside the container (W1.7). Two other settings fix the port at 5678 on their own:
- the compose file publishes `"5678:5678"`
- the launch configuration connects to `localhost` port `5678`

If you changed only `DEBUG_PORT` in the task, debugpy would listen on a port that is neither published nor the one VS Code attaches to. The variable looks like a knob, but in practice it has to stay at 5678 unless all three places change together.

**The check doesn't use the compose service name.** It looks up the container by name (`container_name: orders-dev`), not by `dev`. If the container was started under a different name, it fails even when the service is running.

**The script is new in this change.** The base revision has no `scripts/` folder, so there is no earlier version to compare with.

```dspatch-references
{"references": [{"label": "Settings and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that runs the script with the environment", "step": "W1.2"}, {"label": "The container the script expects", "step": "W1.4"}, {"label": "Where PORT is used", "step": "W1.7"}, {"label": "Published port in compose", "path": "compose.yaml", "side": "target", "start": 8, "end": 10}, {"label": "Attach port in launch config", "path": ".vscode/launch.json", "side": "target", "start": 9, "end": 9}, {"label": "The failing branch", "step": "W2.1"}], "insufficient": false}
```