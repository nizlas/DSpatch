This is the core change in the debug setup. In the base revision the only configuration, "Run the service", used `"request": "launch"`. VS Code started `service/main.py` itself on the host, in the integrated terminal. In the target revision that entry is replaced by **"Attach to the service in the container"** with `"request": "attach"`.

**With attach, VS Code no longer starts the program.** It connects to a Python process that is already running and already has a debugpy listener open. `"type": "debugpy"` is unchanged, so the same Python debugger extension is used. Only its role changes, from starting the process to connecting to one.

Something else now has to start the service. That job falls to the `preLaunchTask` directly below these lines, which names the task labelled "Start the service container". VS Code runs that task first and attaches only after it has finished. The rest of this walk follows that path: the task, Compose, the image, the debugpy listener, and finally the connection back from VS Code.

<!-- dspatch:details -->
Attaching depends on three settings in the rest of this entry, which W1.6 covers:
- `connect` points at `localhost:5678`.
- `pathMappings` maps the local `service` folder to `/app/service` in the container.
- `justMyCode: false` lets the debugger step into code outside the workspace.

Two observations from reading the target files (not verified by running anything):

- **Breakpoints early in startup can be missed.** The container command in `compose.yaml` starts `python -m debugpy --listen 0.0.0.0:5678 -m service.main` without `--wait-for-client`. The service starts running right away instead of waiting for VS Code to connect, so breakpoints in startup code can pass before the debugger is attached.
- **The attach can come before the listener is ready.** The task runs `docker compose up -d --build service`. `-d` makes the command return once the container has started, not once debugpy is listening. VS Code may therefore try to connect before port 5678 accepts connections. On a slow start that would show up as a failed attach that works when retried.

```dspatch-references
{"references": [
  {"label": "Attach configuration in the target", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: VS Code launched main.py itself", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "The pre-launch task", "step": "W1.2"},
  {"label": "Container command starting debugpy without --wait-for-client", "path": "compose.yaml", "side": "target", "start": 4, "end": 4},
  {"label": "Connecting to the debug listener", "step": "W1.6"}
], "insufficient": false}
```