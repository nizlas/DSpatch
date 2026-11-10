This is where the script hands its work over. It does not run the service itself. It starts a separate debugpy process inside the container and returns. Because this is the script's last command, the script exits successfully right away, and that is the exit the pre-launch task waits for (W1.2).

From this point **two things run independently**:

- **VS Code** sees the task succeed and goes on to attach (next step).
- **debugpy** starts up in the container, opens its listener on `PORT`, and holds `orders.main` back until a debugger client connects. The service only starts after the attach.

Two consequences matter when judging the change:

- **The task cannot see this process.** The `-d` flag detaches it, so its output and errors never reach the task terminal. If debugpy fails to start, for example because the import fails or the port is taken, the task has still succeeded. The only sign is that the attach finds nothing listening.
- **The debug server is exposed.** debugpy listens on `0.0.0.0`, which the compose port publishing needs. But compose publishes 5678 without a host address, so the debug server, which has no authentication, can be reached on every host interface, not just localhost (W1.4).

<!-- dspatch:details -->

The success the task reports means only that `docker exec -d` started the process. It does not mean debugpy is listening yet. Nothing in the script or the task waits until the listener is up, so the attach can arrive before the server is ready. The next step picks this up.

The script does not check whether an earlier run's debugpy or service process is still alive in the container. A second F5 without restarting the container starts another debugpy on the same `PORT`. That one most likely fails to bind because the port is taken, and the failure stays invisible for the reason above.

`-m orders.main` resolves because the compose service sets `working_dir: /workspace` (compose.yaml, target, line 5), and `docker exec` uses that directory, which holds the bind-mounted repository. The process runs as root, which is what the log file ownership in W1.9 depends on.

The listen port comes from `PORT`, but compose publishes container port 5678 only (compose.yaml, target, line 9). If `DEBUG_PORT` were set to anything else, debugpy would listen on a port that is not published.