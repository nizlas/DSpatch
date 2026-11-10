Here the walk comes back to the editor. As we saw earlier, the pre-launch task ran `docker compose up -d --build service` (W1.2). Inside the container, debugpy is now listening (W1.5). Once that task finishes, VS Code reads the rest of this configuration. It **connects to that listener as a client**. It does not start any Python process itself.

Two settings make the attach work:

- **`request: "attach"` with `connect` to `localhost:5678`**: this reaches the container only because Compose publishes `"5678:5678"` (W1.3) and debugpy listens on `0.0.0.0` (W1.5). Those two settings and this one must keep the same port.
- **`pathMappings`**: debugpy reports file paths as the container sees them, under `/app/service`. The mapping turns them into `${workspaceFolder}/service`, so breakpoints set in the editor bind to the running code. This only works while `remoteRoot` matches the Dockerfile's `COPY service /app/service` (W1.4). Nothing checks that link. If someone changes one side alone, breakpoints stop binding and the editor shows no error.

In the base revision, this was a `launch` configuration that ran `service/main.py` directly on the host. Now the same debugger type attaches to a process it did not start.

**This part runs in a different order from the walk.** The container command has no `--wait-for-client`, so the service doesn't wait for the debugger. It goes straight into `service.main` and the server (W1.7, W1.8) while VS Code is still attaching. Two things follow from that:

- Breakpoints in startup code can run before the debugger is connected, and then they never hit. Breakpoints in request handling are fine, because that code runs later.
- `docker compose up -d` returns once the container has started, not once debugpy is listening. So in principle the attach could arrive too early and fail. Whether that actually happens depends on timing, and this code can't settle it.

<!-- dspatch:details -->
`justMyCode: false` (line 13, just below this excerpt) lets the debugger stop in and step into library code. This matters here because almost all of the server's work happens in the standard library's `http.server`: `ThreadingHTTPServer` and `SimpleHTTPRequestHandler` (W1.8). Leave this setting at its default (`true`) and only the project's own files are debugged. Then stepping into a request handler would mostly step over it.

One consequence of the mapping: it covers only `${workspaceFolder}/service`. Library frames such as `http.server` don't fall under any mapping, so the editor can't use the host's copy of those files. The debugger has to fetch their source from the container. Which Python build that source comes from is the one in the image, `python:3.12-slim`, not the host's.

If the startup-time issue matters, the usual fix is to add `--wait-for-client` to the debugpy command in Compose. That moves the problem rather than removing it: the service would then not serve on port 8080 until a debugger attaches, including when the container is started without VS Code.

```dspatch-references
{"references": [
  {"label": "Attach configuration with connect, pathMappings and justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: launch configuration running main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task (detached compose up)", "step": "W1.2"},
  {"label": "Published debug port", "step": "W1.3"},
  {"label": "COPY destination that remoteRoot must match", "step": "W1.4"},
  {"label": "debugpy listens on 0.0.0.0:5678 without --wait-for-client", "step": "W1.5"},
  {"label": "Server built on http.server", "step": "W1.8"}
], "insufficient": false}
```