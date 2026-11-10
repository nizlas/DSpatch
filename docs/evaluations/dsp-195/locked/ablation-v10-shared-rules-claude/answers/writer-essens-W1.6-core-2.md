The pre-launch task has finished, and the container's debugpy is (or will soon be) listening. VS Code now **connects to the debugger as a client** through the `connect` setting. The service does not call VS Code. The editor dials `localhost:5678`, and Compose forwards that port to the debugpy listener inside the container.

`pathMappings` lets breakpoints work across the container boundary. Inside the container the code lives under `/app/service`, which is where the image copied it. On the host the same files are in `${workspaceFolder}/service`. A breakpoint set in the workspace is translated to the container path, and stack frames from the container map back to your files. This depends on the image's copy matching the workspace. A stale image would show breakpoints against code that differs from what actually runs, but `--build` in the task makes that less likely.

One condition affects whether the attach succeeds. The task starts the container with `-d` (detached) and has no readiness check, so VS Code considers it done once `docker compose up` returns. Nothing in this configuration waits for debugpy to start listening. If VS Code tries to attach before the listener is up, the first attempt can fail. That's a reading of the configuration, not something observed in a run.

<!-- dspatch:details -->
Compared with the earlier revision, this replaces a `launch` configuration that ran `service/main.py` directly on the host in the integrated terminal. The service now runs only inside the container, and the editor's only role is to attach to it.

`justMyCode: false` lets the debugger step into library code as well, such as the standard library's HTTP server reached in the last step, and not only the workspace files.

The listener binds to `0.0.0.0` inside the container. Combined with the `5678:5678` port publication, that is what makes `localhost:5678` on the host reach it. A listener bound only to the container's loopback would not be reachable through the published port.