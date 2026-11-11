This file is new in this change. A **task** in VS Code is a named command that the editor can run for you. Tasks live in a `tasks.json` file, and other features can refer to them by their `label`. The debug configuration from the previous step names a task in `preLaunchTask`. VS Code finds the task to run by comparing that string with each task's `label`, so the two must match exactly, character for character. If you rename one, you must rename the other, or VS Code will report that it cannot find the task.

**How VS Code knows the task is done.** The task is `"type": "shell"`. VS Code passes `command` to a shell in a terminal panel, and `${workspaceFolder}` expands to the repository root. It has no `isBackground` setting, so it is an ordinary task, and an ordinary task counts as finished when its process exits. The exit code decides what happens next:

- **Exit code 0:** VS Code goes on and attaches, using the `connect` and `pathMappings` settings from the previous step.
- **Non-zero exit code:** VS Code treats the task as failed and does not simply attach. The second walk follows that case.

So the whole script must run to the end before the debugger tries to connect. A background task works differently: it is meant to keep running, and VS Code needs a problem matcher that recognises a "ready" line in the output before it moves on. That machinery isn't used here.

**What the script receives.** `options.env` adds two environment variables to the shell process that runs the script:

- `DEV_CONTAINER=orders-dev`
- `DEBUG_PORT=5678`

The script inherits them like any other environment variable. In the next step it reads them, and it falls back to defaults when they are not set.

<!-- dspatch:details -->
**Why `"problemMatcher": []`.** A problem matcher scans a task's output for compiler-style error lines and lists them in the Problems panel. An empty list says that this task's output should not be scanned. It also stops VS Code from asking which matcher to use the first time the task runs. The empty list has no effect on how VS Code decides success or failure, which still comes only from the exit code. This is also why the script reports its own errors as a message and a non-zero exit, as the next step shows.

**The port appears in several places.** The `5678` here must match the `connect.port` from the previous step. It must also match the port the container publishes, which a later step shows in the compose service. Nothing in the configuration ties these values together, so changing one means changing the others by hand.

**How the script is run.** `command` points straight at the `.sh` file instead of starting it with `bash` in front. That works only if the shell can run the file directly, which needs the file's executable permission and its `#!/usr/bin/env bash` first line. The file's permission bits can't be seen in these files, so it can't be confirmed here that this holds on every developer's machine.