This is the debug configuration you pick in VS Code's Run and Debug view, and the walk starts here. It still uses the Python debugger (`"type": "debugpy"`), but `"request"` is now `"attach"` instead of `"launch"`. **VS Code no longer starts the service. It connects to a debugpy session that something else must already have started.**

That is the main change from the base revision. There, "Run the service" was a `launch` request with `program` set to `service/main.py`, so VS Code ran the file on the host and debugged it directly. In the target revision there is no `program` entry. The service process has to come from somewhere else, and the rest of the walk shows that it runs inside a container.

The trigger for that container is the `preLaunchTask` value just below these lines: `"Start the service container"`. VS Code finds the task with that label in the workspace's tasks file and runs it before it tries to attach. The next step covers that task (W1.2). The remaining settings, `connect` and `pathMappings`, decide where the debugger connects and how file paths match up. They come back in W1.6, after the walk has shown what listens on that port.

<!-- dspatch:details -->

There are two practical effects for a reviewer:

- **The only way to debug the service is now inside the container.** The target revision has just this one configuration, and the base revision's `launch` entry was replaced rather than kept next to it. Running and debugging the service directly on the host is no longer offered.
- **The pre-launch task finishing does not prove the service is ready.** The task runs `docker compose up -d --build service`. The `-d` flag returns once the container has started, and the task defines no readiness check. Whether debugpy is already listening when VS Code tries to connect depends on how fast the container starts. I haven't verified whether this causes problems in practice; W1.5 and W1.6 show what starts the listener and where VS Code connects.

```dspatch-references
{"references": [{"label": "Attach configuration with its pre-launch task", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Earlier launch configuration that ran main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "What starts debugpy in the container", "step": "W1.5"}, {"label": "Where VS Code connects", "step": "W1.6"}], "insufficient": false}
```