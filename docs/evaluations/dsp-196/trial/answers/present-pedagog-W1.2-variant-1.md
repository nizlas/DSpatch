A debug configuration in VS Code can name a **task** that has to run before the debugger starts. This step shows that task. As we saw in W1.1, the configuration "Debug orders in the dev container" has `"preLaunchTask": "Start debugger in dev container"`. VS Code finds the task by matching that string exactly against a task's `label`, and this task is the match. In the base revision, `tasks.json` did not exist. The old configuration, "Run orders locally", was a `"request": "launch"` that ran `orders.main` directly, so nothing ran first.

**What a pre-launch task is, and when it is "done"**

A task is a command that VS Code runs in a terminal. For a pre-launch task, what matters is when VS Code considers it finished, because the debug session waits until then:

- An ordinary task, like this `"type": "shell"` one, is finished when its process exits. If the exit code is 0, the debug session goes on to attach. If it is non-zero, VS Code does not attach. W2 follows that failure path.
- A *background* task would be marked with `isBackground` and a problem matcher that recognises "ready" output. That is for commands that keep running, such as a dev server. This task has neither setting.

So the design depends on `start-debugger.sh` *exiting* once the service has been started, not running for the whole debug session. A later step shows how the script does this: it ends with a detached `docker exec -d`, which returns at once (W1.7). The empty `problemMatcher` tells VS Code not to scan the output for errors, so whatever the script prints is just text in the task terminal. Only the exit code decides.

**Where the script runs**

`command` points to `${workspaceFolder}/scripts/start-debugger.sh`. It runs on the **host**, in VS Code's shell, not inside the container. It reaches into the container through `docker exec`, as the next steps show.

**Handing values to the script**

`options.env` adds two variables to the script's environment:

- `DEV_CONTAINER=orders-dev`: the container to work in.
- `DEBUG_PORT=5678`: the port that debugpy will listen on.

The script reads them in the next step (W1.3). If they are missing, it falls back to the same values (`${DEV_CONTAINER:-orders-dev}`, `${DEBUG_PORT:-5678}`).

The port has to agree with `connect.port` in the debug configuration (W1.1). It also has to agree with the port that `compose.yaml` publishes (W1.4). Nothing in the code links these. They are separate literal values that someone has to keep in sync by hand.

<!-- dspatch:details -->

**Port 5678 is written in four places.** These are the task's `env`, the script's default, `connect.port`, and the compose mapping `"5678:5678"`. If you change it in the task only, the script listens on the new port inside the container. But compose still publishes 5678 and the debugger still connects to 5678, so the attach fails. The container name works the same way: `orders-dev` is in the task, in the script default, and in `container_name` in `compose.yaml`.

**"Task finished" only means the command was sent.** The task ends when the script exits, and the script's last command is `docker exec -d`. That returns as soon as Docker has started the process, not when debugpy is actually listening. The code does nothing to make the attach in W1.8 wait until debugpy has bound the port. Whether a fast attach can arrive too early depends on timing and on how the debugpy extension retries. That cannot be settled from this repository, so treat it as an open question, not an observed failure.

**How the command is run.** A `shell` task passes `command` to VS Code's default shell. The script path is called directly, so it depends on two things this repository's files can't show:
- The file must be executable (the exec bit isn't visible in these files).
- The shell must be able to run a `#!/usr/bin/env bash` script. That works in a Linux or macOS terminal. It does not work in plain PowerShell or cmd on Windows unless VS Code is set to use something like WSL or Git Bash.

The script also uses `id -u` / `id -g` on the host (W1.6), which likewise assumes a Unix-like host shell.

```dspatch-references
{"references": [{"label": "The task (label, shell command, env, empty problemMatcher)", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "The debug configuration that names this task", "step": "W1.1"}, {"label": "Old configuration: launched orders.main directly, no pre-launch task", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10}, {"label": "Script reads DEV_CONTAINER and DEBUG_PORT, with the same defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "The container check that can fail the task", "step": "W1.3"}, {"label": "Container name and published port in compose", "step": "W1.4"}, {"label": "Detached start that lets the script exit", "step": "W1.7"}, {"label": "The attach that runs after the task succeeds", "step": "W1.8"}, {"label": "Failed task blocks the attach", "step": "W2.2"}], "insufficient": false}
```