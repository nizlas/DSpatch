The script hands the service over to the container here and then ends.

`docker exec -d` asks Docker to start a new process inside the running `orders-dev` container (checked in [W1.3]). With `-d` (detached), Docker returns as soon as that process has been created. It does not wait for the process to run or finish. Line 24 is the last command, and `set -euo pipefail` (line 3) only stops the script early on a failing command. So the exit status of `docker exec -d` becomes the script's exit status. VS Code's pre-launch task "Start debugger in dev container" ([W1.2]) therefore counts as successful as soon as Docker has accepted the process. Whether Python and debugpy actually came up has no effect on it.

The process started is `python -m debugpy … -m orders.main`. debugpy launches first and runs the module `orders.main` as its debuggee. Two of its flags work together with the rest of the walk:

- **`--listen "0.0.0.0:$PORT"`** opens debugpy's own debug server inside the container. It binds to all interfaces, not `127.0.0.1`, because the editor connects through Docker's published port `5678:5678` (compose.yaml, [W1.4]). Docker forwards that traffic to the container's network interface, not to its loopback. `$PORT` comes from `DEBUG_PORT`, which the task sets to `5678`. That matches both the compose mapping and `connect.port` in launch.json.
- **`--wait-for-client`** keeps the program from running until a debugger has attached. Nothing in `orders.main` (opening the log, `serve(port=8000)`) runs until then, so breakpoints near the start of `main()` will still be hit.

From here, two things happen independently. On the host, VS Code sees the task end and starts the attach ([W1.8]). In the container, Python starts, imports debugpy and opens the listener. Nothing in the script or the task makes the attach wait until the listener is ready, and nothing checks that it ever came up. The process's stdout and stderr belong to the detached exec, so they never reach the task terminal. A wrong module path, a missing dependency or a port already in use would only show up later, as a failed or refused attach.

This replaces the base revision's "Run orders locally" configuration. That was a `launch` request: VS Code itself started `orders.main` on the host.

<!-- dspatch:details -->

**Things the code allows but does not handle**

- **Timing of the attach.** The task finishes the moment the process is created. Python and debugpy may need a short time before the listener accepts connections. Whether the first attach can arrive before that depends on timing and on how the VS Code debugpy adapter retries a refused connection. The code does not settle that either way.
- **Repeat runs.** The script never records or stops the process it starts. If a debuggee from an earlier session is still running in the container, a second run starts another `debugpy --listen` on the same port. That one would fail to bind, and the failure would not be visible here. The attach might then connect to the old process instead. These are observations from reading the code, not tested behaviour.
- **Which user and directory.** `docker exec` runs with the container's defaults. The image is `python:3.12-slim` and compose sets no `user:`, so the process runs as root. compose sets `working_dir: /workspace`, which is the bind-mounted project, so `orders` is importable as a package from there. Running as root is why [W1.6] hands `/workspace/logs` to the host user before this line. As we'll see in [W1.9], `main()` writes `orders.log` into that folder once the debugger releases it.

```dspatch-references
{"references": [
  {"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24},
  {"label": "Strict mode that makes the last command's status the script's", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 6},
  {"label": "Task that runs the script and sets DEBUG_PORT", "step": "W1.2"},
  {"label": "Container, working dir and published port", "step": "W1.4"},
  {"label": "Log folder prepared for the host user", "step": "W1.6"},
  {"label": "Attach through the published port", "step": "W1.8"},
  {"label": "What runs once the debugger releases main", "step": "W1.9"},
  {"label": "Base: VS Code launched orders.main locally", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}
], "insufficient": false}
```