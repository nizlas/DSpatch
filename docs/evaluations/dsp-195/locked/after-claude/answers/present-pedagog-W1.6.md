VS Code is the **client** here. Earlier steps started the server side: debugpy is listening inside the container (W1.5), and Compose forwards port 5678 from the host to it (W1.3). This configuration tells VS Code where to dial and how to translate file paths once the connection is up.

**Attach versus launch.** A debugger can be set up in two ways:

- In *launch* mode, the editor starts the Python process itself, with the debugger built in.
- In *attach* mode, some other mechanism starts the process, and the editor connects to a debugger that is already running inside it.

The base revision used launch mode. Its "Run the service" configuration ran `service/main.py` directly on the host. Here, `"request": "attach"` is needed because Docker owns the process. VS Code cannot start a program inside the container. It can only reach a port.

**The connection.** `connect` names the address VS Code dials: `localhost:5678`. Nothing in this file proves that something is listening there. The link to the server side exists only because the same number appears in three places:

- `--listen 0.0.0.0:5678` in the Compose `command`
- the `"5678:5678"` port mapping in Compose
- `connect.port` here

If you change one, you have to change the others by hand. Nothing checks that they agree.

**Path mappings.** Once connected, the editor and debugpy talk about code as *file path + line number*. They don't agree on paths, though. The Dockerfile copied the sources to `/app/service` (W1.4), and the workspace has them under `${workspaceFolder}/service`. `pathMappings` rewrites the prefix in both directions. For example:

- You set a breakpoint on line 7 of `<workspace>/service/server.py`. VS Code sends debugpy `/app/service/server.py`, line 7.
- The process stops in `/app/service/main.py`, line 5. VS Code opens `<workspace>/service/main.py` at line 5.

The translation only rewrites file names. It doesn't check that the two copies have the same content. If you edit `server.py` after the container was built, line 7 locally may no longer be line 7 in the container. The pre-launch task's `docker compose up -d --build` rebuilds the image from the current workspace on each start, which keeps the copies in sync at start time only.

**`justMyCode: false`** lets the debugger stop in, and step into, code outside the project. An example is the standard-library `http.server` that the service hands requests to in W1.8.

<!-- dspatch:details -->

**What `preLaunchTask` waits for.** As far as these files show, the task is a plain shell command, `docker compose up -d --build service`. With `-d`, Compose returns once the container has been started, not once debugpy inside it has bound port 5678. Nothing in `tasks.json` or `launch.json` waits for the listener to be ready, so the code alone doesn't settle that the port is accepting connections when VS Code dials it. Whether the attach retries or fails on a slow start depends on VS Code and the debugpy extension, not on anything in this repository.

**Breakpoints in startup code.** The Compose command uses `--listen` without `--wait-for-client`. So debugpy does not hold the program until a debugger attaches. `service.main` runs straight away, calls `serve(port=8080)`, and ends up in `serve_forever()`. By the time VS Code attaches, the code in `main()` and the start of `serve()` has most likely already run. Breakpoints there will not be hit on a normal start. Breakpoints in request handling will be, because those paths run each time a request arrives. This follows from the flags as written. It is an observation, not something verified at runtime.

**Library files have no mapping.** The only mapping covers `/app/service`. The standard library in the container lives under the image's Python installation (the `python:3.12-slim` base), which has no local counterpart. When `justMyCode: false` lets execution stop in `http.server`, VS Code cannot map that frame to a workspace file. Normally the debug adapter supplies the source instead. That behaviour comes from the debugger, not from this configuration.

**Who can reach the port.** `connect.host` is `localhost`, but this setting only controls where VS Code dials. Who else can connect is decided on the Compose side. A port entry written as `"5678:5678"` with no host IP publishes on all of the host's network interfaces by default, so the debug port can also be reached from other machines that can reach this host. Anyone who connects to a debugpy listener can run code in the process. Writing the mapping as `"127.0.0.1:5678:5678"` would limit it to the local machine. This is an observation about the Compose entry, not a finding of this review.

```dspatch-references
{"references": [
  {"label": "Attach configuration: connection, path mapping, justMyCode", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Earlier launch-mode configuration", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Pre-launch task", "step": "W1.2"},
  {"label": "Compose service and port mappings", "step": "W1.3"},
  {"label": "Sources copied to /app/service", "step": "W1.4"},
  {"label": "debugpy listener command", "step": "W1.5"},
  {"label": "Startup code that runs before attach", "step": "W1.7"},
  {"label": "Standard-library server reached with justMyCode false", "step": "W1.8"}
], "insufficient": false}
```