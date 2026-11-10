Once the pre-launch task returns, VS Code makes its own outbound connection. The service never calls the editor. VS Code's debugpy adapter connects to `localhost:5678`, and the container's port publishing forwards that connection to the debugpy listener started by the Compose `command`.

`pathMappings` lets breakpoints work. Inside the container the code runs from `/app/service`, where the Dockerfile copied it. The editor has the same files under `${workspaceFolder}/service`. The mapping translates between these two paths, so breakpoints set in the workspace match the code running in the container.

**The startup order is not guaranteed.** The task runs `docker compose up -d --build`. The `-d` flag makes it return once the container is started, not when debugpy is listening. Nothing in the task waits for the listener to be ready. If the attach request arrives too early, it can fail. This is a possibility from reading the configuration, not something seen happening.

<!-- dspatch:details -->
Two more things matter for how the session behaves:

- **The service doesn't wait for the debugger.** The Compose command starts debugpy with `--listen` but without `--wait-for-client`. So `service.main` starts at once, whether or not VS Code is attached. Code that runs before the attach finishes, such as the startup path to `serve`, can't be stopped at a breakpoint.
- **This replaces the old local launch.** Before this change, the only configuration used `"request": "launch"` with `program` pointing at `service/main.py`. VS Code started the script itself on the host, in the integrated terminal. Now the code always runs in the container, and the editor only attaches to it. `justMyCode: false` also lets the debugger step into library code, such as the standard-library HTTP server used later in the walk.