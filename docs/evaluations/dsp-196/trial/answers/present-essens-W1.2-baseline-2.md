This step is the bridge between the debug configuration and the script. The `preLaunchTask` in the debug configuration (W1.1) names this task by its `label`, and the two strings match exactly. This task is the only one in `tasks.json`, which is a new file in this change. Before the change there was no task: the old configuration was a local `launch` of `orders.main`.

The task is a plain `shell` task with no background settings. **VS Code therefore waits for `start-debugger.sh` to exit, and the exit code decides whether the debug session goes on to attach.** Exit 0 leads to the attach in W1.8. A non-zero exit stops it, which is what W2 follows. The empty `problemMatcher` means nothing scans the output. The exit code is the only signal, and messages from the script are just text in the terminal.

This works because the script's last command starts the service detached (W1.7). So "task finished" means "debugpy has been launched in the container". It does not mean the service is ready.

`options.env` passes the container name (`orders-dev`) and the port (`5678`) to the script, which reads them in the next step. Nothing ties the port to `connect.port` in the debug configuration. Both are literals that someone has to keep in sync by hand.

<!-- dspatch:details -->
The same values appear in more places than just these two:

- **Port:** `5678` is also the published port mapping in the compose file (W1.4). It is also the fallback in the script, `PORT="${DEBUG_PORT:-5678}"`. So four places must agree: the task env, the script default, the compose mapping and `connect.port`. If you change only the task's `DEBUG_PORT`, debugpy would listen on a port the compose file doesn't publish, and the attach would fail.
- **Container name:** `orders-dev` must match `container_name` in the compose file. The script also uses it as its default.

**Two things this task assumes but the code doesn't settle (my observations, not verified):**

- **Unix-like shell:** a `shell` task runs `command` through VS Code's default shell. The script is bash and uses `id -u`/`id -g` on the host. On a Windows host with PowerShell or cmd as the task shell, the `.sh` path would not run as written. Nothing in `tasks.json` sets a shell or adds a `windows` override.
- **Executable script:** the task runs the script directly by path, not as `bash script.sh`. So the file must have its executable bit set in the repository. That can't be checked from the files available here.

```dspatch-references
{"references": [{"label": "The task VS Code runs before attaching", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Debug configuration that names this task", "step": "W1.1"}, {"label": "Script reads DEV_CONTAINER and DEBUG_PORT with defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Container check that can end the task with exit 1", "step": "W1.3"}, {"label": "Compose service: container name and published port", "step": "W1.4"}, {"label": "Detached start, the script's last command", "step": "W1.7"}, {"label": "Attach through the published port", "step": "W1.8"}, {"label": "Failed task blocks the attach", "step": "W2.2"}, {"label": "Old configuration: local launch, no task", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}], "insufficient": false}
```