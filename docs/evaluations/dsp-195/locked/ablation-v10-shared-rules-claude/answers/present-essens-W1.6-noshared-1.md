In this step VS Code connects to the debugger that is already running inside the container. The service never calls back to the editor. Once the pre-launch task has started the container ([W1.2]), VS Code's debugpy adapter connects as a client to `localhost:5678`. It does not start any Python process itself.

Two settings here make this work:

- **`request: "attach"` with `connect`**: the address is `localhost`. It reaches the container only because Compose publishes `"5678:5678"` and the container's debugpy listens on `0.0.0.0` ([W1.5]). If either the port or the listen address changes, this attach fails.
- **`pathMappings`**: inside the container, debugpy reports file paths under `/app/service`, because the Dockerfile copies the code there ([W1.4]). This mapping translates those paths to `${workspaceFolder}/service`. Breakpoints set in the editor then match the running code, and stack frames open the right local files. `remoteRoot` has to stay in sync with the Dockerfile's `COPY` destination.

In the base revision, this was a `launch` configuration that ran `service/main.py` directly on the host in the integrated terminal. The debugger type is the same. What changed is that it now attaches to a process it did not start.

Things to watch for:
- **Timing is not coordinated.** Nothing makes VS Code wait until the listener is ready, and nothing makes the service wait for VS Code.
- **Startup code may run before the debugger attaches.** The Compose command uses `--listen` without `--wait-for-client`, so the service starts right away. Breakpoints in startup code (for example, in `main`) may already have been passed by the time VS Code connects.

<!-- dspatch:details -->

**Pre-launch task and readiness.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, Compose returns as soon as the container is started. It does not wait for debugpy to open its port. So right after a rebuild, the connection to `localhost:5678` could come too early. This is something the configuration allows, not something observed. If it does happen, the symptom is a connection failure, and retrying fixes it.

**`justMyCode: false`** (line 13, just below the shown lines) lets the debugger step into library code, such as the standard library's HTTP server that the service uses in [W1.8].

**Port 8080.** Compose also publishes `8080:8080`. That port is the service's own HTTP port ([W1.7], [W1.8]) and plays no part in the debug connection.

```dspatch-references
{"references": [{"label": "Attach configuration (rest of it)", "path": ".vscode/launch.json", "side": "target", "start": 12, "end": 13}, {"label": "Base: launch configuration that ran main.py on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Pre-launch task", "step": "W1.2"}, {"label": "Dockerfile COPY destination", "step": "W1.4"}, {"label": "debugpy listener and port mapping", "step": "W1.5"}, {"label": "Published debug and HTTP ports", "path": "compose.yaml", "side": "target", "start": 5, "end": 7}], "insufficient": false}
```