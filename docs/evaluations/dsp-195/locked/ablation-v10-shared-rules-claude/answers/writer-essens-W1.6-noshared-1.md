Once the container is running (W1.5), this part of the configuration is what the editor does. VS Code itself opens a connection to `localhost:5678`. The service never calls VS Code. Compose publishes that port from the debugpy listener inside the container, so the editor connects to debugpy through it.

`pathMappings` links the two file systems. In the container, the code lives at `/app/service`, because the Dockerfile copied it there (W1.4). In the workspace, the same files are in the `service` folder. With this mapping, breakpoints set in the editor match the code running in the container, and stack frames open the local files.

**There is a timing gap to judge here.** The pre-launch task runs `docker compose up -d`. In detached mode that command returns once the container has started, not once debugpy is listening. The task defines no check that waits for the listener to be ready. So nothing in this configuration stops VS Code from trying to attach before debugpy accepts connections. Whether that ever happens depends on timing; nothing here shows it happening.

<!-- dspatch:details -->
The container command in W1.5 starts debugpy without `--wait-for-client`. That means `service.main` starts running right away, whether or not a debugger is attached. Breakpoints in startup code can therefore be passed before VS Code connects. Breakpoints in request handling, which runs later, are not affected by this.

In the earlier revision, this configuration was a `launch` request. It ran `service/main.py` directly on the host in the integrated terminal. There was no container, port or path mapping. `justMyCode: false` is new as well: it lets the debugger step into library code such as the standard library's HTTP server, which the service uses in W1.8.