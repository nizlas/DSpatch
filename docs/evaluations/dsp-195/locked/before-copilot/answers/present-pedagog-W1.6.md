Here, `request: "attach"` means VS Code connects to a Python process that is started separately; unlike the base revision’s `launch` configuration, this configuration does not start the Python program itself. The pre-launch task runs Compose before VS Code attempts the connection (W1.2). Compose starts `debugpy` with a listener on port 5678 and the service module (W1.5); the published port lets VS Code reach that listener at `localhost:5678` (W1.3).

The debugger also needs to relate paths inside the container to files in your workspace. This mapping pairs `/app/service` with `${workspaceFolder}/service`, so a container source path such as `/app/service/main.py` corresponds to the local `service/main.py`. It tells the debugger how to find and associate source files; it does not copy or synchronize them. In the next step, `main` enters the service code (W1.7).

<!-- dspatch:details -->
The task starts Compose, but the configuration does not explicitly make it wait for `debugpy` to be ready before attempting to attach. The listener must be reachable for the connection to succeed; the port mapping and path mapping address reachability and source correspondence, respectively, not readiness.

```dspatch-references
{"references":[{"label":"Attach configuration and path mapping","path":".vscode/launch.json","side":"target","start":5,"end":12},{"label":"Compose task that runs before attaching","step":"W1.2"},{"label":"Published debug port","step":"W1.3"},{"label":"Container command that starts debugpy","step":"W1.5"},{"label":"Service module entered next","step":"W1.7"}],"insufficient":false}
```