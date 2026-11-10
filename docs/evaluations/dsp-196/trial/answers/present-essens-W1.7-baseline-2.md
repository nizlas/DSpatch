This line is where the script hands control to another process. `docker exec -d` starts `python -m debugpy … -m orders.main` inside the container and returns as soon as the exec has been created. The script then reaches its end and exits 0. The pre-launch task (W1.2) has no background or readiness matcher, so VS Code treats it as finished and goes on to attach (W1.8). The debugpy process keeps running in the container, which stays alive because of `sleep infinity` (W1.4).

What the started process does:

- **Listens on all interfaces in the container** (`0.0.0.0`). The editor connects to `localhost:5678` on the host, and compose forwards that port into the container. A listener bound only to the container's own localhost would not receive that traffic.
- **Waits for a client before running `orders.main`.** The service code does not run until the editor has attached. Anything written before that point, such as the log file in W1.9, has not happened yet.

**The decisive point is that nothing makes the attach wait for the listener.** The script exits without checking that debugpy has bound the port. VS Code's attach and debugpy's start-up therefore run in parallel, and either can come first. If the attach is first, the connection is refused, or (depending on how Docker forwards the published port) dropped. Whether the attach retries is up to the debugpy extension, not this code.

<!-- dspatch:details -->

The task can report success in cases where the service never started. A detached `docker exec` reports only whether the process could be started in the container. It does not report what the process does afterwards. The following cases all leave the task green and show up only as a failed or hanging attach:

- **debugpy dies at start-up**, for example because the port is taken or an import fails. Its output goes nowhere the editor can see.
- **A run from an earlier session is still alive.** Its debugpy may still hold port 5678. In that case the new process cannot bind, and the editor may attach to the old process instead.
- **The ports don't match.** `DEBUG_PORT` can be overridden (tasks.json sets it to `5678`, which is also the script's default). But compose publishes a fixed `5678:5678`, and launch.json connects to the fixed port `5678`. Changing the variable alone moves the listener without moving the other two.

This script is new in this change. The base revision has no `scripts/` folder and no `tasks.json`.

```dspatch-references
{"references": [
  {"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24},
  {"label": "Port default and override", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6},
  {"label": "Task that runs the script, no readiness matcher", "step": "W1.2"},
  {"label": "Container kept alive and port published", "step": "W1.4"},
  {"label": "Attach to localhost:5678", "step": "W1.8"},
  {"label": "The released service writes its log", "step": "W1.9"},
  {"label": "Task env sets DEBUG_PORT", "path": ".vscode/tasks.json", "side": "target", "start": 8, "end": 9},
  {"label": "Fixed published port", "path": "compose.yaml", "side": "target", "start": 8, "end": 9}
], "insufficient": false}
```