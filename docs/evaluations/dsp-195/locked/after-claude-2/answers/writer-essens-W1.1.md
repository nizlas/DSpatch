This is where the debug session starts. The configuration changes from **launching** the Python program to **attaching** to one that is already running. Before this change, the debugger started `main.py` on the host in the integrated terminal. With `"request": "attach"`, the debugger doesn't start the service at all. It expects some other process to run it with a debugpy listener, and it only connects.

That raises the question of what starts the service. The answer is `preLaunchTask`, on the line right after the highlighted lines. It names "Start the service container", and VS Code runs that task before it attaches. This label is the link to the next step (W1.2), where the task with that name starts the container.

The remaining attach settings are `connect` (host and port) and `pathMappings`. They decide where the debugger connects and how container file paths map to workspace files. W1.6 covers them.

<!-- dspatch:details -->
The `type` stays `debugpy` on both sides, so the change is in the request mode, not the debugger. The base settings `program` and `console` are removed because an attach request starts no process. Setting `justMyCode: false` lets the debugger step into library code as well as the service's own files.