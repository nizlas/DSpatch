This is the one debug configuration VS Code offers in this change, and here it switches from running the service to **attaching** to it. With `request: "attach"`, the `debugpy` debugger starts no Python process of its own. It connects to a debugpy listener that something else must already have started. Who starts the service, and where, is now decided outside this file.

In the base revision this was a `"launch"` configuration named "Run the service". VS Code ran `service/main.py` directly on the host, so the debugger owned that process from its first line. In the target, the process belongs to a container. The debugger only joins it, and only if a listener is reachable when the session starts.

What starts that process is the `preLaunchTask` named right after these lines: `"Start the service container"`. VS Code runs it before attaching. The next step [W1.2] shows that this label matches a shell task that runs Docker Compose.

<!-- dspatch:details -->
Joining instead of owning has two effects that matter for review:

- **Early code can run before you attach.** Compose starts debugpy without `--wait-for-client`, so the service doesn't wait for a debugger before it starts. Breakpoints in startup code may already have been passed when VS Code connects. [W1.5] covers the container command.
- **The process outlives the debug session.** The pre-launch task runs `docker compose up -d`, which starts the container in the background and returns. Nothing here stops it when the session ends.

The address the debugger connects to (`connect`) and how container paths map to workspace files (`pathMappings`) come back in [W1.6], once the walk has shown what listens on that port.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 8}, {"label": "Earlier launch configuration that ran main.py on the host (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Task the preLaunchTask label matches", "step": "W1.2"}, {"label": "Container command that starts debugpy", "step": "W1.5"}, {"label": "connect and pathMappings", "step": "W1.6"}], "insufficient": false}
```