Here VS Code acts as the **client**. The service does not call out to the editor. Once the pre-launch task finishes, VS Code's debugpy adapter connects to `localhost:5678`. Compose forwards that port to the debugpy listener started in the container (W1.5).

`pathMappings` matters because the code runs from a different place than the files you edit. The container runs the copy that the image placed under `/app/service` (W1.4), while you set breakpoints in the workspace's `service` folder. With this mapping, VS Code can match breakpoints and stack frames between the two. The mapping only lines up while the image holds the current source. The task passes `--build` on each start, and Compose mounts no source into the container, so edits made after startup don't reach the running container until the next start.

Two timing points decide what you can actually debug:

- **Nothing makes the attach wait for the listener.** The task runs `docker compose up -d`, which returns once the container has started, not once debugpy is listening. No readiness check exists. Whether the first attach succeeds depends on how fast the container starts.
- **The service also doesn't wait for the debugger.** The container command uses `--listen` without `--wait-for-client`, so `service.main` starts running right away (W1.7). Breakpoints in startup code can pass before VS Code has attached.

<!-- dspatch:details -->
In the base revision this configuration was a `launch` request that ran `service/main.py` directly on the host, in the integrated terminal. The change replaces that with this attach-to-container setup, so the program now runs only inside the container.

`justMyCode: false` lets the debugger step into code outside the workspace, such as `http.server` from the standard library, which the server in W1.8 is built on.

If the attach fails because of the timing above, running the configuration again usually works. That second run starts the task again, but `compose up` leaves an up-to-date running container alone. This is a conclusion from how Compose usually behaves, not something this repository sets up or tests.