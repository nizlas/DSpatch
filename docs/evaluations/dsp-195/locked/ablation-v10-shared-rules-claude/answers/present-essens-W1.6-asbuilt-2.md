Here the walk returns to the editor. In the previous step [W1.5], the container started debugpy listening on port 5678, and Compose published that port to the host. Once the pre-launch task finishes, VS Code uses this part of the same launch configuration. **VS Code makes the connection.** It reaches out to a listener that is already running. The service never contacts the editor.

Three settings make the attach work:

- **`connect` to `localhost:5678`.** This address reaches the container only because of the `"5678:5678"` port mapping in Compose. Inside the container, debugpy listens on `0.0.0.0`, so it accepts connections forwarded from the host. Connection setup depends on all three agreeing: this port, the Compose mapping and the debugpy `--listen` address.
- **`pathMappings`.** Inside the container, the debugger reports file paths as `/app/service/...`, because the Dockerfile copied the code there [W1.4]. This mapping translates those paths to `${workspaceFolder}/service/...`. Without it, breakpoints set in the editor would not match the running code, and stack frames would not open local files. `remoteRoot` is a second copy of the Dockerfile's `COPY` destination, and nothing keeps the two in sync.
- **`justMyCode: false`** (line 13, just outside the highlighted range). The debugger can also step into library code, such as the standard-library HTTP server used in [W1.8].

In the base revision, this was a `launch` configuration that ran `service/main.py` directly on the host. The debugger type is still `debugpy`, but now it attaches to a process it did not start.

**One consequence for the timing.** The Compose `command` starts debugpy without `--wait-for-client`. So the service doesn't wait for VS Code: it goes straight into `main()` and starts the server, whether or not a debugger is attached. Breakpoints in the module entry and server setup, which the next steps show [W1.7, W1.8], can be passed before VS Code connects. Breakpoints in request handling will still be hit.

<!-- dspatch:details -->
Two more things follow from how the pieces fit together. Both are inferred from the configuration, not something I saw happen:

- **A possible race at startup.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, the command returns once the container has started, not once debugpy is listening. VS Code connects right after the task ends. If debugpy isn't ready yet, the first attach could fail and need a retry. Nothing in the target revision waits for the port to be ready.
- **The mapping covers only `service/`.** The mapping is `${workspaceFolder}/service` ↔ `/app/service`. Python runs from `WORKDIR /app` with `-m service.main`, so this covers all the project code that exists. Files outside `service/` would need their own mapping entry. Library files, such as `/usr/local/lib/python3.12/...`, have no local copy. VS Code shows those frames from source it fetches through the debug adapter rather than opening a workspace file.

```dspatch-references
{"references": [
  {"label": "Attach configuration with connect, pathMappings and justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Base: launch configuration running main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task (docker compose up -d)", "step": "W1.2"},
  {"label": "Dockerfile COPY destination that remoteRoot mirrors", "step": "W1.4"},
  {"label": "debugpy --listen 0.0.0.0:5678 without --wait-for-client", "step": "W1.5"},
  {"label": "Published debug port", "path": "compose.yaml", "side": "target", "start": 5, "end": 7},
  {"label": "Module entry that runs before attach", "step": "W1.7"}
], "insufficient": false}
```