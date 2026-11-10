This is the script's last command, and it is where the work leaves the script. Because of `-d`, `docker exec` only starts debugpy inside `orders-dev` and returns at once. It does not wait for the service. debugpy then runs in the container independently of the script and the task.

debugpy's options decide what that process does:
- `--listen "0.0.0.0:$PORT"` makes it accept a debugger client on every interface in the container. That is what lets the published port from compose (step W1.4) reach it.
- `--wait-for-client` makes it hold `orders.main` back until a client connects. Until then the service does not run, so it writes no log and does not serve on 8000.

When the command returns, the script ends and the task finishes. **From here two things run in parallel:**
1. VS Code moves on to attach.
2. debugpy starts up and opens its listener in the container.

Nothing in the script or the task waits for the listener to be ready. Step W1.8 picks up the attach side.

<!-- dspatch:details -->
Because this is the last command, its exit code becomes the script's exit code, and VS Code judges the task by that code. With `-d`, the exit code only reports whether Docker could start the exec. If debugpy fails later, for example because the port is taken or the module cannot be imported, the task still counts as successful.

The process also has no terminal attached. Its output and any startup error do not appear in the task terminal. You would see such a failure only indirectly, as an attach that does not connect.

Two more points:
- **Repeated starts.** The script does not check whether an earlier debugpy process from a previous start is still running in the container. A second start launches another process on the same port.
- **User.** The `docker exec` call sets no user, so the process runs as the container's default user, which this setup treats as root (step W1.6). This matters again in step W1.9, when the service creates its log file.