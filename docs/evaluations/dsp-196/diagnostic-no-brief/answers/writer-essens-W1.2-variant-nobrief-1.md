This task is new in this change. VS Code finds it because its `label` matches the configuration's `preLaunchTask` string exactly. The task is a thin wrapper: it runs `start-debugger.sh` on the host with two settings in the environment, `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The script does all the real work, starting in the next step (W1.3).

**The task must exit before VS Code attaches.** It is a plain shell task with an empty `problemMatcher` and is not marked as a background task, so VS Code waits for the script to finish. Only then does it go on to the attach. W1.7 shows the script ending without waiting for the service, and W2 covers what happens when the script fails.

<!-- dspatch:details -->
The values `orders-dev` and `5678` are written in several places that must stay in sync:

- **Port 5678:** this task's `DEBUG_PORT`, the configuration's `connect.port` (W1.8) and the published `"5678:5678"` mapping in `compose.yaml` (target, line 9).
- **Container name:** `DEV_CONTAINER` here must match `container_name: orders-dev` in `compose.yaml` (target, line 4).

The script falls back to the same two values if the variables are unset. So changing only one of these places would not cause an error until the attach fails.

`command` gives the script's path directly, with no interpreter in front of it. The task therefore relies on the host shell being able to run a bash script with the execute bit set. These files can't show whether that bit is set, or which shell VS Code uses on a given host (for example PowerShell on Windows).