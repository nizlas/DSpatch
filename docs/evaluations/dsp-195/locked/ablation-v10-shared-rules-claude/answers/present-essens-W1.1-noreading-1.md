This step is where the change matters most. On the base revision, this launch configuration was **"Run the service"** with `"request": "launch"`. VS Code started `service/main.py` itself, on the host, in the integrated terminal. On the target, the same slot holds **"Attach to the service in the container"** with `"request": "attach"`. VS Code no longer starts any Python process. It connects to a debugpy server that something else has already started.

`"type": "debugpy"` is the same in both revisions, so the Python debugger extension still does the work. Only who starts the process has changed. The rest of the walk follows that new arrangement:
- the pre-launch task brings the container up ([W1.2]),
- Compose runs the service under debugpy inside it ([W1.3]–[W1.5]),
- this configuration then connects to it ([W1.6]).

For a reviewer, the base configuration is gone, not kept alongside the new one. Anyone who used to press F5 to run the service locally now needs Docker to debug it.

<!-- dspatch:details -->
**Timing.** Nothing here makes the attach wait until the service is actually listening. Before the attach, VS Code waits only for `preLaunchTask` to finish. That task runs `docker compose up -d --build service`, and with `-d` it returns once the container has started, not once debugpy is listening. The container command is `python -m debugpy --listen 0.0.0.0:5678 -m service.main`. It has no `--wait-for-client`, so the service begins running without waiting for the debugger. In practice, code that runs right at startup may already have run before the debugger connects. If debugpy is slow to open its port, the first attach could fail. This is an observation from the configuration as written, not something I verified at runtime.

**Debugger option.** `justMyCode: false` is set on the target. With it, the debugger also steps into library code, not only the service's own files.

```dspatch-references
{"references": [{"label": "Attach configuration on the target", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Previous local launch configuration", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "Container runs debugpy without --wait-for-client", "step": "W1.5"}, {"label": "Where the attach connects", "step": "W1.6"}], "insufficient": false}
```