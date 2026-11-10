With the container running and debugpy listening (W1.5), this is the editor's half of the handoff. The service never calls VS Code. VS Code opens a connection to `localhost:5678` itself, and that address only works because Compose maps host port 5678 to the debugpy listener inside the container.

`pathMappings` is what makes breakpoints work. Inside the container, the code runs from `/app/service`, the folder the Dockerfile copied it into (W1.4). The editor shows the same files under the workspace's `service` folder. With this mapping, a breakpoint set in the workspace matches a running frame in the container. Without it, or if either path were wrong, the debugger would attach but breakpoints would not be hit.

**Nothing makes the attach wait for the listener to be ready.** The pre-launch task (W1.2) runs `docker compose up -d --build`, which returns once the container has started. The task defines no readiness check. So the attach can fire before debugpy is listening, and whether that happens depends on timing. There is a second, separate effect: the Compose command does not pass `--wait-for-client` to debugpy, so the service starts running without waiting for a debugger. Breakpoints in code that runs before the attach completes can therefore be missed.

<!-- dspatch:details -->

This replaces the base revision's configuration, which used `"request": "launch"` to run `service/main.py` directly on the host in the integrated terminal. In this revision the editor no longer starts the program. The container owns the process, and VS Code only connects to it.

`justMyCode: false` lets the debugger step into library code as well, such as the standard library's `http.server` that the server uses (W1.8).