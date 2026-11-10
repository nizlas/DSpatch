A pre-launch task is a shell command that VS Code runs before it starts a debug session. Here it is how the debug session gets the orders service running inside the container. As we saw in W1.1, the debug configuration no longer starts Python itself. It only attaches, so something else must first start a debug server for it to connect to. This task is that "something else".

**How VS Code finds this task.** The debug configuration's `preLaunchTask` is the string `"Start debugger in dev container"`. VS Code matches it by exact text against the `label` of the tasks in `tasks.json`. Nothing else connects the two files. A typo on either side gives a "could not find the task" error instead of a debug session. At the base revision there is no `tasks.json`, and the only configuration ("Run orders locally") is a `launch` that runs `orders.main` on the host. This file and the task in it are new.

**What "shell" means here.** A `"type": "shell"` task runs `command` in a shell, in VS Code's task terminal. `${workspaceFolder}` is a VS Code variable that VS Code fills in with the path of the open folder before the command runs. So the task simply runs `scripts/start-debugger.sh` from the repository.

**When the task counts as "done".** VS Code has two kinds of task:

- An **ordinary task** is done when its process exits. Its exit code is the result: 0 means success, anything else means failure.
- A **background task** (`isBackground: true`) never exits, like a watch server. VS Code watches its output for a pattern that says "ready".

This task is the ordinary kind. That fits because the script's last command is `docker exec -d …` (W1.7). The `-d` makes `docker exec` return at once, so the script exits even though debugpy keeps running inside the container. With exit code 0, VS Code goes on to attach (W1.8). If the script fails, for example `exit 1` when the container isn't running, the failure path in W2 follows.

**`"problemMatcher": []`.** A problem matcher is a set of regex rules that turns a task's output lines into entries in the Problems panel. The empty list switches that off. The script's `echo` messages, including its "not running" error, appear only as text in the terminal. Success or failure is decided by the exit code alone.

**`options.env`.** These two variables are added to the script's environment. The script reads them in the next step (W1.3) as `CONTAINER="${DEV_CONTAINER:-orders-dev}"` and `PORT="${DEBUG_PORT:-5678}"`. The `:-` form means "use this default if the variable is unset or empty". The values here happen to equal the script's defaults, so today the `env` block changes nothing. It only makes the values visible and changeable here.

That points to something the reviewer should keep in mind. The same two values are written as literals in several places, and nothing checks that they agree:

- the port: `DEBUG_PORT` here, `connect.port` in the debug configuration, the `ports` mapping in `compose.yaml`, and the script's default;
- the container name: `DEV_CONTAINER` here, `container_name` in `compose.yaml`, and the script's default.

<!-- dspatch:details -->

**Why changing the port in only one place breaks the session.** The connection goes through three hops:

1. debugpy listens on `0.0.0.0:$PORT` *inside* the container (W1.7).
2. Docker forwards host port 5678 to container port 5678, through the `ports` entry in `compose.yaml` (W1.4).
3. VS Code connects to `localhost:5678` on the host (W1.8).

Suppose someone sets `DEBUG_PORT` to 5679 here only. debugpy would then listen on 5679 inside the container, but Docker forwards only 5678, and VS Code still dials 5678. Because of `--wait-for-client`, the service would sit waiting for a debugger that never arrives. The task itself would still exit 0, so VS Code would try the attach and fail with a connection error rather than a clear message. Changing the container name in only one place fails earlier and more clearly: the script's `docker inspect` check (W1.3) does not find a running container and exits non-zero.

**What a non-zero exit actually does.** In VS Code, a failed `preLaunchTask` doesn't silently cancel the session. Normally VS Code shows a dialog saying the task terminated with an exit code, with choices such as *Debug Anyway*, *Show Errors* and *Abort*. That is editor behaviour, not something this repository configures; W2.2 follows that path.

**Two practical points (observations, not verified here):**

- The task runs the script file directly, not through `bash script.sh`. So the file must be marked executable in git, and a shell that understands the `#!/usr/bin/env bash` line must be available. On a Linux or macOS host that is normal. On a Windows host whose default task shell is PowerShell or cmd, the command probably won't run as intended. The executable bit is not visible in the files available here.
- Since output is not parsed, the only error feedback is the script's own `>&2` message in the task terminal (W1.3). That is enough because the script prints a clear fix ("Start it with: docker compose up -d dev").

```dspatch-references
{"references": [
  {"label": "The task: label, shell command, env and empty problemMatcher", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10},
  {"label": "Debug configuration that names the task and attaches", "step": "W1.1"},
  {"label": "Base: the old launch configuration ran orders.main on the host", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Script reads DEV_CONTAINER and DEBUG_PORT with defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6},
  {"label": "Container check and exit 1", "step": "W1.3"},
  {"label": "Container name and published ports", "step": "W1.4"},
  {"label": "Detached docker exec lets the script exit", "step": "W1.7"},
  {"label": "Attach through the published port", "step": "W1.8"},
  {"label": "Failed task blocks the attach", "step": "W2.2"}
], "insufficient": false}
```