This is where the debug session begins. The user picks **"Attach to the service in the container"** in VS Code's Run and Debug view, and the `debugpy` debugger type handles it.

The key setting is `request: "attach"`. In a `"launch"` configuration, VS Code starts the Python process itself. With `"attach"`, VS Code starts no program. It connects to a debugpy listener that something else has already started. That is why this configuration has no `program` entry: **the service runs somewhere else, and VS Code only connects to it.** The connection details (`connect` and `pathMappings`) are just below this step, and W1.6 covers them.

So what starts that process? The next field, `preLaunchTask: "Start the service container"`, names a task that VS Code runs before it tries to attach. The label is the only link between the two files. VS Code finds the task in the workspace's task definitions by its exact label, so the two strings must match exactly. In the next step we follow that label to the task.

<!-- dspatch:details -->

In the earlier revision, this configuration was called "Run the service". It used `request: "launch"` with `program` pointing at `service/main.py` and `console: "integratedTerminal"`. Back then, VS Code started the service directly on the host, with no task beforehand. The change moves the service into a container and turns VS Code from the process starter into a client that attaches. The two settings depend on each other: the attach request expects the listener to exist, and the pre-launch task is the only thing in the editor setup that starts it.