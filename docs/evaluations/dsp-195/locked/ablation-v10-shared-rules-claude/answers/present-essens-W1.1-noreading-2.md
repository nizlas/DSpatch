This is where the change switches debugging from **launch** to **attach**. On the base revision, the only configuration (`"Run the service"`) used `"request": "launch"`. That means VS Code started `service/main.py` itself, on the host, in the integrated terminal. On the target, the configuration is replaced: `"request": "attach"` tells VS Code to start no Python process. Instead, it connects to a debugpy server that something else has already started.

The `"type": "debugpy"` line is the same in both revisions, so it still uses the Python debugger. What changes is who owns the process:

- **Who starts the service:** The `preLaunchTask` (line 8) runs `docker compose up -d --build service` before VS Code attaches.
- **Where the debugger listens:** Inside the container, the Compose `command` runs the service under `python -m debugpy --listen 0.0.0.0:5678`. `connect` (line 9) points VS Code at `localhost:5678`.
- **How breakpoints line up:** Because the code no longer runs from the workspace, `pathMappings` (lines 10–12) maps the local `service` folder to `/app/service` in the container. Without that mapping, breakpoints set in the editor wouldn't bind.

What to take from this step: the debugging session now depends on a running container and a reachable port. Once VS Code is set to attach, every later step in this walk is needed.

<!-- dspatch:details -->
Some consequences of this design are worth noting when you judge it later in the walk. These are inferences from the configuration, not verified behaviour:

- **Possible race:** The task runs Compose with `-d`, so it returns once the containers are started. That isn't necessarily the moment debugpy is listening. If VS Code attaches before the listener is ready, the first attach can fail.
- **Early code isn't stopped:** The Compose command does not pass `--wait-for-client`. The service starts running right away, so breakpoints in startup code may already have been passed by the time VS Code connects.
- **The container outlives the session:** Ending the debug session detaches VS Code but doesn't stop the container. Nothing in `launch.json` or `tasks.json` defines a `postDebugTask`.
- **Library code is debuggable:** `"justMyCode": false` lets you step into library code as well, not just the service's own code.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Previous launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "debugpy listener in the container", "step": "W1.5"}, {"label": "Connection and path mapping", "step": "W1.6"}], "insufficient": false}
```