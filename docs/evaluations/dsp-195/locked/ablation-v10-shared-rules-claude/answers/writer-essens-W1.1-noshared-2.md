This is where the change starts. The only debug configuration, "Attach to the service in the container", still uses the `debugpy` debugger type. Its `request` has changed from `launch` to `attach`.

- **Before:** VS Code started `service/main.py` itself, on the host, through `program` in the integrated terminal.
- **Now:** VS Code no longer starts the program at all. It expects something else to be running already and **connects to a debugpy listener that something else has started**.

Because attach mode starts nothing, the configuration names a `preLaunchTask`, "Start the service container", on the line right after this step's code. VS Code runs that task before it attaches. The next step follows that label to the task that brings the service up with Docker Compose. A later step (W1.6) covers where the attach connects and how the source paths line up.

<!-- dspatch:details -->
VS Code finds the task by matching the `preLaunchTask` string to a task's `label`. If the two strings drift apart, VS Code can't find the task. Renaming either one breaks the link.

The configuration's `name` is only the text shown in VS Code's debug dropdown. Changing it doesn't affect how the debugger behaves.