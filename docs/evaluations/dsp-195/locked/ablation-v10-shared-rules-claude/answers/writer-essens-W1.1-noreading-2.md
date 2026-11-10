With `"request": "attach"`, the debugpy debugger in VS Code **no longer starts the Python program itself**. It connects to a debugpy process that something else has already started. In the base revision this configuration was `"request": "launch"` and ran the service's `main.py` locally in the integrated terminal. Now the service runs inside a container, and VS Code only connects to it.

Something therefore has to start that process first. The `preLaunchTask` setting does that job. It sits just below these lines and names the task `"Start the service container"`, which VS Code runs before it tries to attach. The next step follows that label into the task definition.

<!-- dspatch:details -->
The rest of this configuration only matters for the attach: the `connect` address (`localhost:5678`) and the `pathMappings` between the container and the workspace. Step W1.6 covers them, after the walk has shown where that port comes from.

`preLaunchTask` makes VS Code run the task before attaching. It doesn't by itself make VS Code wait until the debug listener is ready. Whether the listener is up in time depends on how the task is defined, which is the subject of the next step.