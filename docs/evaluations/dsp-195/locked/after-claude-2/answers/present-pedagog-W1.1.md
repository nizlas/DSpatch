A debug configuration in `launch.json` tells VS Code's debugger how to get hold of a program. The `request` field picks one of two ways:

- **`"launch"`**: the debugger starts the program itself and owns that process. That is how the base revision worked. The configuration was named "Run the service" and pointed `program` at `service/main.py`, which ran on the host in the integrated terminal.
- **`"attach"`**: the debugger starts nothing. It connects to a program that is already running and has already opened a debug port. This is the mode used here, and the new `name` says so.

`type: "debugpy"` stays the same in both revisions. It picks the Python debugger extension, which speaks debugpy's protocol. In launch mode the extension starts debugpy and your program together. In attach mode it only acts as a client: it needs a debugpy server listening somewhere, and it fails if nothing answers.

So the important change here is a change of responsibility. VS Code no longer creates the process it debugs, so the configuration has to say two things:

1. **Who starts the program.** `preLaunchTask: "Start the service container"`, just below this step's lines, names a task that VS Code runs before it attaches. The name is a plain string that must exactly match a task's `label`. The next step [W1.2] follows it to the Docker Compose command.
2. **Where to connect, and how to match files.** `connect` (localhost, port 5678) and `pathMappings` hold this. The service runs inside a container, so the debugger reports file paths under `/app/service`, and these have to be translated to your workspace files. [W1.6] comes back to both once the walk has shown what is listening on that port.

Compare it to a phone call. In launch mode you start the program yourself. In attach mode you dial a number and someone must already be waiting to pick up. The rest of this walk is about how that listener gets there in time.

<!-- dspatch:details -->

**What attach mode does not guarantee.** VS Code waits for `preLaunchTask` to finish before it attaches. Here the task runs `docker compose up -d --build service`, and `-d` means the command returns once the container has started. It does not wait for the process inside to be ready. The container's command is `python -m debugpy --listen 0.0.0.0:5678 -m service.main` (shown in [W1.5]). Two things follow from the code. This is my reading of it, not observed behaviour:

- Nothing makes VS Code wait until debugpy is actually listening on port 5678. The attach can arrive while the Python process is still starting. Whether that happens depends on timing.
- The command has no `--wait-for-client`, so debugpy does not pause the service until a debugger connects. `service.main` starts running right away. Breakpoints in startup code can run before VS Code attaches. In the base revision this could not happen, because launch mode started the program under the debugger.

**One more change in this configuration.** It sets `"justMyCode": false` (line 13), which the base configuration did not have. With this setting the debugger also steps into library code and stops at breakpoints there, not only in your own files.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Earlier launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Task matched by preLaunchTask", "step": "W1.2"}, {"label": "Container command that starts debugpy", "step": "W1.5"}, {"label": "connect and pathMappings", "step": "W1.6"}], "insufficient": false}
```