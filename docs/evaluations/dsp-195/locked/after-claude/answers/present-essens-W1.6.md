Here VS Code acts as the **client** of the debug connection. As we saw in W1.5, the container starts debugpy listening on `0.0.0.0:5678`, and Compose publishes that port to the host. Once the `preLaunchTask` from W1.2 has started the container, this configuration connects to `localhost:5678` and joins the Python process that is already running. The service never connects out to the editor.

Two things decide whether this works:

- **The port number is the only link between the two sides.** `connect.port` here, the `"5678:5678"` mapping and the `--listen` address in the Compose `command` all have to agree. Nothing checks this, so if you change one, you have to change the others by hand.
- **`pathMappings` translates file paths in both directions.** The container runs the copy that the Dockerfile placed under `/app/service` (W1.4). The editor shows the same files under `${workspaceFolder}/service`. Without the mapping, breakpoints set in the editor would not bind to the running code, and stack frames would point to files the editor can't open. The mapping is only correct while the container's copy matches the workspace. The task's `--build` rebuilds the image from the workspace each time the debugger starts, but edits made after that are not in the container until the next start.

`justMyCode: false` allows stepping into and stopping in library code, such as the standard-library HTTP server that W1.8 reaches, not just the project's own files.

Compared with base, this replaces a local launch (`"request": "launch"` of `service/main.py` on the host) with attaching to the containerized process.

<!-- dspatch:details -->

**What attaching means for timing.** The Compose `command` starts debugpy without `--wait-for-client`. The service therefore goes straight into `main()` and `serve(port=8080)` (W1.7, W1.8) whether or not VS Code has connected. This follows from the code, but I haven't observed it running:

- Breakpoints in startup code that runs before the attach completes will probably be missed. Breakpoints in request-handling code are hit, because requests arrive after the debugger has connected.
- `docker compose up -d` returns once the container has started. That is not necessarily when debugpy is accepting connections. The task does nothing to wait for the listener, so the first connect attempt can fail if it arrives too early. VS Code's retry behaviour isn't defined in this repository.

**Exposure.** debugpy listens on `0.0.0.0` inside the container, and Compose publishes `5678` without a host IP. With Docker's usual defaults, that makes the debug port reachable on all of the host's network interfaces, not just from `localhost`. The `localhost` in `connect.host` only controls where VS Code connects; it doesn't limit who else can connect. Binding the port as `"127.0.0.1:5678:5678"` would limit it to the local machine.

```dspatch-references
{"references": [{"label": "Attach configuration: connection, path mapping, justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Launch configuration it replaces", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Pre-launch task", "step": "W1.2"}, {"label": "Image copies service to /app/service", "step": "W1.4"}, {"label": "debugpy listener without --wait-for-client", "step": "W1.5"}, {"label": "Published debug and service ports", "path": "compose.yaml", "side": "target", "start": 5, "end": 7}, {"label": "Service entry that runs before or during attach", "step": "W1.7"}]}
```