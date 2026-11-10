This is the handoff point. The script's last command starts debugpy as a **separate, detached process inside the container** and does not wait for it. Then the script reaches its end and exits 0, so the pre-launch task succeeds and VS Code moves on to attach (next step, W1.8).

Two things now happen in parallel:

- **In VS Code:** the editor goes ahead with the `connect` target from W1.1.
- **In the container:** debugpy starts up, listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects. The service's own setup only runs after the attach (W1.9).

What this means for judging the change: **the task's success only shows that the process was launched. It doesn't show that debugpy is listening.** Because of `-d`, nothing debugpy writes reaches the task terminal. If debugpy fails to import or the port is already taken, the task still succeeds, and the developer only notices when the attach fails.

<!-- dspatch:details -->
**Exposure.** `--listen 0.0.0.0` is needed so that compose's port publishing can reach debugpy inside the container. But compose publishes `"5678:5678"` with no host address (compose.yaml, target line 9), so the debug server is reachable on all host interfaces, not only on localhost. Nothing in this code configures authentication for it, and a debugpy connection can run arbitrary code in the container, which runs as root.

**Port coupling.** `$PORT` comes from the task's `DEBUG_PORT`. Compose publishes only container port 5678. If `DEBUG_PORT` is set to anything else, debugpy listens on a port that isn't published.

**Repeated runs.** The script doesn't look for a debugpy or service process left over from an earlier run. Starting the configuration again while one is still alive launches a second debugpy that tries to bind the same port. Since its output is detached, that failure is only visible through a failed or misdirected attach.

**Module resolution.** `-m orders.main` resolves because the container's `working_dir` is `/workspace`, the bind-mounted repository root (compose.yaml, target lines 5 and 7).