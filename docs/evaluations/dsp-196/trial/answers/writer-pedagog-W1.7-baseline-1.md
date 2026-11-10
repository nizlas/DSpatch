Here the script hands its work to another process and then ends. Up to now each `docker exec` ran a command in the container and waited for it to finish, with its output in the task terminal (W1.5, W1.6). This last one is different.

**What `-d` changes.** Without `-d`, `docker exec` stays attached to the command: it streams the output and returns only when the command ends, with the command's exit code. With `-d` (detached), Docker starts the command inside the container and `docker exec` returns at once. The exit code then only says whether Docker could start the command, not how the command went. Here, the started command is `python -m debugpy ...`, and from this point it runs in the container on its own.

**What the started process does.** debugpy is the Python debug server installed in W1.5. Two of its options matter here:
- `--listen "0.0.0.0:$PORT"` opens a socket on the debug port, 5678 by default (`PORT` comes from the task's `DEBUG_PORT`, as in W1.2). The address `0.0.0.0` means "every network interface in the container". This is needed because the connection from the host arrives through Docker's port publishing (W1.4), not on the container's own loopback interface. If debugpy listened on `127.0.0.1`, the published port would lead nowhere.
- `--wait-for-client` makes debugpy hold back the program until a debugger client connects. Only then does it run `-m orders.main`. It's like a door that is unlocked but stays closed until someone knocks. The service code has not started yet, so no breakpoint can be missed during startup.

`-m orders.main` can be found because the container's `working_dir` is `/workspace` (compose.yaml, target, line 5). That is the bind-mounted repository, and `docker exec` runs in that directory by default.

**What happens next.** This line is the script's last command. It succeeds as soon as Docker has started the process, so the script exits with 0 and VS Code treats the pre-launch task as finished successfully (W1.2). From here, two things run side by side:
1. VS Code continues with the debug configuration and connects to the port (the next step, W1.8).
2. In the container, debugpy starts Python and opens its listening socket.

No step in the script or the task waits for the second to be ready before the first happens.

<!-- dspatch:details -->

**Where output and errors go.** A detached process has no connection to the task terminal. If debugpy fails after Docker has started it, nobody on the host sees the message, and the task has already reported success. For example, it could fail because the port is already taken. The developer would only notice the effect: the attach in W1.8 fails or times out. As the code reads, one way this could happen is starting the configuration twice without the first debugpy process having ended. The script does not check for or stop an earlier debugpy before starting a new one. This is a conclusion from the code, not something seen running.

**Which failures still stop the script.** `set -euo pipefail` (W1.3) still applies to this line, but only to Docker's part of it. Suppose the container stopped between the running check and here: `docker exec -d` would fail, the script would exit with a non-zero code, and VS Code would not attach (see W2.2 for how a failed task is handled). A failure inside debugpy after it has started does not reach the script.

**Lifetime.** The debugpy process, and later `orders.main` under it, belongs to the container, not to the task or the VS Code session. It keeps running until it exits or the container stops. W1.9 shows what it does once the client connects.