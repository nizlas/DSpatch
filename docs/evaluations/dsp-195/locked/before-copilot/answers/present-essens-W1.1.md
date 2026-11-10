`request: "attach"` changes VS Code’s role: unlike the base configuration, which asked it to launch `service/main.py`, this one attaches to a Python process started elsewhere. The `preLaunchTask` selects the task that starts the container (W1.2); a later step shows how VS Code connects to the debug listener (W1.6).

<!-- dspatch:details -->
Starting the task first does not itself guarantee that the debug listener is ready when VS Code attempts the attach.

```dspatch-references
{"references":[{"label":"Attach configuration and pre-launch task","path":".vscode/launch.json","side":"target","start":5,"end":8},{"label":"Previous launch configuration","path":".vscode/launch.json","side":"base","start":4,"end":8},{"label":"Task that starts the container","step":"W1.2"},{"label":"Debugger connection settings","step":"W1.6"}],"insufficient":false}
```