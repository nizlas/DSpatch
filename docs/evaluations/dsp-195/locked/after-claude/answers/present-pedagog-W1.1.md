This is where the debug session starts. A VS Code launch configuration is a named recipe in `launch.json`. When you pick it in the Run and Debug view, VS Code passes the recipe to the debugger extension named by `type`. Here that is `debugpy`, the Python debugger extension.

**Two ways to start debugging.** The `request` field tells the debugger what its job is:

- **`launch`**: the debugger starts the program itself, so the program runs inside the debugger from the first line. The base revision used this. `"request": "launch"` pointed `program` at `${workspaceFolder}/service/main.py` and ran it in the integrated terminal, so the service ran directly on your machine.
- **`attach`**: the debugger starts nothing. It connects to a program that is already running and has opened a debug listener. The target revision uses this, and renames the configuration from "Run the service" to "Attach to the service in the container".

A comparison: `launch` is like starting a car yourself with a passenger watching. `attach` is like climbing into a car that is already running. Someone else must have started it, and the door must be open.

**Why this matters for the change.** With `attach`, VS Code no longer controls how the service starts, so two things now live elsewhere:

1. **Who starts the program.** The line after this excerpt, `preLaunchTask: "Start the service container"`, names a task that VS Code runs before the session begins. It finds the task by matching that label exactly to the `label` in `tasks.json`. The next step [W1.2] follows that task.
2. **What it connects to.** The `connect` and `pathMappings` settings say which listener to connect to and how file paths in the container match your files. These lines follow right after the excerpt; [W1.6] covers them.

So the line `"request": "attach"` is what makes the rest of the walk necessary. The container has to start the service with a debugpy listener, because the debugger no longer starts anything itself.

<!-- dspatch:details -->

**What `attach` changes about when the program starts.** With `launch`, the debugger owns the process from the beginning, so breakpoints on startup code are hit reliably. With `attach`, the service starts before VS Code connects. The `command` in `compose.yaml` (target, line 4) starts the listener with `--listen 0.0.0.0:5678`. It does not pass debugpy's `--wait-for-client` option, so `service.main` can start running before the debugger connects. That means breakpoints in code that runs only once at startup may be missed. Code that runs for each request, after the connection is made, is not affected. [W1.5] covers this command.

**A possible timing gap (an observation, not something that has been run).** The pre-launch task runs `docker compose up -d --build service`. The `-d` flag runs the container in the background. As far as these files show, `docker compose up -d` returns once the container has started, not once debugpy is listening on port 5678. When the task finishes, VS Code connects right away. If the listener isn't up yet, the first connection attempt may fail. Nothing in `tasks.json` waits for the port, for example with a `problemMatcher` or a background-task pattern.

**Other things dropped with `launch`.** `console: "integratedTerminal"` meant something only when VS Code started the process. With `attach`, the service's output goes to the container's logs (`docker compose logs`), not to a VS Code terminal. The target revision also adds `justMyCode: false`, which lets you step into library code, not only your own files.

```dspatch-references
{"references": [{"label": "Attach configuration in full (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Previous launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Task matched by preLaunchTask", "step": "W1.2"}, {"label": "Container command starting the debugpy listener", "step": "W1.5"}, {"label": "Connection and path mapping", "step": "W1.6"}], "insufficient": false}
```