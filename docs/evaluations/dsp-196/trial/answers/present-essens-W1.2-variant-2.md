This task is the bridge between the attach configuration from W1.1 and the shell script. The configuration's `preLaunchTask` value, `"Start debugger in dev container"`, has to equal this task's `label` exactly; that is how VS Code finds it. `tasks.json` is a new file in this change. At base there was no task: the only configuration, "Run orders locally", launched `orders.main` directly on the host.

**What decides the outcome:** this is a plain `"shell"` task with no background settings, so VS Code waits for `start-debugger.sh` to exit. Its exit code then decides whether the debug session goes on:

- **Exit 0:** VS Code goes on to attach, which W1.8 covers.
- **Non-zero exit:** the attach does not happen, which W2 covers.

With `"problemMatcher": []`, VS Code does not scan the output. Whatever the script prints is just terminal text, and only the exit code matters.

This only works because the script exits quickly. Its final `docker exec -d` starts debugpy detached and returns at once, while debugpy waits inside the container for the editor to connect. If the script ran the service in the foreground, the task would never finish and the attach would never start. That last line is covered in W1.7.

`options.env` sets the container name (`DEV_CONTAINER=orders-dev`) and the debug port (`DEBUG_PORT=5678`) for the script, which reads them in the next step. The port has to match `connect.port` in the debug configuration, and nothing enforces that. Both are literal values kept in sync by hand.

<!-- dspatch:details -->
**How many places hold the port and the container name.** The values here duplicate the script's own fallbacks, `CONTAINER="${DEV_CONTAINER:-orders-dev}"` and `PORT="${DEBUG_PORT:-5678}"`. The current values would behave the same if the `env` block were removed. The block only matters once someone changes a value. Even then, changing the port here alone would not be enough. `5678` appears in four places:

- this task's `DEBUG_PORT`
- the script's default
- `connect.port` in the debug configuration
- the `"5678:5678"` port mapping in `compose.yaml`

The container name is also repeated as `container_name: orders-dev` in `compose.yaml`.

**How the script runs.** The `command` is the script path alone, with no `bash` before it. The shell task therefore relies on the script's `#!/usr/bin/env bash` line and on the file having its executable bit set. On a Windows host, VS Code's default shell would not run it that way. The code does not settle which host shell is expected.

```dspatch-references
{"references": [{"label": "The task", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Configuration that names the task", "step": "W1.1"}, {"label": "Base configuration launched orders.main directly", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Script defaults for the same variables", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Detached start lets the task exit", "step": "W1.7"}, {"label": "Port mapping and container name in compose", "path": "compose.yaml", "side": "target", "start": 4, "end": 9}, {"label": "Attach through the port", "step": "W1.8"}, {"label": "Failed task blocks the attach", "step": "W2.2"}], "insufficient": false}
```