This is the half of the launch configuration that VS Code acts on once the pre-launch task has started the container. **VS Code does not start a Python process here.** It connects to a debugpy listener that the container is already running, and from then on it debugs a process it did not create.

Three settings make the attach work:

- **`request: "attach"` with `connect` to `localhost:5678`.** This address reaches the container only because Compose publishes port 5678 to the host. Inside the container, debugpy listens on `0.0.0.0`, so it accepts connections that Docker forwards in from the host.
- **`pathMappings`.** debugpy reports file paths as the container sees them (`/app/service/...`). The mapping translates them to `${workspaceFolder}/service/...`, so breakpoints you set in the editor match the running code and stack frames open the right local files. `remoteRoot` has to stay in sync with the Dockerfile's `COPY service /app/service` and `WORKDIR /app`. If either changes, breakpoints stop binding, and nothing reports an error.
- **`justMyCode: false`.** The debugger can also stop in library code. That matters here because the service has almost no code of its own: `serve` hands every request to the standard library's `SimpleHTTPRequestHandler`. Without this setting, there would be very little request handling you could step into.

In the base revision, this was a `launch` configuration that ran `service/main.py` directly on the host in the integrated terminal.

**One thing I noticed that the reviewed code doesn't address:** the container's command starts debugpy with `--listen` but not `--wait-for-client`. So `main()` and the start of `serve()` run as soon as the container starts, whether or not VS Code is attached yet. Breakpoints in startup code will usually be missed. Breakpoints that are hit while the server handles requests should work.

<!-- dspatch:details -->
**Possible timing gap at attach.** The pre-launch task runs `docker compose up -d --build service`. The `-d` flag means the task ends once Compose has started the container, not once debugpy is listening. VS Code then tries to connect straight away. If the Python interpreter hasn't opened port 5678 yet, the first attach could fail and need a retry. This is inferred from the configuration, not observed. Nothing in the reviewed code waits for the port or checks that the service is ready.

**What `justMyCode: false` brings in.** Besides the standard library, it also lets the debugger stop in anything else installed in the image, such as the debugpy package that the Dockerfile installs with pip. Stepping can go deeper than you expect; that is the cost of being able to follow requests into `http.server`.

**Port exposure.** Compose publishes `"5678:5678"` without a host IP. Docker normally binds that to all host interfaces, not only localhost, so the debug port is probably reachable from the network. `connect` only needs `localhost`, so a binding like `127.0.0.1:5678:5678` would be enough.

```dspatch-references
{"references": [
  {"label": "Attach configuration: connect, pathMappings, justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: launch configuration running main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task", "step": "W1.2"},
  {"label": "debugpy listens on 0.0.0.0:5678 without --wait-for-client", "step": "W1.5"},
  {"label": "Published debug port", "path": "compose.yaml", "side": "target", "start": 5, "end": 7},
  {"label": "Source copied to /app/service (remoteRoot must match)", "step": "W1.4"},
  {"label": "Requests are handled by stdlib SimpleHTTPRequestHandler", "step": "W1.8"}
], "insufficient": false}
```