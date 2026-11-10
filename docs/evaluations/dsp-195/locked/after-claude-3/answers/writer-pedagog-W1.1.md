This is the entry in VS Code's debug configuration list. When the user picks **"Attach to the service in the container"** in the Run and Debug view and presses F5, VS Code reads this object to decide what to do.

Two settings shape everything that follows:

- `type: "debugpy"` sends the session to the Python debugger extension, which uses the `debugpy` library to talk to a Python process.
- `request: "attach"` tells that debugger **not to start any Python program itself**. It should connect to a Python process that is already running and already waiting for a debugger.

**What "attach" means here.** VS Code debug configurations come in two kinds:

- With `launch`, the editor starts the program, so it controls the process from the first line.
- With `attach`, someone else starts the program, and the editor joins it over a network connection.

The earlier revision used `launch`, with a `program` setting that pointed at `service/main.py` in the workspace (base `.vscode/launch.json` lines 7–8). VS Code ran the service on the user's own machine. With `attach`, the service will run somewhere else (here, a container), and this entry only describes how to reach it. The `connect` and `pathMappings` settings that say how are covered in step W1.6.

Because attach starts nothing, something else has to get the process running first. That is the job of the next setting, `preLaunchTask: "Start the service container"`, just below the lines shown (`.vscode/launch.json` target line 8). VS Code runs the task with that exact label before it starts the debug session. **Carry that label to the next step**, where it matches a task in the workspace's task definitions that starts Docker Compose.

<!-- dspatch:details -->
The label is the only link between the two files. VS Code matches the `preLaunchTask` string against the `label` of a task in `.vscode/tasks.json`. Nothing checks this while you edit, so a typo only shows up when you press F5, as a "could not find the task" error.

VS Code waits for the pre-launch task to finish before it attaches. But "finished" only means that the task's shell command exited. Whether that is enough for the attach to succeed depends on what the command does, which is followed in step W1.2 and taken up again in step W1.6.