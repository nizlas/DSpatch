This configuration is what you pick in VS Code's Run and Debug view, and the walk starts here. Two fields decide how debugging works:

- **`type: "debugpy"`** tells VS Code to use the Python debugger. debugpy is a Python package. It runs inside a Python process and accepts connections from a debugger client such as VS Code. The value is the same in both revisions.
- **`request`** is what changed. VS Code debug configurations come in two kinds:
  - **`"launch"`**: VS Code starts the program itself, with the debugger already inside it.
  - **`"attach"`**: VS Code starts nothing. It connects to a process that is already running and already has a debugger waiting for a connection.

In the base revision, the configuration "Run the service" used `"launch"` with `program` set to `service/main.py`. VS Code ran that file with the host's Python interpreter. In the target revision the request is `"attach"` and there is no `program` field. **This configuration no longer starts the service at all.** Something else has to start a Python process with debugpy running inside it, and that is the container.

A comparison: `launch` is like starting a program from your own terminal. `attach` is like dialling into a program someone else has started, so you need its address, and it has to be answering the line.

The configuration also includes the steps that make attaching possible. The `preLaunchTask` value, `"Start the service container"`, is the label of a task that VS Code looks up and runs before it attaches. That task is the next step [W1.2]. The address VS Code dials is in `connect` (`localhost:5678`), and `pathMappings` tells it how file paths inside the container map to your local files. Both come back in [W1.6], after the walk has shown what listens on that port.

<!-- dspatch:details -->

**What "attach" leaves to other parts.** With `launch`, VS Code owns the whole lifecycle: it starts the process, so the debugger is present from the first line, and stopping the debug session ends the program. With `attach`, VS Code owns only the connection. Three consequences follow from this configuration and the files it relies on:

- **Starting the process is done by the task.** The task runs `docker compose up -d --build service`. The `-d` flag means detached: the command returns as soon as the container has started. VS Code then moves on and attaches.
- **Timing.** In `compose.yaml` (target), the container runs `python -m debugpy --listen 0.0.0.0:5678 -m service.main` without `--wait-for-client`. debugpy only uses that flag when it is given, so here the service starts running at once and does not wait for VS Code. Breakpoints in code that runs during startup may be hit before the debugger is attached. Also, nothing in the task waits for port 5678 to be listening. Whether the connection always succeeds on the first try depends on timing that these files do not control. Treat both points as observations to keep in mind, not as verified failures.
- **Stopping.** Ending an attach session normally disconnects the debugger and leaves the process running. The containers are started with `-d`, and none of these files stops them, so they keep running after you stop debugging.

**`justMyCode: false`** is a new setting in the target revision. With it, the debugger also steps into library code instead of skipping it. It does not affect how the connection is made.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Earlier launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "VS Code connects to the debug listener", "step": "W1.6"}, {"label": "Container command starting debugpy", "path": "compose.yaml", "side": "target", "start": 4, "end": 4}], "insufficient": false}
```