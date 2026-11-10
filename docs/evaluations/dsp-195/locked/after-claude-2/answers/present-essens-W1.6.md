Here VS Code is the **client**. Once the pre-launch task returns, the debugger connects to `localhost:5678`. Compose's `"5678:5678"` mapping forwards that port into the container ([W1.3]), where `debugpy --listen 0.0.0.0:5678` accepts it ([W1.5]). The listener binds to `0.0.0.0` so that forwarded traffic can reach it. Without that, it would only accept connections from inside the container.

**`pathMappings` is what makes breakpoints work.** The container runs the code from `/app/service`, because the Dockerfile's `COPY` put it there ([W1.4]). In the workspace the same files are under `${workspaceFolder}/service`. The mapping converts between the two: breakpoints you set in the editor go to container paths, and stack frames come back as workspace paths. If `remoteRoot` drifted from the `COPY` destination, the debugger would still attach, but breakpoints would never bind. Nothing in the repository checks that the two stay in sync.

**One consequence for the main picture:** the container command has no `--wait-for-client`. So the service starts running as soon as the container starts, whether or not VS Code has attached. This means:
- Breakpoints in request handling ([W1.8]) work, because requests arrive after the attach.
- Breakpoints in startup code ([W1.7]) may already have run before the debugger connects.

`justMyCode: false` lets the debugger step into library code too, such as the standard-library HTTP server.

<!-- dspatch:details -->

**Compared with the base revision:** the base had a single `"request": "launch"` configuration. It ran `${workspaceFolder}/service/main.py` directly on the host in the integrated terminal, so it needed no port, task or path mapping. This change replaces it completely: the repository no longer has a configuration for running the service locally without Docker.

**A possible timing gap (my reading, not verified):** the pre-launch task runs `docker compose up -d --build service`. `up -d` returns once the container has started, not once debugpy is listening on 5678. Whether VS Code's first connection attempt can arrive too early depends on how the debugpy extension retries, and the repository doesn't settle that. If it did fail, starting the configuration again would succeed because the container is already up.

**Other notes:**
- The mapping covers only the `service` folder. That's enough, because `COPY` brings in nothing else and the module is started as `service.main` from `WORKDIR /app`.
- Library frames (from `justMyCode: false`) are container paths with no mapping. VS Code can show them only as read-only source fetched from the debugger.

```dspatch-references
{"references": [
  {"label": "Attach configuration: connect target, path mapping, justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: local launch configuration that this replaces", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task returns after a detached compose up", "path": ".vscode/tasks.json", "side": "target", "start": 5, "end": 7},
  {"label": "debugpy started without --wait-for-client", "path": "compose.yaml", "side": "target", "start": 4, "end": 4},
  {"label": "Port mapping", "step": "W1.3"},
  {"label": "COPY destination that remoteRoot must match", "step": "W1.4"},
  {"label": "debugpy listener", "step": "W1.5"},
  {"label": "Startup code that may run before attach", "step": "W1.7"},
  {"label": "Request serving", "step": "W1.8"}
], "insufficient": false}
```