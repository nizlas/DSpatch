Once the container is running, the walk returns to the editor. VS Code makes this connection itself, as part of the `attach` request from the first step (W1.1). The service never calls out to the editor. The debugger connects to `localhost` port `5678`. As we saw in W1.3 and W1.5, Compose publishes that port from the container, where debugpy listens on `0.0.0.0:5678`.

`pathMappings` matters because the code runs at a different path inside the container. The image copies the source to `/app/service`, so debugpy reports files under that path. The mapping translates them to `${workspaceFolder}/service`. **Without this mapping, breakpoints set in the workspace files would not match the code running in the container.**

Nothing here waits for the debugger to be ready. The pre-launch task runs `docker compose up -d`, which returns once the container has been started, not once debugpy is listening. The task also defines no readiness check. So the attach can reach port 5678 before the listener is up, and whether it succeeds then depends on timing.

<!-- dspatch:details -->
This is a change from the base revision. There, the configuration used `"request": "launch"` and ran `service/main.py` directly on the host in the integrated terminal. There was no container, no port and no path mapping.

The Compose command in W1.5 does not pass `--wait-for-client` to debugpy. So `service.main` starts right away, whether or not an editor is attached. Code that runs before the attach completes, such as startup up to `serve`, will normally have finished before any breakpoint in it can take effect.

Line 13 sets `justMyCode: false`, just outside this step's lines. It lets the debugger step into library code, for example the standard-library HTTP server reached in W1.8.