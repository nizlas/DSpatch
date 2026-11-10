The **"Debug orders in the dev container"** configuration names this task in its `preLaunchTask` ([W1.1]). VS Code finds the task by its `label`, so the two strings must match exactly. Both `tasks.json` and this task are new in this change; the base revision has no `tasks.json`.

**How it gates the attach.** This is a plain `shell` task. It is not a background task, so VS Code waits for `start-debugger.sh` to exit and then looks at the exit code:
- **Zero:** the debug session goes on to attach to `localhost:5678`.
- **Non-zero:** the launch stops there (that path is [W2.2]).

The empty `problemMatcher` means VS Code doesn't scan the task's output for errors, so the exit code is the only signal.

The script only works with this model because of how it ends. Its last command is `docker exec -d …`, which starts debugpy in the background and returns at once. So the script exits soon after starting debugpy and doesn't stay running for the life of the service.

**What it hands over.** The task sets `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in the script's environment. The script reads them in the next step ([W1.3]).

<!-- dspatch:details -->

**The variables repeat the script's defaults.** The script's first lines are `CONTAINER="${DEV_CONTAINER:-orders-dev}"` and `PORT="${DEBUG_PORT:-5678}"`. The task passes exactly those values, so leaving out the `env` block would change nothing today. What the block does is make the values visible in the editor's configuration.

**The port is not set in one place.** `DEBUG_PORT` only controls which port debugpy listens on inside the container. Two other places have `5678` written directly:
- the attach target in `launch.json`: `"connect": { "host": "localhost", "port": 5678 }`
- the port mapping in `compose.yaml`: `"5678:5678"`

If someone changes `DEBUG_PORT` here and nowhere else, debugpy will listen on a port that is neither published nor the one VS Code connects to. The container name likewise has to match `container_name: orders-dev` in `compose.yaml` ([W1.4]).

**Which shell runs it.** I haven't verified this, but it looks worth checking. A `shell` task runs `command` through VS Code's default shell. Here the command is a path to a `.sh` file, so it depends on two things:
- the file being executable, so its `#!/usr/bin/env bash` line is used;
- the default shell being one that can run it.

On macOS or Linux that normally works. On a Windows host whose default shell is PowerShell or cmd, it may not run as written. Nothing in this change sets the shell or adds an OS-specific override.

```dspatch-references
{"references": [{"label": "The pre-launch task", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Where the task is referenced", "step": "W1.1"}, {"label": "Hard-coded attach port", "path": ".vscode/launch.json", "side": "target", "start": 9, "end": 9}, {"label": "Script defaults for the same variables", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Detached start, so the script exits", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24}, {"label": "Published port and container name", "path": "compose.yaml", "side": "target", "start": 4, "end": 9}, {"label": "Script reads the variables", "step": "W1.3"}, {"label": "Failed task blocks the attach", "step": "W2.2"}], "insufficient": false}
```