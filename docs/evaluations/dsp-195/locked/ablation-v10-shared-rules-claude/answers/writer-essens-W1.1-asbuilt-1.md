This is the change in approach. Before the change, the configuration was named "Run the service" and used `"request": "launch"`, which meant VS Code started `service/main.py` itself on the host. Now it is named "Attach to the service in the container" and uses `"request": "attach"`. **VS Code no longer starts the Python program. It connects the `debugpy` debugger to a program that something else has already started.**

That "something else" is set by `preLaunchTask`. It names the task "Start the service container", which VS Code runs before it tries to attach. VS Code finds this task by matching the label exactly, and the next step (W1.2) shows the task with that label.

<!-- dspatch:details -->
Because this is an attach request, the settings that only make sense for launching are gone: `program` and `console` no longer appear. Instead the configuration now has the connection target (`connect`) and the source path mapping (`pathMappings`). Step W1.6 covers them, once the walk has shown where the listener they point at comes from.

`justMyCode` is set to `false`. This lets the debugger step into library code as well as the service's own files, including the standard-library HTTP server that the service uses in W1.8.