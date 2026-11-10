This task is the link between the debug configuration and the script. When you start "Debug orders in the dev container", VS Code first looks up the configuration's `preLaunchTask` value. That value must exactly match a task's `label`, and this task's label matches it ([W1.1]). The task runs `scripts/start-debugger.sh` and passes it two environment variables. `tasks.json` doesn't exist in the base revision, so the task and the file are both new in this change.

**How VS Code decides whether to attach.** `"type": "shell"` with no `isBackground` makes this an ordinary task. VS Code waits for the command to exit and treats the exit code as the result:
- **Exit 0:** the debug session continues and attaches to `localhost:5678`.
- **Non-zero exit:** the pre-launch task has failed, and the attach doesn't go ahead as normal. The other walk covers this path ([W2.1], [W2.2]).

`"problemMatcher": []` turns off output scanning, so the exit code is the only success signal VS Code gets.

This only works because the script exits quickly. Its last command is `docker exec -d …` (in a later step, [W1.7]), which returns immediately while debugpy waits inside the container for the editor to connect. If that command weren't detached, the script would never exit, and VS Code would never attach.

**The environment.** `options.env` adds `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` to the script's environment. In the next step ([W1.3]), the script reads them as `CONTAINER` and `PORT`.

<!-- dspatch:details -->

**The same values are written in several places.** Neither value in `options.env` is set only here:
- The script has its own defaults, `${DEV_CONTAINER:-orders-dev}` and `${DEBUG_PORT:-5678}`. Those defaults are the same as the values here, so the task's `env` doesn't change anything today. It just makes the values visible where the task is defined.
- Port 5678 also appears in the launch configuration's `connect.port` ([W1.8]) and in the `ports` mapping `"5678:5678"` in `compose.yaml` ([W1.4]).
- `orders-dev` is also the `container_name` in `compose.yaml`.

Nothing ties these copies together. If you changed `DEBUG_PORT` here alone, debugpy would listen on a port that isn't published from the container and that the editor doesn't connect to. The attach would fail even though the task succeeded.

**How the command runs (not established from the code).** A shell task passes `command` to the platform's default shell. Running a `.sh` path directly assumes two things:
- The script is executable. Its shebang is `#!/usr/bin/env bash`.
- The shell can run it.

On a Linux or macOS host this is the usual case. On a Windows host whose default shell is PowerShell or cmd, it probably won't run without extra configuration. The script also calls `id -u`/`id -g`, which assumes a POSIX host. The revision files don't show the file's executable bit, and nothing in `tasks.json` sets a shell or adds per-OS overrides.

```dspatch-references
{"references": [{"label": "The task: label, shell type, script path, env, empty problem matcher", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "The debug configuration that names this task", "step": "W1.1"}, {"label": "Script reads DEV_CONTAINER and DEBUG_PORT with defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Next step: the container check", "step": "W1.3"}, {"label": "Detached start that lets the script exit", "step": "W1.7"}, {"label": "Port the editor attaches to", "step": "W1.8"}, {"label": "Container name and published port", "step": "W1.4"}, {"label": "Failure path: the task fails and blocks the attach", "step": "W2.2"}], "insufficient": false}
```