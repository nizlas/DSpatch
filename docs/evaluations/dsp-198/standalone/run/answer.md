This task connects the debug configuration to the start script. `launch.json` names it as its `preLaunchTask` by its label, "Start debugger in dev container", so the two strings must match exactly. When you press F5, VS Code runs this task first and only then attaches to `localhost:5678`. The file is new in this change (`base/` has only `launch.json`).

**Why the attach works after the task finishes.** VS Code waits for a non-background `preLaunchTask` to exit before it attaches. The script exits almost straight away because its last line uses `docker exec -d`, which starts debugpy detached in the container. debugpy then holds the service with `--wait-for-client` until the editor attaches. If that `-d` were removed, the task would never exit and the attach would never happen.

**The `env` values are set in more than one place.** `DEV_CONTAINER` and `DEBUG_PORT` override the script's defaults, but they use the same values (`orders-dev`, `5678`). The same port and name also appear in three other places:
- `connect.port` in `launch.json`
- the `5678:5678` port mapping in `compose.yaml`
- `container_name: orders-dev` in `compose.yaml`

If you change the port here, you must change it in those places too. The task does not keep them in sync.

**`"problemMatcher": []`** stops VS Code from asking which matcher to use to scan the output. The script only prints a container-not-running message or nothing, so there are no build errors to parse.

**The script runs on the host.** `${workspaceFolder}/scripts/start-debugger.sh` runs on the host machine, not inside the container. Every container action in it goes through `docker exec`. That's also why `id -u`/`id -g` in the script return the host user's IDs, which it uses to `chown` the log folder. On Windows, a `"type": "shell"` task runs in the default shell, which is usually PowerShell. A `.sh` path won't run there unless Bash is configured as the shell (for example, through WSL or Git Bash).