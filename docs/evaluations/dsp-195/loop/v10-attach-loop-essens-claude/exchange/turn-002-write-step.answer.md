This is where debugging starts: the user picks this configuration and presses F5. **It no longer starts the service. It attaches to a service that something else has to start.**

- **Before:** the `launch` request ran `main.py` directly on the developer's machine, in VS Code's terminal. VS Code started the process and debugged it from the first line.
- **Now:** the `attach` request starts nothing. VS Code first runs the task that `preLaunchTask` names, "Start the service container". Then it connects to a debugger that should already be listening in the container (W1.8).

The service now starts outside VS Code. Debugging only works if that start has finished and the debugger is listening by the time VS Code tries to connect. The following steps show how the start happens. The next step is the task itself. Its `label` matches the `preLaunchTask` value exactly, and that match is how VS Code finds it.

<!-- dspatch:details -->
The configuration's name changed along with its behaviour. If a developer has the old "Run the service" entry selected, they now see "Attach to the service in the container" instead. No configuration left in this file runs the service locally without Docker.