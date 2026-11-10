**The editor makes this connection; the service does not call out to it.** The `"request": "attach"` from the first step (W1.1) means VS Code starts no Python process. Its Python debugger acts as a client and opens a network connection to a debugpy server that is already running. In the earlier revision this configuration used `"request": "launch"` with a `program`, so VS Code ran `service/main.py` locally. Now the program runs in the container, and VS Code only connects to it.

**`connect`: where the editor dials.** `host: "localhost"` and `port: 5678` point at the developer's own machine, not at the container. The connection still reaches debugpy because of two settings seen earlier:

1. The `ports` entry `"5678:5678"` in the Compose file (W1.3) tells Docker to forward the host's port 5678 to port 5678 inside the container.
2. The container command (W1.5) makes debugpy listen on `0.0.0.0:5678`, which means all of the container's network interfaces. That is what lets traffic forwarded from outside reach it. If it listened only on `127.0.0.1` inside the container, the forwarded traffic would not arrive.

**`pathMappings`: why the editor and the container need a translation.** A debugger names code by file path. Breakpoints are sent as "file X, line N", and each stack frame comes back as "file Y, line M". But the two sides see different paths:

- The editor has the source at `${workspaceFolder}/service/...`.
- The container's Python runs the copies the Dockerfile placed under `/app/service` (W1.4).

The mapping is a prefix swap between `localRoot` and `remoteRoot`. For example, a breakpoint on line 6 of the workspace's `service/server.py` is sent as `/app/service/server.py`, line 6. When the program stops there, the reported path is turned back into the workspace file, so the editor can open and highlight it. Without the mapping, debugpy would get paths that don't exist in the container, and breakpoints would not bind.

<!-- dspatch:details -->

**The mapping assumes both sides hold the same files.** It translates paths only; it does not check that the contents match. The image gets the source through `COPY` when the task runs `docker compose up -d --build`. The Compose file mounts no volume. So the container runs the source as it was when the image was last built. If a file is edited after that and not rebuilt, breakpoints in it can land on lines that no longer match the code that runs. Starting the debug configuration again runs the task again, which rebuilds the image. That resolves the mismatch for that session.

**What is ordered and what is left to timing.**

- **Ordered:** VS Code runs the `preLaunchTask` before attaching. The task is a plain shell task, and nothing in the task file marks it as a background task, so VS Code waits for `docker compose up -d --build service` to exit.
- **Left to timing:** `-d` (detached) makes Compose return once the container has been started. It does not wait for the process inside to be ready. The task file has no readiness check, and the Compose file has no healthcheck. So nothing in this configuration guarantees that debugpy is already listening on 5678 when the attach request is sent. In practice debugpy probably starts quickly, but that is timing, not a guarantee. What the editor does if the connection is refused (an error or a retry) is up to the debugger extension, not this code.

**The service does not wait for the debugger either.** The container command has no `--wait-for-client`. Without it, debugpy starts listening and then runs `service.main` at once, whether or not anyone has attached. Code that runs before VS Code connects, such as module imports and the start of `serve` (followed in W1.7 and W1.8), runs without pausing at breakpoints. Breakpoints in the request-handling code still work, because that code runs later, when HTTP requests arrive on port 8080.