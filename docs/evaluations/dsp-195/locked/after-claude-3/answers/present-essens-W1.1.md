The debug session starts here, and this is the central change of the commit. On the base revision, this configuration was **"Run the service"** with `request: "launch"`. VS Code ran the service locally from its `program` entry, `service/main.py`. On the target revision, the configuration has a new name and uses `request: "attach"`, so VS Code no longer starts any Python process. It connects to a debugpy listener that something else has already started. That is why the `program` and `console` entries are gone.

That "something else" is the container. Just below these lines, `preLaunchTask: "Start the service container"` tells VS Code to run a task before it attaches. VS Code finds that task by its exact label, and in the next step we follow the label to the task ([W1.2]). The connection settings (`connect` to `localhost:5678` and `pathMappings`) are covered in W1.6.

The main consequence for the review: the program being debugged now runs inside Docker, not on the developer's machine. Whether a breakpoint works depends on three things: the container starting, debugpy listening on the published port, and the path mapping matching where the code sits in the image.

<!-- dspatch:details -->
The configuration also adds `justMyCode: false`, which the base revision did not have. With this setting, the debugger can step into library code as well as the service's own code.

`request: "attach"` sets no timing contract. The task runs `docker compose up -d --build service`, and `-d` means the command returns once the container has been started, not once debugpy is listening. The container command in `compose.yaml` runs `debugpy --listen` without `--wait-for-client`. Two things follow from that:
- Attaching might race with debugpy's startup.
- The service runs its startup code without waiting for the debugger, so breakpoints in startup code can be missed.

This is my reading of the configuration; I have not seen it fail. Later steps (W1.5, W1.6) show those pieces.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Former launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Pre-launch task", "step": "W1.2"}, {"label": "Container starts debugpy", "step": "W1.5"}, {"label": "Connection and path mappings", "step": "W1.6"}], "insufficient": false}
```