After the earlier pre-launch task starts the Compose service (W1.2), this configuration connects VS Code to the container’s debug listener at `localhost:5678`; it attaches rather than launching `service/main.py` locally. Its path mapping lets the debugger relate container files under `/app/service` to the workspace’s `service` directory. This is the change from the base configuration, which used launch mode with a local program. The container command and published port that make the connection possible are covered in W1.5.

<!-- dspatch:details -->
The mapping tells the debugger how to match source paths; it does not itself copy or mount files. Also, the pre-launch task starts Compose, but this configuration does not specify a separate check that `debugpy` is ready to accept the connection when the task finishes.

```dspatch-references
{"references":[{"label":"Attach settings and path mapping","path":".vscode/launch.json","side":"target","start":5,"end":11},{"label":"Earlier task starts Compose","step":"W1.2"},{"label":"Container starts and publishes the debug listener","step":"W1.5"},{"label":"Previous local launch configuration","path":".vscode/launch.json","side":"base","start":4,"end":8}],"insufficient":false}
```