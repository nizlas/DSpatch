This is the script's last command, and the point where the work leaves the script. With `-d`, `docker exec` asks the Docker daemon to start a new process inside `orders-dev` and **returns as soon as the process has started, without waiting for it to finish**. That new process is `python -m debugpy`. It opens a debug server on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects.

The script ends right after this line. The pre-launch task from W1.2 counts as finished when the script exits, so it reports success, and VS Code goes on to the attach in the next step. From here on, two things run side by side:

- VS Code connects to the port, as described in the next step.
- In the container, debugpy starts up and begins listening.

Nothing here makes the first wait for the second. When the task exits, debugpy may not be listening yet.

<!-- dspatch:details -->
**What the task can no longer see.** Because the process is detached, its stdout and stderr are not connected to the task terminal. Its exit status is not connected to the script either. `set -e` only covers whether `docker exec -d` itself managed to start the process. If debugpy later fails inside the container, the task has already succeeded. Examples are a port already in use or `orders.main` failing to import. The developer would then see only a failed attach in VS Code, with no message in the task terminal. Detached output goes to the Docker daemon, not to `docker logs` (which shows only the container's main command, here `sleep infinity`). So the code gives no obvious place to read it.

**Where the module is found.** This `docker exec` sets no working directory, so the process runs in the service's `working_dir: /workspace` (shown in W1.4). That is the bind-mounted repository, so `-m orders.main` imports the source the developer is editing.

**Why `0.0.0.0`.** debugpy has to listen on all of the container's interfaces. A connection that arrives through the published port does not come in on the container's loopback interface, so a server bound to `127.0.0.1` would not receive it.

**Repeated starts.** Each run of the task starts another detached debugpy process. Nothing in the script stops a process left over from an earlier run. If an earlier process still holds the port, the new one cannot bind to it. Its failure would then be invisible, as described above.