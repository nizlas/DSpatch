This is where the change starts. In the base revision, the configuration "Run the service" used `request: "launch"`, so VS Code ran `service/main.py` itself, on the host, under debugpy. Now the configuration is **`request: "attach"`**. VS Code no longer starts the Python program. It connects its debugger to a debugpy process that something else has already started.

That "something else" is named by `preLaunchTask` just below these lines: `"Start the service container"`. VS Code runs the task with that label before it tries to attach. The next step (W1.2) follows this label to the task that starts the container.

<!-- dspatch:details -->
`type: "debugpy"` is the same in both revisions. Only the request mode changed, and the configuration was renamed to match. The `connect` and `pathMappings` settings that say where to attach come back in W1.6, after the walk has shown what is listening on the other end.