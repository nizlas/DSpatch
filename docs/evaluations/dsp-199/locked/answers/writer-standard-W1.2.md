When the developer starts the debug configuration, VS Code looks up its `preLaunchTask` value, "Start debugger in dev container". It finds this task because the `label` matches that string exactly. The task file is new in this change; the base revision had only the launch configuration.

The task is an ordinary `"type": "shell"` task. VS Code runs `command` through a shell and passes the two variables in `options.env` into that process's environment:

- `DEV_CONTAINER` is `orders-dev`.
- `DEBUG_PORT` is `5678`.

**What matters for the walk is when VS Code considers the task done.** `isBackground` is not set, so this is not a background task. VS Code doesn't watch the output for a "ready" signal. It waits for the shell process to exit, then uses the exit code to decide whether the task succeeded. Only a successful exit lets the configuration from W1.1 go on to its attach. So the end of `start-debugger.sh` is what releases the attach in W1.8.

The empty `problemMatcher` means VS Code doesn't scan the task's output for errors, and it doesn't prompt for a matcher either. Whatever the script prints just appears in the task terminal.

In the next step, the script reads `DEV_CONTAINER` and `DEBUG_PORT` and checks that the container is running.

<!-- dspatch:details -->
The port appears here as `"5678"` and again in the launch configuration's `connect.port`. Neither file references the other, so the two values have to be kept in step by hand. The script also falls back to the same defaults (`orders-dev` and `5678`) if the variables are missing, so an empty `env` here would still work the same way.

`command` is the path to the script itself, with no `bash` in front. The shell therefore runs it as an executable, which depends on the file's `#!/usr/bin/env bash` line and its execute permission. That works with the usual shells on Linux and macOS. With a Windows default shell such as PowerShell, a `.sh` path wouldn't run as a bash script. This is something I noticed in the code; I didn't run it.