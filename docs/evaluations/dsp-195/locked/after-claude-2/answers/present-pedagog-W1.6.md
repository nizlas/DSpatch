Here VS Code becomes a debugger **client**. It opens a TCP connection to a debug server that is already running inside the container. The service never reaches out to the editor. That's what `"request": "attach"` means (as we saw in [W1.1]): VS Code starts no Python process. It only connects to one that is already running.

**What `connect` reaches.** When the pre-launch task finishes, VS Code connects to `localhost:5678`. The connection passes through two pieces from earlier steps:

1. Compose's `"5678:5678"` port mapping forwards host port 5678 into the container ([W1.3]).
2. Inside the container, `python -m debugpy --listen 0.0.0.0:5678` accepts the connection ([W1.5]). It binds to `0.0.0.0` (all interfaces) rather than `127.0.0.1`. Inside a container, loopback means the container's own loopback, so traffic forwarded from the host would never reach a listener bound there.

You can think of it like a remote shell: the container runs the "server" (debugpy), and VS Code is the client that connects to it.

**Why `pathMappings` is needed.** A debugger works with file paths. When you set a breakpoint, VS Code sends a path and a line number. When the program stops, debugpy sends back a stack whose frames name files. The two sides see the same source under different paths:

- On your machine: `${workspaceFolder}/service/server.py`
- In the container: `/app/service/server.py`, because the Dockerfile sets `WORKDIR /app` and runs `COPY service /app/service` ([W1.4]). The module is then started as `-m service.main` from `/app`.

The mapping rewrites one prefix into the other in both directions. Breakpoints go out with container paths, and stack frames come back as workspace files you can open. If `remoteRoot` didn't match the `COPY` destination, the connection would still work, but breakpoints would stay unbound because debugpy would never see code at the paths it was given.

**Compared with the base revision**, this is a different model. Before, the configuration was `"request": "launch"` with `"program": "${workspaceFolder}/service/main.py"`, so VS Code started Python itself on the host. Paths were identical on both sides and no mapping was needed.

<!-- dspatch:details -->

**What happens before the debugger is attached.** debugpy is started without `--wait-for-client` (compose.yaml line 4). The service therefore starts running as soon as the container starts, whether or not VS Code is connected. The consequences:

- Startup code (`main()` calling `serve(port=8080)`, and the server setup in [W1.7] and [W1.8]) may already have run by the time VS Code attaches. Breakpoints there can be missed.
- Code that runs per request, inside `serve_forever()`'s handler threads, does run after attach, so breakpoints there work as expected.

Adding `--wait-for-client` would make the service block until a debugger connects. That would change how the container behaves when nobody attaches.

**Timing of the connection (an observation, not something I verified at runtime).** The pre-launch task is a plain `shell` task running `docker compose up -d --build service` (.vscode/tasks.json lines 5–7). VS Code waits for that command to exit. `-d` returns once the container has started, but that doesn't guarantee debugpy is already listening on 5678. Whether the attach succeeds on the first try then depends on that timing and on how the VS Code Python debugger handles a refused connection. These files don't settle either point.

**`justMyCode: false`** (line 13, just below this excerpt) lets the debugger stop in and step into library code, such as `http.server.ThreadingHTTPServer` and `SimpleHTTPRequestHandler` from [W1.8]. With the default (`true`), stepping would skip over them.

**Exposure of the debug port (an observation).** `"5678:5678"` without a host IP makes Docker publish the port on all host interfaces, not only on `localhost`. A debugpy server accepts any connection and lets the client evaluate arbitrary code in the process. Anyone who can reach the host on that port can therefore run code in the container. Writing the mapping as `"127.0.0.1:5678:5678"` would limit it to the local machine, and the `connect` setting here would still work.

```dspatch-references
{"references": [{"label": "Attach configuration: connect and pathMappings", "path": ".vscode/launch.json", "side": "target", "start": 5, "end": 13}, {"label": "Attach mode selected", "step": "W1.1"}, {"label": "Pre-launch task command", "path": ".vscode/tasks.json", "side": "target", "start": 5, "end": 7}, {"label": "Port mapping 5678", "step": "W1.3"}, {"label": "COPY destination that remoteRoot must match", "step": "W1.4"}, {"label": "debugpy listens on 0.0.0.0:5678 without --wait-for-client", "step": "W1.5"}, {"label": "Startup code that may run before attach", "step": "W1.7"}, {"label": "Library server code reachable with justMyCode false", "step": "W1.8"}, {"label": "Base: local launch configuration", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}], "insufficient": false}
```