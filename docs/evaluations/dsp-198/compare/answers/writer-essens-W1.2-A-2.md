This task is new in this change. The debug configuration finds it through its `preLaunchTask` value, which must match this `label` exactly. The task runs one script, `start-debugger.sh`, and puts two values into its environment: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The script reads these two values in the next step (W1.3).

This is an ordinary shell task: it isn't marked as a background task. **VS Code treats the task as finished when the script exits, and the exit code decides what happens next.** With exit code 0, VS Code goes on to attach. With any other code, the task counts as failed, which is what W2 follows. The empty `problemMatcher` means VS Code doesn't read the script's output for errors, so the exit code is the only result it uses.

<!-- dspatch:details -->
This timing only works because the script ends quickly, as later steps show (W1.7). It starts debugpy in the background and exits straight away. A shell task that kept running would hold back the attach.

The port is written down separately in three places: here, in `connect` in the debug configuration, and in the compose service. Nothing makes them match except keeping them the same by hand. The script's defaults (W1.3) are the same values as here, so if this `env` block were removed, nothing would change.

`command` is the script's path run through the shell. On a host whose default shell can't run a bash script directly, this task would need extra setup. Nothing here checks for that.