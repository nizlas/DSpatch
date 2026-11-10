The service doesn't call out to the editor. VS Code makes the connection itself, as the `attach` request we saw in W1.1. Once `preLaunchTask` finishes, VS Code connects to `localhost:5678`. Compose publishes that port from the debugpy listener started in W1.5, so the debugger reaches the process inside the container through the host's port mapping.

`pathMappings` links the two file trees. In the container the code lives under `/app/service`, which the Dockerfile copied there in W1.4. In the editor it's `${workspaceFolder}/service`. Without this mapping, breakpoints set in workspace files wouldn't match the files the container is running.

**Nothing makes sure the listener is ready before the attach.** The task runs `docker compose up -d --build service`. The `-d` flag makes that command return once the container is started, not once debugpy is listening, and the task defines no readiness check. If the attach comes before debugpy has opened port 5678, the connection can fail.

<!-- dspatch:details -->
In the base revision, this configuration was a `launch` request that ran `service/main.py` directly on the host. Now the code runs in the container and the editor only attaches to it.

The container command in W1.5 starts debugpy without `--wait-for-client`, so the service doesn't wait for the debugger before it runs. Breakpoints in code that runs at startup, before the attach succeeds, can be missed. Code that runs per request, after the attach, can still be stopped at.

`justMyCode: false` lets the debugger step into library code too, such as the standard-library HTTP server used in W1.8, not just the service's own files.