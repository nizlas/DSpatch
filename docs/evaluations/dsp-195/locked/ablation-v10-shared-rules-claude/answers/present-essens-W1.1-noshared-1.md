This is where the walk begins. The change replaces the debug entry. In the base revision it was **"Run the service"**, with `"request": "launch"`: VS Code started `service/main.py` itself on the host. In the target revision it is **"Attach to the service in the container"**, with `"request": "attach"`.

That one switch changes who owns the process. With `attach`, VS Code no longer starts Python. It only connects to a process that is already running and already accepting a debugger. `"type": "debugpy"` still selects the Python debugger extension, as it did in the base revision.

So something else has to start the service. That is the job of `preLaunchTask`, directly below these lines. VS Code runs that task first and makes the attach request after it. VS Code finds the task by its label, `"Start the service container"`, so the label must match a task exactly. The next step shows that task [W1.2].

<!-- dspatch:details -->
The rest of the entry tells VS Code where to attach and how to match files. Step W1.6 covers it:
- `connect` points to `localhost:5678`.
- `pathMappings` maps the local `service` folder to `/app/service` in the container.
- `justMyCode: false` lets you step into library code too.

**A timing question this design raises (my observation, not confirmed by running it):** VS Code waits for the pre-launch task to finish, then attaches. Here the task runs `docker compose up -d --build service`. The `-d` flag makes the command return once the container has started, not once debugpy inside it is listening. The Compose `command` starts debugpy without `--wait-for-client`, so two things can happen:
- The first attach may come before port 5678 is open.
- The service may already be running before the debugger connects, so breakpoints in startup code can be missed.

Whether this matters depends on how fast the container starts. W1.5 and W1.6 show the listener and the connection.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Earlier launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "debugpy started in the container", "step": "W1.5"}, {"label": "VS Code connects to the listener", "step": "W1.6"}], "insufficient": false}
```