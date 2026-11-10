This is the point where the editor reaches the running process. The pre-launch task (W1.2) has started the container, and debugpy is already listening inside it (W1.5). VS Code now **connects to it as a client**. Here it starts nothing itself. In the base revision, this configuration was `"request": "launch"` with a local `program`, so VS Code ran `service/main.py` on the host. In the target revision, the program runs in the container and the editor only attaches to it.

Two settings decide whether the attach works:

- **`connect` → `localhost:5678`.** This address means the host machine, not the container. It reaches debugpy only because Compose publishes `5678:5678` and debugpy listens on `0.0.0.0` (W1.3, W1.5). If either of those changes, nothing is listening at this address.
- **`pathMappings`.** debugpy reports file paths as the container sees them, under `/app/service`, which is where the Dockerfile's `COPY` put the source (W1.4). The mapping translates those paths to `${workspaceFolder}/service`, in both directions. This makes breakpoints set in the editor bind to the files that actually run. `remoteRoot` must stay in step with the Dockerfile's `COPY` destination. If they drift apart, breakpoints silently stop binding.

**Nothing makes the attach wait for the listener.** The task's `docker compose up -d` returns once the container is started, not once debugpy is listening, and no readiness check is defined. Also, debugpy is not run with `--wait-for-client`, so `service.main` runs straight away (W1.7). Startup code may already have run before the editor attaches.

<!-- dspatch:details -->

What follows from those two timing points:

- **First connection attempt.** Whether VS Code's first attempt arrives before debugpy is listening depends on timing. Whether the debugpy extension retries cannot be told from this repository. If it does not retry, the first attach may fail and simply rerunning the configuration may work.
- **Early breakpoints.** A breakpoint in `main()` or at the start of `serve` (W1.7, W1.8) is likely to be passed before the editor connects. Code that handles each request runs after the attach, so breakpoints there are reliable. Adding `--wait-for-client` to the command in `compose.yaml` would make the service wait for the editor before running anything.

`justMyCode: false` (line 13, just outside this excerpt) lets the debugger step into library code too, for example the standard library's server code under `serve`. Those files have no local mapping, so they open as files fetched from the remote process rather than as workspace files.

```dspatch-references
{"references": [
  {"label": "Attach configuration with connect and pathMappings", "path": ".vscode/launch.json", "side": "target", "start": 5, "end": 13},
  {"label": "Base revision: local launch of main.py", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task", "step": "W1.2"},
  {"label": "Port publishing", "step": "W1.3"},
  {"label": "COPY destination that remoteRoot must match", "step": "W1.4"},
  {"label": "debugpy listener without --wait-for-client", "step": "W1.5"},
  {"label": "Module entry that may run before the attach", "step": "W1.7"}
], "insufficient": false}
```