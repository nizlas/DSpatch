Here is how VS Code gets from pressing F5 on "Debug orders in the dev container" to running the setup script. As we saw in [W1.1], that configuration names a `preLaunchTask`. A pre-launch task is something VS Code runs before it starts the debug session. VS Code finds the task by its `label`, and the string has to match exactly. This task file is new in this change. At base, `.vscode/` held only `launch.json`.

**What a "shell" task is.** With `"type": "shell"`, VS Code passes `command` to a shell in its integrated terminal, much as if you had typed it there. `${workspaceFolder}` becomes the absolute path of the opened folder, so the command is the full path to `start-debugger.sh`. `options.env` adds two variables to that shell process's environment: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The script reads them in the next step. It also has its own fallbacks with the same values (`${DEV_CONTAINER:-orders-dev}`, `${DEBUG_PORT:-5678}`), so these settings are the explicit place to change them, not the only place.

**When the task counts as finished.** This is what matters for the walk. The task does not set `isBackground`, so VS Code treats it as an ordinary task: it waits for the process to exit and reads the exit code.

- **Exit code 0:** the debug session goes on to its `attach`.
- **Any other code:** VS Code reports that the pre-launch task failed and doesn't attach by itself. The failure path is [W2.2].

So the debugger can't start until the end of `start-debugger.sh` is reached.

There's a consequence worth keeping in mind for later steps. The script's last command is `docker exec -d ...`, and `-d` means detached: it returns as soon as the command is started inside the container. "Task finished" therefore means "debugpy was launched". It does not mean "debugpy is already listening on 5678". Whether the attach in [W1.8] can arrive before debugpy is listening is a timing question that the configuration doesn't settle. This is an observation from reading the code, not something seen at runtime.

`"problemMatcher": []` says: don't scan this task's output for compiler-style errors, and don't ask me to choose a matcher. The script's output just shows up in the terminal.

<!-- dspatch:details -->
**The port appears in three places.** `DEBUG_PORT` here becomes the `--listen 0.0.0.0:$PORT` address in [W1.7]. The attach in [W1.8] connects to the hard-coded `"port": 5678` in `connect`. In between, the container has to publish that port to the host ([W1.4]). Nothing links these values. If someone changed `DEBUG_PORT` here alone, debugpy would listen on the new port while VS Code still tried 5678.

**Exit code as the contract.** The script uses `set -euo pipefail` and an explicit `exit 1`. Any failing command therefore ends the script with a non-zero status, and that is exactly the signal this non-background task passes back to the debug launch. The two parts were written to work together: the script fails loudly, and the task turns that into "don't attach".

**Platform assumption.** A shell task runs in the user's default shell. Running the `.sh` path directly needs the file to be executable and a POSIX shell that honours the `#!/usr/bin/env bash` line. That holds on Linux and macOS, and inside WSL or a remote session. On a plain Windows host, where the default shell is PowerShell or cmd, this task as written would most likely not run the script. The task has no `windows`-specific override. This is an observation about the configuration, not a finding the review has recorded.

**If a "ready" signal were wanted.** VS Code's other pattern sets `isBackground: true` with a problem matcher whose `background.endsPattern` watches the output for a line like "listening". The debug launch then continues when that line appears instead of when the process exits. This change doesn't use that pattern. It relies on the process exiting.

```dspatch-references
{"references": [{"label": "The task: label, shell command, env, empty problemMatcher", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Configuration that names the task as preLaunchTask", "step": "W1.1"}, {"label": "Script reads the env vars, with its own defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Strict mode makes failures end the task non-zero", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 3}, {"label": "Detached start: the script's last command returns at once", "step": "W1.7"}, {"label": "Attach to the hard-coded port 5678", "step": "W1.8"}, {"label": "Container that publishes the port", "step": "W1.4"}, {"label": "Failed task blocks the attach", "step": "W2.2"}, {"label": "Base revision: launch.json existed, no tasks.json", "path": ".vscode/launch.json", "side": "base", "start": 1, "end": 1}], "insufficient": false}
```