Here the script hands the service to a separate process in the container and ends. `docker exec -d` starts `python -m debugpy` and returns at once without waiting for it. So the script exits with 0, and the pre-launch task finishes as successful (W1.2). Inside `orders-dev`, debugpy listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects.

**From here two things run side by side:** VS Code goes on to attach (next step), and debugpy starts up and opens its port in the container. Nothing between them makes sure the port is open before the attach is tried.

<!-- dspatch:details -->
What the detached start means for the developer:

- **Errors are hidden.** With `-d`, debugpy's output does not reach the task terminal. A startup failure (for example a bad module path, or the port already in use) does not appear there. The task has already succeeded by then, so the failure only shows up when the attach fails.
- **The exit code only covers the hand-off.** `set -e` stops the script only if `docker exec -d` itself fails, for example if the container stops between the earlier check and this line. Once the process has started, its failures are not reported back to the script.
- **A second press can collide.** Each run starts a new debugpy process. If one from an earlier run is still waiting or running, the new one may not be able to bind the same port. Nothing in the script looks for an existing process. This is a conclusion from the code, not something seen running.
- **The module is found through the working directory.** `-m orders.main` resolves because the compose service sets `working_dir: /workspace`, the bind-mounted repository (W1.4).
- **Listening on `0.0.0.0`** makes debugpy reachable through the container's published port, not only from inside the container. That is the path the attach uses in the next step.