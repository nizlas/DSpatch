Once the pre-launch task returns, VS Code sets up the debugger connection itself. The service never calls out to the editor. The `attach` request connects to `localhost` on port `5678`. That port reaches the container because Compose publishes `5678:5678` and debugpy listens on `0.0.0.0:5678` inside it. This replaces the earlier `launch` configuration, which ran `service/main.py` directly on the host.

`pathMappings` matches files in the container to files in the editor. Source under `/app/service`, where the Dockerfile copies it, maps to `${workspaceFolder}/service`. **Breakpoints set in the workspace only bind if this mapping matches the copy path in the image.** `justMyCode: false` also lets the debugger step into library code, not just the service's own files.

**Nothing makes the attach wait until the listener is ready.** The task runs `docker compose up -d --build` in detached mode, which returns once the container has started, and it has no readiness check. So the attach can be sent before debugpy is listening.

<!-- dspatch:details -->
The waiting works the other way too. The container command starts debugpy without `--wait-for-client`, so `service.main` runs straight away whether or not a debugger is attached. Any startup code that runs before the attach finishes won't stop at breakpoints. Once attached, you can debug the running server's request handling.

Both of these follow from reading the configuration. I haven't seen it run, so I can't say how often the early attach fails or whether VS Code retries the connection.