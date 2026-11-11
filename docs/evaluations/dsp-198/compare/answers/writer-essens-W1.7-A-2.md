This is the script's last command, and the point where **the work passes to another process**. With `-d`, `docker exec` starts the command inside `orders-dev` and returns at once. It doesn't wait for debugpy. The script then reaches its end, so it exits with 0 and the pre-launch task from W1.2 counts as successful.

From here on, two things run in parallel:

- **In VS Code:** the task is finished, so the editor moves on to attach (next step).
- **In the container:** debugpy starts and listens on `0.0.0.0:$PORT`. Because of `--wait-for-client`, it doesn't run `orders.main` until a debugger connects.

Nothing makes the first wait for the second. The task finishing tells you only that the `docker exec` command was accepted. It doesn't tell you that debugpy is already listening, or that it started at all. Also, because the process is detached, debugpy's output and any startup error don't appear in the task terminal.

<!-- dspatch:details -->
Some details that link this command to the setup you've already seen:

- **Listening on `0.0.0.0`:** debugpy listens on all of the container's network interfaces, not just its own loopback. That matters because the editor will reach it from outside through the published port in compose (W1.4).
- **Port value:** `$PORT` is the `DEBUG_PORT` value from the task environment, or `5678` if that variable isn't set (W1.3). The compose port mapping is fixed at `5678:5678`. So if `DEBUG_PORT` were changed only in the task, debugpy would listen on a port that compose doesn't publish.
- **How `orders.main` is found:** `-m orders.main` is resolved from the container's working directory. In compose, `working_dir` is `/workspace`, which is the bind-mounted repository. So debugpy runs the code from the host's working tree, the same files the editor shows.
- **Ownership of the process:** the service process isn't tied to the task or to the debug session. As far as this script shows, nothing stops it later. Whether the debugpy process ends when the editor disconnects depends on debugpy's own behaviour, which this code doesn't settle.