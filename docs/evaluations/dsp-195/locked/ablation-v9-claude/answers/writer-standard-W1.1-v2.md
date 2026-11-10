With this change, the debug configuration no longer starts the service itself. It connects to a service that something else has already started.

- **Before:** the configuration was named "Run the service" and used `"request": "launch"` with a `program` pointing at `service/main.py`. VS Code started that Python file on the host, in its integrated terminal, under the debugger.
- **Now:** it is named "Attach to the service in the container" and uses `"request": "attach"`. There is no `program` entry. The `debugpy` debugger type tells VS Code to connect to a debugpy process that is already listening. Starting the Python process is now someone else's job.

That job is handed over by `preLaunchTask: "Start the service container"`, the line just below this step's code. VS Code runs the task with that label before it sends the attach request. The label is the only link between the two files: it has to match a task's `label` exactly. The next step (W1.2) follows that label to the task that starts the container.

<!-- dspatch:details -->
The rest of this configuration, `connect` and `pathMappings`, says where to attach and how container file paths map to workspace files. Step W1.6 covers it, after the container's debug listener has been shown.

For an attach request, VS Code only waits for the pre-launch task to finish, not for the service to be ready to accept a debugger. Whether the debugger can connect therefore depends on what that task starts and when it counts as finished. That question comes back in W1.2 and W1.6.