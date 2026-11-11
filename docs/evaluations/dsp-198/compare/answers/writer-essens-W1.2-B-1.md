This task is the work the debug configuration from W1.1 asks for before it attaches. VS Code finds it because the configuration's `preLaunchTask` matches this task's `label` exactly. The task is new in this change; there was no tasks file before.

It is a plain `shell` task: VS Code runs `start-debugger.sh` and passes two values to the script as environment variables, **`DEV_CONTAINER` (`orders-dev`) and `DEBUG_PORT` (`5678`)**. The script reads them in the next step.

The task is not marked as a background task, and its `problemMatcher` is empty. VS Code therefore waits until the script exits and then decides from the exit code whether to go on to the attach. The script exits quickly because its last command starts the service detached (W1.7). The attach that follows is W1.8; what happens when the script fails is W2.

The port appears twice: here as `DEBUG_PORT`, and again as the attach target in the configuration's `connect`. Nothing in these files ties the two values together, so changing one means changing the other by hand.