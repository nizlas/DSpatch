`type: "debugpy"` selects VS Code’s Python debugger, and `request: "attach"` tells it to connect to a Python process that is already running with debug support—not to launch `service/main.py` itself. That differs from the base revision, where the request was `"launch"` and named the program for VS Code to start. Here, `preLaunchTask` names the task that runs first; the next step follows it, and a later step shows the container starting `debugpy` with the service module (W1.2, W1.5).

<!-- dspatch:details -->
The task runs Compose in detached mode, but has no explicit readiness check. So its completion orders the attach attempt after the startup command; it does not by itself establish that the debug listener is ready to accept the connection.

```dspatch-references
{"references":[{"label":"Attach configuration and connection settings","path":".vscode/launch.json","side":"target","start":4,"end":11},{"label":"Earlier launch configuration","path":".vscode/launch.json","side":"base","start":4,"end":9},{"label":"The task run before attaching","step":"W1.2"},{"label":"The container starts the debug listener and service","step":"W1.5"}],"insufficient":false}
```