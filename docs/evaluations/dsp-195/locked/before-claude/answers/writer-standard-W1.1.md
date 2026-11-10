This is the configuration the user picks in VS Code's Run and Debug view, and it is where the walk begins. It uses the Python debugger (`"type": "debugpy"`) with `"request": "attach"`. **VS Code does not start the Python program itself. It connects to a debugger that something else has already started.**

That replaces the earlier configuration. In the base revision, "Run the service" used `"request": "launch"` with a `program` pointing at `service/main.py`. VS Code ran that file on the host and debugged it directly. In this revision there is no `program` entry, so the service's own process must be started elsewhere. In this setup it is started inside a container.

Before attaching, VS Code runs a task. The `preLaunchTask` value just after the shown lines, `"Start the service container"`, names that task by its label. VS Code finds the task with the same label in the workspace's tasks file and runs it first. That task is the next step (W1.2). The rest of this configuration (`connect` to `localhost:5678` and `pathMappings`) controls where the debugger connects. It comes back in W1.6, once the walk has shown what listens on that port.

<!-- dspatch:details -->
The label only works as a link if the task's `label` matches the `preLaunchTask` value exactly. In this revision, `.vscode/tasks.json` (target, line 5) defines `"label": "Start the service container"`, which is the same string. If the two drifted apart, VS Code would report that the task cannot be found and would not start the debug session.

The `name` "Attach to the service in the container" is only the text shown in VS Code's configuration picker. Nothing else in the change refers to it.