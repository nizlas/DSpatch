Here the editor gets a single debug configuration, named "Attach to the service in the container". When the user picks it and starts debugging (for example with F5), VS Code reads three settings from it:

- **`type: "debugpy"`** chooses the debugger. The Python Debugger extension handles the session, and it uses **debugpy**, the Python debugging library.
- **`request: "attach"`** chooses how the session begins. With `"launch"`, VS Code starts the Python program itself. With `"attach"`, VS Code starts no Python process. It connects to a debugpy listener that something else has already started, and that listener runs inside the program being debugged.
- **`preLaunchTask: "Start the service container"`** is on the line right after the shown range. It names a task that VS Code runs before the debug session begins. The name is a label, not a command: VS Code looks up the task whose `label` has this exact text.

The difference from the earlier revision is the main point. In base, this configuration was named "Run the service". It used `request: "launch"` with `program` pointing at the workspace's `service/main.py` file, so VS Code ran the service on the user's own machine. In target, the configuration has no `program` at all. **Starting the service is now someone else's job, and the editor only connects to it.** The task named by `preLaunchTask` fills that gap, and the next step (W1.2) follows that label to the task that brings up the container.

<!-- dspatch:details -->
Attach mode only works if something has already started debugpy in listening mode. Here the process being debugged runs inside a container, so debugpy must be started there. A later step (W1.5) shows where that happens, in the container's command.

The rest of this object (`connect`, `pathMappings`, `justMyCode`) belongs to the attach itself. W1.6 explains it: the host and port the editor connects to, and how file paths inside the container are matched to files in the workspace.

How VS Code handles a pre-launch task is decided by VS Code, not by this repository. Here is what it normally does:

1. It runs the task named by `preLaunchTask`.
2. A task that is not marked as a background task counts as finished when its command exits, so VS Code waits for that.
3. Then it sends the attach request.

That makes it important that the task in the next step starts the container in detached mode (`-d`). In that mode, Compose's command can return before the service inside the container is listening, and the configuration defines nothing that waits for the listener. W1.6 comes back to this.