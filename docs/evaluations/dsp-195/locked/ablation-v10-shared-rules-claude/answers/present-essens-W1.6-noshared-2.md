Here VS Code **connects to** the debug listener the container started in W1.5. The service never contacts the editor. VS Code reaches it after the pre-launch task (W1.2) has brought the container up.

Two settings decide whether this works:

- **`request: "attach"` with `connect` to `localhost:5678`.** VS Code does not start a Python process here. It connects to one that is already running. `localhost` reaches the container only because Compose publishes `"5678:5678"`. The connection then reaches debugpy because debugpy listens on `0.0.0.0` inside the container, not on the container's own loopback.
- **`pathMappings`.** debugpy reports file paths as Python sees them in the container, which are under `/app/service` because the Dockerfile copies the source there (W1.4). The mapping turns those paths into `${workspaceFolder}/service`. That is what lets editor breakpoints match the running code and lets stack frames open your local files. `remoteRoot` has to keep matching the Dockerfile's `COPY` destination. If the two drift apart, the debugger still attaches, but breakpoints never bind.

On the base revision this configuration was a `launch` that ran `service/main.py` directly on the host in the integrated terminal. Now the same debugger type attaches to a process it did not start. The next step (W1.7) follows that process into the service module.

<!-- dspatch:details -->
Two points about timing follow from the code. I haven't seen either happen at runtime:

- **The service does not wait for the debugger.** The Compose command runs `debugpy --listen` without `--wait-for-client`, so the service starts running whether or not VS Code is attached. Breakpoints in code that runs only at startup can be passed before the attach completes. Code that handles requests later is not affected.
- **There may be a connection race.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, the task can finish once the container has started, which may be before debugpy has opened port 5678. In that case the first `connect` attempt could fail and the user would retry.

`justMyCode: false`, on line 13 just after this range, lets the debugger also stop in library code. That includes the standard library's `http.server`, which the server uses in W1.8.

```dspatch-references
{"references": [{"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 5, "end": 13}, {"label": "Previous launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 5, "end": 9}, {"label": "Pre-launch task starts Compose", "step": "W1.2"}, {"label": "Where the source is copied to /app/service", "step": "W1.4"}, {"label": "debugpy listener on 0.0.0.0:5678", "step": "W1.5"}, {"label": "Published debug and HTTP ports", "path": "compose.yaml", "side": "target", "start": 5, "end": 7}, {"label": "Server that the library code runs in", "step": "W1.8"}], "insufficient": false}
```