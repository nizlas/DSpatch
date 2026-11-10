This is where the debug session starts. When the user picks "Attach to the service in the container" in VS Code's Run and Debug view, the Python debugger extension (`"type": "debugpy"`) reads this entry.

**`"request": "attach"` is the key change.** Before this change, the same configuration used `"request": "launch"` with a `program` pointing at the workspace's `service/main.py`. VS Code then started that Python process on the host itself. With `attach`, VS Code starts no Python process. It connects to a debugpy listener that something else has to have started already. In this walk, that's the container.

The configuration also names a task to run before the session starts: `"preLaunchTask": "Start the service container"` (the line just after this excerpt). VS Code finds the task in `tasks.json` by matching that exact label text. **That label is what the next step follows.**

<!-- dspatch:details -->

The rest of this configuration, `connect` and `pathMappings`, tells VS Code where to attach and how to match files in the container to workspace files. That's covered in W1.6, after the walk has shown what starts the listener.

With `preLaunchTask`, VS Code runs the task first and only then starts the debug session. Whether the debugger's listener is actually up when the attach happens depends on what the task waits for. W1.6 picks up that question.