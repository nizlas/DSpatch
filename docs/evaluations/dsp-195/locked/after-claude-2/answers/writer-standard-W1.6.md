Here VS Code acts as the **client**. The service never contacts the editor. The `"request": "attach"` we saw in step W1.1 means VS Code starts no Python process of its own. Once the pre-launch task finishes, it opens a connection to whatever is listening at `connect`.

The connection goes through three pieces we've already seen:

1. VS Code connects to `localhost:5678` on the host.
2. Compose's `"5678:5678"` mapping forwards that host port into the container (step W1.3).
3. In the container, `debugpy --listen 0.0.0.0:5678` accepts the connection (step W1.5). It binds to `0.0.0.0` rather than the container's own loopback, so the forwarded traffic can reach it.

**`pathMappings` is what makes breakpoints work.** The debugger in the container reports files under `/app/service`, the folder where the Dockerfile's `COPY` put the source (step W1.4). VS Code knows them as `${workspaceFolder}/service`. With this mapping, a breakpoint you set in a workspace file gets translated to the matching container path, and stack frames get translated back. If `remoteRoot` didn't match the `COPY` destination, the debugger would still connect, but breakpoints wouldn't bind.

`justMyCode: false` means the debugger also stops in and steps into library code, such as `http.server`, which the server uses in step W1.8.

<!-- dspatch:details -->
**Timing between startup and attach.** The pre-launch task runs `docker compose up -d --build service` (step W1.2). With `-d`, the command returns once Compose has started the container, not once debugpy is listening. The task has no readiness check and no background or problem-matcher signal, so nothing in this configuration makes VS Code wait for port 5678 before attaching. Whether a too-early attach fails or gets retried is up to the VS Code Python debugger, which can't be determined from this code.

**The service doesn't wait for the debugger.** The command in step W1.5 uses `--listen` without `--wait-for-client`, so `service.main` starts right away whether an editor is attached or not. Anything that runs before the attach completes, such as startup in `main` or the bind in `serve`, can run before your breakpoints are set. Once attached, breakpoints in request handling are hit normally.

**The mapped files are a copy.** `/app/service` holds the source as it was when the image was built. The `--build` flag rebuilds the image on every launch, so workspace and container match at the start of a debug session. Edits you make during the session don't reach the running container until the next launch.

**Compared with the earlier revision.** In base, this configuration was `"request": "launch"` with `program` set to `${workspaceFolder}/service/main.py`. VS Code ran the script itself, on the host, with no container, port or path mapping involved. In target, the service runs only inside the container, and the editor's role is reduced to attaching to it.