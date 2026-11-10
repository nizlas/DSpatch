Up to here, every `docker exec` in the script ran in the foreground: the script waited for each command in the container to finish and, because of `set -e` (W1.3), stopped if one failed. This last line works differently, and **that difference decides how the rest of the walk runs**.

**What `-d` changes.** `docker exec` normally keeps the host side connected to the process it starts in the container. It passes that process's output back and returns that process's exit code. With `-d` (detached), Docker starts the process inside `orders-dev` and returns right away. The host-side command and the container process are no longer connected. The new process belongs to the container and keeps running after the script has gone.

**What the started process does.** `python -m debugpy` is a wrapper that loads the debugger and then runs your program:

- `--listen "0.0.0.0:$PORT"` opens a debug server on the port taken from the task (W1.2, default 5678). The address `0.0.0.0` means "every network interface in the container". This matters because traffic from the host's published port (W1.4) arrives from outside the container. A server listening only on `127.0.0.1` inside the container would never see it.
- `--wait-for-client` makes debugpy wait before running any of the program. It holds `orders.main` back until a debugger client connects.
- `-m orders.main` names the module to run once that happens. The module is found relative to the container's working directory, `/workspace`, which is the bind-mounted repository (W1.4).

**What happens next.** This is the script's last command, so the script exits with that command's exit status. The pre-launch task then counts as finished (W1.2). From this moment, two things run independently:

1. VS Code sees the task end successfully and goes on to attach to `localhost:5678` (next step, W1.8).
2. Inside the container, debugpy starts up, opens its port and waits.

Nothing in the script or the task makes step 1 wait until step 2 has actually opened the port. What decides the order between them is how fast each one runs, not anything in the code.

<!-- dspatch:details -->
**What the task's success means here.** With `-d`, the exit code says only that Docker managed to start the process in the container. It does not say that debugpy is listening, or that `orders.main` will import. Some failures happen after the hand-off, for example a failed import, or a port that is already taken because an earlier debugpy from a previous F5 is still running in the container. Their output is never connected to the task terminal, and they do not change the exit code. From the code alone, the developer would see such a failure only as an attach that does not connect. Any trace of it would be inside the container, not in VS Code's task output. This follows from how detached exec works; it has not been seen in an actual run.

**Who owns the service.** The process started here is the one that later runs `main` (W1.9). Like every exec in this script, it runs as the container's default user, root. Its lifetime is tied to the container, not to the debug session. Stopping the debugger or closing VS Code only ends what that process does once the client goes away. Nothing in the script stops or replaces an earlier instance before starting a new one.