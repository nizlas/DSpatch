This is the core change in the launch configuration. In the base revision, the only entry was **"Run the service"** with `"request": "launch"`. That told VS Code to start `service/main.py` itself, locally, in the integrated terminal. In the target revision, that entry is replaced by **"Attach to the service in the container"** with `"request": "attach"`.

`"type": "debugpy"` stays the same, so the Python debugger is still used. What changes is **who starts the process**. VS Code no longer runs any Python code. It only connects to a debugpy listener that something else has already started. Running the service locally from VS Code is no longer possible through this file. The only configuration left assumes the service runs in a container.

Two other things have to happen for the attach to work, and later steps show them:
- `preLaunchTask` must bring the container up. The next step [W1.2] covers this.
- Compose must start the module under debugpy and publish the debug port. Step [W1.5] covers this.

Step [W1.6] covers where VS Code connects.

<!-- dspatch:details -->
**Readiness is not guaranteed.** The pre-launch task runs `docker compose up -d --build service`. The `-d` flag returns as soon as the container has started, not when debugpy is ready to accept a connection. Nothing in the configuration waits for port 5678 to answer. VS Code tries to attach once the task finishes, so a slow start could make the first attach fail. This is an observation from the configuration, not observed behaviour.

**Early code may run before the debugger is connected.** The Compose command uses `--listen` without `--wait-for-client`. The service starts running immediately, whether or not a debugger is attached. Breakpoints in code that runs at startup may be passed before VS Code connects.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Former launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Pre-launch task", "step": "W1.2"}, {"label": "debugpy started in the container", "step": "W1.5"}, {"label": "VS Code connects to the listener", "step": "W1.6"}, {"label": "Detached compose start", "path": ".vscode/tasks.json", "side": "target", "start": 5, "end": 7}, {"label": "debugpy command without --wait-for-client", "path": "compose.yaml", "side": "target", "start": 4, "end": 4}], "insufficient": false}
```