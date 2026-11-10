This configuration no longer starts the service. In the earlier revision it was a `"launch"` configuration named "Run the service": VS Code ran `service/main.py` on the host in the integrated terminal, and the debugger owned that process. Here `request` is `"attach"`, so the `debugpy` debugger starts no Python program. **It connects to a debugpy listener that something else must already have started.** The rest of the walk follows where that listener comes from.

Two settings decide that handoff:

1. `preLaunchTask`, the line just after this step's lines, names the task VS Code runs before it tries to attach: `"Start the service container"`. VS Code matches that string against task labels. In the next step (W1.2) it leads to the shell task that runs Docker Compose.
2. The `connect` and `pathMappings` settings below it say where the debugger attaches and how container paths match workspace files. W1.6 comes back to them once the walk has shown what listens on that port.

<!-- dspatch:details -->
Some details of the configuration:

- **Same debugger type.** `type` is `"debugpy"` in both revisions. Only the request kind changed, and with it the settings that make sense. A `launch` request needs `program` and `console`, and those are gone. An `attach` request needs `connect` and, when the code runs somewhere else, `pathMappings`.
- **The name is just a label.** The configuration's `name` ("Attach to the service in the container") is what the user picks in the Run and Debug view. Nothing else in the repository refers to it.
- **The task link is a plain string match.** The link between `preLaunchTask` and the task is the label text and nothing more. If either side is renamed and the other is not, VS Code cannot find the task. In this revision the two strings match exactly.
- **The two sides are not explicitly synchronized.** The task starts the container in detached mode and defines no readiness check, as W1.2 and W1.6 show. So this configuration does not explicitly make the attach wait until the listener is ready.