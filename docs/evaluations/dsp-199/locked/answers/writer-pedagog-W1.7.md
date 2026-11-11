This is the script's last command. It hands the service over to a new process inside the container, and then the script, and with it the pre-launch task, is finished.

Three parts of the command work together here:

- **`docker exec -d`** runs a command in the already running `orders-dev` container (the idle `sleep infinity` container from W1.4). Without `-d`, `docker exec` stays attached until the command ends: it streams the command's output and returns its exit code. With `-d` (detached), Docker starts the process and returns at once. The new process keeps running in the container on its own and is no longer connected to the script.
- **`python -m debugpy --listen "0.0.0.0:$PORT"`** starts debugpy, Python's debug adapter. debugpy opens a network port and waits for a debugger client such as VS Code to connect. The address `0.0.0.0` means "every network interface of the container". This matters because traffic from the published port in compose arrives on the container's network interface, not on its own `localhost`. `$PORT` is the `DEBUG_PORT` value from the task, which defaults to 5678 (W1.3).
- **`--wait-for-client -m orders.main`** tells debugpy which module to run (`orders.main`, the same module the old configuration launched locally). It also tells debugpy to hold that module back until a client has attached. So when this line returns, the service has not started; only the listener has.

**When the script ends, two things go on at the same time, and nothing coordinates them.** On the host, the script exits, VS Code sees that the task ended and moves on to attach (next step). In the container, debugpy is still starting up and getting ready to listen. Nothing here waits for the port to be open before the script exits.

<!-- dspatch:details -->

**What the exit code means now.** Because this is the last command, its exit status becomes the script's exit status. VS Code judges the task by that status (W1.2). With `-d`, the status only says whether Docker could start the process in the container. It does not say whether debugpy started listening or whether `orders.main` can be imported. Some examples of failures that the task would still report as success:

- debugpy cannot bind the port. That would happen, for example, if a debugpy from an earlier F5 is still listening on it.
- A typing error in the module name, which debugpy would only report once it runs the module.

Detached processes also have no terminal connected, so such errors never appear in the task terminal. The developer would only see that the attach in the next step fails or that the service does not behave as expected. These cases follow from how `-d` works. They have not been observed running.

**How the module is found.** `python -m orders.main` looks for the package relative to the current directory. `docker exec` uses the container's configured working directory, which compose sets to `/workspace` (W1.4). That directory is the bind-mounted repository, so the process runs the host's current source files. This is also why the editor can match breakpoints to these files through `pathMappings` in the next step.

**What happens after release.** Once VS Code connects, debugpy runs `orders.main` in this same detached process, still as the container's root user. W1.9 follows that and shows what it writes into the log folder prepared in W1.6.