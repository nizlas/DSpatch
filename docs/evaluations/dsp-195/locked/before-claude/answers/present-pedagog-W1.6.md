Here VS Code attaches its debugger to a service that the earlier steps have already started inside a container. The configuration has to do two things: reach the debugger across the container boundary, and translate file paths between the container and your workspace.

**Launch versus attach.** In the base revision this configuration used `"request": "launch"` with a `program`. That means VS Code started `service/main.py` itself, on your machine, with the debugger built in. In the target revision it uses `"request": "attach"`. Now VS Code starts nothing. Something else has already started the program with a debugger inside it, and VS Code only connects to it. That "something else" is the compose `command` from W1.5: `python -m debugpy --listen 0.0.0.0:5678 -m service.main`. debugpy is the Python debugger. With `--listen` it opens a network port and waits, like a small server. VS Code is the **client** that dials in. The connection always goes from the editor to the container, never the other way.

**What the startup order looks like.** When you press F5, VS Code first runs the task named in `preLaunchTask` (W1.2). VS Code runs a `preLaunchTask` for both launch and attach configurations; it is not tied to attach. That task is `docker compose up -d --build service`. It has no `isBackground` setting, so VS Code waits for the command to exit. Then it opens the connection described in `connect`.

**Why `localhost:5678` reaches the container.** VS Code runs on the host, so `localhost` here means your machine, not the container. The address works only because two settings from earlier steps line up:

- Compose publishes `"5678:5678"`. A connection to port 5678 on the host is forwarded to port 5678 inside the container (W1.3).
- debugpy listens on `0.0.0.0`, which means every network interface in the container. If it listened on `127.0.0.1`, it would accept only connections made from inside the container, and forwarded traffic from the host would not reach it (W1.5).

If either of these changes, this address no longer reaches debugpy.

**Why `pathMappings` is needed.** The debugger and the editor name the same file differently. The Dockerfile copies the source to `/app/service` (W1.4), so inside the container debugpy sees `/app/service/server.py`. You have the same file open as `<workspace>/service/server.py`. The mapping replaces one prefix with the other, in both directions:

- You set a breakpoint on `server.py` line 7 in the editor. VS Code sends it to debugpy as `/app/service/server.py:7`.
- debugpy stops there and reports `/app/service/server.py`. VS Code opens your local `service/server.py`.

`remoteRoot` has to match the `COPY` destination in the Dockerfile. If they differ, breakpoints you set in the editor don't match any file that runs.

**What this code does not guarantee.** Nothing makes the attach wait until debugpy is actually listening. `docker compose up -d` returns once the container has started, not once the listener is ready, and the task has no readiness check. And debugpy is started without `--wait-for-client`, so `service.main` runs at once, whether or not an editor is attached. Code that runs at startup, like `main()` calling `serve` (W1.7) and the server binding its port (W1.8), can be past a breakpoint before VS Code connects.

<!-- dspatch:details -->

**Why the timing matters less for request handling.** The setup code in `serve` runs once, at startup, so it is the code most likely to be missed. After that, `httpd.serve_forever()` keeps the process alive and handles each request as it arrives. A breakpoint on code that runs per request can still be hit after a late attach, as long as the request comes in after VS Code has connected.

**What the client side can't tell you.** If the first connection attempt arrives before debugpy is listening, the outcome depends on how the VS Code Python debugger extension handles a refused connection. That code isn't in this repository, so whether it retries or fails can't be settled here. Two common ways to make the startup deterministic, neither of which this change uses:

- Add `--wait-for-client` to the debugpy command. The program then pauses until an editor attaches. The cost is that the service stays stopped when nobody attaches.
- Make the task wait until the port is ready, for example with a health check plus `docker compose up --wait`, or a background task with a problem matcher that watches for a "ready" message.

**`justMyCode: false` (line 13) and paths outside the mapping.** With this setting the debugger also steps into library code, not only your own. That matters here, because the request handler is the standard library's `SimpleHTTPRequestHandler` (`service/server.py` line 5). Those library files live under the container's Python install, which no `pathMappings` entry covers. How VS Code shows such unmapped files depends on the extension, not on anything in this repository.

**Why `/app` is the right base.** The Dockerfile sets `WORKDIR /app`, and the service runs as the module `service.main`. With `-m`, Python puts the working directory on its import path, so `/app/service` is imported as the package `service`. That is also why `main.py` can write `from service.server import serve`. So the container path `/app/service` really is the folder debugpy reports, and the mapping's `remoteRoot` points at the files actually being run.

```dspatch-references
{"references": [{"label": "Attach configuration with connect and pathMappings", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14}, {"label": "Earlier launch configuration that ran the program locally", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Pre-launch task", "step": "W1.2"}, {"label": "Published ports", "step": "W1.3"}, {"label": "COPY destination that remoteRoot must match", "step": "W1.4"}, {"label": "debugpy listening on 0.0.0.0:5678", "step": "W1.5"}, {"label": "Module entry", "step": "W1.7"}, {"label": "Server binds and serves", "step": "W1.8"}, {"label": "Standard-library request handler", "path": "service/server.py", "side": "target", "start": 5, "end": 7}, {"label": "WORKDIR and COPY in the image", "path": "Dockerfile", "side": "target", "start": 2, "end": 4}], "insufficient": false}
```