This step is where VS Code connects to the container. Once the pre-launch task returns, the debugger opens a connection to the debugpy listener that the container is already running. The service never contacts the editor. VS Code doesn't start any process here; it only connects to one.

Two settings carry the main behaviour:

- **`connect` to `localhost:5678`**: this reaches the container only because Compose publishes `"5678:5678"`. It also depends on debugpy listening on `0.0.0.0` inside the container, so connections forwarded from the host are accepted. If you change the port, change it in all three places together.
- **`pathMappings`**: debugpy reports file paths as the container sees them, under `/app/service`. This setting maps them to `${workspaceFolder}/service`, so editor breakpoints match the running code and stack frames open the local files. It only works while `remoteRoot` matches the Dockerfile's `COPY service /app/service` destination. Nothing checks that the two agree. If they drift apart, breakpoints silently stop being hit, and you get no error.

In the base revision this was a `launch` configuration that ran `service/main.py` directly on the host. Now the same `debugpy` type attaches to a process it did not start.

<!-- dspatch:details -->
**Timing.** These are my own observations from the config; I haven't verified them by running anything.

- The pre-launch task runs `docker compose up -d --build service`. With `-d`, the command returns once the container has started, not when debugpy is ready to accept connections. On a slow start, VS Code may try to connect before the listener is up, and the attach could fail on the first try.
- The container command is `python -m debugpy --listen 0.0.0.0:5678 -m service.main` with no `--wait-for-client`. The service starts running right away without waiting for the debugger. Code that runs before VS Code attaches, such as module import and server setup, won't stop at breakpoints. Request handling that comes later will.

**`justMyCode: false`** (line 13, just after the shown lines) lets the debugger step into code outside the workspace, such as the standard library modules the server uses, not just the project's own files.

**Port 8080** is also published by Compose. It's for the service's HTTP traffic and isn't used by the debugger connection.

```dspatch-references
{"references": [
  {"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Previous launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task", "step": "W1.2"},
  {"label": "Compose service and published ports", "step": "W1.3"},
  {"label": "COPY destination that remoteRoot must match", "step": "W1.4"},
  {"label": "debugpy listener command", "step": "W1.5"}
], "insufficient": false}
```