Once the pre-launch task returns, the walk moves from the container to the editor. Nothing in the service calls VS Code. VS Code itself acts on this attach request: it connects as a client to `localhost:5678`. That works because, as shown in W1.5, the container's debugpy listens on 5678 and Compose publishes that port to the host.

`pathMappings` makes breakpoints work. The code runs from `/app/service`, which is where the image copies the source (W1.4). The editor shows the same files under `${workspaceFolder}/service`. The mapping translates between the two locations. Without it, breakpoints set in the workspace would not match the running code. It only works while the copied files are the same as the workspace files, and a new copy is made only when the task rebuilds the image.

**Nothing makes the attach wait until the listener is up.** The task starts Compose with `-d` (detached), and VS Code has no readiness check to wait on. So the attach can be sent before debugpy is listening. Whether that happens depends on how fast the container starts.

<!-- dspatch:details -->
In the earlier revision this configuration used `request: "launch"` and ran `service/main.py` directly on the host, with no task and no path mapping. Debugging now always goes through the container.

The container command in W1.5 has no `--wait-for-client`, so the service doesn't wait for the debugger. It starts serving right away whether or not the editor attaches. Code that runs at startup, before the attach succeeds, will not stop at breakpoints.

`justMyCode: false` lets the debugger step into library code as well, such as the standard-library HTTP server used in W1.8. It's not just the workspace files.