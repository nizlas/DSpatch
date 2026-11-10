This is the last line of the script. Here it hands the debug session over to a process that keeps running after the script has finished. The script is new in the target revision. The base revision had no script and ran `orders.main` locally with a `"launch"` configuration.

**What `docker exec -d` does here**

`docker exec` runs a command inside a container that is already running. In this case that is `orders-dev`, the container the earlier steps checked and prepared (W1.3–W1.6). Without `-d`, `docker exec` stays attached until the command ends, and it returns that command's exit code. With `-d` ("detached"), Docker starts the command inside the container and returns straight away. The exit status then only tells you whether Docker managed to start the process. It says nothing about whether Python, debugpy or `orders.main` work.

This matters for the pre-launch task in W1.2. VS Code waits for that task to finish before it attaches. If this line ran in the foreground, the task would never finish: the service runs until it is stopped, so the attach would never happen. With `-d` the script reaches its end and exits with 0, and VS Code continues. The debugpy process stays alive in the container, next to the container's own `sleep infinity` command (W1.4). That idle command is what keeps the container running between debug sessions.

**What the started process does**

`python -m debugpy … -m orders.main` uses debugpy as a wrapper around the service. Python first runs debugpy, and debugpy then runs the module `orders.main` as if it had been started with `python -m orders.main`. Two options control that:

- `--listen "0.0.0.0:$PORT"` makes debugpy open a TCP server for a debugger client. `0.0.0.0` means "every network interface of the container". This is needed because the editor connects from the host to `localhost:5678`. Docker forwards that connection into the container through the port mapping `"5678:5678"` in `compose.yaml`, so it does not arrive on the container's own loopback interface. A debugpy listening on `127.0.0.1` inside the container would not receive it.
- `--wait-for-client` makes debugpy block before running any code from `orders.main` until a client has attached. Without it, the service would already be running, and could have passed early breakpoints, before VS Code connects.

**What is now true, and what is not**

When the script exits, Docker has started the process, and nothing more is known. The script does not check that debugpy has opened the port, that `import orders.main` will succeed, or that the port was free. Because of `-d`, anything the process prints goes nowhere the task output shows. From here, two things run at the same time: VS Code moves on to attach (W1.8), and the process in the container is still starting Python and debugpy. Which of the two reaches the port first depends on timing. The code does nothing to order them.

<!-- dspatch:details -->

**Failures that `-d` hides**

Because only Docker's start-up result reaches the script, `set -euo pipefail` on line 3 only catches errors from Docker itself. For example, `docker exec` fails if the container stopped right after the check. Some cases that would end the task as successful even though nothing is listening:

- **A second debug session.** If a debugpy from an earlier run is still alive in the container, it may still be holding port 5678. The new debugpy then cannot bind the port and exits, and nobody sees it. If the old process is still listening, the editor may attach to that old process instead. The script has no step that stops a previous instance. This is my reading of the code, not something I have seen happen.
- **Import or start-up errors** in `orders.main` show up only after the attach, and only as output inside the debug session (W1.9 shows what `main` does next).

**Port configuration is in two places**

The script reads `DEBUG_PORT` (line 6), and the task sets it to `"5678"` (tasks.json line 8). But `compose.yaml` publishes a fixed `"5678:5678"`, and `launch.json` connects to a fixed `5678`. If `DEBUG_PORT` were changed only in the task, debugpy would listen on a port that is not published, and the attach would fail. Today all three values match.

**Who the process runs as**

`docker exec` uses the container's default user. `compose.yaml` sets no `user:`, so with `python:3.12-slim` that is root. W1.6 handed the `logs` folder to the host user, but files the service creates there are still created by root. Whether that matters is covered in W1.9.

**The race in more detail**

How the attach behaves if it arrives before debugpy is listening depends on VS Code's debugpy extension and on Docker's port forwarding. Neither is part of this repository, so I cannot tell from the code whether the attach retries, fails, or only fails sometimes. The script could close the race by waiting for the port before it exits, but it does not.

```dspatch-references
{"references": [
  {"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24},
  {"label": "Strict mode and port/container defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 6},
  {"label": "Pre-launch task that runs the script", "step": "W1.2"},
  {"label": "Container with idle command and published ports", "step": "W1.4"},
  {"label": "Log folder handed to the host user", "step": "W1.6"},
  {"label": "Attach through the published port", "step": "W1.8"},
  {"label": "What orders.main does once released", "step": "W1.9"},
  {"label": "Fixed port mapping", "path": "compose.yaml", "side": "target", "start": 8, "end": 11},
  {"label": "DEBUG_PORT set by the task", "path": ".vscode/tasks.json", "side": "target", "start": 8, "end": 8},
  {"label": "Base: local launch configuration", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}
], "insufficient": false}
```