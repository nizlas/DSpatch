This is the last command in the script, and the point where the work passes from the script to a separate process in the container.

Without `-d`, `docker exec` would stay attached to the command until it ended, and the script would block because debugpy is told to wait. **With `-d`, Docker starts the process inside `orders-dev` and returns at once.** That process is `python -m debugpy` with `--listen "0.0.0.0:$PORT"` and `--wait-for-client`. Because this is the last command, the script's exit code is the exit code of `docker exec -d`. That code only shows whether Docker could start the process. It says nothing about whether debugpy started listening.

From here, two things run independently:

1. **On the host:** the script exits with 0, so the plain shell task from W1.2 counts as successful, and VS Code moves on to the attach in the next step.
2. **In the container:** debugpy opens a listener on `$PORT` on all interfaces. It needs `0.0.0.0` rather than localhost, because compose's `5678:5678` mapping from W1.4 forwards traffic from outside the container. `--wait-for-client` makes debugpy hold `orders.main` back until a debugger connects.

The module name `orders.main` resolves because `docker exec` uses the container's working directory, which compose sets to `/workspace`, the bind-mounted repository.

<!-- dspatch:details -->

Some consequences of handing off to a detached process:

- **Output and errors are not visible.** Whatever debugpy or `orders.main` prints goes to the detached exec, not to the task terminal. If debugpy fails at startup (the port is already in use, the module is missing, or the import fails), the task has already succeeded and nothing on the host reports the failure. The developer would only see the attach in W1.8 fail.
- **Nothing makes the attach wait for debugpy.** The script does not check that debugpy is listening before it exits. So the order between "debugpy is listening" and "VS Code connects" is decided by timing, not by the code. The code allows the attach to arrive before the listener is ready. Whether that happens in practice cannot be read from the code.
- **Each run starts a new process.** The script never checks for or stops an earlier debugpy process. If a session from a previous run is still holding the port, the new process has nothing to bind to. It fails silently, for the reason in the first point.
- **What `set -e` covers.** `set -e` still applies to this line. If `docker exec -d` itself fails, for example because the container stopped after the check in W1.3, the script exits non-zero and the task fails. Failures inside the detached process are not covered.