This is the debugger's side of the connection. When the pre-launch task finishes, VS Code does not start any Python itself. Instead, the attach request connects to `localhost:5678`. That is the port Compose publishes from the debugpy listener in the container, as we saw in W1.5. Nothing in the service calls out to the editor; the editor makes the connection.

The `pathMappings` entry lets breakpoints work across the container boundary. Inside the container the code runs from `/app/service`, where the image copied it in W1.4. In the editor the same files are in the workspace's `service` folder. The mapping translates between the two paths, so breakpoints set in your editor match the code that is actually running.

**Nothing makes the attach wait until the listener is ready.** The task runs `docker compose up -d`, which returns once the container is started, and it has no readiness check. So VS Code can try to attach before debugpy is listening.

<!-- dspatch:details -->
A second timing point: the Compose command starts debugpy without `--wait-for-client`. The service begins running straight away, whether or not a debugger is attached. Breakpoints in code that runs at startup, before the attach succeeds, can therefore be missed. Code that runs when a request arrives later can still be debugged normally.

Compared with the base revision, this configuration replaces a `launch` request. That request ran `service/main.py` directly on the host in the integrated terminal. The container, the published port and the path mapping are all new with this change.