Once the pre-launch task has started the container, VS Code attaches to the debugpy listener that is already running there. VS Code starts no process in this step. The container started debugpy, and the editor only connects to it.

Three settings decide whether this works:

- **`request: "attach"` with `connect` to `localhost:5678`.** The editor connects to a host port. That port reaches the container only because Compose publishes `"5678:5678"`. Inside the container, debugpy listens on `0.0.0.0`, so connections forwarded from the host are accepted.
- **`pathMappings`.** debugpy reports file paths as they exist inside the container, under `/app/service`. The mapping turns them into `${workspaceFolder}/service`, so breakpoints and stack frames match the local files. `remoteRoot` has to match the Dockerfile's `COPY service /app/service`. If either one changes alone, breakpoints silently stop binding.
- **`justMyCode: false`.** The debugger can also step into library code, such as `http.server` used by the server, not only the project's files.

In the base revision, this was a `launch` configuration that ran `service/main.py` directly on the host. Now the same debugger type attaches to a process it did not start.

**Timing caveat (an observation, not a verified fault):** the Compose command has no `--wait-for-client`, so the service starts running before any debugger is attached. Code that runs before the attach, such as startup in `main`, can pass its breakpoints. Also, the task `docker compose up -d --build service` returns once the container has started, not once debugpy is listening. The attach could therefore race the listener.

<!-- dspatch:details -->

**The two settings that have to agree across files:**

| Setting here | Must match |
|---|---|
| `connect.port: 5678` | the host side of the `5678:5678` port mapping, and the `--listen` port in the Compose `command` |
| `remoteRoot: "/app/service"` | `WORKDIR /app` plus `COPY service /app/service` in the Dockerfile |

The local half of the mapping points at the workspace's `service/` folder. That works because the image is built from the same files (`build: .`). If the running image is out of date compared with the editor's files, line numbers can drift. The `--build` flag in the task rebuilds the image on every start, which limits that risk.

**Why `localhost` and not the container's address:** the editor runs on the host and has no route to the container's address other than published ports. The attach therefore goes through the port mapping, not straight into the container's network.

**About the timing points above:**
- Without `--wait-for-client`, the module starts as soon as the container does. It then sits in `serve_forever()`, so breakpoints in request handling still work after the attach. Only code that runs once at startup is at risk.
- The task is a plain `shell` task that does not mark when the listener is ready. Nothing in the configuration makes VS Code wait for port 5678 before the attach starts. Whether this race happens in practice depends on how fast the container starts, which these files do not show.

```dspatch-references
{"references": [
  {"label": "Attach configuration: connect, pathMappings, justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: launch configuration running main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task runs docker compose up -d --build", "step": "W1.2"},
  {"label": "debugpy listens on 0.0.0.0:5678 without --wait-for-client", "step": "W1.5"},
  {"label": "Port 5678 published to the host", "path": "compose.yaml", "side": "target", "start": 5, "end": 7},
  {"label": "COPY destination that remoteRoot must match", "step": "W1.4"},
  {"label": "Library code (http.server) reachable with justMyCode false", "step": "W1.8"}
], "insufficient": false}
```