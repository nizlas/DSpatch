This is where debugging starts. Pressing F5 on this configuration no longer runs the service on the developer's machine. Instead, VS Code connects to a Python process that is already running somewhere else.

- **Before the change**, the configuration was called "Run the service" and used `"request": "launch"`. VS Code itself started `service/main.py` in the integrated terminal under debugpy.
- **Now** it is called "Attach to the service in the container" and uses `"request": "attach"`. The `debugpy` debugger type stays the same, but VS Code starts no program. It only opens a debugger connection.

Because VS Code no longer starts the service, something else has to. That is the job of `preLaunchTask`, the line just after this step's code. It names the task `"Start the service container"`, which VS Code runs before it tries to attach. The next step follows that label into the task definition, where the container is started.

<!-- dspatch:details -->
The rest of this configuration says where to attach: `connect` and `pathMappings`. Those settings only make sense once the container's debug listener exists, so they are covered later, in the step where VS Code connects to the debug listener.