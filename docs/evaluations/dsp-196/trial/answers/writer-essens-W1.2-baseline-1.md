The debug configuration's `preLaunchTask` reaches this task through its `label`, which must match exactly. This task is new in this change, and so is the whole `tasks.json`.

It is an ordinary `shell` task that runs `start-debugger.sh`. It is not marked as a background task, so **VS Code counts it as finished when the script exits, and the exit code decides whether the debug session goes on to attach.** The empty `problemMatcher` means VS Code does not scan the output for errors, so the exit code is the only signal.

The task passes the container name and the debug port to the script as the environment variables `DEV_CONTAINER` and `DEBUG_PORT`. The script reads them in the next step (W1.3).

<!-- dspatch:details -->
Because the task ends when the script exits, the attach happens as soon as the script's last command returns. W1.7 shows that this last command starts debugpy detached, so the task does not wait for debugpy to be listening.

The values passed here are the same as the script's built-in defaults (`orders-dev` and `5678`). They have to agree with the container name and port in compose (W1.4) and with the `connect` port in the debug configuration. Nothing links these settings, so each one has to be kept in step by hand.

`command` runs the script file directly. That depends on the file being executable and on its `#!/usr/bin/env bash` line finding bash on the host. The repository doesn't show how this works for a developer whose VS Code task shell is not a POSIX shell, such as on Windows.