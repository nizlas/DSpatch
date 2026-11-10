VS Code finds this task because its `label` matches the configuration's `preLaunchTask` string exactly (W1.1). The task is new in this change. It is the only place where the debug start runs any code of its own.

It is an ordinary `shell` task that runs `start-debugger.sh`. It is not marked as a background task, and its `problemMatcher` is empty. **So VS Code waits for the script to exit and judges the task by its exit code alone.** A zero exit code lets the attach go ahead. A non-zero exit code counts as a failed pre-launch task, which is the case W2 follows.

The task passes the container name (`DEV_CONTAINER=orders-dev`) and the debug port (`DEBUG_PORT=5678`) to the script as environment variables. The script reads them in the next step.

<!-- dspatch:details -->
The port 5678 is written here and again in the configuration's `connect` (W1.1). Nothing in the configuration reads it from this task, so the two values match only because both say 5678.

`command` names the script by path and does not call `bash`. The task therefore relies on the script being executable and on its `#!/usr/bin/env bash` line. From the files alone you cannot tell whether the repository sets the executable bit.