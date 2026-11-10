This is the single debug configuration the developer picks in VS Code. With `request: "attach"`, **VS Code no longer starts the Python program itself.** It expects a debugpy process that is already running and listening, and connects to it.

The earlier revision used `request: "launch"` with `program` pointing at the service's `main.py`. That ran the service on the host, in the integrated terminal. That path is gone: the service now has to be started somewhere else, and this configuration only connects the debugger to it.

That start is the job of `preLaunchTask: "Start the service container"`, the line just after the highlighted range. VS Code runs the task with that label before it attempts to attach. The label is how the next step finds the task that starts the container.

<!-- dspatch:details -->
The rest of the configuration (`connect` to `localhost:5678`, `pathMappings` from the container's `/app/service` to the workspace's `service` folder, and `justMyCode: false`) only matters once the container is running. Those settings are covered in the editor-side connection step later in the walk.