Here the walk switches sides. The earlier steps followed the container: in W1.5, debugpy started listening on port 5678 inside it, and Compose published that port to the host. This step is the **VS Code side of that connection**. The service never calls VS Code. VS Code's debugger connects, as a client, to the listener that is already waiting.

**Attach instead of launch.** A debug configuration with `"request": "launch"` makes VS Code start the Python program itself. In the base revision, that is how this configuration worked: it ran `main.py` directly. With `"request": "attach"`, VS Code starts nothing. It expects a program that is already running with a debug server inside it, and connects to that server. Starting the program is now the job of the pre-launch task (W1.2) and the Compose command (W1.5).

**Where it connects.** `connect` points at `localhost`, port `5678`. On the host there is no debugpy process. The `"5678:5678"` entry under `ports` in Compose makes Docker forward the host's port 5678 to port 5678 in the container. That is where `--listen 0.0.0.0:5678` has debugpy waiting. The `0.0.0.0` matters: it makes debugpy accept connections on every network interface in the container, including the one Docker forwards to. A listener bound only to the container's own loopback address would not be reachable this way.

**Why `pathMappings` is needed.** The debugger and the running code see the same files under different paths:

- VS Code knows the file as `${workspaceFolder}/service/server.py`.
- The Python process in the container knows it as `/app/service/server.py`, because the Dockerfile copies `service` to `/app/service` (W1.4).

Suppose you set a breakpoint in the workspace file. The mapping tells VS Code to ask debugpy for a breakpoint in `/app/service/...`. When the debugger stops, debugpy reports a container path, and VS Code maps it back to the workspace file so it can open it. Without the mapping, breakpoints would not match any file the container runs.

<!-- dspatch:details -->

**Timing: what the code guarantees and what it leaves open.**

1. VS Code runs the `preLaunchTask` first. That task is `docker compose up -d --build service`. The `-d` (detached) flag makes the command return once Compose has started the container. It does not wait for the process inside to reach any particular state.
2. The task defines no readiness check. Nothing in it waits until debugpy is actually listening on 5678. As far as these files show, VS Code may send the attach request before the listener exists. Whether that fails or VS Code retries depends on VS Code and the debugpy extension, not on code in this change.
3. The Compose command does not pass `--wait-for-client` to debugpy. So debugpy does not hold `service.main` back until a debugger attaches. The service starts at once, whether or not VS Code is connected. Breakpoints only take effect after the attach, so a breakpoint on code that runs during startup can be passed before the debugger is there.

The next step (W1.7) goes back to the container's Python process. That is a change of order: the module was started in W1.5, before this attach. The walk only explains it now.

**The mapping depends on the image being current.** The container runs copies made by `COPY` when the image was built. It does not run the workspace files themselves. `pathMappings` only translates paths; it assumes both sides hold the same content. The task's `--build` flag rebuilds the image on each start, so edits made before starting a debug session end up in the container. Edits made during a session do not, so lines can stop matching until the next start.

**`justMyCode: false`** lets the debugger stop in and step into code outside the workspace too. One example is the standard library's `http.server` module, which the server step (W1.8) builds on.