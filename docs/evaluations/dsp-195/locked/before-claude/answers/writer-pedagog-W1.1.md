This configuration is what you choose in VS Code's Run and Debug view. Its `name`, "Attach to the service in the container", is the label shown in that view's dropdown. The other two settings decide how the debug session begins.

- `type: "debugpy"` sends the session to the Python Debugger extension, which talks to **debugpy**. debugpy is the Python library that does the actual debugging work: breakpoints, stepping, and inspecting variables.
- `request: "attach"` decides who starts the Python program. VS Code supports two modes:
  - **launch**: VS Code starts the Python process itself, with the debugger already loaded in it.
  - **attach**: some other tool has already started a Python process that runs a debugpy listener. VS Code only connects to that listener over the network.

**In the earlier revision this configuration used `launch`.** It was named "Run the service" and pointed `program` at `service/main.py` in the workspace, so VS Code ran the file on the host. With `attach`, VS Code no longer runs the service at all. Something else has to start it, inside a container, with debugpy listening. That is why the configuration has no `program` setting any more.

The setting that arranges this startup is `preLaunchTask`, on the line just after `request`. Its value, `"Start the service container"`, is a task **label**. Before VS Code begins the debug session, it looks up the task in the workspace's task definitions whose `label` matches this text exactly, and runs it. Keep that label in mind: the next step (W1.2) shows the task it names, which starts the container.

<!-- dspatch:details -->
A comparison may help. `launch` is like starting a program under a debugger from the command line. `attach` is like connecting a debugger to a server that is already running and waiting for one. Attach mode depends on two things, and later steps cover both:

1. Something must start the process with a debugpy listener on a known port. Steps W1.3 and W1.5 show this.
2. VS Code must know where that listener is, and how file paths inside the container match files in the workspace. This configuration's `connect` and `pathMappings` settings hold that information. Step W1.6 explains them.

The match between `preLaunchTask` and the task's `label` is plain string equality. If the two texts drift apart, VS Code cannot find the task and reports an error, so no session starts. This is general VS Code behaviour, not something defined in this repository.

Whether VS Code then waits for the listener to be ready depends on what the task does. Step W1.6 looks at that.