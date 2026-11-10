Here the walk goes back to the editor. The preLaunchTask label from W1.1 has run the Compose task, and VS Code now carries out the rest of the configuration. Because `request` is `attach`, the debugpy extension starts no Python process of its own. It opens a client connection to the address in `connect`, which is `localhost` port `5678`.

**The service does not call the editor; the editor connects to the service.** The connection reaches the container only because of the pieces shown in W1.3 and W1.5:
- Compose maps host port `5678` to container port `5678`.
- Inside the container, debugpy listens on `0.0.0.0:5678`, so it accepts the connection that the port mapping brings in.

If you change the port or host in any one of these places without the others, the attach fails.

`pathMappings` covers the other side of the connection. In the container, the code runs from `/app/service`, where the Dockerfile copied it in W1.4. In the workspace, the same files are under `service/`. The mapping translates in both directions:
- Breakpoints you set in workspace files are sent to the matching container paths.
- Stack frames reported for container paths open the matching workspace files.

Without this mapping, breakpoints in the editor would not match the files the container runs.

<!-- dspatch:details -->

**When the attach happens.** The task "Start the service container" is a plain shell task, so VS Code waits for its command to exit before it attaches. `docker compose up -d --build service` builds the image and exits once the container is started. Nothing in this setup waits for debugpy to be listening on port 5678: there is no readiness check in the task and no healthcheck in the Compose service. The attach can therefore come before the listener is ready. Whether that causes a failure depends on timing and on how the debugpy client handles a refused connection, and this repository does not show either.

**The service does not wait for the debugger.** The Compose command starts debugpy with `--listen` but without `--wait-for-client`. The service keeps starting whether or not VS Code has attached, so code that runs before the attach does not stop at breakpoints. That includes the start of `service.main` and the call to `serve`. After attaching, you can still stop in request handling, because `serve_forever` keeps running.

**Library code.** `"justMyCode": false` lets you step into code outside your own files, such as `http.server` inside the container. Only `/app/service` has a mapping, so those library frames do not open as workspace files.

**Compared with base.** In base, the configuration used `"request": "launch"` with `program` set to `${workspaceFolder}/service/main.py`. The extension started the script itself on the host, in the integrated terminal, so it needed no port, task or path mapping. All three are new in target because the process now runs elsewhere.