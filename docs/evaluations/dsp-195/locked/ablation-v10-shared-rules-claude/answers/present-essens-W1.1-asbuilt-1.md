This is where the change switches debugging from launching the service locally to attaching to a service in a container. In the base revision, the only configuration was `"Run the service"` with `"request": "launch"`. VS Code started `service/main.py` itself in the integrated terminal. In the target revision, the configuration is renamed and uses **`"request": "attach"`**. VS Code no longer starts any Python process. It connects to one that is already running and has a debug listener open.

What follows for the main picture:

- **Something else has to start the service.** That is the job of `preLaunchTask` (directly below these lines). VS Code runs the task with the label `"Start the service container"` first, and attaches only after that. The next step [W1.2] shows that task.
- **`"type": "debugpy"` stays the same in both revisions.** The same Python debugger extension is used. Only how the process comes into existence changes.
- **Attach mode needs details that launch mode did not.** It needs to know where to connect and how container paths map to local files. A later step [W1.6] covers `connect` and `pathMappings`.

<!-- dspatch:details -->

A timing point to keep in mind for later steps (this is an observation, not something verified at runtime): VS Code attaches as soon as the pre-launch task finishes. The task runs `docker compose up -d --build service`. With `-d`, that command returns once the container is started, not once `debugpy` inside it is listening on port 5678. Nothing in the task or in the launch configuration waits for the listener to be ready. The code shown doesn't settle whether the first attach can arrive too early. That depends on how quickly `debugpy` starts and whether the extension retries the connection.

The Compose command also starts `debugpy` without `--wait-for-client`, so the service begins running right away rather than waiting for VS Code to attach. Code that runs at startup may finish before the debugger connects. That command is the subject of [W1.5].

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 8}, {"label": "Former launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Pre-launch task", "step": "W1.2"}, {"label": "Connect and path mappings", "step": "W1.6"}, {"label": "debugpy started in the container", "step": "W1.5"}], "insufficient": false}
```