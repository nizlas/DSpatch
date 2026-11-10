Here the walk moves from the container back to the editor. **The debugger connection starts from VS Code, not from the service.** In the previous step (W1.5), debugpy started listening inside the container on `0.0.0.0:5678`, and Compose published that port to the host. This step is the client side of that connection.

When the user starts the configuration "Attach to the service in the container", VS Code runs the `preLaunchTask` from W1.2. It then opens a debug session as a client to `connect.host` `localhost` and `connect.port` `5678`. That port is the one Compose's `"5678:5678"` mapping forwards to debugpy in the container. The two sides only have the port number in common. Nothing else links them, so changing the port in one place means changing it in the other.

`pathMappings` matters because the debugger and the code see different file paths:

- Inside the container, Python runs the files the Dockerfile copied to `/app/service` (W1.4). Stack frames and breakpoint locations use those paths.
- In the editor, the same files are under `${workspaceFolder}/service`.

The mapping converts between `remoteRoot` and `localRoot`. Without it, breakpoints set in the workspace would not match the code that runs in the container. The mapping is only correct while the copied files match the workspace. The task builds with `--build`, so each start rebuilds the image from the current workspace. Edits made after that are not in the container until the next rebuild.

`justMyCode: false` lets the debugger step into and stop in library code too, such as the standard-library HTTP server reached in W1.8, not only the project's own files.

<!-- dspatch:details -->

**Timing between the task and the attach.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, the command returns once Compose has started the container. It does not wait for the Python process inside. The task has no readiness check, so VS Code sends the attach request when the shell command ends. Nothing in these files makes sure debugpy is already listening by then. The code therefore allows an attach that tries before the listener is ready, and whether that attach fails depends on timing and on how VS Code retries. Neither can be determined from this repository.

**The service does not wait for the debugger.** The Compose command uses `--listen` without `--wait-for-client`. debugpy therefore starts running `service.main` right away, whether or not anyone has attached. Code that runs before the attach finishes, such as the start of `main` and the call to `serve` in the next steps, can run before any breakpoints are set. Once the server is in its request loop (W1.8), requests handled after the attach can stop at breakpoints.

**Compared with the base revision.** In the base, this configuration was `"request": "launch"` with `program` set to `${workspaceFolder}/service/main.py`. VS Code started the script itself on the host, in the integrated terminal. In the target, VS Code starts no program. The container runs the service, and the editor only connects to it. That change is why the target needs the task, the Compose file, the Dockerfile and the path mapping.