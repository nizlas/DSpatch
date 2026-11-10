VS Code finds this task through the debug configuration's `preLaunchTask` value from W1.1. VS Code matches it against the task's `label`, so the two strings must be identical. The task is new in this change; before it, the repository had no tasks file.

It is an ordinary `"type": "shell"` task. It is not marked `isBackground` and has no problem matcher that watches for a "ready" line. **For a task like this, VS Code waits until the command exits and uses the exit code to decide whether the pre-launch step succeeded.** If the code is 0, VS Code goes on to attach. If not, the attach is held back, which W2 follows. So the attach in W1.8 can start only after the script has finished, and only if it succeeded.

The empty `problemMatcher` tells VS Code not to scan the task's output for compiler-style errors. The exit code alone decides the outcome. As a side effect, VS Code doesn't ask the user which problem matcher to use when the task runs.

`options.env` adds two variables to the environment the script runs in:

- `DEV_CONTAINER` is `orders-dev`.
- `DEBUG_PORT` is `5678`.

In the next step, the script reads these two variables.

<!-- dspatch:details -->
The command is the script path itself, `${workspaceFolder}/scripts/start-debugger.sh`, with no interpreter in front of it. VS Code passes it to the user's configured shell. That works only if the script is executable and the shell understands the `#!/usr/bin/env bash` line, as a Linux or macOS shell does. The script's file mode isn't visible in these revisions, so whether it is executable can't be checked here.

The values in `options.env` match the defaults the script falls back to. The port also appears in the configuration's `connect` block. W1.8 comes back to the fact that the port is written in several places.