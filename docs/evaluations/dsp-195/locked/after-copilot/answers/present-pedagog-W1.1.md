Here, `"request": "attach"` tells VS Code’s `debugpy` extension to connect to an already-running Python process, rather than start the program itself. The target needs to be listening for a debugger connection; the `preLaunchTask` asks VS Code to start the container first, and a later step shows how Compose starts that listener. The task runs before the attach request, but this setting alone does not guarantee that the listener is ready when VS Code connects.

That is a change from the base revision, where `"request": "launch"` and `"program"` told VS Code to start `service/main.py` itself. The target instead uses the connection details and path mapping later in this configuration to attach to the container’s process.

```dspatch-references
{"references":[{"label":"Attach request and connection settings","path":".vscode/launch.json","side":"target","start":4,"end":11},{"label":"Earlier launch configuration","path":".vscode/launch.json","side":"base","start":4,"end":8},{"label":"Pre-launch task","step":"W1.2"},{"label":"Container debug listener","step":"W1.5"}],"insufficient":false}
```