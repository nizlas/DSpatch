Here VS Code starts the connection, not the service. The `attach` request from W1.1 tells the editor to connect to `localhost` on `port` 5678. As W1.5 showed, Compose publishes that host port from the container's debugpy listener, so **this host address reaches the debugpy process running in the container**.

`pathMappings` connects two copies of the same code. The service runs from `/app/service`, where the Dockerfile copied it in W1.4. The reader edits the copy in the workspace's `service` folder. With this mapping, a breakpoint set on a workspace file is matched to the container's file, and stack frames from the container open the matching workspace files.

Two timing consequences follow from the code:

- **Nothing waits for the listener before attaching.** The pre-launch task runs `docker compose up -d`, which returns once the container has been started. No readiness check follows it. The attach request can therefore be sent before debugpy is listening on 5678. Whether that happens depends on timing.
- **The service does not wait for the debugger either.** The command from W1.5 has no `--wait-for-client`, so `service.main` starts running right away. Code that runs before VS Code connects will not stop at breakpoints.

In the earlier revision, this configuration used a `launch` request that ran `service/main.py` locally in the integrated terminal. Now the program runs only inside the container, and the editor only attaches to it.

<!-- dspatch:details -->
`justMyCode: false` lets the debugger step into code outside the project, such as the standard library's `http.server` that W1.8 uses. Only `/app/service` is mapped, though. Library files inside the container image have no counterpart in the workspace, so they cannot be opened from the local `service` folder.

The mapping holds only while the workspace's `service` folder matches what was copied into the image. Every time the task runs, `--build` rebuilds the image from the current workspace, which keeps the two copies in step. If the workspace files change after that build and before attaching, breakpoints can point at lines that differ from the code actually running.