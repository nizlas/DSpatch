This is where the walk starts. The change replaces how the service is debugged. At the base revision, this entry was **"Run the service"**. It used `"request": "launch"` with a `program` pointing at `service/main.py`, so VS Code started the Python process itself on the host. At the target revision, the entry is **"Attach to the service in the container"** and uses `"request": "attach"`.

That one word changes the whole flow. **With `attach`, VS Code no longer starts the service.** Instead, it connects to a Python process that is already running and listening for a debugger. `"type": "debugpy"` still selects the Python debugger extension, as it did before.

So two things now have to happen outside this setting:

- **Something must start the service.** The `preLaunchTask` setting just below these lines names that task: `"Start the service container"`. VS Code runs it before it attaches. The next step [W1.2] shows that task.
- **The running process must accept a debugger connection.** Later steps show how the container does this: [W1.5] starts it under debugpy, and [W1.6] shows how VS Code connects to it.

<!-- dspatch:details -->
Below these lines, the rest of the entry is where the attach setup is completed. `connect` gives `localhost:5678`. `pathMappings` maps the local `service` folder to `/app/service` in the container. `justMyCode` is set to `false`. Step [W1.6] treats these settings.

**A possible timing issue (my reading, not tested).** The task runs `docker compose up -d --build service`. The `-d` flag means Compose returns as soon as the container is started. It does not wait for debugpy to start listening. In Compose, the container runs `debugpy --listen` with no `--wait-for-client`. Together this allows two things:

- The attach may arrive before port 5678 accepts connections.
- The service may already be running code before the debugger connects. Breakpoints in startup code could then be missed.

Whether this happens in practice depends on timing. The configuration does not prevent it.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Previous launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "The pre-launch task", "step": "W1.2"}, {"label": "Container starts debugpy", "step": "W1.5"}, {"label": "VS Code connects to the listener", "step": "W1.6"}], "insufficient": false}
```