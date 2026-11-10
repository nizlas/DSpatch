Here the editor attaches to a service that is already running, rather than starting it. The `attach` request together with `connect` points VS Code at `localhost:5678`. As we saw in W1.5, Compose publishes the container's debugpy listener on that host port, so this address reaches debugpy inside the container. In the earlier revision, this configuration was a `launch` of the service's main script on the host. Now the service runs only in the container, and VS Code acts as a client connecting to it.

**`pathMappings` is what makes breakpoints work.** Inside the container the code lives under `/app/service`, the folder the Dockerfile copied it to in W1.4. On the host the same files are under `${workspaceFolder}/service`. With this mapping, a breakpoint set in the workspace file applies to the matching file in the container, and stack frames from the container open the matching workspace file. The mapping covers only the `service` folder. The container's copy is fixed when the image is built, so the two sides match only as long as the image was built from the current workspace. The pre-launch task's `--build` rebuilds the image on each start (W1.2).

`justMyCode: false` lets the debugger step into code outside the service as well, such as the standard library or debugpy.

<!-- dspatch:details -->
Some timing consequences follow from the container command shown in W1.5, which uses `--listen` without `--wait-for-client`:

- **Startup is not held for the debugger.** The service starts running as soon as the container starts. Code that runs before VS Code attaches will not stop at breakpoints, and that can include the start of `service.main` and server setup. Breakpoints in code that handles requests later will work once VS Code is attached.
- **The attach can come too early.** The task runs `docker compose up -d`, which returns once the container has started, not once debugpy is listening. The configuration does not guarantee that port 5678 is accepting connections when VS Code attaches, so a first attach can fail. Nothing here waits for or checks readiness.

The host side of `connect` is `localhost`, so the configuration assumes Docker publishes ports on the same machine VS Code runs on.