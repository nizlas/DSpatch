This is the configuration the user picks in VS Code's Run and Debug view, and the walk starts here. It changes how debugging works. **With `"request": "attach"`, VS Code no longer starts the Python program. It connects to a debugpy process that something else has already started.** In the earlier revision, this configuration ("Run the service") used `"request": "launch"` with `program` set to `service/main.py`, so VS Code ran the service locally in its integrated terminal.

Because VS Code no longer starts the service, something else has to. The `preLaunchTask` setting, `"Start the service container"`, names the task VS Code runs before it attaches. The next step (W1.2) follows that label to the task that starts the container. The rest of this configuration, the address to connect to and how container paths map to the workspace, comes back in W1.6.

<!-- dspatch:details -->
VS Code finds the task by matching the `preLaunchTask` string exactly against a task's `label`. Renaming either one without the other breaks the link. VS Code would then report that it cannot find the task, rather than starting the container.

`"type": "debugpy"` is the same in both revisions. Only the request mode changed, and with it the setup around the debugger: debugpy now runs inside the container, and VS Code acts only as the client that connects to it.