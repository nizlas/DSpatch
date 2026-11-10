Here, `request: "attach"` changes the configuration from launching `service/main.py` locally to attaching the debugger to a process started separately. VS Code runs the `Start the service container` pre-launch task before attempting that attach; the next step shows the task. The later connection settings specify where the debugger connects.

<!-- dspatch:details -->
The pre-launch task starts Compose in detached mode, but this configuration does not itself wait for the debug listener to be ready; it requests the attach after the task completes. The base configuration used `"request": "launch"` and named a local program instead.

```dspatch-references
{"references":[{"label":"Attach request and pre-launch task","path":".vscode/launch.json","side":"target","start":4,"end":8},{"label":"Earlier launch configuration","path":".vscode/launch.json","side":"base","start":4,"end":9},{"label":"Task that starts the container","step":"W1.2"},{"label":"Debugger connection settings","step":"W1.6"}],"insufficient":false}
```