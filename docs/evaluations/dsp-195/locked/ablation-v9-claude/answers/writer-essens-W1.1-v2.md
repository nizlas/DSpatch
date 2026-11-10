This is where debugging now starts. Before the change, this configuration used `"request": "launch"`, so VS Code ran `service/main.py` itself on the host. Now it uses `"request": "attach"`: **VS Code no longer starts the Python program. It connects its `debugpy` debugger to a process that something else has already started.** That something else is a container, which the rest of this walk follows.

The `preLaunchTask` setting, just below these lines, tells VS Code to run the task labelled `"Start the service container"` before it attaches. That label is how the editor reaches the Docker side. The next step (W1.2) shows the task with that label.

<!-- dspatch:details -->
Where the attach connects and how container paths map to workspace files are set by `connect` and `pathMappings` in the same configuration. W1.6 covers both. The old configuration's `program` and `console` settings are gone, because in attach mode nothing on the host is launched.