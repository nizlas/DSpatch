This task is the link between the editor and the container. VS Code finds it because the configuration's `preLaunchTask` names this `label` exactly, and the task is new in this change. It does one thing: it runs `start-debugger.sh` with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` added to its environment. The script reads both values in the next step (W1.3).

**VS Code attaches only after this task has finished, and only if it succeeds.** This is an ordinary shell task, not a background task, so VS Code treats it as finished when the script exits. The empty `problemMatcher` means no output is scanned for errors, so the exit code alone decides success. A non-zero exit means no attach; W2 follows that case.

<!-- dspatch:details -->
The port appears in three places, and nothing links them. It is the value of `DEBUG_PORT` here, the `connect.port` in the debug configuration, and the published port in the compose file. If you change one, you have to change the others by hand. W1.8 comes back to this.

Two consequences follow from what is written here:

- **The script is run directly.** `command` points at the script file and gives no interpreter. So the script must be executable and must run in a shell that understands its `#!/usr/bin/env bash` line. On a Linux or macOS host that is normal. A Windows host with a default shell would need more setup, and nothing in the change provides it.
- **The script must exit soon.** VS Code waits for the script to exit before it attaches. The script can exit before the service is ready because it starts the service detached (W1.7), and that is why this works.