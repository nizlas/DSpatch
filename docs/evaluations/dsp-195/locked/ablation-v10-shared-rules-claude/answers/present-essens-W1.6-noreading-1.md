Once the pre-launch task has started the container, this part of the configuration tells VS Code how to reach the debugger that is already running inside it. **VS Code starts no Python process here.** In the base revision, the configuration was a `launch` that ran `service/main.py` on the host. In the target, it only connects to a listener that the container started.

The attach depends on three settings in different files agreeing with each other:

- **Address:** `connect` points at `localhost:5678`. That reaches the container only because Compose publishes `"5678:5678"`, and because debugpy inside the container listens on `0.0.0.0` rather than only on its own loopback interface (see W1.5).
- **Paths:** debugpy reports files as Python sees them inside the container. `pathMappings` translates `/app/service` to `${workspaceFolder}/service`, so breakpoints set in the editor match the running code. The `remoteRoot` has to match the Dockerfile's `COPY service /app/service` (W1.4). If either one changes alone, breakpoints silently stop binding.
- **Library code** (`justMyCode: false`, just below the shown lines): the debugger can also stop in library code, such as `http.server`, not only in the project's files.

**Timing (my reading, not verified at runtime):** the Compose command has no `--wait-for-client`, so the service doesn't pause for the debugger and runs as soon as the container starts. Breakpoints in code that runs before VS Code attaches will not be hit. Also, `docker compose up -d` returns once the container has started, not once debugpy is listening. So the first attach could in principle try to connect before the port is open.

<!-- dspatch:details -->

The pre-launch task is `docker compose up -d --build service`. It rebuilds the image on every debug start and runs detached. That is why VS Code can go on to attach instead of blocking on the task. Nothing in these files checks that port 5678 is ready. Whether the first attach succeeds depends on how quickly debugpy opens the listener compared with how quickly VS Code connects after the task ends.

Only one mapping is given, for `service/`. Files outside `/app/service`, such as the container's standard library, have no local counterpart. With `justMyCode: false` the debugger can still step into them, but those frames don't map to workspace files.

```dspatch-references
{"references": [
  {"label": "Attach configuration (connect, pathMappings, justMyCode)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: launch configuration running main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task", "step": "W1.2"},
  {"label": "Port publishing", "step": "W1.3"},
  {"label": "COPY destination that remoteRoot must match", "step": "W1.4"},
  {"label": "debugpy listen command without --wait-for-client", "step": "W1.5"}
], "insufficient": false}
```