This is the hand-off point of the walk. The script starts the service inside `orders-dev` under debugpy, and then it ends. Two things happen here:

- **The script stops here, the service doesn't.** With `-d`, `docker exec` returns as soon as it has started the command. Since this is the last line, the script exits 0, and VS Code treats the pre-launch task from [W1.2] as successful. The debugpy process keeps running in the container on its own, which the `sleep infinity` from [W1.4] keeps alive.
- **The service is held until the editor attaches.** debugpy listens on `0.0.0.0:$PORT` so that a connection forwarded through the port compose publishes can reach it. `--wait-for-client` stops it before `orders.main` runs, so no service code runs until a debugger has connected.

The decisive consequence is that **the task's success only means "launch requested"**. The script never checks that debugpy actually started or is listening. VS Code moves straight on to attach [W1.8] while debugpy may still be starting. Nothing in this change orders those two events, so whether the first connection attempt finds a listener depends on timing.

<!-- dspatch:details -->
Some details that follow from `-d` and the fixed values around this line:

- **Failures here are invisible.** A detached `docker exec` gives no output to the task terminal and doesn't report the process's exit status. If debugpy fails, the script still exits 0. That covers an import error, a crash in startup, or a port that is already bound. You would only notice when the attach in the next step fails.
- **A repeated launch can collide.** Nothing stops a debugpy started by an earlier run. If an earlier session is still alive, for example still waiting for a client, a second run starts another debugpy on the same port. Its bind would be expected to fail, silently as described above, and the attach could reach the old process instead. This is a reading of the code, not something observed.
- **`PORT` is configurable on one side only.** The script reads `DEBUG_PORT` (default 5678), and the task sets it to `"5678"`. But compose publishes `"5678:5678"` as a fixed value, and the launch configuration connects to port `5678` as a fixed value too. If you change `DEBUG_PORT` alone, debugpy listens on a port that is neither published nor attached to.
- **The process runs as the container's user (root).** `docker exec` here passes no `-u`. That is why the previous step [W1.6] gives the `logs` folder to the host user up front. Without that, the folder the service writes to in [W1.9] would be owned by root.
- **`-m orders.main` relies on the working directory.** compose sets `working_dir: /workspace`, and `docker exec` uses it. The bind-mounted package can be imported from there, and that is also the path that `pathMappings` maps to `remoteRoot`.

The script is new in the target revision. In the base revision only `launch.json`, `compose.yaml` and the `orders` package exist.

```dspatch-references
{"references": [{"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24}, {"label": "PORT and CONTAINER defaults from the environment", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Task that runs the script and sets DEBUG_PORT", "step": "W1.2"}, {"label": "Container: fixed port mapping, working_dir, sleep infinity", "step": "W1.4"}, {"label": "Log folder given to the host user", "step": "W1.6"}, {"label": "Attach to the fixed localhost:5678", "step": "W1.8"}, {"label": "The released service writes its log", "step": "W1.9"}], "insufficient": false}
```