This is the editor's half of the connection. The container does nothing to reach VS Code. Instead, VS Code connects as a client to `localhost:5678`. That host port is the one Compose maps to the debugpy listener started in the previous step. The service then runs in the container under debugpy, and the debugger joins it from outside. In the base revision, the same configuration used `request: "launch"` and ran `main.py` directly on the host.

`pathMappings` lets breakpoints work across the container boundary. The Dockerfile copies `service` to `/app/service`, so debugpy reports files under that path. The mapping translates those paths to `${workspaceFolder}/service`, which means a breakpoint set in the workspace file matches the code running in the container.

**The attach depends on timing that nothing in the configuration controls:**
- **Before attaching:** the task runs `docker compose up -d`. The `-d` flag makes it return once the container is started, and the task has no readiness check. So nothing makes sure debugpy is listening on 5678 when VS Code tries to connect.
- **After the container starts:** the Compose command doesn't use `--wait-for-client`, so `service.main` starts running straight away instead of waiting for the debugger. Any code that runs before the attach finishes runs without the debugger.

<!-- dspatch:details -->
Other settings that affect the session:

- **`justMyCode: false`** (the line right after this step's range): the debugger can also step into library code, such as `http.server`, which the next steps rely on.
- **Port mappings:** the attach only works because both sides use 5678. That is the host side of `"5678:5678"` in `compose.yaml` (target, line 6) and the `0.0.0.0:5678` listener in the container command. Debugpy listens on `0.0.0.0` rather than the container's loopback address, which is why a connection forwarded from the host can reach it.
- **Rebuilds:** `pathMappings` assume the container holds the same source as the workspace. The task passes `--build` on every start, so the image is rebuilt from the current `service` folder. The mapping doesn't check this, though.