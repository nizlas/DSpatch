This configuration no longer runs the service on the developer's machine. In the earlier revision, the `"launch"` request had the debugpy debugger start `service/main.py` locally. Now `"request": "attach"` makes VS Code connect to a debugpy process that is already running somewhere else, and it starts no Python program itself.

Because VS Code starts nothing itself, something else has to start the program first. The `preLaunchTask` setting does this. It names `"Start the service container"`, the task VS Code runs before it tries to attach. **That label connects this configuration to the task in the next step.**

<!-- dspatch:details -->
The rest of the configuration, `connect` and `pathMappings`, says where VS Code attaches and how container paths map to workspace files. Step W1.6 covers it after the walk has shown where the debug listener comes from.