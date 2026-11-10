This task is new in this change. It is the glue between the debug configuration and the script. The configuration's `preLaunchTask` names it by its `label`, and the two strings must match exactly. If they don't, VS Code reports that it cannot find the task.

**The task runs once, to completion, before the attach.** It is a plain `shell` task. It has no `isBackground` flag, so VS Code waits for `start-debugger.sh` to exit and judges the task by the script's exit code. Only after a successful exit does VS Code go on to the `attach` from W1.1. A non-zero exit stops the attach, which W2 follows. The empty `problemMatcher` only means VS Code does not scan the output for errors.

The task also fixes the two values the script works with: `DEV_CONTAINER` (`orders-dev`) and `DEBUG_PORT` (`5678`). It passes them as environment variables, and the script reads them in the next step.

<!-- dspatch:details -->
- **How the script is started:** `command` points straight at the script file, with no interpreter in front. Running it therefore depends on the file being executable and on its `#!/usr/bin/env bash` line, which in practice means a POSIX shell on the host. Nothing in the task picks a different command per platform.
- **Fallback values:** the script uses these same two values as defaults when the variables are missing. If they are changed in only one place, the task values win.
- **The port appears in more than one place:** `DEBUG_PORT` here has to match `connect.port` in the debug configuration and the port that compose publishes. W1.8 comes back to this.