This task is what the debug configuration's `preLaunchTask` (W1.1) points at. VS Code finds it by its `label`, so the two strings must match exactly. If someone renames one without the other, VS Code cannot find the task and the debug session never gets to the script. This file did not exist in the earlier revision; the task is new with this change.

A few VS Code task ideas explain how this task behaves.

- **A task is a command that VS Code runs for you.** With `"type": "shell"`, VS Code passes the `command` to the default shell in a terminal panel. Here the command is the path to `start-debugger.sh` under the workspace folder. `${workspaceFolder}` is filled in by VS Code before the shell sees the command.
- **The task is not a background task.** It has no `isBackground` setting, so VS Code treats the task as finished when the process exits. It judges the result by the exit code: 0 is success, anything else is failure. For a pre-launch task, **VS Code goes on to attach only after the script has exited, and only if it exited with 0.**
- **`problemMatcher` is empty.** A problem matcher tells VS Code how to read the task's output, for example to find compiler errors or to spot a line that means "ready". An empty list means VS Code reads nothing from the output. The exit code is the only signal it uses, and VS Code does not ask the developer to choose a matcher.

`options.env` adds `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` to the environment of the shell that runs the script. In the next step (W1.3) the script reads these two values first.

<!-- dspatch:details -->
The values set here are the same as the script's own fallbacks (`${DEV_CONTAINER:-orders-dev}` and `${DEBUG_PORT:-5678}` in `scripts/start-debugger.sh`, target lines 5–6). So if this `env` block were removed, the script would still use the same container and port. If someone changes the port here, the change reaches the script. It does not reach the `connect` port in the debug configuration or the port mapping in compose. W1.8 comes back to those three places.

The success rule has one important consequence. Exit code 0 means only that the script reached its end without an error. Its last command starts debugpy in the background and returns at once (W1.7). So "task succeeded" does not mean "debugpy is listening". Nothing in this task waits for that.

The command is the script path alone. The shell starts it through the script's `#!/usr/bin/env bash` line. That works only if the file is marked executable and the host shell can run a bash script, for example on Linux, macOS or WSL. The file modes are not available in these revisions, so whether the executable bit was committed cannot be confirmed here.

If the script exits with an error, VS Code reports the pre-launch task as failed and does not attach. W2.2 covers that path.