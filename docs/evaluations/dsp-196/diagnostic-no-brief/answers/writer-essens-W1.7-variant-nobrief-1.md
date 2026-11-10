This is the last thing the script does. It starts the orders service inside `orders-dev` under debugpy and hands control back to VS Code at once.

- **`-d` (detached):** `docker exec` returns as soon as the process has been started inside the container. The script therefore ends with exit code 0, and VS Code treats the pre-launch task as finished.
- **`--wait-for-client`:** debugpy opens its listener and then holds `orders.main` until a debugger connects. The service has not started yet when the script exits. It starts only after the attach in the next step (W1.8).
- **`--listen "0.0.0.0:$PORT"`:** debugpy listens on all interfaces inside the container. Listening only on the container's loopback would not be enough, because the editor connects from the host through the port that compose publishes.

**Nothing makes the script wait until debugpy is actually listening.** The task's exit code says only that `docker exec -d` could start the process, not that debugpy came up. If debugpy fails to start, or is slower than the editor's connect, the task has still succeeded. The failure would then appear when the editor tries to attach, not in the task output.

<!-- dspatch:details -->
A few more points from the code around this line:

- **Port values must match.** `$PORT` comes from `DEBUG_PORT`, which the task sets to `5678`. The mapping in compose.yaml (`"5678:5678"`, target lines 8–9) and `connect.port` in launch.json (target line 9) are both written as the fixed value 5678. Changing `DEBUG_PORT` alone would make debugpy listen on a port that is neither published nor the one the editor connects to.
- **Running as root.** There is no `-u` option, so the service runs as the container's default user. The `python:3.12-slim` image does not set a different user, which makes that root. The folder handed to the host user in W1.6 is therefore filled with files created by root. `orders.log` is one example (W1.9). Whether the host user can still edit those files depends on their permissions, not on who owns the folder.
- **Where the output goes.** Because the process is detached, its stdout and stderr are not attached to the task's terminal. The service's own output goes to the log file and to the debug session once the editor is attached.
- **How `-m orders.main` is resolved.** The module is found because the container's `working_dir` is `/workspace`, where the repository is bind-mounted (compose.yaml target lines 5–7). The code that runs is the host's current source.