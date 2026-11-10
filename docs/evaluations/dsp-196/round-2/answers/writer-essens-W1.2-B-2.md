This task is new in this change: before, there was no tasks file. The debug configuration finds it through its `label`, which must match the `preLaunchTask` string exactly.

VS Code runs the task before it attaches. It is an ordinary shell task, not a background task, so **VS Code waits for `start-debugger.sh` to exit and uses its exit code to decide whether the attach goes ahead**. `problemMatcher` is empty, so VS Code doesn't read the script's output for errors. The exit code is the only signal. From here on, whatever makes the script exit with an error stops the session before it attaches. W2 follows that path.

The task sets two values in the script's environment and passes them on to the next step:
- `DEV_CONTAINER=orders-dev` names the container to work in.
- `DEBUG_PORT=5678` sets the port debugpy will listen on.

<!-- dspatch:details -->
**Repeated values.** Both values also appear in other files, and nothing links the copies. The container name is set by `container_name` in `compose.yaml` (target, line 4). The port appears in the port mapping in `compose.yaml` (target, line 9) and as a literal in the configuration's `connect` block, which we saw in W1.1. If you change `DEBUG_PORT` here and nowhere else, debugpy listens on a port that compose doesn't publish and the attach doesn't target. The script falls back to the same two values when the variables are unset (W1.3), so running it by hand gives the same result.

**Platform.** `command` points at the script file itself. The host shell has to run it through its `#!/usr/bin/env bash` shebang, and that requires the file to be executable. The task has no `windows` variant, so on a Windows host whose default terminal is PowerShell or cmd, the command probably won't run as written. In that case the task fails and no attach happens.