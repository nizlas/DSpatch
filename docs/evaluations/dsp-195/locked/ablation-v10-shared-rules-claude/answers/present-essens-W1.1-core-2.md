This is the change that sets the direction for the whole walk. **The debug configuration no longer runs the service; it attaches to one that is already running.**

In the base revision, the only configuration was "Run the service", with `"request": "launch"`. VS Code started `service/main.py` itself, on the host, in the integrated terminal. In the target revision, it is replaced by "Attach to the service in the container", with `"request": "attach"`. `"type": "debugpy"` stays the same, so it is still the Python debugger. What changes is who starts the process: VS Code no longer starts Python at all.

So something else must start the service, and with a debug listener open. In this configuration, that job falls to `preLaunchTask`, the line just below the focus. VS Code runs the task labelled "Start the service container" first and attaches only after that. The label must match the task's label exactly, or VS Code cannot find the task. The next step shows that task. Later steps show where the container starts debugpy and where VS Code connects to it.

For review, the main consequence is that this is a full replacement, not an extra option. After this change the workspace has no way to launch the service locally from the debugger. Debugging now needs Docker.

<!-- dspatch:details -->
The rest of the attach entry (outside the focus lines) decides whether attaching works:

- **`connect`** goes to `localhost:5678`. Compose publishes container port 5678 to the host, and that is where debugpy listens.
- **`pathMappings`** maps the local `service` folder to `/app/service` in the container, so breakpoints set in the editor match the files the container runs. Whether `/app/service` is the right path depends on the Dockerfile (W1.4).
- **`justMyCode: false`** lets you step into library code too, not only your own files.

A possible timing issue, which I have not verified at runtime: the task runs `docker compose up -d --build service`. The `-d` flag returns once the container has started, not once debugpy is listening. The Compose command starts debugpy without `--wait-for-client`, so the service begins running right away. Two things may follow:
- The first attach can fail if debugpy is not listening yet when VS Code tries to connect.
- Code that runs at startup, before VS Code attaches, will not stop at breakpoints.

```dspatch-references
{"references": [{"label": "Attach configuration in full", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Previous launch configuration", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "Container starts debugpy", "step": "W1.5"}, {"label": "VS Code connects to the listener", "step": "W1.6"}], "insufficient": false}
```