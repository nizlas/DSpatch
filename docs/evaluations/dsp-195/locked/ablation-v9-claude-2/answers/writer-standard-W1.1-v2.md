This is the only debug configuration in the file, so it is the one VS Code runs when you start debugging. Its `type` is `debugpy`, so VS Code's Python debugger extension handles it. The setting that decides how it works is `"request": "attach"`.

- **`launch`**: the debugger starts the Python program itself. The earlier revision did this: it ran `service/main.py` from the workspace in the integrated terminal.
- **`attach`** (this revision): the debugger starts no program. It connects to a debugpy listener in a process that is already running. **Something else must start the service and open that listener.**

That job goes to the property just below the lines shown: `"preLaunchTask": "Start the service container"`. Before VS Code attaches, it looks up the task with this exact label in the workspace's task definitions and runs it. The label is the only link between the two files, so it has to match the task's `label` character for character. The next step follows it into that task (W1.2).

The other attach settings (`connect` to `localhost:5678` and the `pathMappings`) come back in W1.6, after the walk has shown where that listener comes from.