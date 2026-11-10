This is the starting point of the change. The debug configuration used to be `"request": "launch"`, where VS Code started `main.py` itself on the host. Now it is `"request": "attach"`. **VS Code no longer starts the Python program. It connects to a debugpy process that something else has already started.** That process runs inside a container.

Before attaching, VS Code runs the task named by `preLaunchTask` on the line just below: "Start the service container". The label has to match a task's `label` exactly, because VS Code uses it to find the task. The next step (W1.2) follows that label to the task that brings up the container.

<!-- dspatch:details -->
Other settings in the same configuration matter later in the walk:

- `connect` sets where the debugger connects: `localhost:5678`.
- `pathMappings` maps the container's `/app/service` to the workspace's `service` folder.

W1.6 covers both. The earlier revision's `program` and `console` settings are gone because they only apply to `launch`. With `attach`, VS Code doesn't choose the program or start it in a terminal.