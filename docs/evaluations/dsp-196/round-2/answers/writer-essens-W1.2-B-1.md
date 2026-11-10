This task is new in this change. The debug configuration's `preLaunchTask` finds it by matching its `label` exactly, so the two strings must stay identical.

VS Code runs `start-debugger.sh` as an ordinary shell task and waits for it to exit before it attaches. There is no `isBackground`, so the task counts as finished only when the script exits. `problemMatcher` is empty, so VS Code doesn't read the output for errors and decides by the exit code alone. **The script's exit code decides whether the attach in W1.8 happens:**
- exit 0: VS Code goes on to connect.
- non-zero exit: the pre-launch task is reported as failed (W2 follows that path).

The task passes two values to the script through its environment: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The next step shows how the script reads them.

<!-- dspatch:details -->
- **The values are written out separately in each file.** The container name also appears as `container_name` in `compose.yaml`. The port also appears in the attach target `connect` and in the port publishing in `compose.yaml`. Nothing links these copies. If you change `DEBUG_PORT` here and nowhere else, debugpy listens on a container port that compose doesn't publish, and VS Code still connects to 5678.
- **The script needs a POSIX shell.** The command runs the script file directly, so it relies on the `bash` shebang and the executable bit. `tasks.json` has no Windows variant, so the task assumes a host that can run bash scripts.
- **The script falls back to the same defaults.** It uses `orders-dev` and `5678` if these variables are unset, so running it by hand outside the task does the same thing.