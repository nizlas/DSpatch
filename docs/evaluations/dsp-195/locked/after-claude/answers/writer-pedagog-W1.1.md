Here a person starts debugging in VS Code. They pick the entry named "Attach to the service in the container" from the Run and Debug list. VS Code then follows the settings in that entry.

Two settings decide what happens:

- **`type: "debugpy"`** gives the session to the Python debugger extension. On the Python side, the debugger is a library called debugpy.
- **`request: "attach"`** sets the mode. VS Code has two kinds of debug request:
  - `"launch"`: VS Code starts the program itself, under the debugger.
  - `"attach"`: VS Code starts nothing. It connects to a program that is already running and already waiting for a debugger.

**This entry uses attach, so pressing Start does not run `service/main.py` on the developer's machine.** Something else has to start the service and its debugger listener first. The rest of the walk shows what does that. A good comparison is the difference between running a program under a debugger and connecting a debugger to a server that is already up.

The setting just below the lines shown here, `preLaunchTask: "Start the service container"`, names that "something else". VS Code runs the task with this label before it tries to attach. The match is by exact text, so this string must be the same as a task's `label` in the workspace's task file. The next step (W1.2) follows that label to the task that starts Docker Compose.

<!-- dspatch:details -->
**Compared with the earlier revision:** this replaces a launch-mode configuration called "Run the service" (`.vscode/launch.json`, base, lines 4–10). That one had `request: "launch"` and a `program` setting pointing at `${workspaceFolder}/service/main.py`, with output going to VS Code's integrated terminal. That base configuration ran the service directly on the host, with no container and no pre-launch task. The new configuration has no `program` setting. In attach mode it would not be used anyway, because VS Code is not the one starting the process.

**What attach still needs:** the settings for where to connect (`connect`) and how to match container file paths to workspace files (`pathMappings`) are also in this configuration. W1.6 explains them, after the walk has shown what listens on the other end.

**About timing:** `preLaunchTask` makes VS Code run the task before attaching. It does not make VS Code wait until the service is ready. W1.6 returns to what that means for this task.